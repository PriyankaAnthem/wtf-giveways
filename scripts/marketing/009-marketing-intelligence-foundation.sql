-- ============================================================================
-- WTF Marketing Hub — Stage 3C2B: Extensible Marketing Intelligence Foundation
-- ----------------------------------------------------------------------------
-- PURPOSE
--   Replace the original "the six automation types ARE the entire universe"
--   architecture with an extensible intelligence foundation:
--
--     RAW BEHAVIOUR
--       -> CUSTOMER MARKETING INTELLIGENCE   (this migration: empty containers)
--       -> MANY COMMERCIAL OPPORTUNITY TYPES (this migration: catalogue table)
--       -> CENTRAL NEXT-BEST-ACTION ENGINE   (later)
--       -> OPTIONAL AI STRATEGIST            (later)
--       -> HARD PERMISSION/FREQUENCY GATE    (later, SEPARATE)
--       -> SEND LATER                        (later)
--
--   This migration creates DATABASE STRUCTURES ONLY and must remain completely
--   INERT after installation.
--
-- WHAT THIS MIGRATION DOES
--   1. Creates public.marketing_opportunity_definitions (the authoritative,
--      extensible catalogue of valid commercial opportunity types) and seeds it
--      with the initial catalogue — EVERY definition enabled = false.
--   2. Surgically fixes public.marketing_opportunities extensibility while it is
--      verified EMPTY: drops the fixed six-value opportunity_type CHECK, makes
--      automation_id NULLABLE (keeps it as optional provenance), and adds an FK
--      opportunity_type -> marketing_opportunity_definitions(opportunity_key).
--   3. Creates public.customer_marketing_intelligence (one derived behavioural
--      row per Auth customer) — installed EMPTY. This is NOT permission state.
--   4. Creates public.customer_campaign_affinity (compact multi-row affinity
--      rollup) — installed EMPTY.
--   5. CREATE OR REPLACEs get_admin_marketing_opportunity_overview so countByType
--      is generated DYNAMICALLY from the catalogue instead of six hard-coded
--      VALUES.
--
-- WHAT THIS MIGRATION DOES NOT DO (explicit non-goals)
--   * NO customer behavioural calculation. NO scan of checkout_intents,
--     instant_win_awards, wallet_transactions, entries or ticket_allocations.
--   * NO detection, NO arbitration/selection, NO AI, NO cron routes.
--   * NO opportunity rows, NO recipients, NO automation runs, NO email.
--   * Does NOT enable any definition, does NOT enable any automation, does NOT
--     enable discovery, does NOT enable sending, does NOT change rollout_limit
--     (it only READS the control state to assert Marketing is paused).
--   * Does NOT ALTER public.customer_marketing_profiles (existing stable system).
--   * Does NOT create customer_marketing_signals. Does NOT create
--     marketing_signal_definitions. Signals are computed later from the
--     profile + intelligence + affinity rollups.
--   * Does NOT modify migrations 001-008. Migration 008 remains an unexecuted,
--     now-superseded script and is neither run nor changed here.
--   * Does NOT touch checkout, payment, ticket allocation, wallet, signup,
--     public pages or transactional email.
--
-- WINNER-MARKETING BOUNDARY (architectural rule for LATER stages)
--   Winning behaviour may LATER be used only as a POSITIVE ENGAGEMENT signal
--   (e.g. "a winner is an engaged, happy customer"). The architecture explicitly
--   PROHIBITS any future AI/template strategy from claiming or implying that
--   winning predicts another win, that a "winning streak" exists, that anyone is
--   "due" a win, that they should "ride the streak", or that previous results
--   affect future odds. NO loss-based intelligence of any kind is permitted:
--   no losing streak, no near miss, no cumulative losses, no chasing losses, no
--   financial-vulnerability targeting. These containers hold ONLY positive and
--   neutral behaviour; they store no loss signal, and none is seeded here.
--
-- SCOPE / SAFETY
--   * ATOMIC. Whole migration in one BEGIN/COMMIT: any failure rolls it ALL
--     back, so it can never be left half-installed on the live database.
--   * FAIL FAST. lock_timeout + statement_timeout are set LOCAL so the install
--     aborts quickly instead of blocking a busy production database.
--   * ADDITIVE ONLY. CREATE ... IF NOT EXISTS / idempotent ALTER guards / seed
--     with ON CONFLICT DO NOTHING make a re-run a practical no-op.
--   * The schema conversion of marketing_opportunities is done ONLY while the
--     ledger is verified EMPTY (asserted in preflight). If ANY opportunity row
--     exists the migration RAISES and rolls back.
--   * New tables: RLS ENABLED + FORCED, NO policies, all access revoked from
--     anon/authenticated, minimal grants to service_role only, NO DELETE grant.
--
-- HOW TO RUN
--   The application NEVER executes this. Run it manually ONCE in the Supabase
--   SQL editor (or psql), AFTER migration 007, while Marketing is paused.
-- ============================================================================

