-- ============================================================================
-- WTF Reporting: single admin dashboard RPC
-- ----------------------------------------------------------------------------
-- get_admin_sales_dashboard(range, from, to, campaign, provider, sort, limit, offset)
--   Reads ONLY the reporting aggregate tables (never raw checkout rows).
--   Returns ONE compact jsonb payload: period + comparison metadata, KPI totals
--   (gross / external / credit / orders / tickets / AOV), previous-period values,
--   percentage changes, bounded chart buckets, bounded campaign performance,
--   available filter options, and reporting freshness / reconciliation status.
--
--   Invariant preserved everywhere: gross_pence = external_pence + credit_pence.
--   All period boundaries are Europe/London.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_sales_dashboard(
  p_range          text    DEFAULT 'today',
  p_from           date    DEFAULT NULL,
  p_to             date    DEFAULT NULL,
  p_campaign       uuid    DEFAULT NULL,
  p_provider       text    DEFAULT NULL,
  p_campaign_sort  text    DEFAULT 'gross',
  p_campaign_limit integer DEFAULT 100,
  p_campaign_offset integer DEFAULT 0
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
  v_label      text;
  v_prev_label text;

  v_span       interval;
  v_span_days  numeric;
  v_use_daily  boolean;
  v_unit       text;

  v_limit      integer := LEAST(GREATEST(COALESCE(p_campaign_limit, 100), 1), 500);
  v_offset     integer := GREATEST(COALESCE(p_campaign_offset, 0), 0);
  v_sort       text    := lower(COALESCE(p_campaign_sort, 'gross'));

  v_totals     jsonb;
  v_prev       jsonb;
  v_chart      jsonb;
  v_campaigns  jsonb;
  v_camp_total bigint;
  v_available  jsonb;
  v_meta       jsonb;
BEGIN
  -- Helper: local-midnight of a UK date as a UTC instant.
  -- ((d::timestamp) AT TIME ZONE tz) gives the instant of local 00:00.

  ------------------------------------------------------------------
  -- 1) Resolve period + comparison window (Europe/London).
  ------------------------------------------------------------------
  IF p_range = 'today' THEN
    v_start := (v_today::timestamp AT TIME ZONE v_tz);
    v_end   := v_now;
    v_prev_start := ((v_today - 1)::timestamp AT TIME ZONE v_tz);
    v_prev_end   := v_prev_start + (v_end - v_start);
    v_label := 'Today';  v_prev_label := 'Yesterday (same time)';

  ELSIF p_range = 'yesterday' THEN
    v_start := ((v_today - 1)::timestamp AT TIME ZONE v_tz);
    v_end   := (v_today::timestamp AT TIME ZONE v_tz);
    v_prev_start := ((v_today - 2)::timestamp AT TIME ZONE v_tz);
    v_prev_end   := v_start;
    v_label := 'Yesterday'; v_prev_label := 'Day before';

  ELSIF p_range = 'last_7_days' THEN
    v_start := v_now - interval '7 days';
    v_end   := v_now;
    v_prev_start := v_now - interval '14 days';
    v_prev_end   := v_now - interval '7 days';
    v_label := 'Last 7 days'; v_prev_label := 'Previous 7 days';

  ELSIF p_range = 'this_month' THEN
    v_start := (date_trunc('month', v_today::timestamp) AT TIME ZONE v_tz);
    v_end   := v_now;
    v_prev_start := (date_trunc('month', (v_today - interval '1 month')::timestamp) AT TIME ZONE v_tz);
    v_prev_end   := v_prev_start + (v_end - v_start);
    v_label := 'This month'; v_prev_label := 'Last month (to date)';

  ELSIF p_range = 'previous_month' THEN
    v_start := (date_trunc('month', (v_today - interval '1 month')::timestamp) AT TIME ZONE v_tz);
    v_end   := (date_trunc('month', v_today::timestamp) AT TIME ZONE v_tz);
    v_prev_start := (date_trunc('month', (v_today - interval '2 months')::timestamp) AT TIME ZONE v_tz);
    v_prev_end   := v_start;
    v_label := 'Previous month'; v_prev_label := 'Month before';

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
    v_label := to_char(p_from, 'DD Mon YYYY') || ' – ' || to_char(p_to, 'DD Mon YYYY');
    v_prev_label := 'Previous period';
  ELSE
    RAISE EXCEPTION 'unknown range: %', p_range;
  END IF;

  v_span      := v_end - v_start;
  v_span_days := EXTRACT(epoch FROM v_span) / 86400.0;
  v_use_daily := v_span_days > 45;   -- long ranges read the daily rollup

  -- Chart resolution.
  IF v_use_daily THEN
    v_unit := 'day';
  ELSIF p_range = 'today' THEN
    v_unit := '5 minutes';
  ELSIF p_range = 'yesterday' THEN
    v_unit := '15 minutes';
  ELSIF p_range = 'last_7_days' THEN
    v_unit := '1 hour';
  ELSIF p_range IN ('this_month','previous_month') THEN
    v_unit := 'day';
  ELSE -- custom
    v_unit := CASE WHEN v_span_days <= 2 THEN '1 hour' ELSE 'day' END;
  END IF;

  ------------------------------------------------------------------
  -- 2) KPI totals + previous, from minute (exact) or daily (long ranges).
  ------------------------------------------------------------------
  IF v_use_daily THEN
    SELECT jsonb_build_object(
             'gross_pence', COALESCE(SUM(gross_pence),0),
             'external_pence', COALESCE(SUM(external_pence),0),
             'credit_pence', COALESCE(SUM(credit_pence),0),
             'confirmed_orders', COALESCE(SUM(confirmed_orders),0),
             'tickets_sold', COALESCE(SUM(tickets_sold),0))
      INTO v_totals
      FROM public.reporting_sales_daily
     WHERE bucket_date >= (v_start AT TIME ZONE v_tz)::date
       AND bucket_date <  (v_end   AT TIME ZONE v_tz)::date
       AND (p_campaign IS NULL OR campaign_id = p_campaign)
       AND (p_provider IS NULL OR provider = p_provider);

    SELECT jsonb_build_object(
             'gross_pence', COALESCE(SUM(gross_pence),0),
             'external_pence', COALESCE(SUM(external_pence),0),
             'credit_pence', COALESCE(SUM(credit_pence),0),
             'confirmed_orders', COALESCE(SUM(confirmed_orders),0),
             'tickets_sold', COALESCE(SUM(tickets_sold),0))
      INTO v_prev
      FROM public.reporting_sales_daily
     WHERE bucket_date >= (v_prev_start AT TIME ZONE v_tz)::date
       AND bucket_date <  (v_prev_end   AT TIME ZONE v_tz)::date
       AND (p_campaign IS NULL OR campaign_id = p_campaign)
       AND (p_provider IS NULL OR provider = p_provider);
  ELSE
    SELECT jsonb_build_object(
             'gross_pence', COALESCE(SUM(gross_pence),0),
             'external_pence', COALESCE(SUM(external_pence),0),
             'credit_pence', COALESCE(SUM(credit_pence),0),
             'confirmed_orders', COALESCE(SUM(confirmed_orders),0),
             'tickets_sold', COALESCE(SUM(tickets_sold),0))
      INTO v_totals
      FROM public.reporting_sales_minute
     WHERE bucket_start >= v_start AND bucket_start < v_end
       AND (p_campaign IS NULL OR campaign_id = p_campaign)
       AND (p_provider IS NULL OR provider = p_provider);

    SELECT jsonb_build_object(
             'gross_pence', COALESCE(SUM(gross_pence),0),
             'external_pence', COALESCE(SUM(external_pence),0),
             'credit_pence', COALESCE(SUM(credit_pence),0),
             'confirmed_orders', COALESCE(SUM(confirmed_orders),0),
             'tickets_sold', COALESCE(SUM(tickets_sold),0))
      INTO v_prev
      FROM public.reporting_sales_minute
     WHERE bucket_start >= v_prev_start AND bucket_start < v_prev_end
       AND (p_campaign IS NULL OR campaign_id = p_campaign)
       AND (p_provider IS NULL OR provider = p_provider);
  END IF;

  ------------------------------------------------------------------
  -- 3) Chart buckets (bounded). date_bin for sub-day; UK date for 'day'.
  ------------------------------------------------------------------
  IF v_unit = 'day' THEN
    IF v_use_daily THEN
      SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'t')), '[]'::jsonb) INTO v_chart FROM (
        SELECT jsonb_build_object(
                 't', bucket_date,
                 'gross_pence', SUM(gross_pence),
                 'external_pence', SUM(external_pence),
                 'credit_pence', SUM(credit_pence),
                 'orders', SUM(confirmed_orders),
                 'tickets', SUM(tickets_sold)) AS row
          FROM public.reporting_sales_daily
         WHERE bucket_date >= (v_start AT TIME ZONE v_tz)::date
           AND bucket_date <  (v_end   AT TIME ZONE v_tz)::date
           AND (p_campaign IS NULL OR campaign_id = p_campaign)
           AND (p_provider IS NULL OR provider = p_provider)
         GROUP BY bucket_date
      ) s;
    ELSE
      SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'t')), '[]'::jsonb) INTO v_chart FROM (
        SELECT jsonb_build_object(
                 't', (bucket_start AT TIME ZONE v_tz)::date,
                 'gross_pence', SUM(gross_pence),
                 'external_pence', SUM(external_pence),
                 'credit_pence', SUM(credit_pence),
                 'orders', SUM(confirmed_orders),
                 'tickets', SUM(tickets_sold)) AS row
          FROM public.reporting_sales_minute
         WHERE bucket_start >= v_start AND bucket_start < v_end
           AND (p_campaign IS NULL OR campaign_id = p_campaign)
           AND (p_provider IS NULL OR provider = p_provider)
         GROUP BY (bucket_start AT TIME ZONE v_tz)::date
      ) s;
    END IF;
  ELSE
    SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'t')), '[]'::jsonb) INTO v_chart FROM (
      SELECT jsonb_build_object(
               't', date_bin(v_unit::interval, bucket_start, timestamptz 'epoch'),
               'gross_pence', SUM(gross_pence),
               'external_pence', SUM(external_pence),
               'credit_pence', SUM(credit_pence),
               'orders', SUM(confirmed_orders),
               'tickets', SUM(tickets_sold)) AS row
        FROM public.reporting_sales_minute
       WHERE bucket_start >= v_start AND bucket_start < v_end
         AND (p_campaign IS NULL OR campaign_id = p_campaign)
         AND (p_provider IS NULL OR provider = p_provider)
       GROUP BY date_bin(v_unit::interval, bucket_start, timestamptz 'epoch')
    ) s;
  END IF;

  ------------------------------------------------------------------
  -- 4) Campaign performance (bounded, server-sorted + paginated).
  --    Sourced from daily when long-range, else minute. pct_sold is a lifetime
  --    metric (all reporting history for that campaign).
  ------------------------------------------------------------------
  WITH period AS (
    SELECT campaign_id,
           SUM(gross_pence)      AS gross_pence,
           SUM(external_pence)   AS external_pence,
           SUM(credit_pence)     AS credit_pence,
           SUM(confirmed_orders) AS confirmed_orders,
           SUM(tickets_sold)     AS tickets_sold
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
     WHERE (p_campaign IS NULL OR campaign_id = p_campaign)
     GROUP BY campaign_id
  ),
  lifetime AS (
    SELECT campaign_id, SUM(tickets_sold) AS lifetime_tickets
      FROM public.reporting_sales_daily
     GROUP BY campaign_id
  ),
  joined AS (
    SELECT p.*,
           c.title, c.status, c.max_tickets_total, c.created_at,
           COALESCE(l.lifetime_tickets, 0) AS lifetime_tickets
      FROM period p
      LEFT JOIN public.campaigns c ON c.id = p.campaign_id
      LEFT JOIN lifetime l ON l.campaign_id = p.campaign_id
  )
  SELECT
    (SELECT COUNT(*) FROM joined),
    COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_camp_total, v_campaigns
  FROM (
    SELECT jsonb_build_object(
             'campaign_id', campaign_id,
             'title', COALESCE(title, '(unknown campaign)'),
             'status', COALESCE(status, 'unknown'),
             'gross_pence', gross_pence,
             'external_pence', external_pence,
             'credit_pence', credit_pence,
             'confirmed_orders', confirmed_orders,
             'tickets_sold', tickets_sold,
             'aov_pence', CASE WHEN confirmed_orders > 0
                               THEN round(gross_pence::numeric / confirmed_orders) ELSE 0 END,
             'max_tickets_total', max_tickets_total,
             'pct_sold', CASE WHEN COALESCE(max_tickets_total,0) > 0
                              THEN round(lifetime_tickets::numeric / max_tickets_total * 100, 1)
                              ELSE NULL END,
             'created_at', created_at
           ) AS row
      FROM joined
     ORDER BY
       CASE WHEN v_sort = 'gross'    THEN gross_pence END DESC NULLS LAST,
       CASE WHEN v_sort = 'external' THEN external_pence END DESC NULLS LAST,
       CASE WHEN v_sort = 'credit'   THEN credit_pence END DESC NULLS LAST,
       CASE WHEN v_sort = 'orders'   THEN confirmed_orders END DESC NULLS LAST,
       CASE WHEN v_sort = 'tickets'  THEN tickets_sold END DESC NULLS LAST,
       CASE WHEN v_sort = 'title'    THEN title END ASC NULLS LAST,
       gross_pence DESC
     LIMIT v_limit OFFSET v_offset
  ) ordered;

  ------------------------------------------------------------------
  -- 5) Available filter options (bounded) + freshness/reconciliation meta.
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

  SELECT jsonb_build_object(
           'last_refresh_at', (SELECT value->>'refreshed_at' FROM public.reporting_meta WHERE key = 'last_refresh'),
           'reconciliation', (SELECT value FROM public.reporting_meta WHERE key = 'last_reconciliation'),
           'generated_at', v_now
         )
    INTO v_meta;

  ------------------------------------------------------------------
  -- 6) Assemble compact payload.
  ------------------------------------------------------------------
  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'range', p_range, 'label', v_label,
      'start', v_start, 'end', v_end,
      'campaign', p_campaign, 'provider', p_provider),
    'comparison', jsonb_build_object(
      'label', v_prev_label, 'start', v_prev_start, 'end', v_prev_end),
    'totals', v_totals || jsonb_build_object(
      'aov_pence', CASE WHEN (v_totals->>'confirmed_orders')::bigint > 0
                        THEN round((v_totals->>'gross_pence')::numeric / (v_totals->>'confirmed_orders')::bigint)
                        ELSE 0 END),
    'previous', v_prev || jsonb_build_object(
      'aov_pence', CASE WHEN (v_prev->>'confirmed_orders')::bigint > 0
                        THEN round((v_prev->>'gross_pence')::numeric / (v_prev->>'confirmed_orders')::bigint)
                        ELSE 0 END),
    'changes', jsonb_build_object(
      'gross_pct',    public._reporting_pct((v_totals->>'gross_pence')::numeric,    (v_prev->>'gross_pence')::numeric),
      'external_pct', public._reporting_pct((v_totals->>'external_pence')::numeric, (v_prev->>'external_pence')::numeric),
      'credit_pct',   public._reporting_pct((v_totals->>'credit_pence')::numeric,   (v_prev->>'credit_pence')::numeric),
      'orders_pct',   public._reporting_pct((v_totals->>'confirmed_orders')::numeric,(v_prev->>'confirmed_orders')::numeric),
      'tickets_pct',  public._reporting_pct((v_totals->>'tickets_sold')::numeric,   (v_prev->>'tickets_sold')::numeric)),
    'chart', jsonb_build_object('unit', v_unit, 'points', v_chart),
    'campaigns', v_campaigns,
    'campaigns_total', v_camp_total,
    'available', v_available,
    'meta', v_meta
  );
END;
$$;

-- Small helper: percentage change, NULL when the previous value is zero.
CREATE OR REPLACE FUNCTION public._reporting_pct(p_cur numeric, p_prev numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN COALESCE(p_prev,0) = 0 THEN NULL
              ELSE round((p_cur - p_prev) / p_prev * 100, 1) END;
$$;

COMMENT ON FUNCTION public.get_admin_sales_dashboard(text,date,date,uuid,text,text,integer,integer) IS
  'Single compact dashboard payload from reporting aggregates only. Never reads raw checkout rows.';

-- Execution grants: service_role only (called from the authenticated admin API).
REVOKE ALL ON FUNCTION public.get_admin_sales_dashboard(text,date,date,uuid,text,text,integer,integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public._reporting_pct(numeric, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_sales_dashboard(text,date,date,uuid,text,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public._reporting_pct(numeric, numeric) TO service_role;
