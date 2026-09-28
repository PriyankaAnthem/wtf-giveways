-- ============================================================================
-- WTF Marketing Hub — Stage 3C prerequisite: pre-registration consent
--                       reconciliation (DATA migration).
-- ----------------------------------------------------------------------------
-- PURPOSE
--   A one-time, set-based, idempotent DATA reconciliation that gives the
--   Marketing Hub a real, PERMISSION-BACKED audience to work with LATER. It
--   reconciles ONLY pre_registrations where consent = true:
--
--     A. Pre-registration email matches an Auth user
--          * NEVER create an external marketing contact for them.
--          * If that Auth user already has ANY marketing_preferences row, leave
--            it completely unchanged (not enabled, not disabled, unsubscribed_at
--            untouched).
--          * Otherwise, and ONLY if there is no active suppression by user_id or
--            normalised email, insert an ENABLED preference using the
--            pre-registration as the consent evidence.
--          * If an active suppression exists, do NOT enable; record in the
--            aggregate result only. The suppression is never touched.
--
--     B. Pre-registration email does NOT match an Auth user
--          * Insert a marketing_external_contacts row from the pre-registration
--            (enabled unless an active suppression exists for that email).
--          * Never create a fake Auth user; never duplicate an existing contact.
--
--   THERE IS NO GENERIC HISTORIC ACTIVATION. This script does NOT create
--   marketing consent for existing Auth users who merely have an account or a
--   purchase history. A historic buyer or registered non-buyer with no recorded
--   consent evidence stays untouched and NON-SENDABLE. The ~10k customer
--   profiles remain usable for opportunity detection, audience matching,
--   scoring and AI decisioning later, but eligibility/sendability stays a
--   separate, explicitly-consented concern.
--
--   This script creates NO sending capability: no opportunities, no recipients,
--   no automation runs, no discovery/sending, no rollout change, no Resend, no
--   cron, and it does not touch checkout / payments / tickets / wallet or any
--   customer-facing path.
--
-- CRITICAL INVARIANTS (enforced structurally below)
--   * marketing_preferences rows are NEVER updated. The only preference write is
--     an INSERT guarded by NOT EXISTS and ON CONFLICT (user_id) DO NOTHING, so a
--     pre-existing enabled OR disabled preference — and its unsubscribed_at and
--     event history — is left byte-for-byte unchanged. An existing row always
--     wins.
--   * Unsubscribes / suppressions are NEVER reversed. This script does not write
--     marketing_suppressions at all; it only READS them to decide whether a NEW
--     preference / external contact may be enabled.
--   * The Marketing Hub must be GLOBALLY PAUSED. Before any write the script
--     asserts sending_enabled = false, discovery_enabled = false and
--     rollout_limit = 0, and RAISES (rolling everything back) otherwise. Those
--     values are only READ, never changed.
--
-- SAFETY / SCOPE
--   * ATOMIC: whole script runs inside one BEGIN/COMMIT; any failure rolls back.
--   * FAIL FAST: LOCAL lock_timeout + statement_timeout abort quickly on a busy
--     production database instead of blocking.
--   * ADDITIVE DATA ONLY: no CREATE/ALTER/DROP of any real table, no trigger, no
--     function, no extension. Only INSERTs into marketing_preferences,
--     marketing_preference_events and marketing_external_contacts.
--   * Does NOT modify migrations 001-005.
--   * Does NOT call refresh_customer_marketing_profiles(); the existing
--     profile-refresh cron picks the preference changes up after COMMIT.
--
-- HOW TO RUN
--   The application NEVER executes this. Run it manually ONCE in the Supabase
--   SQL editor (or psql), AFTER migrations 001-005, while Marketing is paused.
--   It is safe to re-run: a second run inserts nothing (all guards are
--   idempotent) and returns the same shape of aggregate result.
--
-- RESULT
--   Returns exactly ONE row: a single aggregate JSON object. No customer ids,
--   no email addresses, no raw rows.
-- ============================================================================

BEGIN;

