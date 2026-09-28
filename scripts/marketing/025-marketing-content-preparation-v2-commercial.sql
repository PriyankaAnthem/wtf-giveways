-- ============================================================================
-- WTF Marketing — Stage 043B: CONTENT PREPARATION *VERSION 2* (COMMERCIAL).
-- SURGICAL V2 INTEGRATION INTO THE EXISTING PIPELINE (replaces the earlier 025).
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ REVIEW ONLY — NOT AUTO-EXECUTED BY v0.                                      │
-- │ A human operator READS, VERIFIES against the live schema, and runs this     │
-- │ manually. v0 did NOT execute it and made NO database change. Columns/tables │
-- │ marked "VERIFY:" are the Production-audited operational sources; confirm    │
-- │ each against the live database before executing.                            │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- WHY THIS REPLACES THE PREVIOUS 025
--   The first cut created a SECOND preparation executor
--   (prepare_marketing_recipient_content_v2) that nothing called, and left the
--   Stage 022 readiness gate hard-coded to schemaVersion=1 so a valid V2
--   recipient could never become run-ready. This version fixes both: there is
--   ONE preparation executor (the existing public name), and the EXISTING
--   readiness gate is made version-aware. It also corrects the ticket-counter
--   source, the instant-win definition, and the £0-credit selection rule.
--
-- WHAT THIS MIGRATION DOES (three objects)
--   1. NEW  public.wtf_marketing_content_snapshots_are_prepared_v2(jsonb,jsonb,text,boolean)
--        A strict, CLOSED-schema VERSION-2 validator. Reproduces the Production
--        V1 template-snapshot contract EXACTLY and adds the additive commercial
--        context contract. It does NOT touch the Production V1 validator
--        public.wtf_marketing_content_snapshots_are_prepared(...), which remains
--        authoritative for V1.
--   2. REPLACE public.wtf_marketing_recipient_preparation_preview()
--        Reproduced VERBATIM from Stage 022 with exactly ONE change: the
--        content_prepared expression now accepts V1 (unchanged inline contract)
--        OR V2 (via the new validator). Every other condition — permission,
--        consent, suppression, account state, email confirmation, campaign-live,
--        template mapping/validity, automation/definition enablement, identity,
--        routing, recipient/run state, preparation_eligible, blocker_reasons —
--        is byte-for-byte identical. queue_prepared_marketing_runs consumes this
--        content_prepared flag, so run readiness becomes version-aware with NO
--        change to the queue executor.
--   3. REPLACE public.prepare_marketing_recipient_content(integer)
--        SAME public name, signature, cron invocation, SECURITY DEFINER,
--        search_path, service_role grant, advisory-lock key, control/rollout
--        bounds, selection authority, pristine-recipient guard, idempotence, and
--        "no run transition / no provider / no send" posture as Stage 037. It now
--        freezes a schemaVersion=2 context with commercial facts and the
--        recipient's own WTF credit, and adds a £0-credit selection gate + race
--        recheck. There is NO second executor.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * Does NOT create/replace/drop/alter the Production V1 validator or its grants.
--   * Does NOT change queue_prepared_marketing_runs, the cron route, or any
--     downstream delivery-safety gate (claim / JIT / final gate live downstream
--     and are unchanged).
--   * Does NOT write any operational table (campaigns, wallets, tickets, instant
--     wins are READ-ONLY). Does NOT enable sending/discovery, transition runs, or
--     send email. No PII, no vouchers, no AI.
--
-- FAIL-CLOSED COMMERCIAL RULE
--   Every commercial value is nullable and MUST be JSON null when its source is
--   missing or untrustworthy — NEVER coerced to 0. The renderer already treats
--   null => "omit this fact".
-- ============================================================================


