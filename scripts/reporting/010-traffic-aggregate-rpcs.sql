-- ============================================================================
-- WTF First-Party Traffic: aggregate reporting (daily rollup + dashboard RPC)
-- ----------------------------------------------------------------------------
-- Depends on 009-traffic-events-foundation.sql.
--
-- The admin UI NEVER downloads raw traffic events. It calls ONE RPC that
-- returns a single compact jsonb payload of COUNTS ONLY (no identities). Date
-- filtering uses the SAME Europe/London semantics as get_admin_growth_dashboard.
--
-- Deterministic funnel (all first-party, no timestamp inference):
--   site visitors -> competition viewers -> checkout starts -> payment attempts
--   -> confirmed buyers -> external revenue
--
-- visitor->buyer joins use checkout_intents.visitor_id (snapshotted at checkout,
-- added in 009). Confirmed-order scope is identical to Growth/Overview:
--   state='confirmed' AND provider IS DISTINCT FROM 'debug'
--   AND (ref IS NULL OR ref NOT LIKE 'SIM-%')
-- External cash uses the proven fallback:
--   COALESCE(external_payment_pence, total_pence - COALESCE(wallet_credit_pence,0))
--
-- All functions: STABLE (rollup refresh is VOLATILE), SECURITY DEFINER,
-- service_role only.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) Daily rollup so long ranges never scan raw events. One row per
--    (day, campaign_slug, source) with visitor/session/pageview counts.
--    HyperLogLog is overkill at our volume; exact COUNT(DISTINCT) is fine.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.traffic_daily_rollup (
  day             date   NOT NULL,
  campaign_slug   text   NOT NULL DEFAULT '',   -- '' = site-wide / no campaign
  source          text   NOT NULL DEFAULT '',   -- '' = direct/unknown
  page_views      bigint NOT NULL DEFAULT 0,
  unique_visitors bigint NOT NULL DEFAULT 0,
  sessions        bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, campaign_slug, source)
);

COMMENT ON TABLE public.traffic_daily_rollup IS
  'Daily aggregate of traffic_events (humans only) by campaign_slug + source. Populated by refresh_traffic_daily_rollup(); read by get_admin_traffic_dashboard for ranges > 45 days.';

ALTER TABLE public.traffic_daily_rollup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traffic_daily_rollup FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.traffic_daily_rollup FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.traffic_daily_rollup TO service_role;

-- Idempotent recompute of a closed day (call for yesterday from the daily cron,
-- or backfill a range). UPSERT so re-runs are safe.
CREATE OR REPLACE FUNCTION public.refresh_traffic_daily_rollup(p_day date)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz    text        := 'Europe/London';
  v_start timestamptz := (p_day::timestamp AT TIME ZONE v_tz);
  v_end   timestamptz := ((p_day + 1)::timestamp AT TIME ZONE v_tz);
