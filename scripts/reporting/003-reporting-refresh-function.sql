-- ============================================================================
-- WTF Reporting: bounded, idempotent refresh function + advisory-locked job
-- ----------------------------------------------------------------------------
-- refresh_sales_reporting(p_from, p_to):
--   * aggregates confirmed, non-debug, non-SIM checkouts in [p_from, p_to)
--   * uses Europe/London minute buckets
--   * computes gross / external / credit with the proven fallback
--   * upserts reporting_sales_minute (delete+insert within the window = idempotent)
--   * fully rebuilds affected UK-day rows in reporting_sales_daily from minute rows
--   * NEVER touches checkout_intents (read-only aggregate)
--   * bounded: rejects windows larger than 366 days
--
-- refresh_sales_reporting_job(p_lookback_minutes):
--   * wraps the core call with a transaction-scoped advisory lock so overlapping
--     cron executions cannot stack; returns {skipped:true} instead of blocking
--   * used by the protected /api/jobs/refresh-reporting route
--   * default recurring lookback is 15 minutes (small, indexed, bounded)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_sales_reporting(
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from            timestamptz;
  v_to              timestamptz;
  v_day_from        date;
  v_day_to          date;
  v_minutes_written bigint := 0;
  v_days_written    bigint := 0;
BEGIN
  -- Transaction-local safety limits: a pathological run self-terminates rather
  -- than lingering. Applied BEFORE any source query or reporting-table write.
  PERFORM set_config('statement_timeout', '30s', true);
  PERFORM set_config('lock_timeout', '5s', true);

  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'refresh_sales_reporting: p_from and p_to are required';
  END IF;

  v_from := date_trunc('minute', p_from);
  v_to   := date_trunc('minute', p_to);

  IF v_to <= v_from THEN
    RAISE EXCEPTION 'refresh_sales_reporting: p_to (%) must be after p_from (%)', v_to, v_from;
  END IF;

  IF (v_to - v_from) > interval '366 days' THEN
    RAISE EXCEPTION 'refresh_sales_reporting: window too large (max 366 days), got %', (v_to - v_from);
  END IF;

  -- Affected UK-day span (for the daily rebuild).
  v_day_from := (v_from AT TIME ZONE 'Europe/London')::date;
  v_day_to   := (v_to   AT TIME ZONE 'Europe/London')::date;

  -- ------------------------------------------------------------------
  -- 1) Recompute minute rows in [v_from, v_to). Delete-then-insert makes
  --    the window idempotent (safe to run repeatedly / overlapping).
  -- ------------------------------------------------------------------
  DELETE FROM public.reporting_sales_minute m
   WHERE m.bucket_start >= v_from
     AND m.bucket_start <  v_to;

  INSERT INTO public.reporting_sales_minute (
    bucket_start, campaign_id, provider,
    gross_pence, external_pence, credit_pence,
    confirmed_orders, tickets_sold, generated_at, updated_at
  )
  SELECT
    (date_trunc('minute', (src.ts AT TIME ZONE 'Europe/London')) AT TIME ZONE 'Europe/London') AS bucket_start,
    src.campaign_id,
    src.provider,
    SUM(src.total_pence)::bigint                                  AS gross_pence,
    SUM(src.external_calc)::bigint                                AS external_pence,
    SUM(COALESCE(src.wallet_credit_pence, 0))::bigint             AS credit_pence,
    COUNT(*)::bigint                                              AS confirmed_orders,
    SUM(COALESCE(src.qty, 0))::bigint                             AS tickets_sold,
    now(), now()
  FROM (
    SELECT
      ci.campaign_id,
      ci.provider,
      ci.total_pence,
      ci.wallet_credit_pence,
      ci.qty,
      ci.confirmed_at AS ts,
      CASE
        WHEN ci.external_payment_pence IS NOT NULL
          THEN ci.external_payment_pence
        ELSE ci.total_pence - COALESCE(ci.wallet_credit_pence, 0)
      END AS external_calc
    FROM public.checkout_intents ci
    -- Sargable window: bare confirmed_at compared to constants so the partial
    -- index idx_checkout_intents_confirmed_at_confirmed is used. confirmed_at is
    -- NEVER wrapped in COALESCE/DATE_TRUNC/AT TIME ZONE/CAST here. Europe/London
    -- bucketing happens only in the SELECT above, after rows are selected.
    WHERE ci.state = 'confirmed'
      AND ci.provider IS DISTINCT FROM 'debug'
      AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
      AND ci.campaign_id IS NOT NULL
      AND ci.confirmed_at >= v_from
      AND ci.confirmed_at <  v_to
  ) src
  GROUP BY 1, 2, 3;

  GET DIAGNOSTICS v_minutes_written = ROW_COUNT;

  -- ------------------------------------------------------------------
  -- 2) Rebuild affected UK-day rows entirely from minute rows. We rebuild the
  --    WHOLE day (not just the window) so a 15-minute refresh still yields a
  --    correct full-day daily total.
  -- ------------------------------------------------------------------
  DELETE FROM public.reporting_sales_daily d
   WHERE d.bucket_date >= v_day_from
     AND d.bucket_date <= v_day_to;

  INSERT INTO public.reporting_sales_daily (
    bucket_date, campaign_id, provider,
    gross_pence, external_pence, credit_pence,
    confirmed_orders, tickets_sold, generated_at, updated_at
  )
  SELECT
    (m.bucket_start AT TIME ZONE 'Europe/London')::date AS bucket_date,
    m.campaign_id,
    m.provider,
    SUM(m.gross_pence)::bigint,
    SUM(m.external_pence)::bigint,
    SUM(m.credit_pence)::bigint,
    SUM(m.confirmed_orders)::bigint,
    SUM(m.tickets_sold)::bigint,
    now(), now()
  FROM public.reporting_sales_minute m
  WHERE (m.bucket_start AT TIME ZONE 'Europe/London')::date >= v_day_from
    AND (m.bucket_start AT TIME ZONE 'Europe/London')::date <= v_day_to
  GROUP BY 1, 2, 3;

  GET DIAGNOSTICS v_days_written = ROW_COUNT;

  -- ------------------------------------------------------------------
  -- 3) Record freshness (no checkout scan needed on dashboard reads).
  -- ------------------------------------------------------------------
  INSERT INTO public.reporting_meta (key, value, updated_at)
  VALUES (
    'last_refresh',
    jsonb_build_object(
      'from', v_from, 'to', v_to,
      'minutes_written', v_minutes_written,
      'days_written', v_days_written,
      'refreshed_at', now()
    ),
    now()
  )
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'ok', true,
    'from', v_from,
    'to', v_to,
    'minutes_written', v_minutes_written,
    'days_written', v_days_written,
    'refreshed_at', now()
  );
