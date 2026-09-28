-- ============================================================================
-- WTF Marketing Hub — Stage 3C2H: OPPORTUNITY LIFECYCLE + QA FOUNDATION
-- ----------------------------------------------------------------------------
-- PURPOSE
--   Install THREE service-role-only RPCs on top of the Stage 3C1/3C2F ledger:
--     A. get_admin_marketing_opportunity_ledger_overview()  — READ-ONLY admin
--        overview (aggregate counts, expiry windows, distributions; NO PII).
--     B. get_admin_marketing_opportunity_qa_sample(p_limit)  — READ-ONLY
--        anonymised QA sample (opaque customer hash, SAFE fields, key names
--        only; never raw identities or raw reason/context values).
--     C. maintain_marketing_opportunity_lifecycle(p_limit)   — bounded,
--        EXPLICITLY-invoked housekeeping that marks GENUINELY time-expired
--        opportunities as state='expired'. Nothing else.
--
--   This is a normal (non-canary) migration but its INSTALLATION IS INERT: it
--   only CREATE/REPLACEs functions and asserts the current production safety
--   state. It performs ZERO opportunity INSERT/UPDATE/DELETE, ZERO control-state
--   mutation, ZERO definition mutation, and NEVER invokes the maintenance RPC.
--   Run it once AFTER migrations 001-014. Committed as a reviewable artifact;
--   it has NOT been executed.
--
-- LIFECYCLE STATE SEMANTICS (from migration 007 — NOT invented here)
--   Allowed states: open, selected, suppressed, deferred, expired, superseded,
--   actioned. Rows are expired/superseded, never deleted.
--     * open      — active, awaiting selection.               AUTO-EXPIRABLE.
--     * deferred   — active, paused until deferred_until.       AUTO-EXPIRABLE
--                    (a deferred row past its own expires_at is genuinely stale).
--     * selected   — reserved for downstream action (selected_at set). The
--                    schema does NOT prove it is safe to drop a reserved
--                    opportunity, so Stage 3C2H LEAVES 'selected' UNTOUCHED.
--     * suppressed / superseded / actioned — terminal outcomes. NEVER touched.
--     * expired    — already terminal. NEVER re-touched.
--   Approved AUTO-EXPIRABLE set for this stage: ('open','deferred') ONLY.
--
-- SAFETY / CONTROL-STATE RELATIONSHIP
--   Lifecycle expiry is housekeeping — NOT discovery and NOT sending. For this
--   first production stage the maintenance RPC is conservative: it REQUIRES
--   sending_enabled = false and refuses (status='sending_active', updated=0)
--   otherwise. It does NOT require discovery_enabled=false (expiry and discovery
--   may eventually coexist) and it NEVER mutates any control state.
--
-- SECURITY
--   All three functions are SECURITY DEFINER, SET search_path = public, pg_temp,
--   EXECUTE revoked from public/anon/authenticated and granted ONLY to
--   service_role. RLS on marketing_opportunities stays ENABLED + FORCED; no
--   policy/grant is altered.
--
-- PRIVACY
--   Neither read RPC exposes user_id, external_contact_id, email_lc, dedupe_key,
--   or raw reason/context values. The QA sample exposes an opaque md5-derived
--   hash prefix and SAFE scalar fields / JSON KEY NAMES only.
--
-- ABSOLUTELY DOES NOT
--   Enable discovery/sending, change rollout_limit, enable any definition,
--   create opportunities/recipients/runs, send email, add cron/AI, implement
--   superseding/selection/suppression/actioning, create new state values, change
--   dedupe/detector/scoring, scan checkout_intents/instant_win_awards/
--   wallet_transactions/auth.users, alter marketing_opportunities schema, touch
--   customer-facing code, or modify migrations 001-014. The Stage 3C2G canary
--   row is NEVER deleted or modified by installation.
-- ============================================================================

BEGIN;