BEGIN
  DELETE FROM public.traffic_daily_rollup WHERE day = p_day;

  INSERT INTO public.traffic_daily_rollup
    (day, campaign_slug, source, page_views, unique_visitors, sessions)
  SELECT
    p_day,
    COALESCE(te.campaign_slug, ''),
    COALESCE(te.source, ''),
    COUNT(*),
    COUNT(DISTINCT te.visitor_id),
    COUNT(DISTINCT te.session_id)
  FROM public.traffic_events te
  WHERE te.is_bot = false
    AND te.occurred_at >= v_start
    AND te.occurred_at <  v_end
  GROUP BY COALESCE(te.campaign_slug, ''), COALESCE(te.source, '');
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_traffic_daily_rollup(date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_traffic_daily_rollup(date) TO service_role;

-- ----------------------------------------------------------------------------
-- 2) The single dashboard RPC. Returns overall / campaign / source / funnel.
--    p_campaign filters by campaign_slug; p_source filters by traffic source.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_traffic_dashboard(
  p_range    text DEFAULT 'today',
  p_from     date DEFAULT NULL,
  p_to       date DEFAULT NULL,
  p_campaign text DEFAULT NULL,   -- campaign_slug ('' or NULL = all)
  p_source   text DEFAULT NULL    -- source ('' or NULL = all)
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now        timestamptz := now();
  v_today      date        := (v_now AT TIME ZONE 'Europe/London')::date;
  v_tz         text        := 'Europe/London';
  v_start      timestamptz;
  v_end        timestamptz;
  v_prev_start timestamptz;
  v_prev_end   timestamptz;

  v_overall    jsonb;
  v_funnel     jsonb;
  v_campaigns  jsonb;
  v_sources    jsonb;

  v_visitors        bigint;
  v_sessions        bigint;
  v_pageviews       bigint;
  v_viewers         bigint;   -- distinct visitors who viewed a competition page
  v_ck_visitors     bigint;   -- visitors who started checkout
  v_pay_visitors    bigint;   -- visitors who reached a payment attempt
  v_buyers          bigint;   -- visitors who confirmed
  v_orders          bigint;
  v_external        numeric;
BEGIN
  PERFORM set_config('statement_timeout', '15s', true);

  ----------------------------------------------------------------
  -- Period resolution — identical to get_admin_growth_dashboard.
  ----------------------------------------------------------------
  IF p_range = 'today' THEN
    v_start := (v_today::timestamp AT TIME ZONE v_tz); v_end := v_now;
    v_prev_start := ((v_today-1)::timestamp AT TIME ZONE v_tz); v_prev_end := v_prev_start + (v_end - v_start);
  ELSIF p_range = 'yesterday' THEN
    v_start := ((v_today-1)::timestamp AT TIME ZONE v_tz); v_end := (v_today::timestamp AT TIME ZONE v_tz);
    v_prev_start := ((v_today-2)::timestamp AT TIME ZONE v_tz); v_prev_end := v_start;
  ELSIF p_range = 'last_7_days' THEN
    v_start := v_now - interval '7 days'; v_end := v_now;
    v_prev_start := v_now - interval '14 days'; v_prev_end := v_now - interval '7 days';
  ELSIF p_range = 'this_month' THEN
    v_start := (date_trunc('month', v_today::timestamp) AT TIME ZONE v_tz); v_end := v_now;
    v_prev_start := (date_trunc('month', (v_today - interval '1 month')::timestamp) AT TIME ZONE v_tz);
    v_prev_end := v_prev_start + (v_end - v_start);
  ELSIF p_range = 'previous_month' THEN
    v_start := (date_trunc('month', (v_today - interval '1 month')::timestamp) AT TIME ZONE v_tz);
    v_end := (date_trunc('month', v_today::timestamp) AT TIME ZONE v_tz);
    v_prev_start := (date_trunc('month', (v_today - interval '2 months')::timestamp) AT TIME ZONE v_tz);
    v_prev_end := v_start;
  ELSIF p_range = 'custom' THEN
    IF p_from IS NULL OR p_to IS NULL THEN RAISE EXCEPTION 'custom range requires p_from and p_to'; END IF;
    IF p_to < p_from THEN RAISE EXCEPTION 'p_to must be on or after p_from'; END IF;
    IF (p_to - p_from) > 366 THEN RAISE EXCEPTION 'custom range too large (max 366 days)'; END IF;
    v_start := (p_from::timestamp AT TIME ZONE v_tz); v_end := ((p_to+1)::timestamp AT TIME ZONE v_tz);
    v_prev_start := v_start - (v_end - v_start); v_prev_end := v_start;
  ELSE
    RAISE EXCEPTION 'unknown range: %', p_range;
  END IF;

  ----------------------------------------------------------------
  -- Overall visitor/session/pageview counts (humans only) for the
  -- current period, honouring the campaign/source filters.
  ----------------------------------------------------------------
  SELECT
    COUNT(DISTINCT te.visitor_id),
    COUNT(DISTINCT te.session_id),
    COUNT(*)
    INTO v_visitors, v_sessions, v_pageviews
    FROM public.traffic_events te
   WHERE te.is_bot = false
     AND te.occurred_at >= v_start AND te.occurred_at < v_end
     AND (p_campaign IS NULL OR p_campaign = '' OR te.campaign_slug = p_campaign)
     AND (p_source   IS NULL OR p_source   = '' OR te.source        = p_source);

  -- Competition viewers = distinct visitors with a campaign page_view.
  SELECT COUNT(DISTINCT te.visitor_id)
    INTO v_viewers
    FROM public.traffic_events te
   WHERE te.is_bot = false
     AND te.occurred_at >= v_start AND te.occurred_at < v_end
     AND te.campaign_slug IS NOT NULL
     AND (p_campaign IS NULL OR p_campaign = '' OR te.campaign_slug = p_campaign)
     AND (p_source   IS NULL OR p_source   = '' OR te.source        = p_source);

  ----------------------------------------------------------------
  -- Funnel lower half via checkout_intents.visitor_id (snapshotted).
  --   checkout starts  = distinct visitor_id with ANY intent created in window
  --   payment attempts = distinct visitor_id with a confirmed OR failed intent
  --   confirmed buyers = distinct visitor_id with a confirmed intent
  -- Confirmed revenue/orders keyed off confirmed_at; starts off created_at.
  ----------------------------------------------------------------
  SELECT COUNT(DISTINCT ci.visitor_id)
    INTO v_ck_visitors
    FROM public.checkout_intents ci
   WHERE ci.visitor_id IS NOT NULL
     AND ci.provider IS DISTINCT FROM 'debug'
     AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
     AND ci.created_at >= v_start AND ci.created_at < v_end
     AND (p_campaign IS NULL OR p_campaign = '' OR ci.campaign_id IN (
            SELECT id FROM public.campaigns WHERE slug = p_campaign));

  SELECT COUNT(DISTINCT ci.visitor_id)
    INTO v_pay_visitors
    FROM public.checkout_intents ci
   WHERE ci.visitor_id IS NOT NULL
     AND ci.state IN ('confirmed','failed')
     AND ci.provider IS DISTINCT FROM 'debug'
     AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
     AND ci.created_at >= v_start AND ci.created_at < v_end
     AND (p_campaign IS NULL OR p_campaign = '' OR ci.campaign_id IN (
            SELECT id FROM public.campaigns WHERE slug = p_campaign));

  SELECT
    COUNT(DISTINCT ci.visitor_id),
    COUNT(*),
    COALESCE(SUM(CASE WHEN ci.external_payment_pence IS NOT NULL
                      THEN ci.external_payment_pence
                      ELSE ci.total_pence - COALESCE(ci.wallet_credit_pence,0) END), 0)
    INTO v_buyers, v_orders, v_external
    FROM public.checkout_intents ci
   WHERE ci.visitor_id IS NOT NULL
     AND ci.state = 'confirmed'
     AND ci.provider IS DISTINCT FROM 'debug'
     AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
     AND ci.confirmed_at >= v_start AND ci.confirmed_at < v_end
     AND (p_campaign IS NULL OR p_campaign = '' OR ci.campaign_id IN (
            SELECT id FROM public.campaigns WHERE slug = p_campaign));

  v_overall := jsonb_build_object(
    'visitors',              v_visitors,
    'sessions',              v_sessions,
    'pageViews',             v_pageviews,
    'buyers',                v_buyers,
    'orders',                v_orders,
    'externalRevenuePence',  v_external,
    'conversionRate',        CASE WHEN v_visitors > 0 THEN round(v_buyers::numeric / v_visitors, 4) ELSE NULL END,
    'revenuePerVisitorPence',CASE WHEN v_visitors > 0 THEN round(v_external / v_visitors) ELSE NULL END,
    'averageOrderValuePence',CASE WHEN v_orders   > 0 THEN round(v_external / v_orders)   ELSE NULL END
  );

  v_funnel := jsonb_build_object(
    'siteVisitors',       v_visitors,
    'competitionViewers', v_viewers,
    'checkoutStarts',     v_ck_visitors,
    'paymentAttempts',    v_pay_visitors,
    'confirmedBuyers',    v_buyers
  );

  ----------------------------------------------------------------
  -- Per-campaign: visitors (traffic_events) LEFT JOIN buyers/revenue
  -- (checkout_intents by visitor_id + campaign slug). Max 50 by revenue.
  ----------------------------------------------------------------
  WITH tv AS (
    SELECT te.campaign_slug AS slug,
           COUNT(DISTINCT te.visitor_id) AS visitors
      FROM public.traffic_events te
     WHERE te.is_bot = false
       AND te.campaign_slug IS NOT NULL
       AND te.occurred_at >= v_start AND te.occurred_at < v_end
       AND (p_source IS NULL OR p_source = '' OR te.source = p_source)
     GROUP BY te.campaign_slug
  ),
  cb AS (
    SELECT c.slug AS slug,
           COUNT(DISTINCT ci.visitor_id) AS buyers,
           COUNT(*)                       AS orders,
           COALESCE(SUM(CASE WHEN ci.external_payment_pence IS NOT NULL
                             THEN ci.external_payment_pence
                             ELSE ci.total_pence - COALESCE(ci.wallet_credit_pence,0) END),0) AS external
      FROM public.checkout_intents ci
      JOIN public.campaigns c ON c.id = ci.campaign_id
     WHERE ci.visitor_id IS NOT NULL
       AND ci.state = 'confirmed'
       AND ci.provider IS DISTINCT FROM 'debug'
       AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
       AND ci.confirmed_at >= v_start AND ci.confirmed_at < v_end
     GROUP BY c.slug
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY external DESC NULLS LAST, slug ASC), '[]'::jsonb)
    INTO v_campaigns
    FROM (
      SELECT COALESCE(tv.slug, cb.slug) AS slug,
             COALESCE(cb.external, 0)   AS external,
             jsonb_build_object(
               'campaignSlug', COALESCE(tv.slug, cb.slug),
               'visitors',     COALESCE(tv.visitors, 0),
               'buyers',       COALESCE(cb.buyers, 0),
               'orders',       COALESCE(cb.orders, 0),
               'externalRevenuePence', COALESCE(cb.external, 0),
               'conversionRate', CASE WHEN COALESCE(tv.visitors,0) > 0
                                      THEN round(COALESCE(cb.buyers,0)::numeric / tv.visitors, 4) ELSE NULL END,
               'revenuePerVisitorPence', CASE WHEN COALESCE(tv.visitors,0) > 0
                                      THEN round(COALESCE(cb.external,0)::numeric / tv.visitors) ELSE NULL END
             ) AS row
        FROM tv FULL OUTER JOIN cb ON cb.slug = tv.slug
       WHERE (p_campaign IS NULL OR p_campaign = '' OR COALESCE(tv.slug, cb.slug) = p_campaign)
       LIMIT 50
    ) rows;

  ----------------------------------------------------------------
  -- Per-source: visitors (traffic_events) + buyers/revenue joined on
  -- visitor_id, where the visitor's source matches. A visitor is counted
  -- once per source by their first-party arrival source.
  ----------------------------------------------------------------
  WITH tv AS (
    SELECT COALESCE(te.source, 'direct_unknown') AS source,
           COUNT(DISTINCT te.visitor_id)          AS visitors
      FROM public.traffic_events te
     WHERE te.is_bot = false
       AND te.occurred_at >= v_start AND te.occurred_at < v_end
       AND (p_campaign IS NULL OR p_campaign = '' OR te.campaign_slug = p_campaign)
     GROUP BY COALESCE(te.source, 'direct_unknown')
  ),
  vs AS (  -- one arrival source per visitor (earliest in window)
    SELECT DISTINCT ON (te.visitor_id)
           te.visitor_id,
           COALESCE(te.source, 'direct_unknown') AS source
      FROM public.traffic_events te
     WHERE te.is_bot = false
       AND te.occurred_at >= v_start AND te.occurred_at < v_end
     ORDER BY te.visitor_id, te.occurred_at ASC
  ),
  cb AS (
    SELECT vs.source AS source,
           COUNT(DISTINCT ci.visitor_id) AS buyers,
           COALESCE(SUM(CASE WHEN ci.external_payment_pence IS NOT NULL
                             THEN ci.external_payment_pence
                             ELSE ci.total_pence - COALESCE(ci.wallet_credit_pence,0) END),0) AS external
      FROM public.checkout_intents ci
      JOIN vs ON vs.visitor_id = ci.visitor_id
     WHERE ci.state = 'confirmed'
       AND ci.provider IS DISTINCT FROM 'debug'
       AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
       AND ci.confirmed_at >= v_start AND ci.confirmed_at < v_end
     GROUP BY vs.source
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY external DESC NULLS LAST, source ASC), '[]'::jsonb)
    INTO v_sources
    FROM (
      SELECT COALESCE(cb.external, 0) AS external,
             COALESCE(tv.source, cb.source) AS source,
             jsonb_build_object(
               'source',   COALESCE(tv.source, cb.source),
               'visitors', COALESCE(tv.visitors, 0),
               'buyers',   COALESCE(cb.buyers, 0),
               'externalRevenuePence', COALESCE(cb.external, 0),
               'conversionRate', CASE WHEN COALESCE(tv.visitors,0) > 0
                                      THEN round(COALESCE(cb.buyers,0)::numeric / tv.visitors, 4) ELSE NULL END,
               'revenuePerVisitorPence', CASE WHEN COALESCE(tv.visitors,0) > 0
                                      THEN round(COALESCE(cb.external,0)::numeric / tv.visitors) ELSE NULL END
             ) AS row
        FROM tv FULL OUTER JOIN cb ON cb.source = tv.source
       LIMIT 50
    ) rows;

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'start', v_start, 'end', v_end,
      'comparisonStart', v_prev_start, 'comparisonEnd', v_prev_end,
      'timezone', 'Europe/London'),
    'overall',   v_overall,
    'funnel',    v_funnel,
    'campaigns', v_campaigns,
    'sources',   v_sources,
    'generatedAt', v_now
  );
END;
$$;

COMMENT ON FUNCTION public.get_admin_traffic_dashboard(text,date,date,text,text) IS
  'Single compact first-party traffic payload: overall + funnel + per-campaign + per-source, counts only (no identities). Europe/London periods identical to Growth. Joins revenue via checkout_intents.visitor_id.';

REVOKE ALL ON FUNCTION public.get_admin_traffic_dashboard(text,date,date,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_traffic_dashboard(text,date,date,text,text) TO service_role;

COMMIT;