-- Fail fast rather than block on a busy production database, and never let the
-- reconciliation run away. LOCAL = scoped to this transaction only.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ----------------------------------------------------------------------------
-- Guard (read-only): dependency preflight + single-execution advisory lock +
-- global-pause assertion. Any failure RAISES and rolls the whole script back
-- BEFORE a single row is written.
-- ----------------------------------------------------------------------------
DO $guard$
DECLARE
  v_missing text[] := ARRAY[]::text[];
  v_dep     text;
  v_sending   boolean;
  v_discovery boolean;
  v_rollout   integer;
BEGIN
  -- 1) Every required dependency must already exist. to_regclass() is a pure
  --    lookup (NULL when absent); we create/alter NONE of these objects.
  FOREACH v_dep IN ARRAY ARRAY[
    'auth.users',
    'public.marketing_preferences',
    'public.marketing_preference_events',
    'public.marketing_suppressions',
    'public.marketing_external_contacts',
    'public.pre_registrations',
    'public.marketing_control_state'
  ] LOOP
    IF to_regclass(v_dep) IS NULL THEN
      v_missing := array_append(v_missing, v_dep);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'Stage 3C reconciliation aborted: required dependency % is missing. Run migrations 001-005 first.',
      array_to_string(v_missing, ', ');
  END IF;

  -- 2) Refuse to overlap with a concurrent execution of THIS reconciliation.
  --    Transaction-scoped lock, released automatically at COMMIT/ROLLBACK.
  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_stage_3c_existing_customer_activation')) THEN
    RAISE EXCEPTION
      'Stage 3C reconciliation aborted: another execution is already in progress (advisory lock held).';
  END IF;

  -- 3) The Marketing Hub must be GLOBALLY PAUSED. Refuse to write anything
  --    unless sending + discovery are off and rollout_limit is 0.
  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state
   WHERE key = 'default';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Stage 3C reconciliation aborted: marketing_control_state singleton (key=''default'') not found; cannot confirm Marketing is paused.';
  END IF;

  IF v_sending IS DISTINCT FROM false
     OR v_discovery IS DISTINCT FROM false
     OR v_rollout   IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'Stage 3C reconciliation aborted: Marketing is not globally paused (sending_enabled=%, discovery_enabled=%, rollout_limit=%). Refusing to activate.',
      v_sending, v_discovery, v_rollout;
  END IF;
END
$guard$;

-- ----------------------------------------------------------------------------
-- Aggregate result carrier. ON COMMIT DROP keeps it strictly transaction-local.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _stage3c_activation_result (
  consented_pre_registrations_considered   bigint NOT NULL,
  pre_registrations_matched_to_auth        bigint NOT NULL,
  matched_auth_existing_preference_preserved bigint NOT NULL,
  matched_auth_preference_inserted         bigint NOT NULL,
  matched_auth_suppressed_not_enabled      bigint NOT NULL,
  external_contacts_inserted_enabled       bigint NOT NULL,
  external_contacts_inserted_suppressed    bigint NOT NULL,
  external_contacts_already_existing       bigint NOT NULL,
  final_enabled_preference_count           bigint NOT NULL,
  final_external_enabled_count             bigint NOT NULL
) ON COMMIT DROP;

-- ----------------------------------------------------------------------------
-- The reconciliation itself. All mutations are set-based (no per-user loop) and
-- every count is captured from staged working sets / RETURNING, so the
-- aggregate result is exact.
-- ----------------------------------------------------------------------------
DO $activate$
DECLARE
  v_consented_considered   bigint := 0;
  v_matched_to_auth        bigint := 0;
  v_matched_existing_pref  bigint := 0;
  v_matched_inserted       bigint := 0;
  v_matched_suppressed     bigint := 0;
  v_ext_inserted_total     bigint := 0;
  v_ext_inserted_suppressed bigint := 0;
  v_ext_inserted_enabled   bigint := 0;
  v_ext_already_existing   bigint := 0;
  v_final_enabled_pref     bigint := 0;
  v_final_external_enabled bigint := 0;