-- Fail fast rather than block a busy production database.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ----------------------------------------------------------------------------
-- Install-time preflight (READ-ONLY): dependency check + single-execution
-- advisory lock + production safety-state assertions + structural (non-PII)
-- confirmation that the expected Stage 3C2G one-row canary is present. Any
-- failure RAISES and rolls the whole migration back BEFORE any function is
-- created. This block mutates NOTHING.
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_missing        text[] := ARRAY[]::text[];
  v_dep            text;
  v_sending        boolean;
  v_discovery      boolean;
  v_rollout        integer;
  v_enabled_defs   bigint;
  v_opp_count      bigint;
  v_canary_ok      boolean;
BEGIN
  -- 1. Required tables must exist.
  FOREACH v_dep IN ARRAY ARRAY[
    'public.marketing_opportunities',
    'public.marketing_opportunity_definitions',
    'public.marketing_control_state'
  ] LOOP
    IF to_regclass(v_dep) IS NULL THEN
      v_missing := array_append(v_missing, v_dep);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'Stage 3C2H migration aborted: required dependency % is missing. Run migrations 001-014 first.',
      array_to_string(v_missing, ', ');
  END IF;

  -- 2. Migration-specific advisory key (fixed for THIS migration only).
  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_stage_3c2h_lifecycle_qa_foundation')) THEN
    RAISE EXCEPTION
      'Stage 3C2H migration aborted: another execution is already in progress (advisory lock held).';
  END IF;

  -- 3. Production safety state must be paused.
  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state
   WHERE key = 'default';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Stage 3C2H migration aborted: marketing_control_state singleton (key=''default'') not found.';
  END IF;
  IF v_sending IS DISTINCT FROM false
     OR v_discovery IS DISTINCT FROM false
     OR v_rollout   IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'Stage 3C2H migration aborted: Marketing is not paused (sending_enabled=%, discovery_enabled=%, rollout_limit=%).',
      v_sending, v_discovery, v_rollout;
  END IF;

  -- 4. No definition may be enabled yet.
  SELECT count(*) INTO v_enabled_defs
    FROM public.marketing_opportunity_definitions
   WHERE enabled = true;
  IF v_enabled_defs <> 0 THEN
    RAISE EXCEPTION
      'Stage 3C2H migration aborted: % definition(s) already enabled; expected 0.', v_enabled_defs;
  END IF;

  -- 5. Ledger must contain EXACTLY the one Stage 3C2G canary row.
  SELECT count(*) INTO v_opp_count FROM public.marketing_opportunities;
  IF v_opp_count <> 1 THEN
    RAISE EXCEPTION
      'Stage 3C2H migration aborted: marketing_opportunities holds % row(s); expected exactly 1 (the Stage 3C2G canary).',
      v_opp_count;
  END IF;

  -- 6. Assert the canary STRUCTURALLY (no identity exposed, no score coupling).
  SELECT (
           opportunity_type = 'new_account_no_purchase'
           AND state = 'open'
           AND campaign_id IS NULL
           AND user_id IS NOT NULL
           AND external_contact_id IS NULL
         )
    INTO v_canary_ok
    FROM public.marketing_opportunities;
  IF v_canary_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'Stage 3C2H migration aborted: the single ledger row is not the expected Stage 3C2G canary (type=new_account_no_purchase, state=open, no campaign, user identity only). Refusing to install against unexpected production state.';
  END IF;
END
$preflight$;

-- ============================================================================
-- PART A — READ-ONLY LEDGER OVERVIEW
--   Aggregate-only admin overview. STABLE + SECURITY DEFINER + fixed
--   search_path. Reads marketing_control_state, marketing_opportunity_
--   definitions and marketing_opportunities ONLY. Exposes NO identities, NO
--   emails, NO dedupe keys and NO raw reason/context values.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_admin_marketing_opportunity_ledger_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '10s'
AS $$
DECLARE
  v_now        timestamptz := now();
  v_control    jsonb;
  v_defs       jsonb;
  v_ledger     jsonb;
  v_by_state   jsonb;
  v_by_type    jsonb;
  v_by_prio    jsonb;
