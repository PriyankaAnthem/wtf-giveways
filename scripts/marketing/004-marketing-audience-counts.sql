-- ============================================================================
-- WTF Marketing Hub — Stage 2: admin audience-count overview RPC
-- ----------------------------------------------------------------------------
-- Adds ONE read-only, service-role-only function that returns a single compact
-- jsonb payload of AGGREGATE marketing audience counts for the admin Marketing
-- page. It answers two questions only:
--   * how many customers match each useful marketing audience, and
--   * how many of those are currently eligible to receive marketing.
--
-- This migration is BACKEND-ONLY and additive:
--   * Creates NO tables, indexes, triggers, cron jobs or writes of any kind.
--   * Reads ONLY the two Stage 1 tables:
--       public.customer_marketing_profiles
--       public.customer_marketing_profile_refresh_state
--     It NEVER reads auth.users, checkout_intents, wallet_accounts,
--     marketing_suppressions or any other source table — every value it needs
--     was already denormalised into the profile table by the Stage 1 refresh.
--   * Returns NO identities: no user ids, no emails, no rows — only counts and
--     two aggregate credit sums.
--
-- It CANNOT send email and adds no sending capability. The cached
-- marketing_eligible_snapshot column is used ONLY for fast counts; it is NOT
-- authoritative for sending (a future send worker must re-check
-- public.is_marketing_email_eligible immediately before sending).
--
-- SAFETY
--   * Idempotent: CREATE OR REPLACE FUNCTION only. Safe to re-run.
--   * STABLE + SECURITY DEFINER + fixed search_path.
--   * Execution revoked from public/anon/authenticated; granted to service_role
--     only (service_role also bypasses the FORCE-RLS on the two tables).
--   * Transaction-local statement_timeout of 10s so a pathological run
--     self-terminates.
--   * All counts are produced in a SINGLE pass over customer_marketing_profiles
--     using conditional aggregates (FILTER), plus one read of the singleton
--     refresh-state row. No per-audience query, no dynamic SQL, no temp tables.
--
-- CALENDAR
--   "today" and the "previous 7-day window" use Europe/London calendar
--   boundaries. All other lapsed/recency thresholds are rolling intervals from
--   now(), exactly as specified.
--
-- HOW TO RUN
--   The application NEVER executes this. Run it once manually in the Supabase
--   SQL editor (or psql), AFTER migrations 001, 002 and 003.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_marketing_audience_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now         timestamptz := now();
  v_tz          text        := 'Europe/London';
  v_today       date        := (v_now AT TIME ZONE v_tz)::date;
  -- Europe/London calendar boundaries.
  v_today_start timestamptz := (v_today::timestamp AT TIME ZONE v_tz);
  v_week_start  timestamptz := ((v_today - 7)::timestamp AT TIME ZONE v_tz);
  -- Rolling recency thresholds (fixed offsets from now()).
  v_3d          timestamptz := v_now - interval '3 days';
  v_7d          timestamptz := v_now - interval '7 days';
  v_14d         timestamptz := v_now - interval '14 days';
  v_30d         timestamptz := v_now - interval '30 days';
  v_60d         timestamptz := v_now - interval '60 days';
  v_new_acct    timestamptz := v_now - interval '7 days';
  v_stale_floor timestamptz := v_now - interval '15 minutes';

  v_agg         jsonb;
  v_freshness   jsonb;
