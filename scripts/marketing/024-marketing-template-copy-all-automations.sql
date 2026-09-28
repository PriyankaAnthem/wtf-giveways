-- ============================================================================
-- WTF Marketing — Stage 039: TEMPLATE COPY FOR ALL SIX AUTOMATIONS.
--
-- Purpose
--   Guarantee every one of the six marketing automations has an approved,
--   valid marketing_templates row containing the EXACT Stage 039 copy, and is
--   mapped to it, so each automation CAN reach template_ready. Before Stage 039
--   only `abandoned_checkout_v1` existed (created + mapped in script 022) with
--   the earlier Stage 022 copy; the other five automations had template_id NULL.
--
-- Deterministic UPSERT (per template_key)
--   * MISSING              -> INSERT at version 1.
--   * EXISTS, copy IDENTICAL to approved -> NO update, version NOT incremented.
--   * EXISTS, any approved field DIFFERS -> UPDATE the approved fields and
--                                           increment version EXACTLY ONCE.
--   Approved content fields compared/written: name, subject, preview_text,
--   heading, body_text, cta_label, default_url, discount_code_id, is_active.
--   IDs are never changed. `version` is NOT a compared field, so a second
--   immediate run makes ZERO further updates and ZERO version increments.
--
--   abandoned_checkout_v1 currently holds the Stage 022 copy, so this migration
--   updates it to the approved Stage 039 copy and its version goes 1 -> 2 once.
--
-- Mapping safety
--   * Keeps ONLY the six existing automations (fails closed if not all present).
--   * FAILS CLOSED (before any write) if any automation already has a non-NULL
--     template_id pointing at the WRONG template.
--   * NULL mapping            -> mapped to the expected template.
--   * Already correct mapping -> left unchanged.
--   * Never touches `enabled`, priorities, delays, marketing_control_state, or
--     marketing_opportunity_definitions. Mapping while DISABLED is inert.
--
-- Copy rules (enforced by public.wtf_marketing_template_is_valid, script 022)
--   * No angle brackets; bounded lengths; only the resolvable placeholders
--     {{campaign_title}} / {{campaign_url}}, and ONLY in the three
--     CAMPAIGN-SPECIFIC templates. The three NON-campaign templates are fully
--     STATIC. (Emoji is permitted by the validator — no angle brackets.)
--   * Campaign-specific default_url stays NULL (per-recipient destination);
--     non-campaign default_url is the fixed public listing URL.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- GUARD 1 — fail closed unless all six expected automations exist.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_found integer;
BEGIN
  SELECT count(*) INTO v_found
    FROM public.marketing_automations
   WHERE automation_key IN (
     'vip_early_access',
     'abandoned_checkout',
     'wtf_credit_waiting',
     'regular_buyer_campaign_alert',
     'new_account_no_purchase',
     'lapsed_14_days'
   );

  IF v_found <> 6 THEN
    RAISE EXCEPTION
      'Stage 039 (024) aborted: expected 6 marketing automations, found %. No changes made.',
      v_found;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- GUARD 2 — fail closed (BEFORE any write) if any automation is already mapped
--   to a template OTHER than the one Stage 039 expects. A non-NULL template_id
--   whose template_key differs from the expected key (or points at a missing
--   template row) is treated as a wrong mapping and aborts the migration.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(a.automation_key || ' -> ' || coalesce(cur.template_key, '(missing)'), ', ')
    INTO v_bad
    FROM public.marketing_automations a
    JOIN (VALUES
      ('vip_early_access',             'vip_early_access_v1'),
      ('abandoned_checkout',           'abandoned_checkout_v1'),
      ('wtf_credit_waiting',           'wtf_credit_waiting_v1'),
      ('regular_buyer_campaign_alert', 'regular_buyer_campaign_alert_v1'),
      ('new_account_no_purchase',      'new_account_no_purchase_v1'),
      ('lapsed_14_days',               'lapsed_14_days_v1')
    ) AS m(automation_key, expected_key) ON a.automation_key = m.automation_key
    LEFT JOIN public.marketing_templates cur ON cur.id = a.template_id
   WHERE a.template_id IS NOT NULL
     AND cur.template_key IS DISTINCT FROM m.expected_key;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'Stage 039 (024) aborted: automation(s) mapped to an unexpected template [%]. No changes made.',
      v_bad;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- DESIRED STATE — the approved Stage 039 copy for all six templates, declared