BEGIN
  -- Control state (read-only). Null-safe if the singleton is unexpectedly absent.
  SELECT jsonb_build_object(
           'sendingEnabled',   cs.sending_enabled,
           'discoveryEnabled', cs.discovery_enabled,
           'rolloutLimit',     cs.rollout_limit,
           'maximumBatchSize', cs.maximum_batch_size
         )
    INTO v_control
    FROM public.marketing_control_state cs
   WHERE cs.key = 'default';
  IF v_control IS NULL THEN
    v_control := jsonb_build_object(
      'sendingEnabled', NULL, 'discoveryEnabled', NULL,
      'rolloutLimit', NULL, 'maximumBatchSize', NULL);
  END IF;

  -- Definition counts.
  SELECT jsonb_build_object(
           'enabledDefinitions', count(*) FILTER (WHERE enabled = true),
           'totalDefinitions',   count(*)
         )
    INTO v_defs
    FROM public.marketing_opportunity_definitions;

  -- Single-pass ledger aggregation. 'activeNow' counts non-terminal states
  -- (open/selected/deferred) that have NOT yet passed expires_at.
  -- 'expiredButStateNotExpired' counts rows past expires_at whose state is still
  -- one of the AUTO-EXPIRABLE states maintenance is allowed to expire
  -- (open/deferred) — i.e. the exact backlog the maintenance RPC would clear.
  SELECT jsonb_build_object(
           'ledger', jsonb_build_object(
             'total',      count(*),
             'open',       count(*) FILTER (WHERE state = 'open'),
             'selected',   count(*) FILTER (WHERE state = 'selected'),
             'deferred',   count(*) FILTER (WHERE state = 'deferred'),
             'suppressed', count(*) FILTER (WHERE state = 'suppressed'),
             'expired',    count(*) FILTER (WHERE state = 'expired'),
             'superseded', count(*) FILTER (WHERE state = 'superseded'),
             'actioned',   count(*) FILTER (WHERE state = 'actioned')
           ),
           'activeNow', count(*) FILTER (
             WHERE state IN ('open', 'selected', 'deferred') AND expires_at > v_now
           ),
           'expiredButStateNotExpired', count(*) FILTER (
             WHERE expires_at <= v_now AND state IN ('open', 'deferred')
           ),
           'score', jsonb_build_object(
             'min', min(score),
             'avg', round(avg(score), 4),
             'max', max(score)
           ),
           'expiry', jsonb_build_object(
             'nextExpiryAt', min(expires_at) FILTER (
               WHERE state IN ('open', 'selected', 'deferred') AND expires_at > v_now
             ),
             'expiringWithin24h', count(*) FILTER (
               WHERE state IN ('open', 'selected', 'deferred')
                 AND expires_at > v_now AND expires_at <= v_now + interval '24 hours'
             ),
             'expiringWithin7d', count(*) FILTER (
               WHERE state IN ('open', 'selected', 'deferred')
                 AND expires_at > v_now AND expires_at <= v_now + interval '7 days'
             )
           ),
           'identity', jsonb_build_object(
             'userOpportunities',     count(*) FILTER (WHERE user_id IS NOT NULL),
             'externalOpportunities', count(*) FILTER (WHERE external_contact_id IS NOT NULL)
           ),
           'campaignContext', jsonb_build_object(
             'withCampaign',    count(*) FILTER (WHERE campaign_id IS NOT NULL),
             'withoutCampaign', count(*) FILTER (WHERE campaign_id IS NULL)
           )
         )
    INTO v_ledger
    FROM public.marketing_opportunities;

  -- Count by state (every allowed state present, zero when absent).
  SELECT jsonb_object_agg(s.state, COALESCE(c.cnt, 0))
    INTO v_by_state
    FROM (VALUES
            ('open'), ('selected'), ('suppressed'), ('deferred'),
            ('expired'), ('superseded'), ('actioned')
         ) AS s(state)
    LEFT JOIN (
      SELECT state, count(*)::bigint AS cnt
        FROM public.marketing_opportunities
       GROUP BY state
    ) c ON c.state = s.state;

  -- Count by opportunity type. The AUTHORITATIVE catalogue is
  -- marketing_opportunity_definitions (28+ definitions today and growing), so we
  -- read the type list DYNAMICALLY from it — no opportunity key is hardcoded
  -- here. EVERY current definition appears exactly once; definitions with zero
  -- persisted opportunities return 0 (via LEFT JOIN + COALESCE) so newer types
  -- can NEVER be silently omitted. Deterministic ordering by opportunity_key.
  SELECT COALESCE(
           jsonb_object_agg(d.opportunity_key, COALESCE(c.cnt, 0) ORDER BY d.opportunity_key),
           '{}'::jsonb
         )
    INTO v_by_type
    FROM public.marketing_opportunity_definitions d
    LEFT JOIN (
      SELECT opportunity_type, count(*)::bigint AS cnt
        FROM public.marketing_opportunities
       GROUP BY opportunity_type
    ) c ON c.opportunity_type = d.opportunity_key;

  -- Priority distribution (dynamic keys — base_priority is a small 1-based rank).
  SELECT COALESCE(
           jsonb_object_agg(p.base_priority::text, p.cnt ORDER BY p.base_priority),
           '{}'::jsonb
         )
    INTO v_by_prio
    FROM (
      SELECT base_priority, count(*)::bigint AS cnt
        FROM public.marketing_opportunities
       GROUP BY base_priority
    ) p;

  RETURN jsonb_build_object(
           'generatedAt',          v_now,
           'controlState',         v_control,
           'definitions',          v_defs,
           'byState',              v_by_state,
           'byOpportunityType',    v_by_type,
           'priorityDistribution', v_by_prio
         )
         || v_ledger;
