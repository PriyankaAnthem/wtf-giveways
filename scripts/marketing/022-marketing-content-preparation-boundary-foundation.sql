-- ============================================================================
-- WTF Marketing Hub — Stage 3D3B: CONTENT PREPARATION BOUNDARY FOUNDATION
-- ----------------------------------------------------------------------------
-- MIGRATION 022
--
-- PURPOSE
--   Install the deterministic FOUNDATION for POST-MATERIALISATION content
--   preparation, WITHOUT preparing, transitioning, or sending anything. It:
--
--     1. Seeds EXACTLY ONE canonical structured marketing template for the
--        abandoned_checkout trigger (structured slots only; no raw HTML; only
--        the controlled placeholder allowlist; campaign-dynamic default_url is
--        left NULL — see CTA URL note).
--     2. Maps ONLY the abandoned_checkout automation.template_id to that template
--        (config only; the automation and its definition stay DISABLED).
--     3. Installs a PRIVATE, owner-only, read-only POST-MATERIALISATION content
--        preparation gate:
--            public.wtf_marketing_recipient_preparation_preview()
--        This is NOT the Stage 019 PRE-materialisation recipient gate. It
--        evaluates EXISTING materialised recipient rows and decides whether a
--        recipient is eligible for CONTENT PREPARATION (not delivery).
--     4. Installs service-role-only aggregate + anonymised-sample admin RPCs over
--        that gate (no identities, mirroring Stage 018/019 patterns).
--     5. Documents (SQL COMMENTs) the content-readiness contract and the run
--        lifecycle contract, WITHOUT adding a recipient status or altering CHECKs.
--
-- ARCHITECTURAL CONTRACT (why a NEW gate, not Stage 019):
--   Stage 019 (public.wtf_marketing_recipient_gate_preview) is a PRE-
--   materialisation gate. It intentionally requires opportunity.state='open' AND
--   NO existing recipient. After Stage 020 materialisation the legitimate state
--   is opportunity.state='selected' WITH an existing recipient — so a correctly
--   materialised recipient MUST fail Stage 019. That is by design. Stage 019 is
--   NOT touched, NOT weakened, NOT re-used here. This migration adds a SEPARATE
--   deterministic gate for the post-materialisation world.
--
-- WHAT THE PREPARATION GATE REQUIRES (deterministic, fail-closed):
--   RECIPIENT  : opportunity_id NOT NULL; user_id NOT NULL; external_contact_id
--                NULL; status = 'queued' (the current materialised pre-send
--                status); sent_at NULL; provider_email_id NULL; locked_at NULL;
--                locked_until NULL; attempts = 0 (not artificially advanced).
--   RUN        : the recipient's run exists and run.status = 'preparing'.
--   OPPORTUNITY: exists; state='selected'; selected_at NOT NULL; actioned_at
--                NULL; opportunity.user_id = recipient.user_id; the opportunity's
--                identity email (via its profile) = recipient.email_lc;
--                opportunity_type = definition.opportunity_key. Opportunity
--                provenance automation_id is IRRELEVANT and NEVER consulted.
--   ROUTING    : definition exists; definition.delivery_automation_id NOT NULL;
--                run.automation_id = definition.delivery_automation_id;
--                automation exists. (Delivery route is sourced from the
--                DEFINITION, never from opportunity provenance.)
--   KILL SW.   : definition.enabled = true AND automation.enabled = true. If an
--                admin disables either after materialisation, preparation STOPS.
--   CONTACT    : re-checked CURRENTLY (not from any snapshot): profile exists;
--                account_active; email_confirmed; email_lc present and equal to
--                recipient.email_lc; marketing_enabled; NOT has_active_suppression;
--                AND public.is_marketing_email_eligible(user_id, email_lc) IS TRUE.
--   CAMPAIGN   : campaign-specific definition => campaign_id NOT NULL, campaign
--                exists, campaign live (status='live' AND (end_at IS NULL OR
--                end_at > now())). Non-campaign definition => campaign_id NULL.
--   TEMPLATE   : automation.template_id NOT NULL; template exists;
--                template.is_active; template.version >= 1; required structured
--                fields present + non-empty. (template_ready = all of these.)
--
-- FREQUENCY (explicit decision):
--   Frequency caps are NOT part of preparation_eligible. Preparation may happen
--   well before the actual delivery time, and frequency is authoritative at
--   DELIVERY time. The future delivery worker will re-check frequency immediately
--   before any provider call. Preparation is deliberately frequency-agnostic.
--   This does NOT weaken delivery safety.
--
-- CONTENT-READINESS CONTRACT — VERSION 1 (formally ESTABLISHED here; NOT
-- populated here). Stage 022 defines schemaVersion=1 of the prepared-snapshot
-- contract that a FUTURE Stage 023 preparation worker will populate. The gate
-- deterministically VALIDATES this contract; merely non-empty JSON is NOT
-- "prepared". content_prepared is TRUE only when BOTH snapshots are JSON
-- OBJECTS satisfying:
--
--   template_snapshot (schemaVersion=1):
--     {
--       "schemaVersion": 1,                 -- exactly 1
--       "templateKey":     <non-empty string>,
--       "templateVersion": <integer >= 1>,
--       "subject":         <non-empty string>,
--       "previewText":     <string or null>,   -- optional
--       "heading":         <non-empty string>,
--       "bodyText":        <non-empty string>,
--       "ctaLabel":        <non-empty string>
--     }
--
--   context_snapshot (schemaVersion=1):
--     {
--       "schemaVersion":   1,               -- exactly 1
--       "opportunityType": <non-empty string; MUST equal the linked
--                            opportunity.opportunity_type>,
--       "campaign": {                       -- REQUIRED for campaign-specific
--         "title": <non-empty string>,      -- opportunities (abandoned_checkout)
--         "url":   <non-empty string>       -- resolved campaign URL
--       }
--     }
--
--   Forbidden in EITHER snapshot (privacy): user id, email, recipient id,
--   opportunity id, run id, raw consent data, unsubscribe token, provider data,
--   and any financial-vulnerability / loss / chasing data. Unsubscribe URL is
--   NOT part of the prepared contract (minted at final render/delivery time).
--
--   The current live canary has template_snapshot = '{}'::jsonb and
--   context_snapshot = '{}'::jsonb, so content_prepared = false. Stage 022 DOES
--   NOT populate snapshots. Future Stage 023 preparation will populate the above.
--
-- RECIPIENT STATUS CONTRACT (documented; CHECK NOT altered; no new status):
--   recipient.status='queued' ALONE does NOT mean content-ready or delivery-ready.
--   The authoritative future DELIVERY-readiness contract will require BOTH
--   recipient.status='queued' AND parent run.status='queued' AND validated
--   prepared snapshots AND a fresh delivery-safety gate. Thus a 'queued'
--   materialised recipient under a 'preparing' run is NOT delivery-ready.
--
-- RUN LIFECYCLE CONTRACT (documented; NO run is transitioned here):
--   preparing  : recipient materialisation + content preparation may occur.
--                Delivery MUST NOT consume this run.
--   queued     : all recipients intended for the run have completed deterministic
--                preparation and the run has explicitly passed the future
--                readiness transition.
--   processing : the delivery worker has claimed/started the queued run.
--   completed  : delivery finished per future delivery semantics.
--   cancelled / failed : terminal non-success states.
--   Stage 022 MUST NOT transition any run. The live canary stays 'preparing'.
--
-- CTA URL (explicit decision):
--   abandoned_checkout is CAMPAIGN-SPECIFIC. A reusable template must not hard-
--   code one campaign URL. The canonical campaign destination is
--   {NEXT_PUBLIC_SITE_URL}/giveaways/<campaign.slug> (route app/giveaways/[slug]).
--   The template therefore uses the {{campaign_url}} placeholder in the body and
--   leaves default_url NULL. The future preparation layer MUST resolve
--   {{campaign_url}} into the per-recipient context_snapshot (from the frozen
--   opportunity.campaign_id -> campaigns.slug), plus {{campaign_title}}. The
--   seeded copy uses ONLY these two campaign-driven, authoritatively-resolvable
--   placeholders; {{first_name}} is intentionally NOT used (no confirmed source).
--   NO URL is fabricated in this migration.
--
-- UNSUBSCRIBE (explicit decision):
--   No unsubscribe token/URL is placed in the template record OR any recipient
--   snapshot here. The server-only unsubscribe token is minted at final render/
--   delivery time. NO secret is referenced in this migration.
--
-- WHAT THIS MIGRATION MUST NOT DO
--   No recipient/run/opportunity row inserted, updated, deleted. No recipient or
--   run status change. No snapshot populated. No opportunity selected/actioned.
--   No email/Resend/provider call. No sending/discovery/rollout change. No
--   definition enabled. No automation enabled (only template_id mapped). No
--   consent write. No checkout/payments/tickets/wallet/customer-facing change.
--   No cron. No AI. No RLS/policy change. No change to migrations 001-021 (incl.
--   the Stage 019 gate and Stage 020 materialiser). Other five automation
--   mappings untouched.
--
-- PRODUCTION SAFETY
--   Single transaction; SET LOCAL lock_timeout so we FAIL rather than block a busy
--   database. Read-only advisory-locked preflight + post-install verification
--   bracket the ONLY two config writes (one template insert, one automation
--   template_id map). ANY failed assertion RAISEs and rolls back EVERYTHING.
--
-- HOW TO RUN
--   The application NEVER executes this. Run it manually ONCE in the Supabase SQL
--   editor (or psql), AFTER migration 021, while Marketing is paused.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ============================================================================
-- PREFLIGHT — advisory lock + ALL read-only assertions BEFORE any change.
-- ============================================================================
DO $preflight$
DECLARE
  v_dep            text;
  v_missing        text[] := ARRAY[]::text[];

  v_tmpl_total     bigint;
  v_ac_key_exists  boolean;

  v_auto_ac_id     uuid;
  v_auto_ac_tmpl   uuid;
  v_auto_ac_enab   boolean;

  v_def_ac_exists  boolean;
  v_def_ac_camp    boolean;
  v_def_ac_route   uuid;
  v_def_ac_enab    boolean;

  v_recip_count    bigint;
  v_recip_queued   bigint;
  v_recip_snap     bigint;
  v_recip_locked   bigint;
  v_recip_sent     bigint;

  v_runs_count     bigint;
  v_runs_prep      bigint;

  v_opp_count      bigint;
  v_opp_selected   bigint;

  v_sending        boolean;
  v_discovery      boolean;
  v_rollout        integer;

  v_defs_enabled   bigint;
  v_autos_enabled  bigint;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_stage_3d3b_content_preparation')) THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: another execution is already in progress (advisory lock held).';
  END IF;

  -- 1. Required tables.
  FOREACH v_dep IN ARRAY ARRAY[
    'public.marketing_templates',
    'public.marketing_automations',
    'public.marketing_opportunity_definitions',
    'public.marketing_opportunities',
    'public.marketing_automation_runs',
    'public.marketing_recipients',
    'public.marketing_control_state',
    'public.customer_marketing_profiles',
    'public.campaigns'
  ] LOOP
    IF to_regclass(v_dep) IS NULL THEN
      v_missing := array_append(v_missing, v_dep);
    END IF;
  END LOOP;
  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: required table % is missing.', array_to_string(v_missing, ', ');
  END IF;

  -- 2. Authoritative permission function must exist (exact signature).
  IF to_regprocedure('public.is_marketing_email_eligible(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: is_marketing_email_eligible(uuid,text) is missing.';
  END IF;

  -- 3. Stage 019 delivery route column must exist (post-materialisation routing source).
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.marketing_opportunity_definitions'::regclass
       AND attname = 'delivery_automation_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: Stage 019 delivery_automation_id column missing.';
  END IF;

  -- 4. No template named for abandoned_checkout may already exist under our key.
  SELECT count(*) INTO v_tmpl_total FROM public.marketing_templates;
  SELECT EXISTS (
    SELECT 1 FROM public.marketing_templates WHERE template_key = 'abandoned_checkout_v1'
  ) INTO v_ac_key_exists;
  IF v_ac_key_exists THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: template_key ''abandoned_checkout_v1'' already exists.';
  END IF;

  -- 5. abandoned_checkout automation must exist, be UNMAPPED, and DISABLED.
  SELECT id, template_id, enabled
    INTO v_auto_ac_id, v_auto_ac_tmpl, v_auto_ac_enab
    FROM public.marketing_automations
   WHERE automation_key = 'abandoned_checkout';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: abandoned_checkout automation missing.';
  END IF;
  IF v_auto_ac_tmpl IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: abandoned_checkout automation already has template_id set.';
  END IF;
  IF v_auto_ac_enab IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: abandoned_checkout automation is enabled; expected disabled.';
  END IF;

  -- 6. abandoned_checkout definition must exist, be campaign-specific, routed, DISABLED.
  SELECT true, d.campaign_specific, d.delivery_automation_id, d.enabled
    INTO v_def_ac_exists, v_def_ac_camp, v_def_ac_route, v_def_ac_enab
    FROM public.marketing_opportunity_definitions d
   WHERE d.opportunity_key = 'abandoned_checkout';
  IF NOT COALESCE(v_def_ac_exists, false) THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: abandoned_checkout definition missing.';
  END IF;
  IF v_def_ac_camp IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: abandoned_checkout definition must be campaign_specific.';
  END IF;
  IF v_def_ac_route IS NULL THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: abandoned_checkout definition has no delivery route.';
  END IF;
  IF v_def_ac_route IS DISTINCT FROM v_auto_ac_id THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: abandoned_checkout definition route does not point at the abandoned_checkout automation.';
  END IF;
  IF v_def_ac_enab IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: abandoned_checkout definition is enabled; expected disabled.';
  END IF;

  -- 7. Controlled live canary ledger: recipients=1, runs=1, opportunities=7.
  SELECT count(*),
         count(*) FILTER (WHERE status = 'queued'),
         count(*) FILTER (WHERE template_snapshot = '{}'::jsonb AND context_snapshot = '{}'::jsonb),
         count(*) FILTER (WHERE locked_at IS NOT NULL OR locked_until IS NOT NULL),
         count(*) FILTER (WHERE sent_at IS NOT NULL OR provider_email_id IS NOT NULL)
    INTO v_recip_count, v_recip_queued, v_recip_snap, v_recip_locked, v_recip_sent
    FROM public.marketing_recipients;
  IF v_recip_count <> 1 THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: marketing_recipients holds % row(s); expected 1.', v_recip_count;
  END IF;
  IF v_recip_queued <> 1 THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: canary recipient not queued.';
  END IF;
  IF v_recip_snap <> 1 THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: canary recipient snapshots are not both empty {}.';
  END IF;
  IF v_recip_locked <> 0 THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: canary recipient is locked.';
  END IF;
  IF v_recip_sent <> 0 THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: canary recipient has send/provider state.';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE status = 'preparing')
    INTO v_runs_count, v_runs_prep
    FROM public.marketing_automation_runs;
  IF v_runs_count <> 1 OR v_runs_prep <> 1 THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: expected exactly 1 preparing run (got total=%, preparing=%).', v_runs_count, v_runs_prep;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE state = 'selected')
    INTO v_opp_count, v_opp_selected
    FROM public.marketing_opportunities;
  IF v_opp_count <> 7 THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: marketing_opportunities holds % row(s); expected 7.', v_opp_count;
  END IF;
  IF v_opp_selected <> 1 THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: expected exactly 1 selected opportunity (got %).', v_opp_selected;
  END IF;

  -- 8. Marketing fully paused; zero definitions/automations enabled.
  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state WHERE key = 'default';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: marketing_control_state singleton not found.';
  END IF;
  IF v_sending IS DISTINCT FROM false OR v_discovery IS DISTINCT FROM false OR v_rollout IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: Marketing not paused (sending=%, discovery=%, rollout=%).', v_sending, v_discovery, v_rollout;
  END IF;

  SELECT count(*) INTO v_defs_enabled  FROM public.marketing_opportunity_definitions WHERE enabled = true;
  SELECT count(*) INTO v_autos_enabled FROM public.marketing_automations           WHERE enabled = true;
  IF v_defs_enabled <> 0 THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: % definition(s) enabled; expected 0.', v_defs_enabled;
  END IF;
  IF v_autos_enabled <> 0 THEN
    RAISE EXCEPTION 'Stage 3D3B (022) aborted: % automation(s) enabled; expected 0.', v_autos_enabled;
  END IF;
END
$preflight$;

-- ============================================================================
-- BASELINE CAPTURE — counts + deterministic checksums of the recipient, run and
-- opportunity ledgers over STABLE columns. Verified UNCHANGED post-install to
-- prove the data ledger was not touched. ON COMMIT DROP.
-- ============================================================================
CREATE TEMP TABLE tmp_marketing_3d3b_baseline ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.marketing_recipients)      AS recipients_before,
  (SELECT count(*) FROM public.marketing_automation_runs) AS runs_before,
  (SELECT count(*) FROM public.marketing_opportunities)   AS opportunities_before,
  (
    SELECT md5(coalesce(string_agg(row_sig, '|' ORDER BY row_sig), ''))
      FROM (
        SELECT md5(
          coalesce(r.id::text, '')                 || '~' ||
          coalesce(r.run_id::text, '')             || '~' ||
          coalesce(r.user_id::text, '')            || '~' ||
          coalesce(r.opportunity_id::text, '')     || '~' ||
          coalesce(r.email_lc, '')                 || '~' ||
          coalesce(r.status, '')                   || '~' ||
          coalesce(r.attempts::text, '')           || '~' ||
          coalesce(r.template_snapshot::text, '')  || '~' ||
          coalesce(r.context_snapshot::text, '')   || '~' ||
          coalesce(r.sent_at::text, '')            || '~' ||
          coalesce(r.provider_email_id, '')        || '~' ||
          coalesce(r.locked_at::text, '')          || '~' ||
          coalesce(r.locked_until::text, '')
        ) AS row_sig
          FROM public.marketing_recipients r
      ) s
  ) AS recipients_checksum,
  (
    SELECT md5(coalesce(string_agg(row_sig, '|' ORDER BY row_sig), ''))
      FROM (
        SELECT md5(
          coalesce(ru.id::text, '')            || '~' ||
          coalesce(ru.automation_id::text, '') || '~' ||
          coalesce(ru.promotion_id::text, '')  || '~' ||
          coalesce(ru.status, '')
        ) AS row_sig
          FROM public.marketing_automation_runs ru
      ) s
  ) AS runs_checksum,
  (
    SELECT md5(coalesce(string_agg(row_sig, '|' ORDER BY row_sig), ''))
      FROM (
        SELECT md5(
          coalesce(o.id::text, '')            || '~' ||
          coalesce(o.state, '')               || '~' ||
          coalesce(o.selected_at::text, '')   || '~' ||
          coalesce(o.actioned_at::text, '')   || '~' ||
          coalesce(o.automation_id::text, '') || '~' ||
          coalesce(o.campaign_id::text, '')
        ) AS row_sig
          FROM public.marketing_opportunities o
      ) s
  ) AS opportunities_checksum;