BEGIN;

-- Fail fast rather than block on a busy production database, and never let the
-- install run away. LOCAL = scoped to this transaction only; nothing global.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ----------------------------------------------------------------------------
-- Preflight (read-only): dependency check + single-execution advisory lock +
-- global-pause assertion + empty-ledger assertion. Any failure RAISES and rolls
-- the whole migration back BEFORE a single structure is created or altered.
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_missing   text[] := ARRAY[]::text[];
  v_dep       text;
  v_sending   boolean;
  v_discovery boolean;
  v_rollout   integer;
  v_opp_count bigint;
BEGIN
  -- 1) Every required dependency must already exist. to_regclass() is a pure
  --    lookup (NULL when absent); we create/alter NONE of these dependencies.
  FOREACH v_dep IN ARRAY ARRAY[
    'public.marketing_opportunities',
    'public.marketing_automations',
    'public.marketing_control_state',
    'public.customer_marketing_profiles',
    'public.marketing_external_contacts',
    'public.marketing_campaign_promotions',
    'public.marketing_templates',
    'public.campaigns'
  ] LOOP
    IF to_regclass(v_dep) IS NULL THEN
      v_missing := array_append(v_missing, v_dep);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'Stage 3C2B migration aborted: required dependency % is missing. Run migrations 001-007 first.',
      array_to_string(v_missing, ', ');
  END IF;

  -- 2) Refuse to overlap with a concurrent execution of THIS migration.
  --    Transaction-scoped lock, released automatically at COMMIT/ROLLBACK.
  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_stage_3c2b_intelligence_foundation')) THEN
    RAISE EXCEPTION
      'Stage 3C2B migration aborted: another execution is already in progress (advisory lock held).';
  END IF;

  -- 3) The Marketing Hub must be GLOBALLY PAUSED.
  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state
   WHERE key = 'default';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Stage 3C2B migration aborted: marketing_control_state singleton (key=''default'') not found; cannot confirm Marketing is paused.';
  END IF;

  IF v_sending IS DISTINCT FROM false
     OR v_discovery IS DISTINCT FROM false
     OR v_rollout   IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'Stage 3C2B migration aborted: Marketing is not globally paused (sending_enabled=%, discovery_enabled=%, rollout_limit=%). Refusing to install.',
      v_sending, v_discovery, v_rollout;
  END IF;

  -- 4) The opportunity ledger MUST be empty. This migration deliberately
  --    changes the opportunity schema (drops the six-value CHECK, adds an FK);
  --    that is only safe while zero rows exist. If ANY row is present, refuse.
  SELECT count(*) INTO v_opp_count FROM public.marketing_opportunities;
  IF v_opp_count <> 0 THEN
    RAISE EXCEPTION
      'Stage 3C2B migration aborted: marketing_opportunities contains % row(s); schema conversion requires an empty ledger.',
      v_opp_count;
  END IF;
END
$preflight$;