END;
$$;

COMMENT ON FUNCTION public.get_admin_marketing_opportunity_ledger_overview() IS
  'Stage 3C2H READ-ONLY admin ledger overview. Reads control state, definitions and marketing_opportunities only. Returns aggregate counts (by state/type/priority), activeNow, expiredButStateNotExpired (open/deferred past expiry), score min/avg/max, expiry windows, identity and campaign-context splits. Exposes NO user_id/email/external_contact_id/dedupe_key/raw reason/context. No writes. Service-role only.';

REVOKE ALL ON FUNCTION public.get_admin_marketing_opportunity_ledger_overview() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_marketing_opportunity_ledger_overview() TO service_role;

-- ============================================================================
-- PART B — ANONYMISED QA SAMPLE
--   Bounded (1..100) READ-ONLY sample of individual opportunities exposing SAFE
--   fields only: an opaque md5-derived customer hash prefix (NEVER a raw id),
--   scalar lifecycle fields, and JSON KEY NAMES (never raw values). detectorStage
--   and definitionKey are extracted individually because they are safe,
--   non-identifying provenance strings. Deterministic newest-first ordering.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_admin_marketing_opportunity_qa_sample(p_limit integer DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '10s'
AS $$
DECLARE
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_result jsonb;
BEGIN
  WITH sample AS (
    SELECT
      o.id,
      o.user_id,
      o.external_contact_id,
      o.opportunity_type,
      o.state,
      o.base_priority,
      o.score,
      o.detected_at,
      o.expires_at,
      o.campaign_id,
      o.reason,
      o.context_snapshot
    FROM public.marketing_opportunities o
    -- Deterministic: most recently detected first, id as the internal tie-break.
    ORDER BY o.detected_at DESC, o.id ASC
    LIMIT v_limit
  )
  SELECT jsonb_build_object(
    'generatedAt', now(),
    'limit',       v_limit,
    'count',       (SELECT count(*)::int FROM sample),
    'sample', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        -- Opaque, stable, NON-reversible customer hash prefix. Derived from
        -- whichever identity is present; NEVER the raw user_id/contact id.
        'customerHash',     substr(md5(COALESCE(s.user_id::text, s.external_contact_id::text)), 1, 12),
        'opportunityType',  s.opportunity_type,
        'state',            s.state,
        'basePriority',     s.base_priority,
        'score',            s.score,
        'detectedAt',       s.detected_at,
        'expiresAt',        s.expires_at,
        'hoursRemaining',   round(extract(epoch FROM (s.expires_at - now())) / 3600, 2),
        'campaignContext',  (s.campaign_id IS NOT NULL),
        -- reason / context KEY NAMES only — never the raw values.
        'reasonKeys',       (SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb)
                               FROM jsonb_object_keys(s.reason) k),
        'contextKeys',      (SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb)
                               FROM jsonb_object_keys(s.context_snapshot) k),
        -- Safe, non-identifying provenance strings only.
        'detectorStage',    s.context_snapshot ->> 'detectorStage',
        'definitionKey',    s.reason ->> 'definitionKey',
        'selectedAsNextBestAction',
                            COALESCE((s.context_snapshot ->> 'selectedAsNextBestAction')::boolean, false),
        'hasUserIdentity',     (s.user_id IS NOT NULL),
        'hasExternalIdentity', (s.external_contact_id IS NOT NULL)
      ) ORDER BY s.detected_at DESC, s.id ASC)
       FROM sample s),
      '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_admin_marketing_opportunity_qa_sample(integer) IS
  'Stage 3C2H READ-ONLY bounded (<=100) anonymised QA sample of individual opportunities. Exposes an opaque md5-derived customerHash (never a raw id), opportunity_type, state, base_priority, score, timing, hoursRemaining, campaign-context boolean, reason/context KEY NAMES only, safe detectorStage/definitionKey provenance strings, selectedAsNextBestAction and identity-shape booleans. Never exposes user_id/email/external_contact_id/dedupe_key/raw reason/context. Newest-first deterministic order. No writes. Service-role only.';