-- ============================================================================
-- PART 1 — VERSION-2 SNAPSHOT VALIDATOR (NEW; separate _v2 name).
--   Closed top-level schemas. Reproduces the Production V1 TEMPLATE contract
--   exactly, then validates the additive commercial CONTEXT. For
--   wtf_credit_waiting it REQUIRES customerValue.walletCreditPence > 0, so the
--   snapshot itself fails closed even if selection ever regressed.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.wtf_marketing_content_snapshots_are_prepared_v2(
  p_template          jsonb,
  p_context           jsonb,
  p_opportunity_type  text,
  p_campaign_specific boolean
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $v2$
DECLARE
  v_campaign jsonb;
  v_customer jsonb;
  v_txt      text;
  v_key      text;
  v_num      jsonb;
BEGIN
  -- (0) Both snapshots must be JSON objects.
  IF p_template IS NULL OR jsonb_typeof(p_template) <> 'object' THEN RETURN false; END IF;
  IF p_context  IS NULL OR jsonb_typeof(p_context)  <> 'object' THEN RETURN false; END IF;

  -- ==========================================================================
  -- (A) TEMPLATE SNAPSHOT — identical contract to the Production V1 validator.
  --     CLOSED keys; schemaVersion is JSON NUMBER exactly 1 (V2 upgrades the
  --     CONTEXT only, not the template).
  -- ==========================================================================
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_template) AS k
     WHERE k NOT IN ('schemaVersion','templateKey','templateVersion',
                     'subject','previewText','heading','bodyText','ctaLabel')
  ) THEN RETURN false; END IF;

  -- schemaVersion: JSON number exactly 1.
  IF jsonb_typeof(p_template->'schemaVersion') <> 'number'
     OR (p_template->>'schemaVersion') <> '1' THEN RETURN false; END IF;

  -- templateKey: string, trimmed 1..100, ^[a-z][a-z0-9_]*$.
  IF jsonb_typeof(p_template->'templateKey') <> 'string' THEN RETURN false; END IF;
  v_txt := btrim(p_template->>'templateKey');
  IF length(v_txt) < 1 OR length(v_txt) > 100 OR v_txt !~ '^[a-z][a-z0-9_]*$' THEN RETURN false; END IF;

  -- templateVersion: JSON number, integer >= 1.
  IF jsonb_typeof(p_template->'templateVersion') <> 'number' THEN RETURN false; END IF;
  IF (p_template->>'templateVersion') !~ '^[0-9]+$'
     OR (p_template->>'templateVersion')::bigint < 1 THEN RETURN false; END IF;

  -- subject: string, trimmed 1..300, no <>, no unresolved mustaches.
  IF jsonb_typeof(p_template->'subject') <> 'string' THEN RETURN false; END IF;
  v_txt := btrim(p_template->>'subject');
  IF length(v_txt) < 1 OR length(v_txt) > 300 THEN RETURN false; END IF;
  IF (p_template->>'subject') ~ '[<>]'
     OR (p_template->>'subject') ~ '\{\{' OR (p_template->>'subject') ~ '\}\}' THEN RETURN false; END IF;

  -- previewText: optional; JSON null OR string, max 300, no <>, no mustaches.
  IF (p_template ? 'previewText') AND jsonb_typeof(p_template->'previewText') <> 'null' THEN
    IF jsonb_typeof(p_template->'previewText') <> 'string' THEN RETURN false; END IF;
    IF length(p_template->>'previewText') > 300 THEN RETURN false; END IF;
    IF (p_template->>'previewText') ~ '[<>]'
       OR (p_template->>'previewText') ~ '\{\{' OR (p_template->>'previewText') ~ '\}\}' THEN RETURN false; END IF;
  END IF;

  -- heading: string, trimmed 1..300, no <>, no mustaches.
  IF jsonb_typeof(p_template->'heading') <> 'string' THEN RETURN false; END IF;
  v_txt := btrim(p_template->>'heading');
  IF length(v_txt) < 1 OR length(v_txt) > 300 THEN RETURN false; END IF;
  IF (p_template->>'heading') ~ '[<>]'
     OR (p_template->>'heading') ~ '\{\{' OR (p_template->>'heading') ~ '\}\}' THEN RETURN false; END IF;

  -- bodyText: string, trimmed 1..5000, no <>, no mustaches.
  IF jsonb_typeof(p_template->'bodyText') <> 'string' THEN RETURN false; END IF;
  v_txt := btrim(p_template->>'bodyText');
  IF length(v_txt) < 1 OR length(v_txt) > 5000 THEN RETURN false; END IF;
  IF (p_template->>'bodyText') ~ '[<>]'
     OR (p_template->>'bodyText') ~ '\{\{' OR (p_template->>'bodyText') ~ '\}\}' THEN RETURN false; END IF;

  -- ctaLabel: string, trimmed 1..100, no <>, no mustaches.
  IF jsonb_typeof(p_template->'ctaLabel') <> 'string' THEN RETURN false; END IF;
  v_txt := btrim(p_template->>'ctaLabel');
  IF length(v_txt) < 1 OR length(v_txt) > 100 THEN RETURN false; END IF;
  IF (p_template->>'ctaLabel') ~ '[<>]'
     OR (p_template->>'ctaLabel') ~ '\{\{' OR (p_template->>'ctaLabel') ~ '\}\}' THEN RETURN false; END IF;

  -- ==========================================================================
  -- (B) CONTEXT SNAPSHOT — VERSION 2, CLOSED top-level keys.
  -- ==========================================================================
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_context) AS k
     WHERE k NOT IN ('schemaVersion','opportunityType','campaign','customerValue')
  ) THEN RETURN false; END IF;

  -- schemaVersion: JSON number exactly 2.
  IF jsonb_typeof(p_context->'schemaVersion') <> 'number'
     OR (p_context->>'schemaVersion') <> '2' THEN RETURN false; END IF;

  -- opportunityType: non-empty string equal to the linked opportunity type.
  IF jsonb_typeof(p_context->'opportunityType') <> 'string' THEN RETURN false; END IF;
  IF COALESCE(btrim(p_context->>'opportunityType'), '') = '' THEN RETURN false; END IF;
  IF (p_context->>'opportunityType') IS DISTINCT FROM p_opportunity_type THEN RETURN false; END IF;

  v_campaign := p_context->'campaign';
  v_customer := p_context->'customerValue';

  -- (B.1) CAMPAIGN block: required + closed for campaign-specific; forbidden otherwise.
  IF p_campaign_specific THEN
    IF v_campaign IS NULL OR jsonb_typeof(v_campaign) <> 'object' THEN RETURN false; END IF;

    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_campaign) AS k
       WHERE k NOT IN ('title','url','imageUrl','ticketPricePence','ticketsTotal',
                       'ticketsSold','ticketsRemaining','endAt','instantWinsRemaining',
                       'remainingInstantPrizeValuePence','highestRemainingInstantPrizePence')
    ) THEN RETURN false; END IF;

    -- title: string, trimmed 1..300, no <>, no mustaches.
    IF jsonb_typeof(v_campaign->'title') <> 'string' THEN RETURN false; END IF;
    v_txt := btrim(v_campaign->>'title');
    IF length(v_txt) < 1 OR length(v_txt) > 300 THEN RETURN false; END IF;
    IF (v_campaign->>'title') ~ '[<>]'
       OR (v_campaign->>'title') ~ '\{\{' OR (v_campaign->>'title') ~ '\}\}' THEN RETURN false; END IF;

    -- url: bounded http(s), no <>, no mustaches.
    IF jsonb_typeof(v_campaign->'url') <> 'string' THEN RETURN false; END IF;
    IF (v_campaign->>'url') !~ '^https?://' OR length(v_campaign->>'url') > 2048 THEN RETURN false; END IF;
    IF (v_campaign->>'url') ~ '[<>]'
       OR (v_campaign->>'url') ~ '\{\{' OR (v_campaign->>'url') ~ '\}\}' THEN RETURN false; END IF;

    -- imageUrl: JSON null OR bounded http(s), no <>, no mustaches.
    IF (v_campaign ? 'imageUrl') AND jsonb_typeof(v_campaign->'imageUrl') <> 'null' THEN
      IF jsonb_typeof(v_campaign->'imageUrl') <> 'string' THEN RETURN false; END IF;
      IF (v_campaign->>'imageUrl') !~ '^https?://' OR length(v_campaign->>'imageUrl') > 2048 THEN RETURN false; END IF;
      IF (v_campaign->>'imageUrl') ~ '[<>]'
         OR (v_campaign->>'imageUrl') ~ '\{\{' OR (v_campaign->>'imageUrl') ~ '\}\}' THEN RETURN false; END IF;
    END IF;

    -- Numeric commercial fields: JSON null OR non-negative integer.
    FOREACH v_key IN ARRAY ARRAY[
      'ticketPricePence','ticketsTotal','ticketsSold','ticketsRemaining',
      'instantWinsRemaining','remainingInstantPrizeValuePence','highestRemainingInstantPrizePence'
    ] LOOP
      IF (v_campaign ? v_key) THEN
        v_num := v_campaign->v_key;
        IF jsonb_typeof(v_num) = 'null' THEN
          CONTINUE;
        ELSIF jsonb_typeof(v_num) = 'number' AND (v_campaign->>v_key) ~ '^[0-9]+$' THEN
          CONTINUE;
        ELSE
          RETURN false;
        END IF;
      END IF;
    END LOOP;

    -- endAt: JSON null OR bounded string, no <>, no mustaches.
    IF (v_campaign ? 'endAt') AND jsonb_typeof(v_campaign->'endAt') <> 'null' THEN
      IF jsonb_typeof(v_campaign->'endAt') <> 'string' THEN RETURN false; END IF;
      IF length(v_campaign->>'endAt') > 100 THEN RETURN false; END IF;
      IF (v_campaign->>'endAt') ~ '[<>]'
         OR (v_campaign->>'endAt') ~ '\{\{' OR (v_campaign->>'endAt') ~ '\}\}' THEN RETURN false; END IF;
    END IF;
  ELSE
    -- Non-campaign types MUST NOT carry a campaign block.
    IF v_campaign IS NOT NULL AND jsonb_typeof(v_campaign) <> 'null' THEN RETURN false; END IF;
  END IF;

  -- (B.2) customerValue: optional; closed; walletCreditPence non-negative integer.
  IF v_customer IS NOT NULL AND jsonb_typeof(v_customer) <> 'null' THEN
    IF jsonb_typeof(v_customer) <> 'object' THEN RETURN false; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_customer) AS k WHERE k NOT IN ('walletCreditPence')
    ) THEN RETURN false; END IF;
    IF (v_customer ? 'walletCreditPence') THEN
      v_num := v_customer->'walletCreditPence';
      IF NOT (jsonb_typeof(v_num) = 'number' AND (v_customer->>'walletCreditPence') ~ '^[0-9]+$') THEN
        RETURN false;
      END IF;
    END IF;
  END IF;

  -- (B.3) wtf_credit_waiting HARD requirement: customerValue.walletCreditPence > 0.
  --       Fails closed at the snapshot level regardless of selection.
  IF p_opportunity_type = 'wtf_credit_waiting' THEN
    IF v_customer IS NULL OR jsonb_typeof(v_customer) <> 'object' THEN RETURN false; END IF;
    IF NOT (v_customer ? 'walletCreditPence') THEN RETURN false; END IF;
    v_num := v_customer->'walletCreditPence';
    IF NOT (jsonb_typeof(v_num) = 'number' AND (v_customer->>'walletCreditPence') ~ '^[0-9]+$') THEN RETURN false; END IF;
    IF (v_customer->>'walletCreditPence')::bigint <= 0 THEN RETURN false; END IF;
  END IF;

  RETURN true;