-- ============================================================================
-- 1. EXTENSIBLE OPPORTUNITY CATALOGUE
--    public.marketing_opportunity_definitions is the authoritative catalogue of
--    valid commercial opportunity types. It is deliberately NOT tied to
--    marketing_automations: an opportunity type may exist with no legacy
--    automation. New strategies become ROWS here, not schema migrations.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.marketing_opportunity_definitions (
  opportunity_key      text        PRIMARY KEY,
  display_name         text        NOT NULL,
  description          text        NOT NULL,
  family               text        NOT NULL,
  default_priority     integer     NOT NULL,
  default_score        numeric(10,4) NOT NULL,
  default_expiry_hours integer     NOT NULL,
  campaign_specific    boolean     NOT NULL DEFAULT false,
  ai_strategy_useful   boolean     NOT NULL DEFAULT false,
  enabled              boolean     NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- opportunity_key: lower-case, trimmed, token-safe [a-z0-9_], bounded.
  CONSTRAINT marketing_opportunity_definitions_key_token_chk CHECK (
    opportunity_key = lower(opportunity_key)
    AND opportunity_key = btrim(opportunity_key)
    AND opportunity_key ~ '^[a-z0-9_]+$'
    AND char_length(opportunity_key) BETWEEN 1 AND 100
  ),

  -- display_name / description bounded, non-empty.
  CONSTRAINT marketing_opportunity_definitions_display_name_chk CHECK (
    char_length(btrim(display_name)) BETWEEN 1 AND 200
  ),
  CONSTRAINT marketing_opportunity_definitions_description_chk CHECK (
    char_length(btrim(description)) BETWEEN 1 AND 1000
  ),

  -- family: lower-case, trimmed, token-safe, bounded.
  CONSTRAINT marketing_opportunity_definitions_family_token_chk CHECK (
    family = lower(family)
    AND family = btrim(family)
    AND family ~ '^[a-z0-9_]+$'
    AND char_length(family) BETWEEN 1 AND 50
  ),

  -- default_priority is a real 1-based rank.
  CONSTRAINT marketing_opportunity_definitions_priority_chk CHECK (
    default_priority >= 1
  ),

  -- default_score bounded to the same fixed 0-1000 scale as marketing_opportunities.
  CONSTRAINT marketing_opportunity_definitions_score_range_chk CHECK (
    default_score >= 0 AND default_score <= 1000
  ),

  -- default_expiry_hours positive and sanely bounded (<= 90 days).
  CONSTRAINT marketing_opportunity_definitions_expiry_chk CHECK (
    default_expiry_hours > 0 AND default_expiry_hours <= 2160
  )
);

COMMENT ON TABLE public.marketing_opportunity_definitions IS
  'Stage 3C2B authoritative, extensible catalogue of commercial opportunity types. Not tied to marketing_automations. New strategies are rows, not migrations. All seeded definitions start enabled=false (no detector exists). Defaults (priority/score/expiry) are STARTING CONFIGURATION only, tuned later using results. Service-role only.';

-- Security: RLS ENABLED + FORCED, no policies, service_role only, NO DELETE.
ALTER TABLE public.marketing_opportunity_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_opportunity_definitions FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_opportunity_definitions FROM anon, authenticated;
-- Security hardening: explicitly strip ALL privileges from service_role FIRST so
-- it cannot inherit DELETE (or any other verb) via existing/default grants, then
-- grant back EXACTLY the three verbs this catalogue needs. No DELETE is granted.
REVOKE ALL ON public.marketing_opportunity_definitions FROM service_role;
GRANT SELECT, INSERT, UPDATE ON public.marketing_opportunity_definitions TO service_role;

-- ============================================================================
-- 2. SEED THE INITIAL OPPORTUNITY CATALOGUE
--    Idempotent (ON CONFLICT DO NOTHING). EVERY definition starts enabled=false
--    because NO detector exists yet. The priority/score/expiry values are
--    STARTING CONFIGURATION ONLY and will be tuned later using real results.
--    These are DEFINITION rows only; they do NOT imply detection is implemented.
--    Compound intelligence comes LATER from signal features + scoring, so this
--    catalogue is intentionally NOT an explosion of rigid compound types.
-- ============================================================================
INSERT INTO public.marketing_opportunity_definitions
  (opportunity_key, display_name, description, family,
   default_priority, default_score, default_expiry_hours,
   campaign_specific, ai_strategy_useful, enabled)