REVOKE ALL ON FUNCTION public.get_admin_marketing_opportunity_qa_sample(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_marketing_opportunity_qa_sample(integer) TO service_role;

-- ============================================================================
-- PART C — BOUNDED LIFECYCLE MAINTENANCE
--   EXPLICITLY invoked (never at install, never by cron in this stage). Marks
--   GENUINELY time-expired opportunities (expires_at <= now()) whose state is in
--   the approved AUTO-EXPIRABLE set ('open','deferred') as state='expired'. The
--   ONLY transition performed is -> 'expired'. It NEVER selects, suppresses,
--   supersedes, actions or creates opportunities, and NEVER mutates control
--   state or definitions.
--
--   Bounded: p_limit defaults to 100, hard-clamped to [1, 500]. Set-based,
--   deterministic (expires_at ASC, detected_at ASC, id ASC). Conservative gate:
--   refuses while sending_enabled = true.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.maintain_marketing_opportunity_lifecycle(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $$
DECLARE
  v_start           timestamptz := clock_timestamp();
  v_now             timestamptz := now();
  -- Hard-clamped to the absolute [1, 500] envelope.
  v_requested_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_effective_limit integer;
  v_sending         boolean;
  v_considered      bigint := 0;
  v_updated         bigint := 0;
BEGIN
  -- effective_limit has no additional ceiling in this housekeeping stage.
  v_effective_limit := v_requested_limit;

  -- Read (never mutate) the sending gate. Fail closed if the singleton is gone.
  SELECT sending_enabled INTO v_sending
    FROM public.marketing_control_state
   WHERE key = 'default';
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 'control_state_missing',
      'considered', 0,
      'updated', 0,
      'requestedLimit', v_requested_limit,
      'effectiveLimit', v_effective_limit,
      'generatedAt', v_now,
      'durationMs', round(extract(epoch FROM clock_timestamp() - v_start) * 1000)::bigint
    );
  END IF;

  -- Conservative gate: refuse to expire anything while sending is active.
  IF v_sending IS DISTINCT FROM false THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'sending_active',
      'considered', 0,
      'updated', 0,
      'requestedLimit', v_requested_limit,
      'effectiveLimit', v_effective_limit,
      'generatedAt', v_now,
      'durationMs', round(extract(epoch FROM clock_timestamp() - v_start) * 1000)::bigint
    );
  END IF;

  -- Serialise maintenance runs (distinct from the discovery run lock). If another
  -- run holds the lock, no-op cleanly.
  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_stage_3c2h_lifecycle_maintenance')) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'locked',
      'considered', 0,
      'updated', 0,
      'requestedLimit', v_requested_limit,
      'effectiveLimit', v_effective_limit,
      'generatedAt', v_now,
      'durationMs', round(extract(epoch FROM clock_timestamp() - v_start) * 1000)::bigint
    );
  END IF;

  -- Total genuinely-expirable backlog (for reporting; not the update bound).
  SELECT count(*) INTO v_considered
    FROM public.marketing_opportunities
   WHERE expires_at <= v_now
     AND state IN ('open', 'deferred');

  -- Bounded, deterministic, SET-BASED expiry. The ONLY transition is -> expired.
  -- The WHERE clause on the UPDATE re-checks expiry + approved states so the
  -- write can never touch selected/suppressed/superseded/actioned/expired rows.
  WITH eligible AS (
    SELECT id
      FROM public.marketing_opportunities
     WHERE expires_at <= v_now
       AND state IN ('open', 'deferred')
     ORDER BY expires_at ASC, detected_at ASC, id ASC
     LIMIT v_effective_limit
  )
  UPDATE public.marketing_opportunities o
     SET state = 'expired',
         updated_at = v_now
    FROM eligible e
   WHERE o.id = e.id
     AND o.expires_at <= v_now
     AND o.state IN ('open', 'deferred');

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'ok',
    'considered', v_considered,
    'updated', v_updated,
    'requestedLimit', v_requested_limit,
    'effectiveLimit', v_effective_limit,
    'generatedAt', v_now,
    'durationMs', round(extract(epoch FROM clock_timestamp() - v_start) * 1000)::bigint
  );