--   ONCE in a temp table. INSERT, UPDATE and the difference test all read from
--   here, so the copy has a single source of truth and comparisons are exact.
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS _stage039_desired;
CREATE TEMP TABLE _stage039_desired (
  template_key      text,
  name              text,
  subject           text,
  preview_text      text,
  heading           text,
  body_text         text,
  cta_label         text,
  default_url       text,
  discount_code_id  uuid,
  is_active         boolean
);

INSERT INTO _stage039_desired
  (template_key, name, subject, preview_text, heading, body_text, cta_label,
   default_url, discount_code_id, is_active)
VALUES
  -- ---- CAMPAIGN-SPECIFIC: abandoned_checkout (Stage 039 approved copy) ----
  (
    'abandoned_checkout_v1',
    'Abandoned Checkout — Recovery',
    'You left this one behind 👀',
    'Your entry isn''t finished — and it''s still live.',
    'You left this one behind 👀',
    'You were checking this one out but didn''t finish your entry.
It''s still live — jump back in and take another look before it''s gone.',
    'Finish my entry',
    NULL,   -- campaign-dynamic; destination resolved per recipient via context
    NULL,
    true
  ),
  -- ---- CAMPAIGN-SPECIFIC: vip_early_access ----
  (
    'vip_early_access_v1',
    'VIP Early Access — Invitation',
    'Your VIP early access to {{campaign_title}}',
    'You can enter {{campaign_title}} before it opens to everyone.',
    'Early access: {{campaign_title}}',
    'As one of our VIP members, you can enter {{campaign_title}} ahead of everyone else. '
      || 'Take a look while your early access window is open and enter here: {{campaign_url}}.',
    'View the competition',
    NULL,
    NULL,
    true
  ),
  -- ---- CAMPAIGN-SPECIFIC: regular_buyer_campaign_alert ----
  (
    'regular_buyer_campaign_alert_v1',
    'Regular Buyer — Campaign Alert',
    'Now live: {{campaign_title}}',
    'A new competition, {{campaign_title}}, has just gone live.',
    '{{campaign_title}} is now live',
    'A new competition has just gone live and we thought you would want to know. '
      || 'If you would like to take part, you can see the full details and enter '
      || '{{campaign_title}} here: {{campaign_url}}.',
    'See the competition',
    NULL,
    NULL,
    true
  ),
  -- ---- NON-CAMPAIGN: wtf_credit_waiting (fully static) ----
  (
    'wtf_credit_waiting_v1',
    'WTF Credit — Reminder',
    'You have WTF credit ready to use',
    'There is credit waiting in your WTF Giveaways account.',
    'You have credit waiting',
    'This is a friendly reminder that you have credit available in your WTF Giveaways account. '
      || 'You can put it towards any of our live competitions whenever you are ready. '
      || 'Browse what is on right now and use your credit at checkout.',
    'Browse live competitions',
    'https://www.wtf-giveaways.co.uk/giveaways',
    NULL,
    true
  ),
  -- ---- NON-CAMPAIGN: new_account_no_purchase (fully static) ----
  (
    'new_account_no_purchase_v1',
    'New Account — Welcome',
    'Welcome to WTF Giveaways',
    'Thanks for joining. Here is how to get started.',
    'Welcome to WTF Giveaways',
    'Thanks for creating your account. WTF Giveaways runs regular competitions with a wide '
      || 'range of prizes, and entering only takes a moment. Whenever you are ready, take a '
      || 'look at what is live right now and find one you like.',
    'See live competitions',
    'https://www.wtf-giveaways.co.uk/giveaways',
    NULL,
    true
  ),
  -- ---- NON-CAMPAIGN: lapsed_14_days (fully static) ----
  (
    'lapsed_14_days_v1',
    'Lapsed Customer — What is Live',
    'See what is live at WTF Giveaways',
    'New competitions have gone live since your last visit.',
    'There is plenty on right now',
    'It has been a little while since we last saw you, and we have added new competitions '
      || 'since then. If you fancy a look, you can see everything that is live right now and '
      || 'pick whichever one appeals to you.',
    'Browse competitions',
    'https://www.wtf-giveaways.co.uk/giveaways',
    NULL,
    true
  );