-- ============================================================================
-- CONFIG WRITE 1 — SEED THE CANONICAL abandoned_checkout TEMPLATE.
--   Structured slots only. Only CURRENTLY-RESOLVABLE allowlisted placeholders
--   are used:
--     {{campaign_title}}, {{campaign_url}}
--   {{first_name}} is deliberately NOT used: the Stage 022 audit established that
--   customer_marketing_profiles has NO confirmed authoritative first_name source,
--   and this migration must not invent one or expand the marketing projection.
--   Allowlisting only proves SYNTAX validity, not DATA resolvability, so the
--   seeded copy is limited to values the next preparation layer can resolve
--   authoritatively from its approved campaign-driven inputs.
--   NO angle brackets, NO raw HTML, NO emoji, NO loss/near-miss/chasing/scarcity/
--   guaranteed-win framing.
--   default_url is intentionally NULL: abandoned_checkout is campaign-specific,
--   so the destination is resolved per-recipient by the future preparation layer
--   into context_snapshot (from campaign.slug), NEVER hard-coded to one campaign.
--   is_active = true (mapped + active so the recipient can become template_ready)
--   but the automation + definition stay DISABLED, so nothing can send.
-- ============================================================================
INSERT INTO public.marketing_templates (
  template_key,
  name,
  subject,
  preview_text,
  heading,
  body_text,
  cta_label,
  default_url,
  discount_code_id,
  version,
  is_active
)
VALUES (
  'abandoned_checkout_v1',
  'Abandoned Checkout — Recovery',
  'You left something behind',
  'Your entry for {{campaign_title}} was not completed.',
  'Still thinking about {{campaign_title}}?',
  'It looks like your checkout was not completed. If you still want to enter, '
    || 'you can head back to the competition and pick up right where you left off '
    || 'before it closes. Complete your entry at {{campaign_url}}.',
  'Finish my entry',
  NULL,          -- campaign-dynamic; resolved later via {{campaign_url}}
  NULL,          -- no discount attached to this recovery template
  1,
  true
);