END;
$$;

COMMENT ON FUNCTION public.maintain_marketing_opportunity_lifecycle(integer) IS
  'Stage 3C2H bounded, explicitly-invoked lifecycle housekeeping. Marks genuinely time-expired opportunities (expires_at <= now()) whose state is open or deferred as state=expired — the ONLY transition it performs. NEVER selects/suppresses/supersedes/actions/creates opportunities, NEVER touches selected/suppressed/superseded/actioned/expired rows, NEVER mutates control state or definitions. Refuses while sending_enabled=true (status=sending_active). Set-based, advisory-locked, p_limit clamped 1..500, deterministic order. Returns compact JSON (no identities). Service-role only.';

REVOKE ALL ON FUNCTION public.maintain_marketing_opportunity_lifecycle(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maintain_marketing_opportunity_lifecycle(integer) TO service_role;

COMMIT;

-- ============================================================================
-- POST-CONDITIONS (informational):
--   * Three new functions created; ZERO opportunity rows created/updated/deleted
--     by this installation; control state, definitions and the Stage 3C2G canary
--     row UNCHANGED.
--   * The ONLY opportunity UPDATE in this file lives INSIDE
--     maintain_marketing_opportunity_lifecycle and is NOT invoked at install.
--   * A manual maintenance call today updates 0 rows (the canary is not expired).
--   * No detector/scoring/schema/dedupe change; no new states; no recipients/
--     runs/email/cron/AI; no discovery/sending/rollout/definition change.
--   * Migrations 001-014 untouched.
-- ============================================================================
