-- ============================================================================
-- WTF Marketing Hub — MANUAL parity audit for customer_marketing_profiles
-- ----------------------------------------------------------------------------
-- PURPOSE
--   Prove, from the AUTHORITATIVE source tables, that the denormalised Stage 1
--   profile table (public.customer_marketing_profiles) faithfully represents
--   all existing historical buyer behaviour — coverage, purchase aggregates,
--   wallet balances, marketing state and freshness — in ONE read.
--
-- THIS IS NOT A MIGRATION AND IS NEVER RUN BY THE APPLICATION.
--   * Read-only: a single SELECT. No INSERT/UPDATE/DELETE/DDL, no temp tables,
--     no explicit locks, no settings changes, no cron, no trigger.
--   * Run it DELIBERATELY and manually in the Supabase SQL editor (or psql).
--     It is not granted to, imported by, or referenced by any route or job.
--   * It reads the source tables (auth.users, checkout_intents, wallet_accounts,
--     marketing_preferences, marketing_suppressions) directly — which is why it
--     must only ever be executed by a human with service-role access, never by
--     the app. The application Marketing page reads ONLY the profile table.
--
-- PRIVACY
--   Returns EXACTLY ONE JSON row of aggregates. It exposes NO email address,
--   user id, name, checkout reference, payment id or any raw customer row.
--
-- CANONICAL DEFINITIONS (identical to migration 003 — do NOT diverge):
--   Profile-eligible user: auth.users with a non-empty normalised email
--       (a profile is only ever created for such users).
--   Eligible confirmed order:
--       state = 'confirmed'
--       AND provider IS DISTINCT FROM 'debug'
--       AND (ref IS NULL OR ref NOT LIKE 'SIM-%')
--       AND confirmed_at IS NOT NULL
--   External revenue per order:
--       CASE WHEN external_payment_pence IS NOT NULL THEN external_payment_pence
--            ELSE COALESCE(total_pence, 0) - COALESCE(wallet_credit_pence, 0) END
--   Last campaign tie-break: confirmed_at DESC, id DESC (deterministic).
--   Wallet available: GREATEST(COALESCE(balance_pence,0) - COALESCE(reserved_pence,0), 0)
--   Eligibility snapshot: account_active AND email_confirmed
--       AND marketing_enabled AND NOT has_active_suppression
--
-- PERFORMANCE
--   One grouped scan of eligible confirmed checkouts, one grouped wallet source,
--   one grouped suppression source, set-based joins only. No correlated
--   per-profile subquery.
-- ============================================================================