-- ============================================================================
-- CONFIG WRITE 2 — MAP ONLY THE abandoned_checkout AUTOMATION -> new template.
--   Sets template_id ONLY. enabled is NOT touched (stays false). No other
--   automation is modified. Mapping while disabled is allowed and inert.
-- ============================================================================
UPDATE public.marketing_automations a
   SET template_id = t.id,
       updated_at  = now()
  FROM public.marketing_templates t
 WHERE a.automation_key = 'abandoned_checkout'
   AND t.template_key   = 'abandoned_checkout_v1'
   AND a.template_id IS NULL;   -- idempotent guard: never overwrite an existing map

-- ============================================================================
-- PART A0 — PRIVATE DB TEMPLATE-VALIDATION HELPER (authoritative at the
--   preparation boundary). Reproduces the CURRENT application validation
--   contract from lib/admin/marketing/hub-validation.ts + placeholders.ts
--   EXACTLY, so the gate NEVER trusts that the admin API validated the row.
--
--   Contract reproduced (all must hold for a template to be "valid"):
--     * template_key: lower(key) matches ^[a-z][a-z0-9_]*$ AND length 1..100.
--     * name        : required, trimmed length 1..200,  no angle brackets [<>].
--     * subject     : required, trimmed length 1..300,  no angle brackets.
--     * preview_text: optional; if present trimmed length 1..300, no brackets.
--     * heading     : required, trimmed length 1..300,  no angle brackets.
--     * body_text   : required, trimmed length 1..5000, no angle brackets.
--     * cta_label   : required, trimmed length 1..100,  no angle brackets.
--     * default_url : optional; if present length 1..2048, no angle brackets,
--                     AND a syntactically valid http(s):// URL.
--     * version     : integer >= 1.
--     * Placeholders: every {{ token }} across subject/preview/heading/body/
--                     cta/default_url must, after trimming, be one of the exact
--                     canonical allowlist:
--                       first_name, campaign_title, campaign_url,
--                       credit_balance, discount_code, unsubscribe_url
--                     An empty/whitespace token {{}} is INVALID. The token
--                     grammar is exactly the app engine's /\{\{([^{}]*)\}\}/g:
--                     inner content may not contain '{' or '}'.
--
--   Owner-only; STABLE (reads marketing_templates by id); no writes; EXECUTE
--   revoked from PUBLIC/anon/authenticated/service_role. Returns false for a
--   NULL / missing template id (fail-closed).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.wtf_marketing_template_is_valid(p_template_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $tmplvalid$
  WITH t AS (
    SELECT *
      FROM public.marketing_templates
     WHERE id = p_template_id
  ),
  -- Every {{...}} token across all rendered slots (inner captured, no braces).
  toks AS (
    SELECT btrim(m[1]) AS token
      FROM t,
           LATERAL regexp_matches(
             coalesce(t.subject, '')      || ' ' ||
             coalesce(t.preview_text, '') || ' ' ||
             coalesce(t.heading, '')      || ' ' ||
             coalesce(t.body_text, '')    || ' ' ||
             coalesce(t.cta_label, '')    || ' ' ||
             coalesce(t.default_url, ''),
             '\{\{([^{}]*)\}\}',
             'g'
           ) AS m
  )
  SELECT COALESCE((
    SELECT
          -- template_key
          lower(t.template_key) ~ '^[a-z][a-z0-9_]*$'
      AND char_length(t.template_key) BETWEEN 1 AND 100
          -- name
      AND t.name IS NOT NULL AND char_length(btrim(t.name)) BETWEEN 1 AND 200
      AND t.name !~ '[<>]'
          -- subject (required)
      AND t.subject IS NOT NULL AND char_length(btrim(t.subject)) BETWEEN 1 AND 300
      AND t.subject !~ '[<>]'
          -- preview_text (optional)
      AND (t.preview_text IS NULL
           OR (char_length(btrim(t.preview_text)) BETWEEN 1 AND 300 AND t.preview_text !~ '[<>]'))
          -- heading (required)
      AND t.heading IS NOT NULL AND char_length(btrim(t.heading)) BETWEEN 1 AND 300
      AND t.heading !~ '[<>]'
          -- body_text (required)
      AND t.body_text IS NOT NULL AND char_length(btrim(t.body_text)) BETWEEN 1 AND 5000
      AND t.body_text !~ '[<>]'
          -- cta_label (required)
      AND t.cta_label IS NOT NULL AND char_length(btrim(t.cta_label)) BETWEEN 1 AND 100
      AND t.cta_label !~ '[<>]'
          -- default_url (optional, http(s), bounded, no brackets)
      AND (t.default_url IS NULL
           OR (char_length(t.default_url) BETWEEN 1 AND 2048
               AND t.default_url !~ '[<>]'
               AND t.default_url ~* '^https?://[^[:space:]]+$'))
          -- version
      AND coalesce(t.version, 0) >= 1
          -- placeholders: no unknown/empty token anywhere
      AND NOT EXISTS (
            SELECT 1 FROM toks
             WHERE toks.token NOT IN (
               'first_name', 'campaign_title', 'campaign_url',
               'credit_balance', 'discount_code', 'unsubscribe_url'
             )
          )
      FROM t
  ), false)
$tmplvalid$;

COMMENT ON FUNCTION public.wtf_marketing_template_is_valid(uuid) IS
  'Stage 3D3B PRIVATE authoritative template validator (owner-only; EXECUTE revoked from every role). Reproduces the CURRENT application validation contract (lib/admin/marketing/hub-validation.ts + placeholders.ts): template_key regex ^[a-z][a-z0-9_]*$ (1..100); required subject/heading/body/cta + optional preview within DB length caps and with NO angle brackets; optional default_url must be a bounded http(s) URL; version >= 1; and EVERY {{token}} (grammar /\{\{([^{}]*)\}\}/g, trimmed) must belong to the exact allowlist {first_name, campaign_title, campaign_url, credit_balance, discount_code, unsubscribe_url} with empty tokens rejected. Fail-closed: NULL/missing id => false. Read-only; the preparation boundary NEVER trusts prior admin-API validation.';

REVOKE ALL ON FUNCTION public.wtf_marketing_template_is_valid(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wtf_marketing_template_is_valid(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.wtf_marketing_template_is_valid(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.wtf_marketing_template_is_valid(uuid) FROM service_role;

-- ============================================================================
-- PART A — PRIVATE POST-MATERIALISATION CONTENT PREPARATION GATE.
--   Owner-only (EXECUTE revoked from PUBLIC/anon/authenticated/service_role).
--   STABLE, SECURITY DEFINER, locked search_path. Read-only. Evaluates EXISTING
--   materialised recipient rows. Emits deterministic, fixed-order blocker codes.
--   May contain IDs because it is owner-only and never exposed to app roles.
--
--   Authoritative linkage:
--     marketing_recipients r
--     JOIN marketing_automation_runs run  ON run.id = r.run_id
--     JOIN marketing_opportunities   o    ON o.id   = r.opportunity_id
--     LEFT JOIN marketing_opportunity_definitions d ON d.opportunity_key = o.opportunity_type
--     LEFT JOIN marketing_automations a    ON a.id = d.delivery_automation_id
--     LEFT JOIN marketing_templates   t    ON t.id = a.template_id
--     LEFT JOIN customer_marketing_profiles p ON p.user_id = r.user_id
--     LEFT JOIN campaigns c                ON c.id = o.campaign_id
--
--   Delivery route is sourced from the DEFINITION (d.delivery_automation_id) and
--   the run must match it (run.automation_id = d.delivery_automation_id). The
--   opportunity's provenance automation_id is NEVER consulted. Stage 019 concepts
--   (gate_eligible, pre_nba_gate_eligible, next_best_rank, opportunity.state=open,
--   "no existing recipient") are NEVER reapplied here.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.wtf_marketing_recipient_preparation_preview()
RETURNS TABLE (
  recipient_id                      uuid,
  run_id                            uuid,
  opportunity_id                    uuid,
  user_id                           uuid,
  email_lc                          text,
  opportunity_type                  text,
  campaign_id                       uuid,

  recipient_queued                  boolean,
  recipient_unsent                  boolean,
  recipient_unlocked                boolean,
  recipient_attempts_pristine       boolean,
  recipient_user_identity           boolean,

  run_exists                        boolean,
  run_preparing                     boolean,

  opportunity_exists                boolean,
  opportunity_selected              boolean,
  opportunity_selected_at_set       boolean,
  opportunity_actioned              boolean,
  opportunity_user_matches          boolean,
  opportunity_email_matches         boolean,
  opportunity_type_matches_def      boolean,

  definition_exists                 boolean,
  definition_enabled                boolean,
  automation_exists                 boolean,
  automation_enabled                boolean,
  route_valid                       boolean,

  profile_matched                   boolean,
  account_active                    boolean,
  email_confirmed                   boolean,
  marketing_enabled                 boolean,
  active_suppression                boolean,
  authoritative_marketing_eligible  boolean,

  campaign_specific                 boolean,
  campaign_context_valid            boolean,

  template_mapped                   boolean,
  template_exists                   boolean,
  template_active                   boolean,
  template_valid                    boolean,
  template_ready                    boolean,
  template_version                  integer,

  content_prepared                  boolean,
  preparation_eligible              boolean,
  blocker_reasons                   text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $prep$
WITH base AS (
  SELECT
    r.id                                   AS recipient_id,
    r.run_id                               AS run_id,
    r.opportunity_id                       AS opportunity_id,
    r.user_id                              AS user_id,
    r.email_lc                             AS email_lc,
    r.external_contact_id                  AS external_contact_id,
    r.status                               AS recip_status,
    r.sent_at                              AS sent_at,
    r.provider_email_id                    AS provider_email_id,
    r.locked_at                            AS locked_at,
    r.locked_until                         AS locked_until,
    r.attempts                             AS attempts,
    r.template_snapshot                    AS template_snapshot,
    r.context_snapshot                     AS context_snapshot,

    run.id                                 AS run_row_id,
    run.status                             AS run_status,
    run.automation_id                      AS run_automation_id,

    o.id                                   AS opp_row_id,
    o.opportunity_type                     AS opportunity_type,
    o.campaign_id                          AS campaign_id,
    o.state                                AS opp_state,
    o.selected_at                          AS opp_selected_at,
    o.actioned_at                          AS opp_actioned_at,
    o.user_id                              AS opp_user_id,

    d.opportunity_key                      AS def_key,
    COALESCE(d.enabled, false)             AS def_enabled,
    COALESCE(d.campaign_specific, false)   AS def_campaign_specific,
    d.delivery_automation_id               AS def_delivery_automation_id,

    a.id                                   AS auto_row_id,
    COALESCE(a.enabled, false)             AS auto_enabled,
    a.template_id                          AS auto_template_id,

    t.id                                   AS tmpl_row_id,
    COALESCE(t.is_active, false)           AS tmpl_active,
    t.version                              AS tmpl_version,
    t.subject                              AS tmpl_subject,
    t.heading                              AS tmpl_heading,
    t.body_text                            AS tmpl_body,
    t.cta_label                            AS tmpl_cta,

    (p.user_id IS NOT NULL)                AS profile_matched,
    p.email_lc                             AS profile_email_lc,
    p.account_active                       AS account_active,
    p.email_confirmed                      AS email_confirmed,
    p.marketing_enabled                    AS marketing_enabled,
    p.has_active_suppression               AS has_active_suppression,

    (c.id IS NOT NULL)                     AS campaign_row_exists,
    (c.status = 'live' AND (c.end_at IS NULL OR c.end_at > now())) AS campaign_live
  FROM public.marketing_recipients r
  JOIN public.marketing_automation_runs run ON run.id = r.run_id
  LEFT JOIN public.marketing_opportunities o           ON o.id = r.opportunity_id
  LEFT JOIN public.marketing_opportunity_definitions d ON d.opportunity_key = o.opportunity_type
  LEFT JOIN public.marketing_automations a             ON a.id = d.delivery_automation_id
  LEFT JOIN public.marketing_templates t               ON t.id = a.template_id
  LEFT JOIN public.customer_marketing_profiles p       ON p.user_id = r.user_id
  LEFT JOIN public.campaigns c                         ON c.id = o.campaign_id
),
flags AS (
  SELECT
    b.*,
    -- RECIPIENT shape (materialised, pre-send, untouched).
    (b.recip_status = 'queued')                              AS recipient_queued,
    (b.sent_at IS NULL AND b.provider_email_id IS NULL)      AS recipient_unsent,
    (b.locked_at IS NULL AND b.locked_until IS NULL)         AS recipient_unlocked,
    (COALESCE(b.attempts, 0) = 0)                            AS recipient_attempts_pristine,
    (b.user_id IS NOT NULL AND b.external_contact_id IS NULL) AS recipient_user_identity,
    -- RUN.
    (b.run_row_id IS NOT NULL)                               AS run_exists,
    (b.run_status = 'preparing')                             AS run_preparing,
    -- OPPORTUNITY lifecycle + identity match (provenance automation_id ignored).
    (b.opp_row_id IS NOT NULL)                               AS opportunity_exists,
    (b.opp_state = 'selected')                               AS opportunity_selected,
    (b.opp_selected_at IS NOT NULL)                          AS opportunity_selected_at_set,
    (b.opp_actioned_at IS NOT NULL)                          AS opportunity_actioned,
    (b.opp_user_id IS NOT NULL AND b.opp_user_id = b.user_id) AS opportunity_user_matches,
    (b.profile_email_lc IS NOT NULL AND b.email_lc IS NOT NULL
       AND b.profile_email_lc = b.email_lc)                  AS opportunity_email_matches,
    (b.def_key IS NOT NULL AND b.def_key = b.opportunity_type) AS opportunity_type_matches_def,
    -- ROUTING (definition-sourced; run must match).
    (b.def_key IS NOT NULL)                                  AS definition_exists,
    b.def_enabled                                            AS definition_enabled,
    (b.auto_row_id IS NOT NULL)                              AS automation_exists,
    b.auto_enabled                                           AS automation_enabled,
    (b.def_delivery_automation_id IS NOT NULL
       AND b.auto_row_id IS NOT NULL
       AND b.run_automation_id = b.def_delivery_automation_id) AS route_valid,
    -- CONTACT permission authority (CURRENT re-check, not snapshot).
    COALESCE(
      CASE
        WHEN b.user_id IS NOT NULL AND b.external_contact_id IS NULL
             AND b.profile_email_lc IS NOT NULL
          THEN public.is_marketing_email_eligible(b.user_id, b.profile_email_lc)
        ELSE false
      END, false)                                            AS authoritative_marketing_eligible,
    -- CAMPAIGN context (matches definition.campaign_specific shape).
    CASE
      WHEN b.def_key IS NULL THEN false
      WHEN b.def_campaign_specific THEN (b.campaign_id IS NOT NULL AND b.campaign_row_exists AND b.campaign_live)
      ELSE (b.campaign_id IS NULL)
    END                                                      AS campaign_context_valid,
    -- TEMPLATE readiness.
    (b.auto_template_id IS NOT NULL)                         AS template_mapped,
    (b.tmpl_row_id IS NOT NULL)                              AS template_exists,
    b.tmpl_active                                            AS template_active,
    -- Authoritative validation via the private helper — reproduces the full
    -- application template-validation contract (key regex, length caps, no
    -- angle brackets, http(s) default_url, version>=1, allowlisted placeholders).
    (b.tmpl_row_id IS NOT NULL
       AND public.wtf_marketing_template_is_valid(b.tmpl_row_id))          AS template_valid,
    -- CONTENT-READINESS: deterministic validation of the VERSION 1 canonical
    -- prepared-snapshot contract (see header). Merely non-empty JSON is NOT
    -- prepared. Both snapshots must be JSON OBJECTS with schemaVersion=1 and all
    -- required non-empty fields; opportunityType must equal the linked
    -- opportunity.opportunity_type; campaign-specific opportunities additionally
    -- require a context_snapshot.campaign object with non-empty title + url.
    -- The current canary snapshots are {}/{} => content_prepared = false.
    (
          jsonb_typeof(b.template_snapshot) = 'object'
      AND jsonb_typeof(b.context_snapshot)  = 'object'
          -- template_snapshot v1
      AND (b.template_snapshot ->> 'schemaVersion') = '1'
      AND coalesce(btrim(b.template_snapshot ->> 'templateKey'), '') <> ''
      AND (b.template_snapshot ->> 'templateVersion') ~ '^[0-9]+$'
      AND (b.template_snapshot ->> 'templateVersion')::bigint >= 1
      AND coalesce(btrim(b.template_snapshot ->> 'subject'), '')  <> ''
      AND coalesce(btrim(b.template_snapshot ->> 'heading'), '')  <> ''
      AND coalesce(btrim(b.template_snapshot ->> 'bodyText'), '') <> ''
      AND coalesce(btrim(b.template_snapshot ->> 'ctaLabel'), '') <> ''
          -- context_snapshot v1
      AND (b.context_snapshot ->> 'schemaVersion') = '1'
      AND coalesce(btrim(b.context_snapshot ->> 'opportunityType'), '') <> ''
      AND (b.context_snapshot ->> 'opportunityType') = b.opportunity_type
          -- campaign-specific opportunities require a valid campaign block
      AND (
            NOT b.def_campaign_specific
            OR (
                  jsonb_typeof(b.context_snapshot -> 'campaign') = 'object'
              AND coalesce(btrim(b.context_snapshot #>> '{campaign,title}'), '') <> ''
              AND coalesce(btrim(b.context_snapshot #>> '{campaign,url}'), '')   <> ''
            )
          )
    )                                                                      AS content_prepared
  FROM base b
),
computed AS (
  SELECT
    f.*,
    (f.template_mapped AND f.template_exists AND f.template_active AND f.template_valid) AS template_ready
  FROM flags f
)
SELECT
  c.recipient_id,
  c.run_id,
  c.opportunity_id,
  c.user_id,
  c.email_lc,
  c.opportunity_type,
  c.campaign_id,

  c.recipient_queued,
  c.recipient_unsent,
  c.recipient_unlocked,
  c.recipient_attempts_pristine,
  c.recipient_user_identity,

  c.run_exists,
  c.run_preparing,

  c.opportunity_exists,
  c.opportunity_selected,
  c.opportunity_selected_at_set,
  c.opportunity_actioned,
  c.opportunity_user_matches,
  c.opportunity_email_matches,
  c.opportunity_type_matches_def,

  c.definition_exists,
  c.definition_enabled,
  c.automation_exists,
  c.automation_enabled,
  c.route_valid,

  c.profile_matched,
  c.account_active,
  c.email_confirmed,
  c.marketing_enabled,
  c.has_active_suppression                                   AS active_suppression,
  c.authoritative_marketing_eligible,

  c.def_campaign_specific                                    AS campaign_specific,
  c.campaign_context_valid,

  c.template_mapped,
  c.template_exists,
  c.template_active,
  c.template_valid,
  c.template_ready,
  c.tmpl_version                                             AS template_version,

  c.content_prepared,

  -- preparation_eligible: everything required to CONTENT-PREPARE this recipient.
  -- Deliberately EXCLUDES frequency (authoritative at delivery time). It REQUIRES
  -- NOT content_prepared: an already-prepared recipient does not require
  -- preparation, so it is ineligible (and carries the already_prepared blocker).
  (
        c.recipient_user_identity
    AND c.recipient_queued
    AND c.recipient_unsent
    AND c.recipient_unlocked
    AND c.recipient_attempts_pristine
    AND c.run_exists
    AND c.run_preparing
    AND c.opportunity_exists
    AND c.opportunity_selected
    AND c.opportunity_selected_at_set
    AND NOT c.opportunity_actioned
    AND c.opportunity_user_matches
    AND c.opportunity_email_matches
    AND c.opportunity_type_matches_def
    AND c.definition_exists
    AND c.definition_enabled
    AND c.automation_exists
    AND c.automation_enabled
    AND c.route_valid
    AND c.profile_matched
    AND COALESCE(c.account_active, false)
    AND COALESCE(c.email_confirmed, false)
    AND COALESCE(c.marketing_enabled, false)
    AND NOT COALESCE(c.has_active_suppression, false)
    AND c.authoritative_marketing_eligible
    AND c.campaign_context_valid
    AND c.template_ready
    -- A recipient that is ALREADY content-prepared does NOT require preparation,
    -- so it must NOT be selected by a preparation worker. This makes the
    -- already_prepared blocker consistent with preparation_eligible=false.
    AND NOT c.content_prepared
  )                                                          AS preparation_eligible,

  -- Deterministic, PII-free blocker codes in a FIXED, stable order.
  (ARRAY[]::text[]
    || CASE WHEN NOT c.recipient_queued              THEN ARRAY['recipient_not_queued'] ELSE ARRAY[]::text[] END
    || CASE WHEN NOT c.recipient_unsent              THEN ARRAY['recipient_already_sent'] ELSE ARRAY[]::text[] END
    || CASE WHEN NOT c.recipient_unlocked            THEN ARRAY['recipient_locked'] ELSE ARRAY[]::text[] END
    || CASE WHEN NOT c.recipient_attempts_pristine   THEN ARRAY['recipient_attempts_advanced'] ELSE ARRAY[]::text[] END
    || CASE WHEN NOT c.recipient_user_identity       THEN ARRAY['external_contact_not_supported'] ELSE ARRAY[]::text[] END
    || CASE WHEN NOT c.run_preparing                 THEN ARRAY['run_not_preparing'] ELSE ARRAY[]::text[] END
    || CASE WHEN NOT c.opportunity_exists            THEN ARRAY['opportunity_missing'] ELSE ARRAY[]::text[] END
    || CASE WHEN c.opportunity_exists AND NOT c.opportunity_selected        THEN ARRAY['opportunity_not_selected'] ELSE ARRAY[]::text[] END
    || CASE WHEN c.opportunity_exists AND NOT c.opportunity_selected_at_set THEN ARRAY['opportunity_selected_at_missing'] ELSE ARRAY[]::text[] END
    || CASE WHEN c.opportunity_actioned              THEN ARRAY['opportunity_actioned'] ELSE ARRAY[]::text[] END
    || CASE WHEN c.opportunity_exists AND NOT c.opportunity_user_matches    THEN ARRAY['identity_mismatch'] ELSE ARRAY[]::text[] END
    || CASE WHEN c.opportunity_exists AND NOT c.opportunity_email_matches   THEN ARRAY['email_mismatch'] ELSE ARRAY[]::text[] END
    || CASE WHEN c.opportunity_exists AND NOT c.opportunity_type_matches_def THEN ARRAY['opportunity_type_mismatch'] ELSE ARRAY[]::text[] END
    || CASE WHEN NOT c.definition_exists             THEN ARRAY['definition_missing'] ELSE ARRAY[]::text[] END
    || CASE WHEN c.definition_exists AND NOT c.definition_enabled           THEN ARRAY['definition_disabled'] ELSE ARRAY[]::text[] END
    || CASE WHEN NOT c.route_valid                   THEN ARRAY['delivery_route_invalid'] ELSE ARRAY[]::text[] END
    || CASE WHEN c.automation_exists AND NOT c.automation_enabled           THEN ARRAY['automation_disabled'] ELSE ARRAY[]::text[] END
    || CASE WHEN NOT c.profile_matched               THEN ARRAY['profile_unmatched'] ELSE ARRAY[]::text[] END
    || CASE WHEN c.profile_matched AND NOT COALESCE(c.account_active, false)  THEN ARRAY['account_inactive'] ELSE ARRAY[]::text[] END
    || CASE WHEN c.profile_matched AND NOT COALESCE(c.email_confirmed, false) THEN ARRAY['email_unconfirmed'] ELSE ARRAY[]::text[] END
    || CASE WHEN c.profile_matched AND NOT COALESCE(c.marketing_enabled, false) THEN ARRAY['marketing_disabled'] ELSE ARRAY[]::text[] END
    || CASE WHEN c.profile_matched AND COALESCE(c.has_active_suppression, false) THEN ARRAY['active_suppression'] ELSE ARRAY[]::text[] END
    || CASE WHEN c.recipient_user_identity AND c.profile_matched AND NOT c.authoritative_marketing_eligible THEN ARRAY['authoritative_marketing_ineligible'] ELSE ARRAY[]::text[] END
    || CASE WHEN c.definition_exists AND NOT c.campaign_context_valid       THEN ARRAY['campaign_context_invalid'] ELSE ARRAY[]::text[] END
    || CASE WHEN NOT c.template_mapped               THEN ARRAY['template_unmapped'] ELSE ARRAY[]::text[] END
    || CASE WHEN c.template_mapped AND NOT c.template_exists                THEN ARRAY['template_missing'] ELSE ARRAY[]::text[] END
    || CASE WHEN c.template_exists AND NOT c.template_active                THEN ARRAY['template_inactive'] ELSE ARRAY[]::text[] END
    || CASE WHEN c.template_exists AND NOT c.template_valid                 THEN ARRAY['template_invalid'] ELSE ARRAY[]::text[] END
    || CASE WHEN c.content_prepared                  THEN ARRAY['already_prepared'] ELSE ARRAY[]::text[] END
  ) AS blocker_reasons
FROM computed c
$prep$;

COMMENT ON FUNCTION public.wtf_marketing_recipient_preparation_preview() IS
  'Stage 3D3B PRIVATE post-materialisation CONTENT-PREPARATION gate (owner-only; EXECUTE revoked from PUBLIC/anon/authenticated/service_role). NOT the Stage 019 pre-materialisation recipient gate: it evaluates EXISTING materialised recipients, expects opportunity.state=selected WITH an existing recipient, and never applies gate_eligible/pre_nba_gate_eligible/next_best_rank/no-existing-recipient/state=open. Delivery route is sourced from marketing_opportunity_definitions.delivery_automation_id (run.automation_id must match); opportunity provenance automation_id is ignored. Re-checks CURRENT contact permission via is_marketing_email_eligible + profile flags (never a snapshot). Frequency is intentionally EXCLUDED (authoritative at delivery time). content_prepared is the OUTPUT of preparation and is deterministically validated against the VERSION 1 canonical snapshot contract (schemaVersion=1 objects with required non-empty fields; opportunityType must equal the linked opportunity; campaign-specific opportunities require campaign.title + campaign.url); merely non-empty JSON is NOT prepared. preparation_eligible REQUIRES NOT content_prepared, so an already-prepared recipient is ineligible (blocker already_prepared) and never re-selected. Read-only; AI never influences it. Internal infrastructure for a future owner-executed preparation worker; NOT for direct application use.';

REVOKE ALL ON FUNCTION public.wtf_marketing_recipient_preparation_preview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wtf_marketing_recipient_preparation_preview() FROM anon;
REVOKE ALL ON FUNCTION public.wtf_marketing_recipient_preparation_preview() FROM authenticated;
REVOKE ALL ON FUNCTION public.wtf_marketing_recipient_preparation_preview() FROM service_role;

-- ============================================================================
-- PART B — ADMIN AGGREGATE OVERVIEW (service-role only, NO identities).
--   Exposes counts + blocker histogram only. NEVER emits any recipient/run/
--   opportunity/user/automation/campaign/template id or email.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_admin_marketing_recipient_preparation_overview()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $overview$
  WITH g AS (
    SELECT * FROM public.wtf_marketing_recipient_preparation_preview()
  ),
  reasons AS (
    SELECT code, count(*)::bigint AS cnt
      FROM (SELECT unnest(g.blocker_reasons) AS code FROM g) x
     GROUP BY code
  )
  SELECT jsonb_build_object(
    'generatedAt', now(),
    'totals', jsonb_build_object(
      'recipients',           (SELECT count(*)::bigint FROM g),
      'userIdentity',         (SELECT count(*) FILTER (WHERE recipient_user_identity)::bigint FROM g)
    ),
    'recipientShape', jsonb_build_object(
      'queued',            (SELECT count(*) FILTER (WHERE recipient_queued)::bigint FROM g),
      'unsent',            (SELECT count(*) FILTER (WHERE recipient_unsent)::bigint FROM g),
      'unlocked',          (SELECT count(*) FILTER (WHERE recipient_unlocked)::bigint FROM g),
      'attemptsPristine',  (SELECT count(*) FILTER (WHERE recipient_attempts_pristine)::bigint FROM g)
    ),
    'run', jsonb_build_object(
      'preparing',         (SELECT count(*) FILTER (WHERE run_preparing)::bigint FROM g)
    ),
    'opportunity', jsonb_build_object(
      'selected',          (SELECT count(*) FILTER (WHERE opportunity_selected)::bigint FROM g),
      'selectedAtSet',     (SELECT count(*) FILTER (WHERE opportunity_selected_at_set)::bigint FROM g),
      'notActioned',       (SELECT count(*) FILTER (WHERE NOT opportunity_actioned)::bigint FROM g),
      'identityMatched',   (SELECT count(*) FILTER (WHERE opportunity_user_matches)::bigint FROM g),
      'emailMatched',      (SELECT count(*) FILTER (WHERE opportunity_email_matches)::bigint FROM g),
      'typeMatched',       (SELECT count(*) FILTER (WHERE opportunity_type_matches_def)::bigint FROM g)
    ),
    'routing', jsonb_build_object(
      'definitionEnabled', (SELECT count(*) FILTER (WHERE definition_enabled)::bigint FROM g),
      'automationEnabled', (SELECT count(*) FILTER (WHERE automation_enabled)::bigint FROM g),
      'routeValid',        (SELECT count(*) FILTER (WHERE route_valid)::bigint FROM g)
    ),
    'contact', jsonb_build_object(
      'profileMatched',        (SELECT count(*) FILTER (WHERE profile_matched)::bigint FROM g),
      'accountActive',         (SELECT count(*) FILTER (WHERE account_active)::bigint FROM g),
      'emailConfirmed',        (SELECT count(*) FILTER (WHERE email_confirmed)::bigint FROM g),
      'marketingEnabled',      (SELECT count(*) FILTER (WHERE marketing_enabled)::bigint FROM g),
      'activeSuppression',     (SELECT count(*) FILTER (WHERE active_suppression)::bigint FROM g),
      'authoritativeEligible', (SELECT count(*) FILTER (WHERE authoritative_marketing_eligible)::bigint FROM g)
    ),
    'campaign', jsonb_build_object(
      'contextValid',      (SELECT count(*) FILTER (WHERE campaign_context_valid)::bigint FROM g)
    ),
    'template', jsonb_build_object(
      'mapped',            (SELECT count(*) FILTER (WHERE template_mapped)::bigint FROM g),
      'exists',            (SELECT count(*) FILTER (WHERE template_exists)::bigint FROM g),
      'active',            (SELECT count(*) FILTER (WHERE template_active)::bigint FROM g),
      'valid',             (SELECT count(*) FILTER (WHERE template_valid)::bigint FROM g),
      'ready',             (SELECT count(*) FILTER (WHERE template_ready)::bigint FROM g)
    ),
    'content', jsonb_build_object(
      'prepared',          (SELECT count(*) FILTER (WHERE content_prepared)::bigint FROM g)
    ),
    'final', jsonb_build_object(
      'preparationEligible', (SELECT count(*) FILTER (WHERE preparation_eligible)::bigint FROM g)
    ),
    'blockedByReason', COALESCE((SELECT jsonb_object_agg(code, cnt) FROM reasons), '{}'::jsonb)
  )
$overview$;

COMMENT ON FUNCTION public.get_admin_marketing_recipient_preparation_overview() IS
  'Stage 3D3B service-role aggregate overview of the post-materialisation content-preparation gate. Read-only; calls the PRIVATE preparation gate as owner. Emits counts + a PII-free blocker histogram only — never any recipient/run/opportunity/user/automation/campaign/template id or email. preparationEligible is independent of sending; it never triggers a send.';

REVOKE ALL ON FUNCTION public.get_admin_marketing_recipient_preparation_overview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_marketing_recipient_preparation_overview() FROM anon;
REVOKE ALL ON FUNCTION public.get_admin_marketing_recipient_preparation_overview() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_marketing_recipient_preparation_overview() TO service_role;

-- ============================================================================
-- PART C — ANONYMISED QA SAMPLE (service-role only, SAFE fields only).
--   Exposes only diagnostic booleans + a 12-char customerHash. NEVER exposes any
--   recipient/run/opportunity/user/automation/campaign/template id or email.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_admin_marketing_recipient_preparation_sample(
  p_limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $sample$
  WITH bounded AS (
    SELECT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100) AS lim
  ),
  g AS (
    SELECT * FROM public.wtf_marketing_recipient_preparation_preview()
  ),
  ordered AS (
    SELECT
      substr(md5(coalesce(g.recipient_id::text, g.opportunity_id::text, '')), 1, 12) AS "customerHash",
      g.opportunity_type              AS "opportunityType",
      (g.campaign_id IS NOT NULL)     AS "campaignContext",
      g.recipient_queued              AS "recipientQueued",
      g.recipient_unsent              AS "recipientUnsent",
      g.recipient_unlocked            AS "recipientUnlocked",
      g.recipient_attempts_pristine   AS "recipientAttemptsPristine",
      g.run_preparing                 AS "runPreparing",
      g.opportunity_selected          AS "opportunitySelected",
      g.opportunity_actioned          AS "opportunityActioned",
      g.opportunity_user_matches      AS "identityMatched",
      g.opportunity_email_matches     AS "emailMatched",
      g.opportunity_type_matches_def  AS "typeMatched",
      g.definition_enabled            AS "definitionEnabled",
      g.automation_enabled            AS "automationEnabled",
      g.route_valid                   AS "routeValid",
      g.profile_matched               AS "profileMatched",
      g.account_active                AS "accountActive",
      g.email_confirmed               AS "emailConfirmed",
      g.marketing_enabled             AS "marketingEnabled",
      g.active_suppression            AS "activeSuppression",
      g.authoritative_marketing_eligible AS "authoritativeEligible",
      g.campaign_context_valid        AS "campaignContextValid",
      g.template_mapped               AS "templateMapped",
      g.template_active               AS "templateActive",
      g.template_ready                AS "templateReady",
      g.content_prepared              AS "contentPrepared",
      g.preparation_eligible          AS "preparationEligible",
      g.blocker_reasons               AS "blockerReasons"
    FROM g
    ORDER BY g.opportunity_type ASC, "customerHash" ASC
    LIMIT (SELECT lim FROM bounded)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(ordered)), '[]'::jsonb) FROM ordered
$sample$;

COMMENT ON FUNCTION public.get_admin_marketing_recipient_preparation_sample(integer) IS
  'Stage 3D3B service-role anonymised QA sample of the post-materialisation content-preparation gate (limit clamped 1..100, default 25). Read-only. Exposes only safe diagnostic booleans plus a 12-char customerHash; never a recipient/run/opportunity/user/automation/campaign/template id or email.';

REVOKE ALL ON FUNCTION public.get_admin_marketing_recipient_preparation_sample(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_marketing_recipient_preparation_sample(integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_admin_marketing_recipient_preparation_sample(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_marketing_recipient_preparation_sample(integer) TO service_role;

-- ============================================================================
-- CONTRACT DOCUMENTATION — status + run lifecycle (COMMENTs only; no CHECK change).
-- ============================================================================
COMMENT ON COLUMN public.marketing_recipients.status IS
  'Recipient processing status (CHECK unchanged in Stage 022). CONTRACT: status=''queued'' ALONE does NOT mean content-ready or delivery-ready. A materialised recipient is inserted ''queued'' with EMPTY snapshots ({}), i.e. materialised but NOT yet content-prepared. The authoritative future DELIVERY-readiness contract requires ALL of: recipient.status=''queued'' AND parent run.status=''queued'' AND validated prepared template_snapshot/context_snapshot AND a fresh delivery-safety gate. Thus a ''queued'' recipient under a ''preparing'' run is NOT delivery-ready.';

COMMENT ON COLUMN public.marketing_automation_runs.status IS
  'Run lifecycle status (CHECK unchanged in Stage 022). CONTRACT: preparing = recipient materialisation + content preparation may occur; delivery MUST NOT consume this run. queued = all intended recipients have completed deterministic preparation and the run has explicitly passed the future readiness transition. processing = delivery worker has claimed/started the queued run. completed = delivery finished per future delivery semantics. cancelled/failed = terminal non-success. Stage 022 transitions NO run; the live canary stays ''preparing''.';

-- ============================================================================
-- POST-INSTALL VERIFICATION — READ-ONLY; ANY failure rolls back everything.
-- ============================================================================
DO $postcheck$
DECLARE
  v_tmpl_ac        record;
  v_auto_ac_tmpl   uuid;
  v_auto_ac_enab   boolean;
  v_other_mapped   bigint;
  v_defs_enabled   bigint;
  v_autos_enabled  bigint;

  v_recip_now      bigint;
  v_runs_now       bigint;
  v_opp_now        bigint;
  v_recip_before   bigint;
  v_runs_before    bigint;
  v_opp_before     bigint;
  v_rchk_before    text;
  v_runchk_before  text;
  v_ochk_before    text;
  v_rchk_now       text;
  v_runchk_now     text;
  v_ochk_now       text;

  v_sending        boolean;
  v_discovery      boolean;
  v_rollout        integer;

  v_overview       jsonb;
  v_sample         jsonb;
  v_prep_elig      bigint;
  v_tmpl_ready     bigint;
  v_content_prep   bigint;
BEGIN
  -- 1. Exactly ONE abandoned_checkout template, active, version 1, default_url NULL,
  --    no discount, no angle brackets in any content slot.
  SELECT * INTO v_tmpl_ac FROM public.marketing_templates WHERE template_key = 'abandoned_checkout_v1';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: abandoned_checkout_v1 template missing.';
  END IF;
  IF v_tmpl_ac.is_active IS DISTINCT FROM true OR v_tmpl_ac.version < 1
     OR v_tmpl_ac.default_url IS NOT NULL OR v_tmpl_ac.discount_code_id IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: template shape wrong (active=%, version=%, default_url set=%, discount set=%).',
      v_tmpl_ac.is_active, v_tmpl_ac.version, (v_tmpl_ac.default_url IS NOT NULL), (v_tmpl_ac.discount_code_id IS NOT NULL);
  END IF;
  IF (coalesce(v_tmpl_ac.subject,'') || coalesce(v_tmpl_ac.preview_text,'') || coalesce(v_tmpl_ac.heading,'')
      || coalesce(v_tmpl_ac.body_text,'') || coalesce(v_tmpl_ac.cta_label,'')) ~ '[<>]' THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: template contains angle brackets (raw markup).';
  END IF;

  -- 2. abandoned_checkout automation mapped to it, STILL disabled.
  SELECT template_id, enabled INTO v_auto_ac_tmpl, v_auto_ac_enab
    FROM public.marketing_automations WHERE automation_key = 'abandoned_checkout';
  IF v_auto_ac_tmpl IS DISTINCT FROM v_tmpl_ac.id THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: abandoned_checkout automation not mapped to the new template.';
  END IF;
  IF v_auto_ac_enab IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: abandoned_checkout automation is enabled.';
  END IF;

  -- 3. No OTHER automation was mapped (the other five stay template_id NULL).
  SELECT count(*) INTO v_other_mapped
    FROM public.marketing_automations
   WHERE automation_key <> 'abandoned_checkout' AND template_id IS NOT NULL;
  IF v_other_mapped <> 0 THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: % non-abandoned_checkout automation(s) unexpectedly mapped.', v_other_mapped;
  END IF;

  -- 4. Still zero enabled definitions/automations.
  SELECT count(*) INTO v_defs_enabled  FROM public.marketing_opportunity_definitions WHERE enabled = true;
  SELECT count(*) INTO v_autos_enabled FROM public.marketing_automations           WHERE enabled = true;
  IF v_defs_enabled <> 0 OR v_autos_enabled <> 0 THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: enabled defs=%, autos=% (expected 0/0).', v_defs_enabled, v_autos_enabled;
  END IF;

  -- 5. Data ledger UNCHANGED (counts + checksums identical to baseline).
  SELECT recipients_before, runs_before, opportunities_before,
         recipients_checksum, runs_checksum, opportunities_checksum
    INTO v_recip_before, v_runs_before, v_opp_before, v_rchk_before, v_runchk_before, v_ochk_before
    FROM tmp_marketing_3d3b_baseline;

  SELECT count(*) INTO v_recip_now FROM public.marketing_recipients;
  SELECT count(*) INTO v_runs_now  FROM public.marketing_automation_runs;
  SELECT count(*) INTO v_opp_now   FROM public.marketing_opportunities;
  IF v_recip_now <> 1 OR v_recip_now <> v_recip_before THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: recipient count changed (% -> %); expected 1.', v_recip_before, v_recip_now;
  END IF;
  IF v_runs_now <> 1 OR v_runs_now <> v_runs_before THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: run count changed (% -> %); expected 1.', v_runs_before, v_runs_now;
  END IF;
  IF v_opp_now <> 7 OR v_opp_now <> v_opp_before THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: opportunity count changed (% -> %); expected 7.', v_opp_before, v_opp_now;
  END IF;

  SELECT md5(coalesce(string_agg(row_sig, '|' ORDER BY row_sig), '')) INTO v_rchk_now
    FROM (
      SELECT md5(
        coalesce(r.id::text, '')                 || '~' ||
        coalesce(r.run_id::text, '')             || '~' ||
        coalesce(r.user_id::text, '')            || '~' ||
        coalesce(r.opportunity_id::text, '')     || '~' ||
        coalesce(r.email_lc, '')                 || '~' ||
        coalesce(r.status, '')                   || '~' ||
        coalesce(r.attempts::text, '')           || '~' ||
        coalesce(r.template_snapshot::text, '')  || '~' ||
        coalesce(r.context_snapshot::text, '')   || '~' ||
        coalesce(r.sent_at::text, '')            || '~' ||
        coalesce(r.provider_email_id, '')        || '~' ||
        coalesce(r.locked_at::text, '')          || '~' ||
        coalesce(r.locked_until::text, '')
      ) AS row_sig FROM public.marketing_recipients r
    ) s;
  IF v_rchk_now IS DISTINCT FROM v_rchk_before THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: recipient ledger changed (status/snapshots/locks/send state modified).';
  END IF;

  SELECT md5(coalesce(string_agg(row_sig, '|' ORDER BY row_sig), '')) INTO v_runchk_now
    FROM (
      SELECT md5(
        coalesce(ru.id::text, '')            || '~' ||
        coalesce(ru.automation_id::text, '') || '~' ||
        coalesce(ru.promotion_id::text, '')  || '~' ||
        coalesce(ru.status, '')
      ) AS row_sig FROM public.marketing_automation_runs ru
    ) s;
  IF v_runchk_now IS DISTINCT FROM v_runchk_before THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: run ledger changed (a run was transitioned).';
  END IF;

  SELECT md5(coalesce(string_agg(row_sig, '|' ORDER BY row_sig), '')) INTO v_ochk_now
    FROM (
      SELECT md5(
        coalesce(o.id::text, '')            || '~' ||
        coalesce(o.state, '')               || '~' ||
        coalesce(o.selected_at::text, '')   || '~' ||
        coalesce(o.actioned_at::text, '')   || '~' ||
        coalesce(o.automation_id::text, '') || '~' ||
        coalesce(o.campaign_id::text, '')
      ) AS row_sig FROM public.marketing_opportunities o
    ) s;
  IF v_ochk_now IS DISTINCT FROM v_ochk_before THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: opportunity ledger changed.';
  END IF;

  -- 6. Controls unchanged (paused).
  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state WHERE key = 'default';
  IF v_sending IS DISTINCT FROM false OR v_discovery IS DISTINCT FROM false OR v_rollout IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: control state changed (sending=%, discovery=%, rollout=%).', v_sending, v_discovery, v_rollout;
  END IF;

  -- 7. Privileges: PRIVATE preparation gate direct EXECUTE denied to every role.
  IF has_function_privilege('anon', 'public.wtf_marketing_recipient_preparation_preview()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.wtf_marketing_recipient_preparation_preview()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.wtf_marketing_recipient_preparation_preview()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: PRIVATE preparation gate EXECUTE is granted to an application role.';
  END IF;

  -- PRIVATE template validator: direct EXECUTE denied to every role.
  IF has_function_privilege('anon', 'public.wtf_marketing_template_is_valid(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.wtf_marketing_template_is_valid(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.wtf_marketing_template_is_valid(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: PRIVATE template validator EXECUTE is granted to an application role.';
  END IF;

  -- Admin overview + sample: service_role only.
  IF NOT has_function_privilege('service_role', 'public.get_admin_marketing_recipient_preparation_overview()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_admin_marketing_recipient_preparation_overview()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_admin_marketing_recipient_preparation_overview()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: admin overview privileges are not service-role-only.';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.get_admin_marketing_recipient_preparation_sample(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_admin_marketing_recipient_preparation_sample(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_admin_marketing_recipient_preparation_sample(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: admin sample privileges are not service-role-only.';
  END IF;

  -- 8. Preparation preview for the current canary: templateReady=1, contentPrepared=0,
  --    preparationEligible=0 (definition + automation disabled).
  v_overview   := public.get_admin_marketing_recipient_preparation_overview();
  v_prep_elig  := (v_overview #>> '{final,preparationEligible}')::bigint;
  v_tmpl_ready := (v_overview #>> '{template,ready}')::bigint;
  v_content_prep := (v_overview #>> '{content,prepared}')::bigint;
  IF v_tmpl_ready <> 1 THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: template.ready=% but expected 1 (mapped active valid template).', v_tmpl_ready;
  END IF;
  IF v_content_prep <> 0 THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: content.prepared=% but expected 0 (snapshots still empty).', v_content_prep;
  END IF;
  IF v_prep_elig <> 0 THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: preparationEligible=% but expected 0 (definition + automation disabled).', v_prep_elig;
  END IF;
  IF (v_overview #>> '{routing,definitionEnabled}')::bigint <> 0
     OR (v_overview #>> '{routing,automationEnabled}')::bigint <> 0 THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: definition/automation reported enabled.';
  END IF;
  -- Expected disabling blockers must be present.
  IF NOT (v_overview #> '{blockedByReason}' ? 'definition_disabled')
     OR NOT (v_overview #> '{blockedByReason}' ? 'automation_disabled') THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: expected definition_disabled + automation_disabled blockers.';
  END IF;

  -- 9. Admin outputs must NOT leak any raw identifier or email.
  IF v_overview::text ~* '(recipient_id|opportunity_id|user_id|automation_id|campaign_id|email_lc|@)' THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: overview output leaks an identifier/email.';
  END IF;
  v_sample := public.get_admin_marketing_recipient_preparation_sample(100);
  IF v_sample::text ~* '(recipient_id|opportunity_id|"user_id"|automation_id|campaign_id|email_lc|@)' THEN
    RAISE EXCEPTION 'Stage 3D3B (022) verify aborted: sample output leaks an identifier/email.';
  END IF;
END
$postcheck$;

COMMIT;

-- ============================================================================
-- POST-CONDITIONS (informational):
--   * Exactly ONE template seeded: abandoned_checkout_v1 (active, version 1,
--     default_url NULL, no discount, allowlisted placeholders only, no markup).
--   * abandoned_checkout automation.template_id mapped to it; automation STILL
--     disabled. No other automation mapped. Definition STILL disabled.
--   * PRIVATE wtf_marketing_recipient_preparation_preview() installed (owner-only)
--     + service-role-only overview/sample RPCs (no identities).
--   * Recipient status + run lifecycle contracts documented via COMMENTs; no CHECK
--     changed; no new status added.
--   * DATA LEDGER UNCHANGED: recipients=1 (queued, empty snapshots, unlocked, no
--     send state), runs=1 (preparing), opportunities=7 (1 selected). Controls
--     paused. No send, no cron, no AI, no consent/checkout/wallet change.
--   * For the canary: templateReady=true, contentPrepared=false,
--     preparationEligible=false (blocked by definition_disabled + automation_disabled).
-- ============================================================================