VALUES
  -- Original six keys, preserved for compatibility (map onto seeded automations).
  ('vip_early_access',             'VIP Early Access',                 'Give a VIP customer early access to a configured promotion.',                         'promotion', 1, 800, 72,  true,  true,  false),
  ('abandoned_checkout',           'Abandoned Checkout',               'A customer began but did not complete a checkout for a campaign.',                      'checkout',  2, 650, 24,  true,  false, false),
  ('wtf_credit_waiting',           'WTF Credit Waiting',               'A customer holds available WTF wallet credit to spend.',                                'wallet',    3, 500, 720, false, false, false),
  ('regular_buyer_campaign_alert', 'Regular Buyer Campaign Alert',     'Alert a regular buyer to a configured campaign promotion.',                             'promotion', 4, 450, 168, true,  true,  false),
  ('new_account_no_purchase',      'New Account No Purchase',          'A newly registered account has not yet made a first purchase.',                         'lifecycle', 5, 350, 336, false, false, false),
  ('lapsed_14_days',               'Lapsed 14 Days',                   'A previously active customer has not purchased in 14 days.',                            'lifecycle', 6, 300, 336, false, false, false),

  -- Winner family (POSITIVE engagement only; never streak/odds/"due" framing).
  ('recent_winner_follow_up',      'Recent Winner Follow Up',          'Re-engage a customer who recently won, as a happy engaged customer.',                   'winner',    1, 780, 168, true,  true,  false),
  ('recent_winner_credit_available','Recent Winner Credit Available',  'A recent winner is holding spendable WTF credit from their win.',                       'winner',    1, 800, 168, true,  true,  false),
  ('first_win_follow_up',          'First Win Follow Up',              'Nurture a customer who has just had their first ever win.',                             'winner',    2, 700, 336, false, true,  false),
  ('high_value_winner_follow_up',  'High Value Winner Follow Up',      'Retain a high-value customer who recently had a high-value win.',                       'winner',    1, 820, 336, true,  true,  false),

  -- Wallet family.
  ('fresh_wallet_credit',          'Fresh Wallet Credit',              'A customer recently received new WTF wallet credit worth acting on quickly.',           'wallet',    2, 620, 168, false, false, false),
  ('wallet_credit_campaign_match', 'Wallet Credit Campaign Match',     'A customer has spendable credit and an open campaign that matches their affinity.',     'wallet',    2, 700, 168, true,  true,  false),

  -- Cadence family.
  ('personal_cadence_overdue',     'Personal Cadence Overdue',         'A customer is overdue versus their own personal purchase cadence.',                     'cadence',   3, 560, 168, false, true,  false),

  -- Affinity family.
  ('frequent_buyer_relevant_campaign','Frequent Buyer Relevant Campaign','Alert a frequent buyer to a new campaign matching their affinity.',                   'affinity',  4, 480, 168, true,  true,  false),
  ('vip_relevant_campaign',        'VIP Relevant Campaign',            'Alert a VIP customer to a new campaign matching their affinity.',                       'affinity',  1, 760, 168, true,  true,  false),
  ('reveal_affinity_campaign',     'Reveal Affinity Campaign',         'A new campaign matches a customer''s preferred reveal type.',                           'affinity',  4, 440, 168, true,  true,  false),
  ('recently_active_no_relevant_entry','Recently Active No Relevant Entry','A recently active customer has not entered a currently relevant campaign.',           'affinity',  5, 400, 96,  true,  false, false),

  -- Lifecycle family.
  ('first_to_second_purchase',     'First To Second Purchase',         'Encourage a one-time buyer towards their second purchase.',                             'lifecycle', 3, 520, 336, false, false, false),
  ('lapsed_7_days',                'Lapsed 7 Days',                    'A previously active customer has not purchased in 7 days.',                             'lifecycle', 4, 320, 336, false, false, false),
  ('lapsed_30_days',               'Lapsed 30 Days',                   'A previously active customer has not purchased in 30 days.',                            'lifecycle', 6, 280, 720, false, false, false),
  ('high_value_customer_at_risk',  'High Value Customer At Risk',      'A high-value customer is showing signs of lapsing.',                                    'lifecycle', 2, 720, 336, false, true,  false),
  ('vip_reactivation',             'VIP Reactivation',                 'Reactivate a lapsed VIP customer.',                                                     'lifecycle', 1, 760, 720, false, true,  false),
  ('reactivated_customer_follow_up','Reactivated Customer Follow Up',  'Follow up with a customer who recently returned after a lapse.',                        'lifecycle', 4, 420, 336, false, false, false),

  -- Checkout family.
  ('high_value_abandoned_checkout','High Value Abandoned Checkout',    'A customer abandoned a high-value checkout.',                                           'checkout',  1, 700, 24,  true,  false, false),
  ('repeat_abandoner',             'Repeat Abandoner',                 'A customer has abandoned checkout more than once recently.',                            'checkout',  3, 480, 48,  true,  false, false),

  -- Promotion / cross-campaign family.
  ('campaign_closing_relevant_customer','Campaign Closing Relevant Customer','A relevant open campaign is closing soon for an interested customer.',              'promotion', 3, 540, 48,  true,  true,  false),
  ('recent_buyer_cross_campaign',  'Recent Buyer Cross Campaign',      'A recent buyer may be interested in another currently open campaign.',                  'promotion', 5, 400, 96,  true,  true,  false),
  ('promotion_match',              'Promotion Match',                  'A customer matches the audience of a configured campaign promotion.',                   'promotion', 4, 440, 168, true,  true,  false)
ON CONFLICT (opportunity_key) DO NOTHING;