END;
$v2$;

COMMENT ON FUNCTION public.wtf_marketing_content_snapshots_are_prepared_v2(jsonb, jsonb, text, boolean) IS
  'Stage 043B VERSION-2 marketing snapshot validator (NEW; does not replace the Production V1 validator). Closed top-level schemas. Reproduces the Production V1 template contract EXACTLY (closed keys; schemaVersion number=1; templateKey ^[a-z][a-z0-9_]*$ 1..100; templateVersion integer>=1; subject/heading 1..300; bodyText 1..5000; ctaLabel 1..100; optional previewText<=300; all copy no angle brackets, no unresolved mustaches) and adds the additive VERSION-2 context contract (schemaVersion number=2; opportunityType equals linked type; campaign block required+closed for campaign-specific and forbidden otherwise with bounded http(s) url/imageUrl and nullable non-negative-integer commercial fields; customerValue closed to a nullable non-negative-integer walletCreditPence). For wtf_credit_waiting it REQUIRES customerValue.walletCreditPence > 0. Fail closed. IMMUTABLE; service_role only.';

REVOKE ALL ON FUNCTION public.wtf_marketing_content_snapshots_are_prepared_v2(jsonb, jsonb, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wtf_marketing_content_snapshots_are_prepared_v2(jsonb, jsonb, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.wtf_marketing_content_snapshots_are_prepared_v2(jsonb, jsonb, text, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.wtf_marketing_content_snapshots_are_prepared_v2(jsonb, jsonb, text, boolean) TO service_role;


-- ============================================================================
-- PART 2 — VERSION-AWARE READINESS GATE.
--   CREATE OR REPLACE the EXISTING Stage 022 preparation preview VERBATIM with
--   exactly ONE change: content_prepared accepts V1 (unchanged inline contract)
--   OR V2 (new validator). Nothing else changes; queue_prepared_marketing_runs
--   consumes content_prepared and therefore becomes version-aware unchanged.
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
    -- CONTENT-READINESS: VERSION-AWARE (Stage 043B). content_prepared is TRUE for
    -- a valid VERSION 1 snapshot (the EXACT inline contract shipped in Stage 022,
    -- reproduced UNCHANGED below) OR a valid VERSION 2 snapshot (validated by the
    -- new public.wtf_marketing_content_snapshots_are_prepared_v2). Any other
    -- schemaVersion => false. Merely non-empty JSON is NOT prepared. The current
    -- canary snapshots are {}/{} => content_prepared = false.
    (
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
      )
      OR
      (
            jsonb_typeof(b.template_snapshot) = 'object'
        AND jsonb_typeof(b.context_snapshot)  = 'object'
        AND (b.context_snapshot ->> 'schemaVersion') = '2'
        AND public.wtf_marketing_content_snapshots_are_prepared_v2(
              b.template_snapshot, b.context_snapshot, b.opportunity_type, b.def_campaign_specific
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
  'Stage 3D3B PRIVATE post-materialisation CONTENT-PREPARATION gate (owner-only; EXECUTE revoked from PUBLIC/anon/authenticated/service_role). Stage 043B change: content_prepared is now VERSION-AWARE — true for a valid VERSION 1 snapshot (the exact Stage 022 inline contract, unchanged) OR a valid VERSION 2 snapshot via public.wtf_marketing_content_snapshots_are_prepared_v2; any other schemaVersion is false. Every other condition is unchanged (recipient/run/opportunity state, identity, routing, definition/automation enablement, contact permission via is_marketing_email_eligible + profile flags, campaign-live context, template validity; frequency intentionally excluded). preparation_eligible still REQUIRES NOT content_prepared. Read-only; AI never influences it.';

REVOKE ALL ON FUNCTION public.wtf_marketing_recipient_preparation_preview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wtf_marketing_recipient_preparation_preview() FROM anon;
REVOKE ALL ON FUNCTION public.wtf_marketing_recipient_preparation_preview() FROM authenticated;
REVOKE ALL ON FUNCTION public.wtf_marketing_recipient_preparation_preview() FROM service_role;


-- ============================================================================
-- PART 3 — CONTENT PREPARATION EXECUTOR (SAME public name/signature).
--   CREATE OR REPLACE the Stage 037 executor. Identical control/rollout/lock/
--   selection/pristine-guard/idempotence/no-send posture. Additions ONLY:
--     * £0-credit SELECTION gate + write-time race recheck for wtf_credit_waiting
--     * freeze a schemaVersion=2 context with commercial facts + own WTF credit
--     * validate via the V2 validator
--   There is NO second executor.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.prepare_marketing_recipient_content(
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $prepare$
DECLARE
  v_requested  integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_effective  integer := 0;
  v_sending    boolean;
  v_discovery  boolean;
  v_rollout    integer;
  v_batch      integer;
  v_considered integer := 0;
  v_prepared   integer := 0;
  v_skipped    integer := 0;
  v_failed     integer := 0;
  -- FIXED canonical production base (no trailing slash). No GUC / no env lookup.
  v_base       constant text := 'https://www.wtf-giveaways.co.uk';
  r            record;
  v_title      text;
  v_url        text;
  v_subject    text;
  v_preview    text;
  v_heading    text;
  v_body       text;
  v_cta        text;
  v_template_key text;
  v_template_version integer;
  v_template   jsonb;
  v_context    jsonb;
  v_campaign_json jsonb;
  v_ok         boolean;
  v_updated    integer;
  -- Stage 043B commercial scratch (all default NULL => fail closed).
  v_image_url      text;
  v_price_pence    integer;
  v_max_tickets    integer;
  v_end_at         timestamptz;
  v_next_ticket    bigint;
  v_tickets_sold   integer;
  v_tickets_remain integer;
  v_iw_remaining   integer;
  v_iw_unknown     boolean;
  v_iw_value       integer;
  v_iw_top         integer;
  v_wallet_pence   bigint;
BEGIN
  -- (B) Concurrency: transaction-scoped advisory lock (SAME preparation key as
  --     Stage 037 — ONE preparation concurrency domain, no V2-specific lock).
  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_prepare_recipient_content')) THEN
    RETURN jsonb_build_object(
      'status', 'busy', 'requestedLimit', v_requested, 'effectiveLimit', 0,
      'considered', 0, 'prepared', 0, 'skipped', 0, 'failed', 0, 'generatedAt', now()
    );
  END IF;

  -- (C) Controls. Missing singleton or invalid batch -> FAIL CLOSED, zero writes.
  SELECT sending_enabled, discovery_enabled, rollout_limit, maximum_batch_size
    INTO v_sending, v_discovery, v_rollout, v_batch
    FROM public.marketing_control_state
   WHERE key = 'default';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'control_missing', 'requestedLimit', v_requested, 'effectiveLimit', 0,
      'considered', 0, 'prepared', 0, 'skipped', 0, 'failed', 0, 'generatedAt', now()
    );
  END IF;

  IF v_batch IS NULL OR v_batch <= 0 THEN
    RETURN jsonb_build_object(
      'status', 'invalid_control', 'requestedLimit', v_requested, 'effectiveLimit', 0,
      'considered', 0, 'prepared', 0, 'skipped', 0, 'failed', 0, 'generatedAt', now()
    );
  END IF;

  -- (D) Rollout kill switch. rollout_limit <= 0 -> rollout_disabled, zero writes.
  --     Note: sending_enabled / discovery_enabled are intentionally NOT required.
  IF v_rollout IS NULL OR v_rollout <= 0 THEN
    RETURN jsonb_build_object(
      'status', 'rollout_disabled', 'requestedLimit', v_requested, 'effectiveLimit', 0,
      'considered', 0, 'prepared', 0, 'skipped', 0, 'failed', 0, 'generatedAt', now()
    );
  END IF;

  -- (E) Effective limit = MIN(requested, maximum_batch_size, rollout_limit).
  v_effective := LEAST(v_requested, v_batch, v_rollout);
  IF v_effective <= 0 THEN
    RETURN jsonb_build_object(
      'status', 'rollout_disabled', 'requestedLimit', v_requested, 'effectiveLimit', 0,
      'considered', 0, 'prepared', 0, 'skipped', 0, 'failed', 0, 'generatedAt', now()
    );
  END IF;

  -- (F) Prepare up to v_effective preparation-eligible recipients.
  --     Stage 043B £0-CREDIT SELECTION GATE: wtf_credit_waiting is selectable ONLY
  --     when the recipient has strictly positive available WTF credit. This keeps
  --     a £0 recipient OUT of selection (no rollout=1 poison pill); other
  --     opportunity types are unaffected. g.user_id is exposed by the preview.
  --     VERIFY: wallet_accounts(user_id, balance_pence, reserved_pence).
  FOR r IN
    SELECT
      g.recipient_id,
      g.opportunity_id,
      g.opportunity_type,
      g.campaign_id,
      g.campaign_specific,
      g.user_id,
      a.template_id
    FROM public.wtf_marketing_recipient_preparation_preview() g
    JOIN public.marketing_opportunity_definitions d ON d.opportunity_key = g.opportunity_type
    JOIN public.marketing_automations a ON a.id = d.delivery_automation_id
    WHERE g.preparation_eligible
      AND (
        g.opportunity_type <> 'wtf_credit_waiting'
        OR EXISTS (
          SELECT 1
          FROM public.wallet_accounts w
          WHERE w.user_id = g.user_id
            AND GREATEST(COALESCE(w.balance_pence, 0) - COALESCE(w.reserved_pence, 0), 0) > 0
        )
      )
    ORDER BY g.recipient_id
    LIMIT v_effective
  LOOP
    v_considered := v_considered + 1;
    v_title := NULL;
    v_url := NULL;
    -- Reset commercial scratch every iteration (fail closed).
    v_image_url := NULL; v_price_pence := NULL; v_max_tickets := NULL; v_end_at := NULL;
    v_next_ticket := NULL; v_tickets_sold := NULL; v_tickets_remain := NULL;
    v_iw_remaining := NULL; v_iw_unknown := NULL; v_iw_value := NULL; v_iw_top := NULL;
    v_wallet_pence := NULL;

    -- Resolve template (always) + campaign (only when campaign_specific).
    -- VERIFY: campaigns(hero_image_url, ticket_price_pence, max_tickets_total, end_at).
    IF r.campaign_specific THEN
      SELECT
        c.title,
        v_base || '/giveaways/' || c.slug,
        t.subject, t.preview_text, t.heading, t.body_text, t.cta_label,
        t.template_key, t.version,
        c.hero_image_url, c.ticket_price_pence, c.max_tickets_total, c.end_at
      INTO
        v_title, v_url, v_subject, v_preview, v_heading, v_body, v_cta,
        v_template_key, v_template_version,
        v_image_url, v_price_pence, v_max_tickets, v_end_at
      FROM public.marketing_templates t
      LEFT JOIN public.campaigns c ON c.id = r.campaign_id
      WHERE t.id = r.template_id;

      -- Campaign-specific MUST resolve a real campaign (title + slug -> url).
      IF v_title IS NULL OR btrim(v_title) = ''
         OR v_url IS NULL OR v_url NOT LIKE 'https://%/giveaways/%' THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Sanitise commercial scalars to the fail-closed contract.
      IF v_price_pence IS NOT NULL AND v_price_pence < 0 THEN v_price_pence := NULL; END IF;
      IF v_max_tickets IS NOT NULL AND v_max_tickets < 0 THEN v_max_tickets := NULL; END IF;
      IF v_image_url IS NOT NULL AND v_image_url !~ '^https?://' THEN v_image_url := NULL; END IF;

      -- TICKET COUNTER — ONLY the Production-audited source, NO fallback.
      -- VERIFY: giveaway_ticket_counters(giveaway_id, next_ticket).
      SELECT gc.next_ticket
        INTO v_next_ticket
        FROM public.giveaway_ticket_counters gc
       WHERE gc.giveaway_id = r.campaign_id;

      IF v_next_ticket IS NOT NULL THEN
        v_tickets_sold := GREATEST(v_next_ticket - 1, 0);
        IF v_max_tickets IS NOT NULL THEN
          v_tickets_remain := GREATEST(v_max_tickets - (v_next_ticket - 1), 0);
        END IF;

        -- INSTANT WINS — genuinely-remaining SLOTS only (Production definition):
        --   claimed_at IS NULL AND winning_ticket IS NOT NULL
        --   AND winning_ticket >= next_ticket.
        -- If ANY genuinely-remaining slot has a NULL prize value, BOTH value
        -- aggregates become NULL (no partial totals). The COUNT may still stand.
        -- VERIFY: instant_win_slots(giveaway_id, prize_id, claimed_at, winning_ticket),
        --         instant_win_prizes(id, prize_value_pence).
        SELECT
          count(*)::int,
          bool_or(p.prize_value_pence IS NULL),
          SUM(p.prize_value_pence)::int,
          MAX(p.prize_value_pence)::int
        INTO v_iw_remaining, v_iw_unknown, v_iw_value, v_iw_top
        FROM public.instant_win_slots s
        JOIN public.instant_win_prizes p ON p.id = s.prize_id
        WHERE s.giveaway_id = r.campaign_id
          AND s.claimed_at IS NULL
          AND s.winning_ticket IS NOT NULL
          AND s.winning_ticket >= v_next_ticket;

        IF COALESCE(v_iw_unknown, false) THEN
          v_iw_value := NULL;
          v_iw_top := NULL;
        END IF;
      END IF;
      -- If v_next_ticket IS NULL: tickets_sold / tickets_remain and ALL instant-win
      -- fields remain NULL (fail closed) — no counter fallback is attempted.
    ELSE
      SELECT
        t.subject, t.preview_text, t.heading, t.body_text, t.cta_label,
        t.template_key, t.version
      INTO
        v_subject, v_preview, v_heading, v_body, v_cta,
        v_template_key, v_template_version
      FROM public.marketing_templates t
      WHERE t.id = r.template_id;
    END IF;

    -- Template must supply all required copy regardless of opportunity type.
    IF v_subject IS NULL OR v_heading IS NULL OR v_body IS NULL OR v_cta IS NULL
       OR v_template_key IS NULL OR btrim(v_template_key) = ''
       OR v_template_version IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Resolve the ONLY two allowed campaign placeholders (campaign-specific only,
    -- whitespace-tolerant). Non-campaign templates receive no substitution.
    IF r.campaign_specific THEN
      v_subject := regexp_replace(v_subject, '\{\{\s*campaign_title\s*\}\}', v_title, 'g');
      v_subject := regexp_replace(v_subject, '\{\{\s*campaign_url\s*\}\}',   v_url,   'g');
      v_heading := regexp_replace(v_heading, '\{\{\s*campaign_title\s*\}\}', v_title, 'g');
      v_heading := regexp_replace(v_heading, '\{\{\s*campaign_url\s*\}\}',   v_url,   'g');
      v_body    := regexp_replace(v_body,    '\{\{\s*campaign_title\s*\}\}', v_title, 'g');
      v_body    := regexp_replace(v_body,    '\{\{\s*campaign_url\s*\}\}',   v_url,   'g');
      IF v_preview IS NOT NULL THEN
        v_preview := regexp_replace(v_preview, '\{\{\s*campaign_title\s*\}\}', v_title, 'g');
        v_preview := regexp_replace(v_preview, '\{\{\s*campaign_url\s*\}\}',   v_url,   'g');
      END IF;
    END IF;

    -- ANY unresolved {{...}} placeholder (either opportunity type) FAILS closed.
    IF v_subject ~ '\{\{' OR v_heading ~ '\{\{' OR v_body ~ '\{\{' OR v_cta ~ '\{\{'
       OR (v_preview IS NOT NULL AND v_preview ~ '\{\{') THEN
      v_failed := v_failed + 1;
      CONTINUE;
    END IF;

    -- WTF CREDIT (wtf_credit_waiting only): write-time RACE RECHECK of the
    -- authoritative available credit. A missing account counts as 0. If credit is
    -- no longer > 0 between selection and write, CONTINUE without writing snapshots
    -- (no send, no status change, no wallet mutation).
    IF r.opportunity_type = 'wtf_credit_waiting' THEN
      SELECT GREATEST(COALESCE(w.balance_pence, 0) - COALESCE(w.reserved_pence, 0), 0)
        INTO v_wallet_pence
        FROM public.wallet_accounts w
       WHERE w.user_id = r.user_id;

      IF v_wallet_pence IS NULL OR v_wallet_pence <= 0 THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
    END IF;

    -- Build the VERSION 1 TEMPLATE snapshot (unchanged; templates stay v1).
    v_template := jsonb_build_object(
      'schemaVersion', 1,
      'templateKey', v_template_key,
      'templateVersion', v_template_version,
      'subject', v_subject,
      'previewText', v_preview,
      'heading', v_heading,
      'bodyText', v_body,
      'ctaLabel', v_cta
    );

    -- Build the VERSION 2 CONTEXT snapshot. to_jsonb(NULL) => JSON null => the
    -- renderer omits that fact. Campaign block only for campaign-specific.
    v_context := jsonb_build_object(
      'schemaVersion', 2,
      'opportunityType', r.opportunity_type
    );

    IF r.campaign_specific THEN
      v_campaign_json := jsonb_build_object(
        'title', v_title,
        'url', v_url,
        'imageUrl', to_jsonb(v_image_url),
        'ticketPricePence', to_jsonb(v_price_pence),
        'ticketsTotal', to_jsonb(v_max_tickets),
        'ticketsSold', to_jsonb(v_tickets_sold),
        'ticketsRemaining', to_jsonb(v_tickets_remain),
        'endAt', to_jsonb(v_end_at),
        'instantWinsRemaining', to_jsonb(v_iw_remaining),
        'remainingInstantPrizeValuePence', to_jsonb(v_iw_value),
        'highestRemainingInstantPrizePence', to_jsonb(v_iw_top)
      );
      v_context := v_context || jsonb_build_object('campaign', v_campaign_json);
    END IF;

    -- Freeze the customer's OWN available WTF credit for wtf_credit_waiting.
    IF r.opportunity_type = 'wtf_credit_waiting' AND v_wallet_pence IS NOT NULL AND v_wallet_pence > 0 THEN
      v_context := v_context || jsonb_build_object(
        'customerValue', jsonb_build_object('walletCreditPence', to_jsonb(v_wallet_pence))
      );
    END IF;

    -- Authoritative VERSION-2 validation BEFORE committing. Persist ONLY if TRUE.
    v_ok := public.wtf_marketing_content_snapshots_are_prepared_v2(
      v_template, v_context, r.opportunity_type, r.campaign_specific
    );
    IF NOT v_ok THEN
      v_failed := v_failed + 1;
      CONTINUE;
    END IF;

    -- Write ONLY the two snapshot columns, and only to a still-pristine, unsent,
    -- unlocked, not-yet-prepared recipient (race-safe, idempotent). Never touches
    -- status/attempts/locks/sent_at/provider_email_id; never transitions the run.
    UPDATE public.marketing_recipients
       SET template_snapshot = v_template,
           context_snapshot  = v_context
     WHERE id = r.recipient_id
       AND status = 'queued'
       AND sent_at IS NULL
       AND provider_email_id IS NULL
       AND locked_at IS NULL
       AND locked_until IS NULL
       AND COALESCE(attempts, 0) = 0
       AND external_contact_id IS NULL
       AND template_snapshot = '{}'::jsonb
       AND context_snapshot  = '{}'::jsonb;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN
      v_prepared := v_prepared + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'ok',
    'requestedLimit', v_requested,
    'effectiveLimit', v_effective,
    'considered', v_considered,
    'prepared', v_prepared,
    'skipped', v_skipped,
    'failed', v_failed,
    'generatedAt', now()
  );
END;
$prepare$;

COMMENT ON FUNCTION public.prepare_marketing_recipient_content(integer) IS
  'Stage 043B CONTENT PREPARATION executor (owner-only; SAME public name/signature/cron invocation as Stage 037; there is NO second executor). Retains Stage 037 safety exactly: SECURITY DEFINER, hardened search_path, service_role-only, the SAME preparation advisory-lock key, control-state fail-closed (control_missing/invalid_control/rollout_disabled), LEAST(requested, maximum_batch_size, rollout_limit) bounds, Stage 022 preparation_eligible selection authority, pristine/unsent/unlocked/attempts=0/external_contact_id NULL/empty-snapshot write guard, idempotence, no run transition, no provider, no send. Stage 043B additions: (1) wtf_credit_waiting is selectable only with strictly positive available WTF credit and is re-checked at write time (CONTINUE if <=0), never mutating wallet data; (2) freezes a schemaVersion=2 context with commercial facts (campaign artwork, ticket price, tickets total/sold/remaining from giveaway_ticket_counters ONLY, end_at, genuinely-remaining instant wins from instant_win_slots with all-or-nothing value aggregates) and the recipient''s own available WTF credit; every commercial value is nullable and fails closed to JSON null; (3) validates via public.wtf_marketing_content_snapshots_are_prepared_v2 and writes ONLY template_snapshot + context_snapshot. Returns a PII-free stats summary.';

REVOKE ALL ON FUNCTION public.prepare_marketing_recipient_content(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_marketing_recipient_content(integer) FROM anon;
REVOKE ALL ON FUNCTION public.prepare_marketing_recipient_content(integer) FROM authenticated;
-- Invoked by the /api/cron/marketing-preparation route via the service-role client.
GRANT EXECUTE ON FUNCTION public.prepare_marketing_recipient_content(integer) TO service_role;

-- ============================================================================
-- NOTE ON queue_prepared_marketing_runs(integer): intentionally NOT redefined.
-- It reads content_prepared from wtf_marketing_recipient_preparation_preview(),
-- which is now version-aware, so run readiness accepts fully V2-prepared runs
-- with NO change to the queue executor and no parallel readiness path.
-- ============================================================================