WITH
-- Singleton refresh-state row (identity-free operational metadata).
refresh_state AS (
  SELECT *
  FROM public.customer_marketing_profile_refresh_state
  WHERE key = 'default'
),
-- Profile-eligible auth users: a profile is only ever created for a user with a
-- usable (non-empty, normalised) email. Empty-email users are excluded by
-- migration 003, so they are excluded here too for an apples-to-apples parity.
auth_src AS (
  SELECT
    u.id                                             AS user_id,
    btrim(lower(coalesce(u.email, '')))              AS email_lc,
    (u.email_confirmed_at IS NOT NULL)               AS email_confirmed,
    (u.deleted_at IS NULL)                           AS account_active
  FROM auth.users u
  WHERE btrim(lower(coalesce(u.email, ''))) <> ''
),
-- One grouped scan of eligible confirmed orders (canonical scope).
orders_src AS (
  SELECT
    ci.user_id,
    MIN(ci.confirmed_at)                             AS first_confirmed_at,
    MAX(ci.confirmed_at)                             AS last_confirmed_at,
    COUNT(*)::bigint                                 AS confirmed_order_count,
    SUM(
      CASE
        WHEN ci.external_payment_pence IS NOT NULL THEN ci.external_payment_pence
        ELSE COALESCE(ci.total_pence, 0) - COALESCE(ci.wallet_credit_pence, 0)
      END
    )::bigint                                        AS lifetime_external_pence
  FROM public.checkout_intents ci
  JOIN auth_src a ON a.user_id = ci.user_id
  WHERE ci.state = 'confirmed'
    AND ci.provider IS DISTINCT FROM 'debug'
    AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
    AND ci.confirmed_at IS NOT NULL
  GROUP BY ci.user_id
),
-- Deterministic last campaign per user (same tie-break as migration 003).
last_campaign_src AS (
  SELECT DISTINCT ON (ci.user_id)
    ci.user_id,
    ci.campaign_id
  FROM public.checkout_intents ci
  JOIN auth_src a ON a.user_id = ci.user_id
  WHERE ci.state = 'confirmed'
    AND ci.provider IS DISTINCT FROM 'debug'
    AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
    AND ci.confirmed_at IS NOT NULL
    AND ci.campaign_id IS NOT NULL
  ORDER BY ci.user_id, ci.confirmed_at DESC, ci.id DESC
),
-- One grouped wallet source.
wallet_src AS (
  SELECT
    w.user_id,
    GREATEST(COALESCE(w.balance_pence, 0) - COALESCE(w.reserved_pence, 0), 0) AS wallet_available_pence
  FROM public.wallet_accounts w
  JOIN auth_src a ON a.user_id = w.user_id
),
pref_src AS (
  SELECT mp.user_id, mp.email_marketing_enabled
  FROM public.marketing_preferences mp
  JOIN auth_src a ON a.user_id = mp.user_id
),
-- One grouped suppression source (active, matched by id OR normalised email).
supp_src AS (
  SELECT DISTINCT a.user_id
  FROM auth_src a
  JOIN public.marketing_suppressions s
    ON s.revoked_at IS NULL
   AND (s.user_id = a.user_id OR s.email_lc = a.email_lc)
),
-- Recomputed authoritative expectation per profile-eligible user (set-based).
expected AS (
  SELECT
    a.user_id,
    o.first_confirmed_at,
    o.last_confirmed_at,
    COALESCE(o.confirmed_order_count, 0)             AS confirmed_order_count,
    COALESCE(o.lifetime_external_pence, 0)           AS lifetime_external_pence,
    lc.campaign_id                                   AS last_campaign_id,
    COALESCE(w.wallet_available_pence, 0)            AS wallet_available_pence,
    COALESCE(p.email_marketing_enabled, false)       AS marketing_enabled,
    (s.user_id IS NOT NULL)                          AS has_active_suppression,
    (
      a.account_active
      AND a.email_confirmed
      AND COALESCE(p.email_marketing_enabled, false)
      AND (s.user_id IS NULL)
    )                                                AS marketing_eligible_snapshot
  FROM auth_src a
  LEFT JOIN orders_src        o  ON o.user_id  = a.user_id
  LEFT JOIN last_campaign_src lc ON lc.user_id = a.user_id
  LEFT JOIN wallet_src        w  ON w.user_id  = a.user_id
  LEFT JOIN pref_src          p  ON p.user_id  = a.user_id
  LEFT JOIN supp_src          s  ON s.user_id  = a.user_id
),
-- Field-by-field comparison of expectation vs the stored profile row.
cmp AS (
  SELECT
    (p.user_id IS NULL)                                          AS profile_missing,
    (e.first_confirmed_at        IS DISTINCT FROM p.first_confirmed_at)      AS mm_first,
    (e.last_confirmed_at         IS DISTINCT FROM p.last_confirmed_at)       AS mm_last,
    (e.confirmed_order_count     IS DISTINCT FROM p.confirmed_order_count)   AS mm_orders,
    (e.lifetime_external_pence   IS DISTINCT FROM p.lifetime_external_pence) AS mm_revenue,
    (e.last_campaign_id          IS DISTINCT FROM p.last_campaign_id)        AS mm_campaign,
    (e.wallet_available_pence    IS DISTINCT FROM p.wallet_available_pence)  AS mm_wallet,
    (e.marketing_enabled         IS DISTINCT FROM p.marketing_enabled)       AS mm_menabled,
    (e.has_active_suppression    IS DISTINCT FROM p.has_active_suppression)  AS mm_supp,
    (e.marketing_eligible_snapshot IS DISTINCT FROM p.marketing_eligible_snapshot) AS mm_elig
  FROM expected e
  LEFT JOIN public.customer_marketing_profiles p ON p.user_id = e.user_id
)
SELECT jsonb_build_object(
  'generatedAt', now(),

  ----------------------------------------------------------------------------
  -- Coverage
  ----------------------------------------------------------------------------
  'coverage', jsonb_build_object(
    'authUserCount',               (SELECT count(*)::bigint FROM auth.users),
    'authProfileEligibleUserCount',(SELECT count(*)::bigint FROM auth_src),
    'profileCount',                (SELECT count(*)::bigint FROM public.customer_marketing_profiles),
    'authUsersMissingProfile',     (SELECT count(*)::bigint FROM cmp WHERE profile_missing),
    'profilesWithOrders',          (SELECT count(*)::bigint FROM public.customer_marketing_profiles WHERE confirmed_order_count > 0),
    'rawDistinctConfirmedBuyers',  (SELECT count(*)::bigint FROM orders_src)
  ),

  ----------------------------------------------------------------------------
  -- Purchase totals (raw source vs stored profile sums)
  ----------------------------------------------------------------------------
  'purchaseTotals', jsonb_build_object(
    'rawEligibleConfirmedOrderCount',  (SELECT COALESCE(SUM(confirmed_order_count), 0)::bigint FROM orders_src),
    'profileConfirmedOrderCountSum',   (SELECT COALESCE(SUM(confirmed_order_count), 0)::bigint FROM public.customer_marketing_profiles),
    'rawLifetimeExternalPence',        (SELECT COALESCE(SUM(lifetime_external_pence), 0)::bigint FROM orders_src),
    'profileLifetimeExternalPenceSum', (SELECT COALESCE(SUM(lifetime_external_pence), 0)::bigint FROM public.customer_marketing_profiles)
  ),

  ----------------------------------------------------------------------------
  -- Per-profile field mismatch counts (only over profiles that exist).
  -- A row absent from the profile table is reported under coverage instead.
  ----------------------------------------------------------------------------
  'profileFieldMismatches', jsonb_build_object(
    'comparableProfiles',      (SELECT count(*)::bigint FROM cmp WHERE NOT profile_missing),
    'firstConfirmedAt',        (SELECT count(*)::bigint FROM cmp WHERE NOT profile_missing AND mm_first),
    'lastConfirmedAt',         (SELECT count(*)::bigint FROM cmp WHERE NOT profile_missing AND mm_last),
    'confirmedOrderCount',     (SELECT count(*)::bigint FROM cmp WHERE NOT profile_missing AND mm_orders),
    'lifetimeExternalPence',   (SELECT count(*)::bigint FROM cmp WHERE NOT profile_missing AND mm_revenue),
    'lastCampaignId',          (SELECT count(*)::bigint FROM cmp WHERE NOT profile_missing AND mm_campaign)
  ),

  ----------------------------------------------------------------------------
  -- Wallet parity
  ----------------------------------------------------------------------------
  'walletParity', jsonb_build_object(
    'rawCustomersWithCredit',           (SELECT count(*)::bigint FROM wallet_src WHERE wallet_available_pence > 0),
    'profileCustomersWithCredit',       (SELECT count(*)::bigint FROM public.customer_marketing_profiles WHERE wallet_available_pence > 0),
    'rawTotalAvailableCreditPence',     (SELECT COALESCE(SUM(wallet_available_pence), 0)::bigint FROM wallet_src),
    'profileTotalAvailableCreditPence', (SELECT COALESCE(SUM(wallet_available_pence), 0)::bigint FROM public.customer_marketing_profiles),
    'walletAvailablePenceMismatch',     (SELECT count(*)::bigint FROM cmp WHERE NOT profile_missing AND mm_wallet)
  ),

  ----------------------------------------------------------------------------
  -- Marketing state parity (uses the same Stage 1 snapshot rule as expected)
  ----------------------------------------------------------------------------
  'marketingStateParity', jsonb_build_object(
    'marketingEnabledMismatch',          (SELECT count(*)::bigint FROM cmp WHERE NOT profile_missing AND mm_menabled),
    'hasActiveSuppressionMismatch',       (SELECT count(*)::bigint FROM cmp WHERE NOT profile_missing AND mm_supp),
    'marketingEligibleSnapshotMismatch',  (SELECT count(*)::bigint FROM cmp WHERE NOT profile_missing AND mm_elig)
  ),

  ----------------------------------------------------------------------------
  -- Freshness
  ----------------------------------------------------------------------------
  'freshness', jsonb_build_object(
    'backfillComplete',            (SELECT COALESCE(backfill_complete, false) FROM refresh_state),
    'lastSuccessfulRefresh',       (SELECT last_success_at FROM refresh_state),
    'lastIncrementalRefresh',      (SELECT last_incremental_at FROM refresh_state),
    'profilesRefreshedLast15Min',  (SELECT count(*)::bigint FROM public.customer_marketing_profiles
                                       WHERE refreshed_at >= now() - interval '15 minutes'),
    'profilesOlderThanLastSuccess',(SELECT count(*)::bigint FROM public.customer_marketing_profiles p
                                       WHERE (SELECT last_success_at FROM refresh_state) IS NOT NULL
                                         AND p.refreshed_at < (SELECT last_success_at FROM refresh_state))
  )
) AS parity_audit;

-- ============================================================================
-- End of manual parity audit. Read-only, one JSON row, no identities, no writes,
-- no schema/setting changes. Never invoked by the application.
-- ============================================================================