-- ============================================================================
-- 3. FIX marketing_opportunities EXTENSIBILITY (safe only while EMPTY).
--    A) Drop the fixed six-value opportunity_type CHECK.
--    B) Make automation_id NULLABLE (keep the column as optional provenance).
--    C) Add FK opportunity_type -> marketing_opportunity_definitions(opportunity_key)
--       ON DELETE RESTRICT. The column name opportunity_type is UNCHANGED.
--    No other marketing_opportunities constraint/index/RLS/grant is touched.
-- ============================================================================

-- A) Drop the obsolete six-value CHECK (idempotent).
ALTER TABLE public.marketing_opportunities
  DROP CONSTRAINT IF EXISTS marketing_opportunities_type_chk;

-- B) automation_id becomes optional provenance (only drops NOT NULL; column and
--    its existing FK to marketing_automations are otherwise untouched).
ALTER TABLE public.marketing_opportunities
  ALTER COLUMN automation_id DROP NOT NULL;

-- C) Referential integrity from opportunity_type to the catalogue. Guarded so a
--    re-run does not error on the already-present constraint.
DO $add_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'marketing_opportunities_type_fkey'
       AND conrelid = 'public.marketing_opportunities'::regclass
  ) THEN
    ALTER TABLE public.marketing_opportunities
      ADD CONSTRAINT marketing_opportunities_type_fkey
      FOREIGN KEY (opportunity_type)
      REFERENCES public.marketing_opportunity_definitions (opportunity_key)
      ON DELETE RESTRICT;
  END IF;
END
$add_fk$;

-- D) Defensive hardening: explicitly revoke DELETE on the existing opportunity
--    ledger from service_role. The ledger is append/update-only (immutable
--    history); nothing should ever hard-delete an opportunity row. This does NOT
--    otherwise change marketing_opportunities permissions (its existing
--    SELECT/INSERT/UPDATE grants and RLS from migration 007 are untouched).
REVOKE DELETE ON public.marketing_opportunities FROM service_role;

-- ============================================================================
-- 4. customer_marketing_intelligence
--    One MUTABLE derived behavioural/commercial row per Auth customer. This is
--    NOT permission state (consent/eligibility stay in the marketing permission
--    system and in customer_marketing_profiles). customer_marketing_profiles is
--    NOT altered by this migration. Installed EMPTY; populated by a LATER rollup.
--    Holds ONLY positive/neutral behaviour — no loss signal of any kind.
--    user_id is a plain uuid with NO FK to auth.users (immutable-friendly).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.customer_marketing_intelligence (
  user_id                             uuid        PRIMARY KEY,

  -- Purchase frequency windows.
  orders_7d                           integer     NOT NULL DEFAULT 0,
  orders_14d                          integer     NOT NULL DEFAULT 0,
  orders_30d                          integer     NOT NULL DEFAULT 0,
  orders_60d                          integer     NOT NULL DEFAULT 0,
  orders_90d                          integer     NOT NULL DEFAULT 0,

  -- External spend windows (pence).
  external_spend_30d_pence            bigint      NOT NULL DEFAULT 0,
  external_spend_90d_pence            bigint      NOT NULL DEFAULT 0,

  average_external_order_value_pence  bigint,
  highest_external_order_value_pence  bigint,

  -- Cadence.
  previous_confirmed_at               timestamptz,
  average_purchase_gap_hours          numeric(12,4),

  -- Winning behaviour (POSITIVE engagement signal only).
  last_win_at                         timestamptz,
  win_count                           integer     NOT NULL DEFAULT 0,
  wins_30d                            integer     NOT NULL DEFAULT 0,
  last_win_value_pence                integer,
  last_win_fulfilment_type            text,
  last_win_campaign_id                uuid,

  -- Wallet ledger derived.
  last_wallet_credit_at               timestamptz,
  last_wallet_debit_at                timestamptz,
  wallet_credit_received_30d_pence    bigint      NOT NULL DEFAULT 0,
  wallet_spent_30d_pence              bigint      NOT NULL DEFAULT 0,

  -- Checkout abandonment (behaviour, not permission).
  last_abandoned_at                   timestamptz,
  abandoned_7d_count                  integer     NOT NULL DEFAULT 0,
  abandoned_30d_count                 integer     NOT NULL DEFAULT 0,
  last_abandoned_campaign_id          uuid,

  -- Provenance.
  source_updated_at                   timestamptz,
  refreshed_at                        timestamptz NOT NULL DEFAULT now(),

  -- Non-negative counters / amounts.
  CONSTRAINT cmi_orders_nonneg_chk CHECK (
    orders_7d >= 0 AND orders_14d >= 0 AND orders_30d >= 0
    AND orders_60d >= 0 AND orders_90d >= 0
  ),
  CONSTRAINT cmi_spend_nonneg_chk CHECK (
    external_spend_30d_pence >= 0 AND external_spend_90d_pence >= 0
    AND wallet_credit_received_30d_pence >= 0 AND wallet_spent_30d_pence >= 0
  ),
  CONSTRAINT cmi_optional_amounts_nonneg_chk CHECK (
    (average_external_order_value_pence IS NULL OR average_external_order_value_pence >= 0)
    AND (highest_external_order_value_pence IS NULL OR highest_external_order_value_pence >= 0)
    AND (last_win_value_pence IS NULL OR last_win_value_pence >= 0)
  ),
  CONSTRAINT cmi_wins_nonneg_chk CHECK (
    win_count >= 0 AND wins_30d >= 0
  ),
  CONSTRAINT cmi_abandoned_nonneg_chk CHECK (
    abandoned_7d_count >= 0 AND abandoned_30d_count >= 0
  ),
  CONSTRAINT cmi_avg_gap_nonneg_chk CHECK (
    average_purchase_gap_hours IS NULL OR average_purchase_gap_hours >= 0
  ),

  -- last_win_fulfilment_type restricted to ACTUAL verified WTF award values.
  CONSTRAINT cmi_fulfilment_type_chk CHECK (
    last_win_fulfilment_type IS NULL
    OR last_win_fulfilment_type IN ('cash', 'wallet_credit', 'manual')
  ),

  -- Derived-data consistency: these nested time-window aggregates are computed
  -- by a later rollup. Enforce that logically impossible combinations can NEVER
  -- be stored, so a buggy future rollup fails loudly instead of persisting
  -- corrupt intelligence. Each wider window must contain the narrower one.
  CONSTRAINT cmi_orders_window_monotonic_chk CHECK (
    orders_7d <= orders_14d
    AND orders_14d <= orders_30d
    AND orders_30d <= orders_60d
    AND orders_60d <= orders_90d
  ),
  CONSTRAINT cmi_spend_window_monotonic_chk CHECK (
    external_spend_30d_pence <= external_spend_90d_pence
  ),
  CONSTRAINT cmi_wins_window_monotonic_chk CHECK (
    wins_30d <= win_count
  ),
  CONSTRAINT cmi_abandoned_window_monotonic_chk CHECK (
    abandoned_7d_count <= abandoned_30d_count
  ),
  -- Average order value can never exceed the highest order value (when both
  -- are known). NULLs (unknown) are permitted and skip the check.
  CONSTRAINT cmi_avg_le_highest_chk CHECK (
    average_external_order_value_pence IS NULL
    OR highest_external_order_value_pence IS NULL
    OR average_external_order_value_pence <= highest_external_order_value_pence
  )
);