BEGIN
  -- Transaction-local safety limit: a pathological run self-terminates well
  -- within the 10s ceiling required by the spec.
  PERFORM set_config('statement_timeout', '10s', true);

  ------------------------------------------------------------------
  -- 1) Freshness / refresh-state (singleton row, identity-free).
  --    profileCount is the live row count of the profile table so the UI can
  --    show progress even mid-backfill; it never queries auth.users.
  ------------------------------------------------------------------
  SELECT jsonb_build_object(
           'profileCount',       (SELECT count(*)::bigint FROM public.customer_marketing_profiles),
           'backfillComplete',   COALESCE(s.backfill_complete, false),
           'backfillStartedAt',  s.backfill_started_at,
           'lastSuccessAt',      s.last_success_at,
           'lastIncrementalAt',  s.last_incremental_at,
           'lastProcessedUsers', COALESCE(s.last_processed_users, 0),
           'stale',              (s.last_success_at IS NULL OR s.last_success_at < v_stale_floor)
         )
    INTO v_freshness
    FROM public.customer_marketing_profile_refresh_state s
   WHERE s.key = 'default';

  -- If the singleton is somehow absent, present a safe "never refreshed" shape
  -- rather than null, so the UI can still render (and will flag it as stale).
  IF v_freshness IS NULL THEN
    v_freshness := jsonb_build_object(
      'profileCount',       (SELECT count(*)::bigint FROM public.customer_marketing_profiles),
      'backfillComplete',   false,
      'backfillStartedAt',  NULL,
      'lastSuccessAt',      NULL,
      'lastIncrementalAt',  NULL,
      'lastProcessedUsers', 0,
      'stale',              true
    );
  END IF;

  ------------------------------------------------------------------
  -- 2) Single-pass conditional aggregation over the compact profile table.
  --    Every count is a COUNT(*) FILTER (...) so the whole payload is one scan.
  --    matchedCount = rows matching the commercial rule.
  --    eligibleCount = matching rows where marketing_eligible_snapshot = true.
  ------------------------------------------------------------------
  SELECT jsonb_build_object(
    'health', jsonb_build_object(
      'totalProfiles',          count(*),
      'currentlyEligible',      count(*) FILTER (WHERE marketing_eligible_snapshot),
      'marketingEnabled',       count(*) FILTER (WHERE marketing_enabled),
      'activelySuppressed',     count(*) FILTER (WHERE has_active_suppression),
      'emailUnconfirmed',       count(*) FILTER (WHERE email_confirmed = false),
      'inactiveAccounts',       count(*) FILTER (WHERE account_active = false),
      'customersWithOrders',    count(*) FILTER (WHERE confirmed_order_count > 0),
      'customersWithoutOrders', count(*) FILTER (WHERE confirmed_order_count = 0)
    ),
    'audiences', jsonb_build_object(
      -- A. Recent buyers who have not purchased today (Europe/London window).
      'recentBuyersNotToday', jsonb_build_object(
        'key', 'recent_buyers_not_today',
        'matchedCount', count(*) FILTER (
          WHERE confirmed_order_count > 0
            AND last_confirmed_at >= v_week_start
            AND last_confirmed_at <  v_today_start),
        'eligibleCount', count(*) FILTER (
          WHERE confirmed_order_count > 0
            AND last_confirmed_at >= v_week_start
            AND last_confirmed_at <  v_today_start
            AND marketing_eligible_snapshot)
      ),
      -- B. One-time buyers (settled at least 3 days ago).
      'oneTimeBuyers', jsonb_build_object(
        'key', 'one_time_buyers',
        'matchedCount', count(*) FILTER (
          WHERE confirmed_order_count = 1
            AND last_confirmed_at <= v_3d),
        'eligibleCount', count(*) FILTER (
          WHERE confirmed_order_count = 1
            AND last_confirmed_at <= v_3d
            AND marketing_eligible_snapshot)
      ),
      -- C. Lapsed 7+ days.
      'lapsed7Days', jsonb_build_object(
        'key', 'lapsed_7_days',
        'matchedCount', count(*) FILTER (
          WHERE confirmed_order_count > 0 AND last_confirmed_at < v_7d),
        'eligibleCount', count(*) FILTER (
          WHERE confirmed_order_count > 0 AND last_confirmed_at < v_7d
            AND marketing_eligible_snapshot)
      ),
      -- D. Lapsed 14+ days.
      'lapsed14Days', jsonb_build_object(
        'key', 'lapsed_14_days',
        'matchedCount', count(*) FILTER (
          WHERE confirmed_order_count > 0 AND last_confirmed_at < v_14d),
        'eligibleCount', count(*) FILTER (
          WHERE confirmed_order_count > 0 AND last_confirmed_at < v_14d
            AND marketing_eligible_snapshot)
      ),
      -- E. Lapsed 30+ days.
      'lapsed30Days', jsonb_build_object(
        'key', 'lapsed_30_days',
        'matchedCount', count(*) FILTER (
          WHERE confirmed_order_count > 0 AND last_confirmed_at < v_30d),
        'eligibleCount', count(*) FILTER (
          WHERE confirmed_order_count > 0 AND last_confirmed_at < v_30d
            AND marketing_eligible_snapshot)
      ),
      -- F. Lapsed 60+ days.
      'lapsed60Days', jsonb_build_object(
        'key', 'lapsed_60_days',
        'matchedCount', count(*) FILTER (
          WHERE confirmed_order_count > 0 AND last_confirmed_at < v_60d),
        'eligibleCount', count(*) FILTER (
          WHERE confirmed_order_count > 0 AND last_confirmed_at < v_60d
            AND marketing_eligible_snapshot)
      ),
      -- G. Frequent buyers (5+ orders).
      'frequentBuyers', jsonb_build_object(
        'key', 'frequent_buyers',
        'matchedCount', count(*) FILTER (WHERE confirmed_order_count >= 5),
        'eligibleCount', count(*) FILTER (
          WHERE confirmed_order_count >= 5 AND marketing_eligible_snapshot)
      ),
      -- H. VIP buyers (10+ orders OR >= £250 external).
      'vipBuyers', jsonb_build_object(
        'key', 'vip_buyers',
        'matchedCount', count(*) FILTER (
          WHERE confirmed_order_count >= 10 OR lifetime_external_pence >= 25000),
        'eligibleCount', count(*) FILTER (
          WHERE (confirmed_order_count >= 10 OR lifetime_external_pence >= 25000)
            AND marketing_eligible_snapshot)
      ),
      -- I. High-value buyers (>= £100 external).
      'highValueBuyers', jsonb_build_object(
        'key', 'high_value_buyers',
        'matchedCount', count(*) FILTER (WHERE lifetime_external_pence >= 10000),
        'eligibleCount', count(*) FILTER (
          WHERE lifetime_external_pence >= 10000 AND marketing_eligible_snapshot)
      ),
      -- J. Customers with WTF Credit (> £0), plus aggregate credit sums.
      'customersWithCredit', jsonb_build_object(
        'key', 'customers_with_credit',
        'matchedCount', count(*) FILTER (WHERE wallet_available_pence > 0),
        'eligibleCount', count(*) FILTER (
          WHERE wallet_available_pence > 0 AND marketing_eligible_snapshot),
        'totalAvailableCreditPence',
          COALESCE(SUM(wallet_available_pence) FILTER (WHERE wallet_available_pence > 0), 0),
        'eligibleAvailableCreditPence',
          COALESCE(SUM(wallet_available_pence) FILTER (
            WHERE wallet_available_pence > 0 AND marketing_eligible_snapshot), 0)
      ),
      -- K. Customers with £5+ WTF Credit.
      'customersWithCredit5Plus', jsonb_build_object(
        'key', 'customers_with_credit_5_plus',
        'matchedCount', count(*) FILTER (WHERE wallet_available_pence >= 500),
        'eligibleCount', count(*) FILTER (
          WHERE wallet_available_pence >= 500 AND marketing_eligible_snapshot)
      ),
      -- L. New accounts (<= 7 days old) with no purchase.
      'newAccountsWithoutPurchase', jsonb_build_object(
        'key', 'new_accounts_without_purchase',
        'matchedCount', count(*) FILTER (
          WHERE account_created_at >= v_new_acct AND confirmed_order_count = 0),
        'eligibleCount', count(*) FILTER (
          WHERE account_created_at >= v_new_acct AND confirmed_order_count = 0
            AND marketing_eligible_snapshot)
      ),
      -- M. Eligible buyers (matched == eligible by construction).
      'allEligibleBuyers', jsonb_build_object(
        'key', 'all_eligible_buyers',
        'matchedCount', count(*) FILTER (
          WHERE confirmed_order_count > 0 AND marketing_eligible_snapshot),
        'eligibleCount', count(*) FILTER (
          WHERE confirmed_order_count > 0 AND marketing_eligible_snapshot)
      ),
      -- N. Eligible non-buyers.
      'eligibleNonBuyers', jsonb_build_object(
        'key', 'eligible_non_buyers',
        'matchedCount', count(*) FILTER (
          WHERE confirmed_order_count = 0 AND marketing_eligible_snapshot),
        'eligibleCount', count(*) FILTER (
          WHERE confirmed_order_count = 0 AND marketing_eligible_snapshot)
      )
    )
  )
  INTO v_agg
  FROM public.customer_marketing_profiles;

  -- An empty profile table yields NULL aggregates; present zeroed structures so
  -- the response contract is always fully populated.
  IF v_agg IS NULL THEN
    v_agg := jsonb_build_object('health', '{}'::jsonb, 'audiences', '{}'::jsonb);
  END IF;

  ------------------------------------------------------------------
  -- 3) Assemble the single compact payload (camelCase; identity-free).
  ------------------------------------------------------------------
  RETURN jsonb_build_object(
    'generatedAt', v_now,
    'freshness',   v_freshness,
    'health',      v_agg -> 'health',
    'audiences',   v_agg -> 'audiences'
  );
END;
$$;

COMMENT ON FUNCTION public.get_admin_marketing_audience_overview() IS
  'Stage 2 admin Marketing overview. Reads ONLY customer_marketing_profiles + customer_marketing_profile_refresh_state. Returns aggregate audience counts + freshness as one jsonb payload. No identities, no rows, no writes, no sending. Service-role only.';

-- Service-role-only execution.
REVOKE ALL ON FUNCTION public.get_admin_marketing_audience_overview() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_marketing_audience_overview() TO service_role;
