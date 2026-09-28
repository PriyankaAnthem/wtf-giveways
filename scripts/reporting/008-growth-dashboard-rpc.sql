-- ============================================================================
-- WTF Reporting: single admin GROWTH dashboard RPC (additive, read-only)
-- ----------------------------------------------------------------------------
-- get_admin_growth_dashboard(range, from, to, campaign, provider)
--   Additive companion to get_admin_sales_dashboard. Returns ONE compact jsonb
--   payload for the Growth tab:
--     * customer performance (unique buyers, orders/buyer, external £/buyer, AOV)
--       with current + comparison-period values and % change
--     * checkout health cohort (created attempts by created_at, success rate)
--     * WTF Credit impact (wallet-assisted orders, credit redeemed, leverage)
--     * up to 50 LIVE campaign performance aggregates
--
--   Buyer-independent sales totals come from the reporting rollups (same source
--   as Overview). Buyer counts + last-sale come from a SINGLE grouped raw
--   checkout aggregate (no per-campaign / N+1 queries). NO customer identity
--   fields are ever returned — only COUNT(DISTINCT user_id) aggregates.
--
--   Eligible confirmed scope (identical to the refresh job / Overview):
--     state = 'confirmed'
--     AND provider IS DISTINCT FROM 'debug'
--     AND (ref IS NULL OR ref NOT LIKE 'SIM-%')
--   Revenue/customer metrics key off confirmed_at; checkout health keys off
--   created_at. External cash always uses the proven fallback:
--     COALESCE(external_payment_pence, total_pence - COALESCE(wallet_credit_pence,0))
--   All period boundaries are Europe/London.
--
--   STABLE, SECURITY DEFINER, service_role only. No writes, no DDL, no triggers.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_growth_dashboard(
  p_range    text DEFAULT 'today',
  p_from     date DEFAULT NULL,
  p_to       date DEFAULT NULL,
  p_campaign uuid DEFAULT NULL,
  p_provider text DEFAULT NULL
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
  v_24h        timestamptz := now() - interval '24 hours';
  v_30m        timestamptz := now() - interval '30 minutes';

  v_start      timestamptz;
  v_end        timestamptz;
  v_prev_start timestamptz;
  v_prev_end   timestamptz;

  v_span_days  numeric;
  v_use_daily  boolean;

  -- current-period customer aggregates
  v_c_buyers   bigint;
  v_c_orders   bigint;
  v_c_ext      numeric;
  -- previous-period customer aggregates
  v_p_buyers   bigint;
  v_p_orders   bigint;
  v_p_ext      numeric;

  v_customers  jsonb;
  v_health     jsonb;
  v_wallet     jsonb;
  v_campaigns  jsonb;
  v_available  jsonb;
BEGIN
  -- Transaction-local safety limit: a pathological run self-terminates.
  PERFORM set_config('statement_timeout', '15s', true);

  ------------------------------------------------------------------
  -- 1) Resolve period + comparison window (Europe/London).
  --    Identical logic to get_admin_sales_dashboard so Growth never invents a
  --    different meaning for a date range.
  ------------------------------------------------------------------
  IF p_range = 'today' THEN
    v_start := (v_today::timestamp AT TIME ZONE v_tz);
    v_end   := v_now;
    v_prev_start := ((v_today - 1)::timestamp AT TIME ZONE v_tz);
    v_prev_end   := v_prev_start + (v_end - v_start);

  ELSIF p_range = 'yesterday' THEN
    v_start := ((v_today - 1)::timestamp AT TIME ZONE v_tz);
    v_end   := (v_today::timestamp AT TIME ZONE v_tz);
    v_prev_start := ((v_today - 2)::timestamp AT TIME ZONE v_tz);
    v_prev_end   := v_start;

  ELSIF p_range = 'last_7_days' THEN
    v_start := v_now - interval '7 days';
    v_end   := v_now;
    v_prev_start := v_now - interval '14 days';
    v_prev_end   := v_now - interval '7 days';

  ELSIF p_range = 'this_month' THEN
    v_start := (date_trunc('month', v_today::timestamp) AT TIME ZONE v_tz);
    v_end   := v_now;
    v_prev_start := (date_trunc('month', (v_today - interval '1 month')::timestamp) AT TIME ZONE v_tz);
    v_prev_end   := v_prev_start + (v_end - v_start);

  ELSIF p_range = 'previous_month' THEN
    v_start := (date_trunc('month', (v_today - interval '1 month')::timestamp) AT TIME ZONE v_tz);
    v_end   := (date_trunc('month', v_today::timestamp) AT TIME ZONE v_tz);
    v_prev_start := (date_trunc('month', (v_today - interval '2 months')::timestamp) AT TIME ZONE v_tz);
    v_prev_end   := v_start;

  ELSIF p_range = 'custom' THEN
    IF p_from IS NULL OR p_to IS NULL THEN
      RAISE EXCEPTION 'custom range requires p_from and p_to';
    END IF;
    IF p_to < p_from THEN
      RAISE EXCEPTION 'p_to must be on or after p_from';
    END IF;
    IF (p_to - p_from) > 366 THEN
      RAISE EXCEPTION 'custom range too large (max 366 days)';
    END IF;
    v_start := (p_from::timestamp AT TIME ZONE v_tz);
    v_end   := ((p_to + 1)::timestamp AT TIME ZONE v_tz);   -- inclusive end date
    v_prev_start := v_start - (v_end - v_start);
    v_prev_end   := v_start;
  ELSE
    RAISE EXCEPTION 'unknown range: %', p_range;
  END IF;

  v_span_days := EXTRACT(epoch FROM (v_end - v_start)) / 86400.0;
  v_use_daily := v_span_days > 45;   -- long ranges read the daily rollup

  ------------------------------------------------------------------
  -- 2) Customer performance — current + previous period.
  --    Buyer-level, so read raw checkout_intents (rollups have no user_id).
  --    One bounded aggregate per period over the sargable confirmed_at window.
  ------------------------------------------------------------------
  SELECT
    COUNT(DISTINCT ci.user_id),
    COUNT(*),
    COALESCE(SUM(CASE WHEN ci.external_payment_pence IS NOT NULL
                      THEN ci.external_payment_pence
                      ELSE ci.total_pence - COALESCE(ci.wallet_credit_pence, 0) END), 0)
    INTO v_c_buyers, v_c_orders, v_c_ext
    FROM public.checkout_intents ci
   WHERE ci.state = 'confirmed'
     AND ci.provider IS DISTINCT FROM 'debug'
     AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
     AND ci.confirmed_at >= v_start
     AND ci.confirmed_at <  v_end
     AND (p_campaign IS NULL OR ci.campaign_id = p_campaign)
     AND (p_provider IS NULL OR ci.provider = p_provider);

  SELECT
    COUNT(DISTINCT ci.user_id),
    COUNT(*),
    COALESCE(SUM(CASE WHEN ci.external_payment_pence IS NOT NULL
                      THEN ci.external_payment_pence
                      ELSE ci.total_pence - COALESCE(ci.wallet_credit_pence, 0) END), 0)
    INTO v_p_buyers, v_p_orders, v_p_ext
    FROM public.checkout_intents ci
   WHERE ci.state = 'confirmed'
     AND ci.provider IS DISTINCT FROM 'debug'
     AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
     AND ci.confirmed_at >= v_prev_start
     AND ci.confirmed_at <  v_prev_end
     AND (p_campaign IS NULL OR ci.campaign_id = p_campaign)
     AND (p_provider IS NULL OR ci.provider = p_provider);

  v_customers := jsonb_build_object(
    'uniqueBuyers', jsonb_build_object(
      'current',  v_c_buyers,
      'previous', v_p_buyers,
      'changePct', public._reporting_pct(v_c_buyers::numeric, v_p_buyers::numeric)),
    'ordersPerBuyer', jsonb_build_object(
      'current',  CASE WHEN v_c_buyers > 0 THEN round(v_c_orders::numeric / v_c_buyers, 3) ELSE NULL END,
      'previous', CASE WHEN v_p_buyers > 0 THEN round(v_p_orders::numeric / v_p_buyers, 3) ELSE NULL END,
      'changePct', public._reporting_pct(
        CASE WHEN v_c_buyers > 0 THEN v_c_orders::numeric / v_c_buyers ELSE 0 END,
        CASE WHEN v_p_buyers > 0 THEN v_p_orders::numeric / v_p_buyers ELSE 0 END)),
    'externalRevenuePerBuyerPence', jsonb_build_object(
      'current',  CASE WHEN v_c_buyers > 0 THEN round(v_c_ext / v_c_buyers) ELSE NULL END,
      'previous', CASE WHEN v_p_buyers > 0 THEN round(v_p_ext / v_p_buyers) ELSE NULL END,
      'changePct', public._reporting_pct(
        CASE WHEN v_c_buyers > 0 THEN v_c_ext / v_c_buyers ELSE 0 END,
        CASE WHEN v_p_buyers > 0 THEN v_p_ext / v_p_buyers ELSE 0 END)),
    'averageOrderValuePence', jsonb_build_object(
      'current',  CASE WHEN v_c_orders > 0 THEN round(v_c_ext / v_c_orders) ELSE NULL END,
      'previous', CASE WHEN v_p_orders > 0 THEN round(v_p_ext / v_p_orders) ELSE NULL END,
      'changePct', public._reporting_pct(
        CASE WHEN v_c_orders > 0 THEN v_c_ext / v_c_orders ELSE 0 END,
        CASE WHEN v_p_orders > 0 THEN v_p_ext / v_p_orders ELSE 0 END))
  );

  ------------------------------------------------------------------
  -- 3) Checkout health — intents CREATED inside the period (by created_at).
  --    Includes all states (test noise excluded). In-progress = pending and
  --    younger than 30 minutes; abandoned = pending and >= 30 minutes old.
  --    Success rate denominator excludes in-progress.
  ------------------------------------------------------------------
  SELECT jsonb_build_object(
           'created',    COALESCE(t.created, 0),
           'confirmed',  COALESCE(t.confirmed, 0),
           'failed',     COALESCE(t.failed, 0),
           'abandoned',  COALESCE(t.abandoned, 0),
           'inProgress', COALESCE(t.in_progress, 0),
           'completedAttempts', COALESCE(t.confirmed + t.failed + t.abandoned, 0),
           'successRate', CASE WHEN COALESCE(t.confirmed + t.failed + t.abandoned, 0) > 0
                               THEN round(t.confirmed::numeric / (t.confirmed + t.failed + t.abandoned), 4)
                               ELSE NULL END)
    INTO v_health
    FROM (
      SELECT
        COUNT(*)                                                                        AS created,
        COUNT(*) FILTER (WHERE state = 'confirmed')                                     AS confirmed,
        COUNT(*) FILTER (WHERE state = 'failed')                                        AS failed,
        COUNT(*) FILTER (WHERE state = 'pending' AND created_at <= v_30m)               AS abandoned,
        COUNT(*) FILTER (WHERE state = 'pending' AND created_at >  v_30m)               AS in_progress
        FROM public.checkout_intents ci
       WHERE ci.created_at >= v_start
         AND ci.created_at <  v_end
         AND ci.provider IS DISTINCT FROM 'debug'
         AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
         AND (p_campaign IS NULL OR ci.campaign_id = p_campaign)
         AND (p_provider IS NULL OR ci.provider = p_provider)
    ) t;

  ------------------------------------------------------------------
  -- 4) WTF Credit impact — eligible confirmed orders in the period.
  ------------------------------------------------------------------
  SELECT jsonb_build_object(
           'confirmedOrders',                COALESCE(w.orders, 0),
           'walletOrders',                   COALESCE(w.wallet_orders, 0),
           'walletUsageRate', CASE WHEN COALESCE(w.orders,0) > 0
                                   THEN round(w.wallet_orders::numeric / w.orders, 4) ELSE NULL END,
           'walletCreditRedeemedPence',      COALESCE(w.credit, 0),
           'externalCashFromWalletOrdersPence', COALESCE(w.ext_from_wallet, 0),
           'fullyWalletFundedOrders',        COALESCE(w.fully_funded, 0),
           'averageCreditPerWalletOrderPence', CASE WHEN COALESCE(w.wallet_orders,0) > 0
                                   THEN round(w.credit::numeric / w.wallet_orders) ELSE NULL END,
           'externalCashPerCreditPound', CASE WHEN COALESCE(w.credit,0) > 0
                                   THEN round(w.ext_from_wallet::numeric / w.credit, 4) ELSE NULL END)
    INTO v_wallet
    FROM (
      SELECT
        COUNT(*)                                                     AS orders,
        COUNT(*) FILTER (WHERE COALESCE(wallet_credit_pence,0) > 0)  AS wallet_orders,
        COALESCE(SUM(COALESCE(wallet_credit_pence,0)), 0)            AS credit,
        COALESCE(SUM(CASE WHEN COALESCE(wallet_credit_pence,0) > 0
              THEN (CASE WHEN external_payment_pence IS NOT NULL
                         THEN external_payment_pence
                         ELSE total_pence - COALESCE(wallet_credit_pence,0) END)
              ELSE 0 END), 0)                                        AS ext_from_wallet,
        COUNT(*) FILTER (
          WHERE COALESCE(wallet_credit_pence,0) > 0
            AND (CASE WHEN external_payment_pence IS NOT NULL
                      THEN external_payment_pence
                      ELSE total_pence - COALESCE(wallet_credit_pence,0) END) <= 0
        )                                                            AS fully_funded
        FROM public.checkout_intents ci
       WHERE ci.state = 'confirmed'
         AND ci.provider IS DISTINCT FROM 'debug'
         AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
         AND ci.confirmed_at >= v_start
         AND ci.confirmed_at <  v_end
         AND (p_campaign IS NULL OR ci.campaign_id = p_campaign)
         AND (p_provider IS NULL OR ci.provider = p_provider)
    ) w;

  ------------------------------------------------------------------
  -- 5) Live campaign performance (every live campaign, max 50).
  --    Period sales come from the rollups (buyer-independent, same as Overview);
  --    last-24h + unique buyers + last-sale come from ONE grouped raw aggregate.
  ------------------------------------------------------------------
  WITH live AS (
    SELECT id, title, slug, status, max_tickets_total, created_at
      FROM public.campaigns
     WHERE status = 'live'
       AND (p_campaign IS NULL OR id = p_campaign)
     ORDER BY created_at DESC
     LIMIT 50
  ),
  period_sales AS (
    SELECT u.campaign_id,
           SUM(u.gross_pence)      AS gross,
           SUM(u.external_pence)   AS external,
           SUM(u.credit_pence)     AS credit,
           SUM(u.confirmed_orders) AS orders,
           SUM(u.tickets_sold)     AS tickets
      FROM (
        SELECT campaign_id, gross_pence, external_pence, credit_pence, confirmed_orders, tickets_sold
          FROM public.reporting_sales_minute
         WHERE NOT v_use_daily
           AND bucket_start >= v_start AND bucket_start < v_end
           AND (p_provider IS NULL OR provider = p_provider)
        UNION ALL
        SELECT campaign_id, gross_pence, external_pence, credit_pence, confirmed_orders, tickets_sold
          FROM public.reporting_sales_daily
         WHERE v_use_daily
           AND bucket_date >= (v_start AT TIME ZONE v_tz)::date
           AND bucket_date <  (v_end   AT TIME ZONE v_tz)::date
           AND (p_provider IS NULL OR provider = p_provider)
      ) u
     WHERE u.campaign_id IN (SELECT id FROM live)
     GROUP BY u.campaign_id
  ),
  lifetime AS (
    SELECT campaign_id, SUM(tickets_sold) AS lifetime_tickets
      FROM public.reporting_sales_daily
     WHERE campaign_id IN (SELECT id FROM live)
     GROUP BY campaign_id
  ),
  raw24 AS (
    SELECT ci.campaign_id,
           MAX(ci.confirmed_at)                                          AS last_confirmed,
           COALESCE(SUM(COALESCE(ci.qty,0)) FILTER (WHERE ci.confirmed_at >= v_24h), 0) AS tickets_24h,
           COALESCE(SUM(CASE WHEN ci.external_payment_pence IS NOT NULL
                             THEN ci.external_payment_pence
                             ELSE ci.total_pence - COALESCE(ci.wallet_credit_pence,0) END)
                    FILTER (WHERE ci.confirmed_at >= v_24h), 0)          AS external_24h,
           COUNT(DISTINCT ci.user_id) FILTER (WHERE ci.confirmed_at >= v_24h) AS buyers_24h
      FROM public.checkout_intents ci
     WHERE ci.state = 'confirmed'
       AND ci.provider IS DISTINCT FROM 'debug'
       AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
       AND ci.campaign_id IN (SELECT id FROM live)
       AND (p_provider IS NULL OR ci.provider = p_provider)
     GROUP BY ci.campaign_id
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY external_period DESC NULLS LAST, title ASC), '[]'::jsonb)
    INTO v_campaigns
    FROM (
      SELECT
        COALESCE(ps.external, 0) AS external_period,
        l.title,
        jsonb_build_object(
          'campaignId', l.id,
          'title', l.title,
          'slug', COALESCE(l.slug, ''),
          'status', l.status,
          'maxTickets', COALESCE(l.max_tickets_total, 0),
          'lifetimeTicketsSold', COALESCE(lt.lifetime_tickets, 0),
          'ticketsRemaining', GREATEST(COALESCE(l.max_tickets_total, 0) - COALESCE(lt.lifetime_tickets, 0), 0),
          'soldPercentage', CASE WHEN COALESCE(l.max_tickets_total, 0) > 0
                                 THEN round(COALESCE(lt.lifetime_tickets, 0)::numeric / l.max_tickets_total * 100, 1)
                                 ELSE NULL END,
          'externalRevenuePeriodPence', COALESCE(ps.external, 0),
          'grossSalesPeriodPence', COALESCE(ps.gross, 0),
          'creditPeriodPence', COALESCE(ps.credit, 0),
          'confirmedOrdersPeriod', COALESCE(ps.orders, 0),
          'ticketsPeriod', COALESCE(ps.tickets, 0),
          'averageOrderValuePence', CASE WHEN COALESCE(ps.orders, 0) > 0
                                         THEN round(COALESCE(ps.external, 0)::numeric / ps.orders)
                                         ELSE NULL END,
          'ticketsLast24Hours', COALESCE(r.tickets_24h, 0),
          'externalRevenueLast24HoursPence', COALESCE(r.external_24h, 0),
          'uniqueBuyersLast24Hours', COALESCE(r.buyers_24h, 0),
          'lastConfirmedAt', r.last_confirmed
        ) AS row
        FROM live l
        LEFT JOIN period_sales ps ON ps.campaign_id = l.id
        LEFT JOIN lifetime     lt ON lt.campaign_id = l.id
        LEFT JOIN raw24        r  ON r.campaign_id  = l.id
    ) rows;

  ------------------------------------------------------------------
  -- 6) Available filter options (bounded) so the Growth filter bar is
  --    self-sufficient in the same single request. No identity fields.
  ------------------------------------------------------------------
  SELECT jsonb_build_object(
           'campaigns', COALESCE((
             SELECT jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title) ORDER BY c.title)
             FROM public.campaigns c
             WHERE EXISTS (SELECT 1 FROM public.reporting_sales_daily d WHERE d.campaign_id = c.id)
           ), '[]'::jsonb),
           'providers', COALESCE((
             SELECT jsonb_agg(DISTINCT provider ORDER BY provider)
             FROM public.reporting_sales_daily
           ), '[]'::jsonb)
         )
    INTO v_available;

  ------------------------------------------------------------------
  -- 7) Assemble compact payload (camelCase; no identity fields).
  ------------------------------------------------------------------
  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'start', v_start,
      'end', v_end,
      'comparisonStart', v_prev_start,
      'comparisonEnd', v_prev_end,
      'timezone', 'Europe/London'),
    'customers', v_customers,
    'checkoutHealth', v_health,
    'walletImpact', v_wallet,
    'liveCampaigns', v_campaigns,
    'available', v_available,
    'generatedAt', v_now
  );
END;
$$;

COMMENT ON FUNCTION public.get_admin_growth_dashboard(text,date,date,uuid,text) IS
  'Single compact Growth-analytics payload (customers, checkout health, WTF Credit, live campaigns). Reads reporting rollups + one grouped raw checkout aggregate. Never returns customer identities.';

-- Execution grants: service_role only (called from the authenticated admin API).
-- _reporting_pct already exists (created in 004) and is granted to service_role.
REVOKE ALL ON FUNCTION public.get_admin_growth_dashboard(text,date,date,uuid,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_growth_dashboard(text,date,date,uuid,text) TO service_role;