COMMENT ON TABLE public.customer_marketing_intelligence IS
  'Stage 3C2B derived per-customer behavioural/commercial intelligence. NOT permission state (consent/eligibility live elsewhere). Installed empty; a later rollup populates it. Holds only positive/neutral behaviour — no loss signal. Service-role only.';

-- Useful, restrained indexes (partial where the column is sparse).
CREATE INDEX IF NOT EXISTS customer_marketing_intelligence_last_win_at_idx
  ON public.customer_marketing_intelligence (last_win_at)
  WHERE last_win_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_marketing_intelligence_last_credit_at_idx
  ON public.customer_marketing_intelligence (last_wallet_credit_at)
  WHERE last_wallet_credit_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_marketing_intelligence_last_abandoned_at_idx
  ON public.customer_marketing_intelligence (last_abandoned_at)
  WHERE last_abandoned_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_marketing_intelligence_orders_30d_idx
  ON public.customer_marketing_intelligence (orders_30d);

-- Security: RLS ENABLED + FORCED, no policies, service_role only, NO DELETE.
ALTER TABLE public.customer_marketing_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_marketing_intelligence FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_marketing_intelligence FROM anon, authenticated;
-- Security hardening: explicitly strip ALL privileges from service_role FIRST so
-- it cannot inherit DELETE (or any other verb) via existing/default grants, then
-- grant back EXACTLY the three verbs this rollup needs. No DELETE is granted.
REVOKE ALL ON public.customer_marketing_intelligence FROM service_role;
GRANT SELECT, INSERT, UPDATE ON public.customer_marketing_intelligence TO service_role;