END;
$$;

COMMENT ON FUNCTION public.refresh_sales_reporting(timestamptz, timestamptz) IS
  'Bounded idempotent refresh of reporting_sales_minute/daily from confirmed checkouts. Read-only against checkout_intents.';

-- ----------------------------------------------------------------------------
-- Advisory-locked job wrapper. Uses a transaction-scoped advisory lock so a new
-- cron tick is skipped (not queued) while a previous run holds the lock.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_sales_reporting_job(
  p_lookback_minutes integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key bigint := hashtext('wtf_sales_reporting_refresh');
  v_from     timestamptz;
  v_to       timestamptz;
  v_result   jsonb;
BEGIN
  -- Transaction-local safety limits, set before the advisory lock and any work.
  PERFORM set_config('statement_timeout', '30s', true);
  PERFORM set_config('lock_timeout', '5s', true);

  -- Clamp lookback to a sane range (1 min .. 7 days).
  IF p_lookback_minutes IS NULL OR p_lookback_minutes < 1 THEN
    p_lookback_minutes := 15;
  END IF;
  IF p_lookback_minutes > 10080 THEN
    p_lookback_minutes := 10080;
  END IF;

  -- Non-blocking: if another refresh holds the lock, skip this tick.
  IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'locked');
  END IF;

  v_to   := now() + interval '1 minute';               -- small forward pad
  v_from := now() - make_interval(mins => p_lookback_minutes);

  v_result := public.refresh_sales_reporting(v_from, v_to);
  RETURN v_result || jsonb_build_object('skipped', false, 'lookback_minutes', p_lookback_minutes);
END;
$$;

COMMENT ON FUNCTION public.refresh_sales_reporting_job(integer) IS
  'Advisory-locked wrapper for scheduled refreshes; skips (does not stack) if a run is already in progress.';

-- Execution grants: only the service_role (admin API + protected cron) may call.
REVOKE ALL ON FUNCTION public.refresh_sales_reporting(timestamptz, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_sales_reporting_job(integer)               FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_sales_reporting(timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_sales_reporting_job(integer)               TO service_role;