-- ----------------------------------------------------------------------------
-- INSERT — create any missing template at version 1 (idempotent on rerun).
-- ----------------------------------------------------------------------------
INSERT INTO public.marketing_templates
  (template_key, name, subject, preview_text, heading, body_text, cta_label,
   default_url, discount_code_id, version, is_active)
SELECT
  d.template_key, d.name, d.subject, d.preview_text, d.heading, d.body_text,
  d.cta_label, d.default_url, d.discount_code_id, 1, d.is_active
FROM _stage039_desired d
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_templates t WHERE t.template_key = d.template_key
);

-- ----------------------------------------------------------------------------
-- UPDATE — for existing rows whose approved copy DIFFERS, write the approved
--   fields and increment version EXACTLY ONCE. Uses IS DISTINCT FROM so NULLs
--   compare correctly and identical rows are left untouched (no increment).
-- ----------------------------------------------------------------------------
UPDATE public.marketing_templates t
   SET name             = d.name,
       subject          = d.subject,
       preview_text     = d.preview_text,
       heading          = d.heading,
       body_text        = d.body_text,
       cta_label        = d.cta_label,
       default_url      = d.default_url,
       discount_code_id = d.discount_code_id,
       is_active        = d.is_active,
       version          = t.version + 1,
       updated_at       = now()
  FROM _stage039_desired d
 WHERE t.template_key = d.template_key
   AND (
        t.name             IS DISTINCT FROM d.name
     OR t.subject          IS DISTINCT FROM d.subject
     OR t.preview_text     IS DISTINCT FROM d.preview_text
     OR t.heading          IS DISTINCT FROM d.heading
     OR t.body_text        IS DISTINCT FROM d.body_text
     OR t.cta_label        IS DISTINCT FROM d.cta_label
     OR t.default_url      IS DISTINCT FROM d.default_url
     OR t.discount_code_id IS DISTINCT FROM d.discount_code_id
     OR t.is_active        IS DISTINCT FROM d.is_active
   );

-- ----------------------------------------------------------------------------
-- MAP — attach each automation to its template ONLY when currently unmapped.
--   `template_id IS NULL` keeps this idempotent and never overwrites a mapping
--   (Guard 2 has already proven any existing mapping is the correct one).
--   `enabled` is deliberately NOT set: every automation stays disabled.
-- ----------------------------------------------------------------------------
UPDATE public.marketing_automations a
   SET template_id = t.id,
       updated_at  = now()
  FROM (VALUES
    ('vip_early_access',             'vip_early_access_v1'),
    ('abandoned_checkout',           'abandoned_checkout_v1'),
    ('wtf_credit_waiting',           'wtf_credit_waiting_v1'),
    ('regular_buyer_campaign_alert', 'regular_buyer_campaign_alert_v1'),
    ('new_account_no_purchase',      'new_account_no_purchase_v1'),
    ('lapsed_14_days',               'lapsed_14_days_v1')
  ) AS m(automation_key, template_key)
  JOIN public.marketing_templates t ON t.template_key = m.template_key
 WHERE a.automation_key = m.automation_key
   AND a.template_id IS NULL;

DROP TABLE IF EXISTS _stage039_desired;