-- ============================================================================
-- 5. customer_campaign_affinity
--    One compact multi-row-per-customer affinity rollup. Signals are computed
--    LATER from customer_marketing_profiles + customer_marketing_intelligence +
--    this table; there is deliberately NO customer_marketing_signals fact table.
--    affinity_type is token-validated but NOT restricted by a rigid CHECK, so
--    future structured metadata (e.g. campaign family / host) can be added once
--    real structured data exists — never inferred from campaign titles.
--    Installed EMPTY. user_id is a plain uuid with NO FK.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.customer_campaign_affinity (
  user_id               uuid        NOT NULL,
  affinity_type         text        NOT NULL,
  affinity_key          text        NOT NULL,
  confirmed_order_count integer     NOT NULL DEFAULT 0,
  external_spend_pence  bigint      NOT NULL DEFAULT 0,
  last_confirmed_at     timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, affinity_type, affinity_key),

  -- affinity_type: lower-case, trimmed, token-safe, bounded (NOT value-locked).
  CONSTRAINT customer_campaign_affinity_type_token_chk CHECK (
    affinity_type = lower(affinity_type)
    AND affinity_type = btrim(affinity_type)
    AND affinity_type ~ '^[a-z0-9_]+$'
    AND char_length(affinity_type) BETWEEN 1 AND 50
  ),

  -- affinity_key: lower-case, trimmed, token-safe, bounded. Hyphens ARE allowed
  -- so keys can be UUID- or slug-style identifiers (e.g. a campaign UUID for
  -- affinity_type = 'campaign'), which contain hyphens. affinity_type stays
  -- underscore/token-only above; only the KEY permits hyphens.
  CONSTRAINT customer_campaign_affinity_key_token_chk CHECK (
    affinity_key = lower(affinity_key)
    AND affinity_key = btrim(affinity_key)
    AND affinity_key ~ '^[a-z0-9_-]+$'
    AND char_length(affinity_key) BETWEEN 1 AND 100
  ),

  CONSTRAINT customer_campaign_affinity_nonneg_chk CHECK (
    confirmed_order_count >= 0 AND external_spend_pence >= 0
  )
);

COMMENT ON TABLE public.customer_campaign_affinity IS
  'Stage 3C2B compact per-customer campaign affinity rollup (multi-row per customer). affinity_type is token-validated (underscore/token only) but intentionally NOT value-locked, so future structured metadata can be added. affinity_key additionally permits hyphens so it can hold UUID/slug-style identifiers (e.g. a campaign UUID). Never infer host/category from titles. Installed empty; populated by a later rollup. Service-role only.';

-- Index to find users with a given affinity_type + affinity_key.
CREATE INDEX IF NOT EXISTS customer_campaign_affinity_type_key_idx
  ON public.customer_campaign_affinity (affinity_type, affinity_key);

-- Security: RLS ENABLED + FORCED, no policies, service_role only, NO DELETE.
ALTER TABLE public.customer_campaign_affinity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_campaign_affinity FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_campaign_affinity FROM anon, authenticated;
-- Security hardening: explicitly strip ALL privileges from service_role FIRST so
-- it cannot inherit DELETE (or any other verb) via existing/default grants, then
-- grant back EXACTLY the three verbs this rollup needs. No DELETE is granted.
REVOKE ALL ON public.customer_campaign_affinity FROM service_role;
GRANT SELECT, INSERT, UPDATE ON public.customer_campaign_affinity TO service_role;

-- ============================================================================
-- 7. UPDATE THE ADMIN OPPORTUNITY OVERVIEW RPC
--    countByType is now generated DYNAMICALLY from the catalogue LEFT JOINed to
--    actual counts, so every enabled/disabled definition appears (zero when no
--    opportunity rows exist) and the obsolete six hard-coded VALUES are gone.
--    Also exposes enabledDefinitionCount / totalDefinitionCount aggregates.
--    Unchanged: RETURNS jsonb, STABLE, SECURITY DEFINER, fixed search_path, 10s
--    statement_timeout, service-role-only EXECUTE, no identities/emails/rows,
--    no checkout scan. Existing state counts + selected decision-mode counts
--    are preserved exactly. Definition descriptions/raw rows are NOT exposed.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_admin_marketing_opportunity_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '10s'
AS $$
DECLARE
  v_now          timestamptz := now();
  v_counts       jsonb;
  v_by_state     jsonb;
  v_by_type      jsonb;
  v_def_total    bigint;
  v_def_enabled  bigint;