BEGIN
  -- Consented pre-registrations considered (the entire input to this script).
  SELECT count(*) INTO v_consented_considered
    FROM public.pre_registrations pr
   WHERE pr.consent = true;

  -- === Stage the MATCHED Auth users (branch A) into a working set ==========
  -- One row per DISTINCT Auth user whose email matches a consented
  -- pre-registration. has_pref / is_suppressed are captured HERE, BEFORE any
  -- insert, so counts and the insert are consistent and the insert cannot
  -- affect its own eligibility. is_suppressed checks suppression by user_id OR
  -- by the normalised email (active = revoked_at IS NULL).
  CREATE TEMP TABLE _stage3c_matched ON COMMIT DROP AS
  SELECT mu.user_id,
         mu.email_norm,
         mu.consented_at,
         EXISTS (
           SELECT 1 FROM public.marketing_preferences mp WHERE mp.user_id = mu.user_id
         ) AS has_pref,
         EXISTS (
           SELECT 1 FROM public.marketing_suppressions ms
            WHERE ms.revoked_at IS NULL
              AND (ms.user_id = mu.user_id OR ms.email_lc = mu.email_norm)
         ) AS is_suppressed
    FROM (
      SELECT u.id AS user_id,
             lower(btrim(u.email)) AS email_norm,
             min(pr.created_at) AS consented_at
        FROM auth.users u
        JOIN public.pre_registrations pr
          ON pr.consent = true
         AND COALESCE(NULLIF(lower(btrim(pr.email_lc)), ''), lower(btrim(pr.email)))
             = lower(btrim(u.email))
       WHERE u.email IS NOT NULL
         AND lower(btrim(u.email)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
       GROUP BY u.id, lower(btrim(u.email))
    ) mu;

  SELECT count(*),
         count(*) FILTER (WHERE has_pref),
         count(*) FILTER (WHERE has_pref = false AND is_suppressed)
    INTO v_matched_to_auth, v_matched_existing_pref, v_matched_suppressed
    FROM _stage3c_matched;

  -- === Branch A insert: activate matched Auth users with NO preference row ==
  -- === and NO active suppression, using pre-registration as consent. ========
  WITH ins AS (
    INSERT INTO public.marketing_preferences AS mp (
      user_id, email_marketing_enabled, consented_at, consent_source,
      consent_version, unsubscribed_at, created_at, updated_at
    )
    SELECT m.user_id, true, m.consented_at, 'pre_registration',
           'pre_registration_v1', NULL, now(), now()
      FROM _stage3c_matched m
     WHERE m.has_pref = false
       AND m.is_suppressed = false
    ON CONFLICT (user_id) DO NOTHING
    RETURNING user_id
  ),
  ev AS (
    -- Data-modifying CTEs always run to completion even when unreferenced.
    -- Only rows actually inserted (FROM ins) get a subscribed event.
    INSERT INTO public.marketing_preference_events (
      user_id, event_type, source, consent_version, metadata
    )
    SELECT i.user_id, 'subscribed', 'pre_registration', 'pre_registration_v1',
           jsonb_build_object('activation', 'pre_registration_reconciliation',
                              'provenance', 'pre_registration')
      FROM ins i
    RETURNING 1
  )
  SELECT count(*) INTO v_matched_inserted FROM ins;

  -- === Stage the UNMATCHED consented pre-registrations (branch B) ==========
  -- One row per normalised email (earliest consent wins) that is consented,
  -- valid-email, does NOT match an Auth user, and is NOT already an external
  -- contact.
  CREATE TEMP TABLE _stage3c_external ON COMMIT DROP AS
  SELECT DISTINCT ON (n.norm_email)
         n.norm_email                               AS email_lc,
         left(NULLIF(btrim(n.first_name), ''), 200) AS first_name,
         left(NULLIF(btrim(n.last_name),  ''), 200) AS last_name,
         n.id                                       AS source_record_id,
         n.created_at                               AS consented_at
    FROM (
      SELECT pr.id, pr.first_name, pr.last_name, pr.created_at,
             COALESCE(NULLIF(lower(btrim(pr.email_lc)), ''), lower(btrim(pr.email))) AS norm_email
        FROM public.pre_registrations pr
       WHERE pr.consent = true
    ) n
   WHERE n.norm_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     AND NOT EXISTS (
       SELECT 1 FROM auth.users u
        WHERE u.email IS NOT NULL
          AND lower(btrim(u.email)) = n.norm_email
     )
   ORDER BY n.norm_email, n.created_at ASC;

  -- Consented, unmatched emails that ALREADY exist as an external contact are
  -- left untouched; count them for the result.
  SELECT count(*) INTO v_ext_already_existing
    FROM _stage3c_external e
   WHERE EXISTS (
     SELECT 1 FROM public.marketing_external_contacts ec WHERE ec.email_lc = e.email_lc
   );

  -- === Branch B insert: create external contacts for the rest ==============
  -- Enabled unless an active suppression exists for that email; a suppressed
  -- email is recorded DISABLED and the suppression is never touched.
  WITH ins AS (
    INSERT INTO public.marketing_external_contacts (
      email_lc, first_name, last_name, source, source_record_id,
      consented_at, consent_source, consent_version, marketing_enabled,
      unsubscribed_at, created_at, updated_at
    )
    SELECT e.email_lc, e.first_name, e.last_name, 'pre_registration', e.source_record_id,
           e.consented_at, 'pre_registration', 'pre_registration_v1',
           CASE WHEN EXISTS (
                  SELECT 1 FROM public.marketing_suppressions ms
                   WHERE ms.revoked_at IS NULL AND ms.email_lc = e.email_lc
                ) THEN false ELSE true END,
           NULL, now(), now()
      FROM _stage3c_external e
     WHERE NOT EXISTS (
       SELECT 1 FROM public.marketing_external_contacts ec WHERE ec.email_lc = e.email_lc
     )
    ON CONFLICT (email_lc) DO NOTHING
    RETURNING marketing_enabled
  )
  SELECT count(*), count(*) FILTER (WHERE marketing_enabled = false)
    INTO v_ext_inserted_total, v_ext_inserted_suppressed
    FROM ins;

  v_ext_inserted_enabled := v_ext_inserted_total - v_ext_inserted_suppressed;

  -- === Final snapshots (after reconciliation) =============================
  SELECT count(*) INTO v_final_enabled_pref
    FROM public.marketing_preferences
   WHERE email_marketing_enabled = true;

  SELECT count(*) INTO v_final_external_enabled
    FROM public.marketing_external_contacts
   WHERE marketing_enabled = true;

  INSERT INTO _stage3c_activation_result (
    consented_pre_registrations_considered,
    pre_registrations_matched_to_auth,
    matched_auth_existing_preference_preserved,
    matched_auth_preference_inserted,
    matched_auth_suppressed_not_enabled,
    external_contacts_inserted_enabled,
    external_contacts_inserted_suppressed,
    external_contacts_already_existing,
    final_enabled_preference_count,
    final_external_enabled_count
  ) VALUES (
    v_consented_considered,
    v_matched_to_auth,
    v_matched_existing_pref,
    v_matched_inserted,
    v_matched_suppressed,
    v_ext_inserted_enabled,
    v_ext_inserted_suppressed,
    v_ext_already_existing,
    v_final_enabled_pref,
    v_final_external_enabled
  );
END
$activate$;

-- ----------------------------------------------------------------------------
-- Return exactly one aggregate JSON row. No ids, no emails, no rows.
-- ----------------------------------------------------------------------------
SELECT jsonb_build_object(
  'consentedPreRegistrationsConsidered',       r.consented_pre_registrations_considered,
  'preRegistrationsMatchedToAuth',             r.pre_registrations_matched_to_auth,
  'matchedAuthExistingPreferencePreserved',    r.matched_auth_existing_preference_preserved,
  'matchedAuthPreferenceInserted',             r.matched_auth_preference_inserted,
  'matchedAuthSuppressedNotEnabled',           r.matched_auth_suppressed_not_enabled,
  'externalContactsInsertedEnabled',           r.external_contacts_inserted_enabled,
  'externalContactsInsertedSuppressed',        r.external_contacts_inserted_suppressed,
  'externalContactsAlreadyExisting',           r.external_contacts_already_existing,
  'finalEnabledPreferenceCount',               r.final_enabled_preference_count,
  'finalExternalEnabledCount',                 r.final_external_enabled_count
) AS result
FROM _stage3c_activation_result r;

COMMIT;

-- ============================================================================
-- End of Stage 3C reconciliation. No generic historic Auth activation exists,
-- no email was sent, and no sending / discovery / leasing capability was
-- created. sending_enabled, discovery_enabled and rollout_limit are untouched
-- (only READ, in the pause assertion).
-- ============================================================================
