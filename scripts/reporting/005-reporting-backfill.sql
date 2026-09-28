-- ============================================================================
-- WTF Reporting: historical backfill  (BOUNDED, RESTARTABLE — DO NOT RUN HERE)
-- ----------------------------------------------------------------------------
-- The backfill is NOT a single all-history transaction. It is a bounded helper
-- function that backfills ONE explicit [p_from, p_to) range per call, plus a
-- runbook generator that emits one monthly statement at a time. The operator
-- runs those statements individually, so each month COMMITS on its own and the
-- process is restartable after any failed month.
--
-- Properties:
--   * bounded: rejects ranges wider than 45 days (forces monthly chunks)
--   * restartable: re-running a month recomputes only that month (idempotent
--     delete+insert inside refresh_sales_reporting)
--   * read-only against checkout_intents (no update / no lock / no trigger)
--   * NO COMMIT inside the function — autocommit of each manual call provides
--     independent per-chunk commits
--
-- Prerequisites: 001, 002a-002e, 003, 004 already run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bounded per-range backfill. One call = one chunk = one transaction (via the
-- caller's autocommit). Delegates to the same idempotent refresh used by cron.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.backfill_sales_reporting(
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Transaction-local safety limits for the chunk.
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM set_config('lock_timeout', '5s', true);

  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'backfill_sales_reporting: p_from and p_to are required';
  END IF;
  IF p_to <= p_from THEN
    RAISE EXCEPTION 'backfill_sales_reporting: p_to (%) must be after p_from (%)', p_to, p_from;
  END IF;
  IF (p_to - p_from) > interval '45 days' THEN
    RAISE EXCEPTION 'backfill_sales_reporting: range too wide (max 45 days) — split into monthly chunks, got %', (p_to - p_from);
  END IF;

  v_result := public.refresh_sales_reporting(p_from, p_to);
  RETURN v_result || jsonb_build_object('backfill_chunk', jsonb_build_object('from', p_from, 'to', p_to));
END;
$$;

COMMENT ON FUNCTION public.backfill_sales_reporting(timestamptz, timestamptz) IS
  'Bounded (<=45d) restartable per-range backfill chunk; delegates to refresh_sales_reporting. Run one month per call.';

REVOKE ALL ON FUNCTION public.backfill_sales_reporting(timestamptz, timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_sales_reporting(timestamptz, timestamptz) TO service_role;

-- ----------------------------------------------------------------------------
-- RUNBOOK GENERATOR (read-only). Run this SELECT to print the exact list of
-- monthly statements to execute ONE AT A TIME. Copy each emitted line, run it,
-- confirm it returns ok:true, then run the next. Each line commits on its own.
-- ----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    date_trunc('month', min(COALESCE(confirmed_at, created_at))) AS first_month,
    date_trunc('month', now()) + interval '1 month'              AS end_month
  FROM public.checkout_intents
  WHERE state = 'confirmed'
    AND provider IS DISTINCT FROM 'debug'
    AND (ref IS NULL OR ref NOT LIKE 'SIM-%')
),
months AS (
  SELECT generate_series(first_month, end_month - interval '1 month', interval '1 month') AS m
  FROM bounds
  WHERE first_month IS NOT NULL
)
SELECT
  row_number() OVER (ORDER BY m)                        AS step,
  format(
    'SELECT public.backfill_sales_reporting(%L::timestamptz, %L::timestamptz);',
    m, m + interval '1 month'
  )                                                     AS run_this_statement
FROM months
ORDER BY m;

-- ----------------------------------------------------------------------------
-- Reconciliation (run AFTER all monthly chunks). Source vs reporting — every
-- difference MUST be zero.
-- ----------------------------------------------------------------------------
WITH source AS (
  SELECT
    COALESCE(SUM(total_pence), 0)::bigint AS gross,
    COALESCE(SUM(
      CASE WHEN external_payment_pence IS NOT NULL
           THEN external_payment_pence
           ELSE total_pence - COALESCE(wallet_credit_pence, 0) END
    ), 0)::bigint AS external,
    COALESCE(SUM(COALESCE(wallet_credit_pence, 0)), 0)::bigint AS credit,
    COUNT(*)::bigint AS orders,
    COALESCE(SUM(COALESCE(qty, 0)), 0)::bigint AS tickets
  FROM public.checkout_intents
  WHERE state = 'confirmed'
    AND provider IS DISTINCT FROM 'debug'
    AND (ref IS NULL OR ref NOT LIKE 'SIM-%')
    AND campaign_id IS NOT NULL
    AND confirmed_at IS NOT NULL          -- recurring/backfill path uses confirmed_at only
),
report AS (
  SELECT
    COALESCE(SUM(gross_pence), 0)::bigint      AS gross,
    COALESCE(SUM(external_pence), 0)::bigint   AS external,
    COALESCE(SUM(credit_pence), 0)::bigint     AS credit,
    COALESCE(SUM(confirmed_orders), 0)::bigint AS orders,
    COALESCE(SUM(tickets_sold), 0)::bigint     AS tickets
  FROM public.reporting_sales_daily
)
SELECT
  s.gross    AS source_gross,    r.gross    AS reporting_gross,    (s.gross    - r.gross)    AS diff_gross,
  s.external AS source_external, r.external AS reporting_external, (s.external - r.external) AS diff_external,
  s.credit   AS source_credit,   r.credit   AS reporting_credit,   (s.credit   - r.credit)   AS diff_credit,
  s.orders   AS source_orders,   r.orders   AS reporting_orders,   (s.orders   - r.orders)   AS diff_orders,
  s.tickets  AS source_tickets,  r.tickets  AS reporting_tickets,  (s.tickets  - r.tickets)  AS diff_tickets
FROM source s CROSS JOIN report r;

-- ----------------------------------------------------------------------------
-- Record reconciliation status for the dashboard freshness panel.
-- ----------------------------------------------------------------------------
WITH source AS (
  SELECT
    COALESCE(SUM(total_pence), 0)::bigint AS gross,
    COALESCE(SUM(
      CASE WHEN external_payment_pence IS NOT NULL
           THEN external_payment_pence
           ELSE total_pence - COALESCE(wallet_credit_pence, 0) END
    ), 0)::bigint AS external,
    COALESCE(SUM(COALESCE(wallet_credit_pence, 0)), 0)::bigint AS credit,
    COUNT(*)::bigint AS orders,
    COALESCE(SUM(COALESCE(qty, 0)), 0)::bigint AS tickets
  FROM public.checkout_intents
  WHERE state = 'confirmed'
    AND provider IS DISTINCT FROM 'debug'
    AND (ref IS NULL OR ref NOT LIKE 'SIM-%')
    AND campaign_id IS NOT NULL
    AND confirmed_at IS NOT NULL
),
report AS (
  SELECT
    COALESCE(SUM(gross_pence), 0)::bigint      AS gross,
    COALESCE(SUM(external_pence), 0)::bigint   AS external,
    COALESCE(SUM(credit_pence), 0)::bigint     AS credit,
    COALESCE(SUM(confirmed_orders), 0)::bigint AS orders,
    COALESCE(SUM(tickets_sold), 0)::bigint     AS tickets
  FROM public.reporting_sales_daily
)
INSERT INTO public.reporting_meta (key, value, updated_at)
SELECT
  'last_reconciliation',
  jsonb_build_object(
    'reconciled_at', now(),
    'balanced', (s.gross = r.gross AND s.external = r.external AND s.credit = r.credit
                 AND s.orders = r.orders AND s.tickets = r.tickets),
    'diff_gross', s.gross - r.gross,
    'diff_external', s.external - r.external,
    'diff_credit', s.credit - r.credit,
    'diff_orders', s.orders - r.orders,
    'diff_tickets', s.tickets - r.tickets
  ),
  now()
FROM source s CROSS JOIN report r
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