BEGIN
  -- Single-pass conditional aggregation over the (initially empty) ledger.
  SELECT jsonb_build_object(
           'total',                 count(*),
           'open',                  count(*) FILTER (WHERE state = 'open'),
           'selected',              count(*) FILTER (WHERE state = 'selected'),
           'suppressed',            count(*) FILTER (WHERE state = 'suppressed'),
           'deferred',              count(*) FILTER (WHERE state = 'deferred'),
           'expired',               count(*) FILTER (WHERE state = 'expired'),
           'superseded',            count(*) FILTER (WHERE state = 'superseded'),
           'actioned',              count(*) FILTER (WHERE state = 'actioned'),
           -- CURRENTLY-selected decision counts only.
           'deterministicSelected', count(*) FILTER (WHERE decision_mode = 'deterministic' AND state = 'selected'),
           'aiSelected',            count(*) FILTER (WHERE decision_mode = 'ai' AND state = 'selected')
         )
    INTO v_counts
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

  -- Count by opportunity type, generated DYNAMICALLY from the catalogue LEFT
  -- JOINed to actual counts. Every definition appears (zero when no rows). No
  -- hard-coded VALUES, and definition descriptions/raw rows are NOT exposed.
  SELECT jsonb_object_agg(d.opportunity_key, COALESCE(c.cnt, 0))
    INTO v_by_type
    FROM public.marketing_opportunity_definitions d
    LEFT JOIN (
      SELECT opportunity_type, count(*)::bigint AS cnt
        FROM public.marketing_opportunities
       GROUP BY opportunity_type
    ) c ON c.opportunity_type = d.opportunity_key;

  -- Aggregate catalogue counts (no descriptions, no rows).
  SELECT count(*)::bigint,
         count(*) FILTER (WHERE enabled)::bigint
    INTO v_def_total, v_def_enabled
    FROM public.marketing_opportunity_definitions;

  RETURN jsonb_build_object(
    'generatedAt',            v_now,
    'total',                  (v_counts ->> 'total')::bigint,
    'open',                   (v_counts ->> 'open')::bigint,
    'selected',               (v_counts ->> 'selected')::bigint,
    'suppressed',             (v_counts ->> 'suppressed')::bigint,
    'deferred',               (v_counts ->> 'deferred')::bigint,
    'expired',                (v_counts ->> 'expired')::bigint,
    'actioned',               (v_counts ->> 'actioned')::bigint,
    'deterministicSelected',  (v_counts ->> 'deterministicSelected')::bigint,
    'aiSelected',             (v_counts ->> 'aiSelected')::bigint,
    'countByState',           v_by_state,
    'countByType',            COALESCE(v_by_type, '{}'::jsonb),
    'enabledDefinitionCount', v_def_enabled,
    'totalDefinitionCount',   v_def_total
  );
END;
$$;

COMMENT ON FUNCTION public.get_admin_marketing_opportunity_overview() IS
  'Stage 3C2B read-only admin opportunity overview. Reads ONLY marketing_opportunities + marketing_opportunity_definitions. countByType is generated dynamically from the catalogue. Returns aggregate counts only — no identities, no emails, no rows, no descriptions, no writes, no checkout scan, no sending. Service-role only.';

-- Service-role-only execution.
REVOKE ALL ON FUNCTION public.get_admin_marketing_opportunity_overview() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_marketing_opportunity_overview() TO service_role;

COMMIT;

-- ============================================================================
-- End of Stage 3C2B migration.
--   * Atomic BEGIN/COMMIT with fail-fast lock/statement timeouts, a dependency
--     + advisory-lock preflight, a global-pause assertion (control state read
--     only), and an empty-ledger assertion.
--   * NEW: marketing_opportunity_definitions (catalogue, seeded, every row
--     enabled=false), customer_marketing_intelligence (empty),
--     customer_campaign_affinity (empty) — all RLS enabled+forced, service-role
--     only, NO DELETE grant.
--   * marketing_opportunities: six-value CHECK dropped, automation_id nullable,
--     FK opportunity_type -> marketing_opportunity_definitions added. All other
--     constraints/indexes/RLS/grants intact.
--   * get_admin_marketing_opportunity_overview replaced: countByType dynamic.
--   * customer_marketing_profiles NOT altered. No customer_marketing_signals /
--     marketing_signal_definitions table created.
--   * NO behavioural calculation, NO checkout/award/wallet/ticket scan, NO
--     opportunities/recipients/runs, NO AI, NO Resend, NO cron, NO discovery/
--     sending enabled, NO rollout change, NO enabled definition or automation.
--   * Migrations 001-008 untouched (008 remains unexecuted and superseded).
--     Checkout/payment/ticket/wallet/signup/public pages/transactional email
--     unchanged.
-- ============================================================================
