-- ============================================================================
-- WTF Marketing Hub — Stage 3C2D: READ-ONLY opportunity DETECTION + NEXT-BEST-
-- ACTION arbitration PREVIEW.
-- ----------------------------------------------------------------------------
-- PURPOSE
--   Install READ-ONLY, service-role-only RPCs that report what the FUTURE
--   Opportunity Engine WOULD detect and how it WOULD arbitrate a single
--   next-best-action per customer, across the live customer intelligence base,
--   WITHOUT creating a single marketing_opportunities row. Analysis only.
--
--   It supersedes the obsolete, unexecuted migration 008 CONCEPTUALLY. It does
--   NOT modify 008 (or any migration 001-010).
--
-- HARD GUARANTEES (this migration is INERT on install)
--   * NO writes anywhere. marketing_opportunities stays at 0 rows.
--   * NO recipients, NO automation runs, NO selection/arbitration writes.
--   * NO definition is enabled (all 28 remain enabled=false).
--   * marketing_control_state is READ ONLY (pause assertion); never mutated.
--   * NO AI, NO cron, NO email/Resend, NO sending, NO discovery.
--   * NO ALTER of any existing table, NO new table, NO trigger, NO extension.
--   * Does NOT touch checkout / payment / ticket / wallet / signup / customer
--     facing behaviour.
--
-- DETECTION SUBSTRATE (rollups only — NO broad operational history scan)
--   Primary substrate is the pre-computed rollups:
--     * public.customer_marketing_profiles        (value, wallet, permission)
--     * public.customer_marketing_intelligence     (behaviour, wins, cadence,
--                                                    wallet freshness, abandonment,
--                                                    last_win_campaign_id,
--                                                    last_abandoned_campaign_id)
--     * public.customer_campaign_affinity          (campaign / reveal_type /
--                                                    presentation_type affinity,
--                                                    with confirmed_order_count,
--                                                    external_spend_pence,
--                                                    last_confirmed_at)
--   Small config datasets are joined:
--     * public.campaigns                           (live universe + closing)
--     * public.marketing_campaign_promotions       (configured promotions)
--     * public.marketing_automations               (delay / wallet thresholds)
--     * public.marketing_opportunity_definitions   (family / priority / score /
--                                                    campaign_specific)
--   checkout_intents / instant_win_awards / wallet_transactions are NEVER read
--   here: those operational facts are already rolled up into intelligence and
--   affinity. Abandonment (delay + debug/SIM + later same-campaign conversion
--   exclusion) is ALREADY applied inside the rollup, so no re-scan is needed.
--
-- CAMPAIGN CONTEXT IS REAL (no NULL-campaign campaign-specific candidates)
--   Every definition flagged campaign_specific = true MUST carry a concrete
--   campaign_id or it is dropped in executable SQL (not merely documented):
--     * live campaign universe  = status = 'live' AND (end_at IS NULL OR
--                                  end_at > now())
--     * actionable promotions   = marketing_campaign_promotions JOIN campaigns,
--                                  promotion status scheduled/processing AND the
--                                  campaign still live/open
--     * winner candidates       = intelligence.last_win_campaign_id
--     * abandonment candidates  = intelligence.last_abandoned_campaign_id
--     * affinity/relevance      = an ACTUAL relevant LIVE campaign the customer
--                                  has NOT already bought, ranked by structured
--                                  affinity (never MIN(uuid))
--   is_closing describes THAT candidate's own campaign only; it is never a
--   customer-wide flag.
--
-- ARCHITECTURE RULE — DETECTION IS NOT SEND ELIGIBILITY
--   An opportunity is DETECTED from the full Auth customer population regardless
--   of marketing permission. Detection NEVER filters on permission or
--   sendability. Permission (marketing_enabled / has_active_suppression) and
--   sendability (marketing_eligible_snapshot AND NOT has_active_suppression) are
--   reported SEPARATELY as aggregates on the winning candidates. Final send
--   eligibility remains a later deterministic gate (send workers re-check
--   is_marketing_email_eligible at send time).
--
-- NO LOSS / GAMBLING-HARM SIGNALS
--   No losses, losing streaks, near misses, "due to win", win probability,
--   chasing losses, cumulative losses, financial vulnerability or deposit
--   escalation are derived or scored. Winner data is used ONLY as positive
--   engagement history and never implies future winning.
--
-- HOW TO RUN
--   The application NEVER executes this. Run it manually ONCE in the Supabase
--   SQL editor (or psql), AFTER migrations 001-010. Re-running is a no-op
--   (CREATE OR REPLACE FUNCTION only).
-- ============================================================================

BEGIN;

-- Fail fast rather than block on a busy production database; LOCAL only.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ----------------------------------------------------------------------------
-- Preflight (READ-ONLY): dependency existence, single-execution advisory lock,
-- and global-pause assertion. This is a PRE-LAUNCH planning tool, so it refuses
-- to install unless the hub is still fully paused. Nothing here writes;
-- to_regclass is a pure catalogue lookup.
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_missing   text[] := ARRAY[]::text[];
  v_dep       text;
  v_sending   boolean;
  v_discovery boolean;
  v_rollout   integer;
BEGIN
  FOREACH v_dep IN ARRAY ARRAY[
    'public.campaigns',
    'public.customer_marketing_profiles',
    'public.customer_marketing_intelligence',
    'public.customer_campaign_affinity',
    'public.marketing_opportunity_definitions',
    'public.marketing_campaign_promotions',
    'public.marketing_automations',
    'public.marketing_control_state',
    'public.marketing_opportunities'
  ] LOOP
    IF to_regclass(v_dep) IS NULL THEN
      v_missing := array_append(v_missing, v_dep);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'Stage 3C2D preview aborted: required dependency % is missing. Run migrations 001-010 first.',
      array_to_string(v_missing, ', ');
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_stage_3c2d_detection_preview')) THEN
    RAISE EXCEPTION
      'Stage 3C2D preview aborted: another execution is already in progress (advisory lock held).';
  END IF;

  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state
   WHERE key = 'default';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Stage 3C2D preview aborted: marketing_control_state singleton (key=''default'') not found; cannot confirm Marketing is paused.';
  END IF;

  IF v_sending IS DISTINCT FROM false
     OR v_discovery IS DISTINCT FROM false
     OR v_rollout   IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'Stage 3C2D preview aborted: Marketing is not globally paused (sending_enabled=%, discovery_enabled=%, rollout_limit=%). Refusing to install a detection preview once live.',
      v_sending, v_discovery, v_rollout;
  END IF;
END
$preflight$;

-- ============================================================================
-- 1. PRIVATE CANDIDATE MODEL (SET-BASED, READ-ONLY)
--    A STABLE SECURITY DEFINER set-returning function that produces ONE ROW per
--    (user_id, opportunity_key) detected candidate, with its transparent score
--    components and its deterministic per-customer arbitration rank. Both public
--    RPCs below consume this single source of truth so detection, scoring and
--    arbitration can never diverge between the overview and the sample.
--
--    It is owner-only: reachable exclusively through the two top-level
--    SECURITY DEFINER RPCs (same owner). EXECUTE is granted to NOBODY.
--
--    Determinism / boundedness:
--      * Purely set-based (CTEs + window functions). No PL/pgSQL customer loop.
--      * Campaign-context detectors are gated on a CONCRETE campaign_id; when no
--        live campaigns / actionable promotions exist those picks are NULL and
--        the campaign_specific invariant drops the candidate.
--      * Reads ONLY the three rollups + tiny config tables. No operational scan.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.wtf_marketing_opportunity_candidates_preview()
RETURNS TABLE (
  user_id             uuid,
  opportunity_key     text,
  family              text,
  default_priority    integer,
  default_score       numeric,
  campaign_id         uuid,
  final_score         integer,
  score_components    jsonb,
  is_closing          boolean,
  -- permission + sendability (reported separately from detection; NEVER filter)
  perm_backed         boolean,
  perm_suppressed     boolean,
  perm_not_backed     boolean,
  sendable_now        boolean,
  rn                  integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '10s'
AS $$
WITH
-- Automation-driven thresholds (single read of the tiny automations table).
cfg AS (
  SELECT
    COALESCE(max(first_delay_minutes)  FILTER (WHERE automation_key = 'new_account_no_purchase'), 1440)::int AS na_delay_minutes,
    COALESCE(max(minimum_wallet_pence) FILTER (WHERE automation_key = 'wtf_credit_waiting'),      1)::bigint  AS wtf_min_wallet_pence
  FROM public.marketing_automations
),
-- Live / marketable campaign universe. status = 'live' is the authoritative
-- public "isLive" definition; a live campaign with end_at in the past is no
-- longer open, so it is excluded. reveal_type / presentation_type are lowered
-- to match the affinity rollup keys. is_closing = end_at within 48h.
live_campaigns AS (
  SELECT
    c.id                                                          AS campaign_id,
    lower(btrim(c.reveal_type))                                   AS reveal_key,
    lower(btrim(c.presentation_type))                             AS presentation_key,
    c.end_at,
    (c.end_at IS NOT NULL
      AND c.end_at > now()
      AND c.end_at <= now() + interval '48 hours')                AS is_closing
  FROM public.campaigns c
  WHERE c.status = 'live'
    AND (c.end_at IS NULL OR c.end_at > now())
),
-- Per-campaign closing lookup for candidate-specific is_closing (J). A candidate
-- is "closing" ONLY when ITS OWN attached campaign is closing.
closing_lu AS (
  SELECT campaign_id, is_closing FROM live_campaigns
),
-- ACTIONABLE promotion universe (B): a configured promotion in an actionable
-- state whose campaign is genuinely live/open. This is the ONLY source of
-- campaign_id for vip_early_access / regular_buyer_campaign_alert /
-- promotion_match.
actionable_promos AS (
  SELECT
    p.promotion_type,
    p.campaign_id,
    c.end_at
  FROM public.marketing_campaign_promotions p
  JOIN public.campaigns c ON c.id = p.campaign_id
  WHERE p.status IN ('scheduled', 'processing')
    AND c.status = 'live'
    AND (c.end_at IS NULL OR c.end_at > now())
),
vip_promo_campaigns AS (
  SELECT DISTINCT campaign_id, end_at
  FROM actionable_promos WHERE promotion_type = 'vip_early_access'
),
rb_promo_campaigns AS (
  SELECT DISTINCT campaign_id, end_at
  FROM actionable_promos WHERE promotion_type = 'regular_buyer_campaign_alert'
),
-- reveal_type / presentation_type affinity, carrying the structured stats used
-- for campaign selection ordering (H).
type_affinity AS (
  SELECT user_id, affinity_type, affinity_key,
         confirmed_order_count, external_spend_pence, last_confirmed_at
  FROM public.customer_campaign_affinity
  WHERE affinity_type IN ('reveal_type', 'presentation_type')
),
-- Campaigns a customer has already bought (affinity_type = 'campaign'); the
-- already-entered / already-purchased exclusion WITHOUT scanning checkouts.
bought_campaign AS (
  SELECT user_id, affinity_key AS campaign_key
  FROM public.customer_campaign_affinity
  WHERE affinity_type = 'campaign'
),
-- Customer x live-campaign relevance pairs, matched on structured metadata only
-- (never titles/slugs). via_reveal distinguishes a reveal_type match from a
-- presentation_type-only match (G). Carries affinity stats + campaign end_at for
-- deterministic ordering, and whether the customer already bought the campaign.
match_pairs AS (
  SELECT
    ta.user_id,
    lc.campaign_id,
    lc.is_closing,
    (ta.affinity_type = 'reveal_type')                            AS via_reveal,
    ta.confirmed_order_count,
    ta.external_spend_pence,
    ta.last_confirmed_at                                          AS affinity_last_confirmed_at,
    lc.end_at,
    (bc.user_id IS NOT NULL)                                      AS already_entered
  FROM type_affinity ta
  JOIN live_campaigns lc
    ON (ta.affinity_type = 'reveal_type'       AND ta.affinity_key = lc.reveal_key)
    OR (ta.affinity_type = 'presentation_type' AND ta.affinity_key = lc.presentation_key)
  LEFT JOIN bought_campaign bc
    ON bc.user_id = ta.user_id
   AND bc.campaign_key = lower(lc.campaign_id::text)
),
-- Structured affinity ordering (H). Rank relevant, NOT-already-bought live
-- campaigns per customer. NEVER MIN(uuid).
--   1) confirmed_order_count DESC
--   2) external_spend_pence  DESC
--   3) last_confirmed_at     DESC NULLS LAST
--   4) campaign end_at        ASC NULLS LAST
--   5) campaign_id            ASC (deterministic tie-break)
rel_ranked AS (
  SELECT
    user_id, campaign_id, is_closing, via_reveal,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY confirmed_order_count DESC,
               external_spend_pence DESC,
               affinity_last_confirmed_at DESC NULLS LAST,
               end_at ASC NULLS LAST,
               campaign_id ASC
    ) AS rrn
  FROM match_pairs
  WHERE NOT already_entered
),
rel_campaign_pick AS (
  SELECT user_id, campaign_id AS relevant_campaign_id
  FROM rel_ranked WHERE rrn = 1
),
-- Reveal-specific selector (G): restricted to via_reveal matches, so
-- reveal_affinity_campaign can NEVER accidentally use a presentation-only match.
reveal_ranked AS (
  SELECT
    user_id, campaign_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY confirmed_order_count DESC,
               external_spend_pence DESC,
               affinity_last_confirmed_at DESC NULLS LAST,
               end_at ASC NULLS LAST,
               campaign_id ASC
    ) AS rrn
  FROM match_pairs
  WHERE NOT already_entered AND via_reveal
),
reveal_campaign_pick AS (
  SELECT user_id, campaign_id AS reveal_campaign_id
  FROM reveal_ranked WHERE rrn = 1
),
-- Closing relevant selector: best relevant, not-entered campaign that is closing.
closing_ranked AS (
  SELECT
    user_id, campaign_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY confirmed_order_count DESC,
               external_spend_pence DESC,
               affinity_last_confirmed_at DESC NULLS LAST,
               end_at ASC NULLS LAST,
               campaign_id ASC
    ) AS rrn
  FROM match_pairs
  WHERE NOT already_entered AND is_closing
),
closing_campaign_pick AS (
  SELECT user_id, campaign_id AS closing_campaign_id
  FROM closing_ranked WHERE rrn = 1
),
-- Base feature row: one per customer. Profile is the population spine (every
-- Auth customer with a marketing profile); intelligence + relevance picks are
-- LEFT JOINed so DETECTION covers the whole population, not just the enriched.
base AS (
  SELECT
    p.user_id,
    -- value / lifecycle
    p.confirmed_order_count,
    p.lifetime_external_pence,
    p.first_confirmed_at,
    p.last_confirmed_at,
    p.account_created_at,
    p.wallet_available_pence,
    -- permission + sendability inputs (reported separately; never filter)
    p.marketing_enabled,
    p.marketing_eligible_snapshot,
    p.has_active_suppression,
    -- intelligence behaviour
    i.orders_30d,
    i.previous_confirmed_at,
    i.average_purchase_gap_hours,
    i.last_win_at,
    i.win_count,
    i.last_win_value_pence,
    i.last_win_campaign_id,
    i.last_wallet_credit_at,
    i.last_abandoned_at,
    i.last_abandoned_campaign_id,
    i.abandoned_7d_count,
    i.abandoned_30d_count,
    -- concrete campaign picks (structured; NULL when none)
    rp.relevant_campaign_id,
    rvp.reveal_campaign_id,
    clp.closing_campaign_id
  FROM public.customer_marketing_profiles p
  LEFT JOIN public.customer_marketing_intelligence i ON i.user_id = p.user_id
  LEFT JOIN rel_campaign_pick     rp  ON rp.user_id  = p.user_id
  LEFT JOIN reveal_campaign_pick  rvp ON rvp.user_id = p.user_id
  LEFT JOIN closing_campaign_pick clp ON clp.user_id = p.user_id
),
-- Derived, bounded features.
feat AS (
  SELECT
    b.*,
    (b.confirmed_order_count >= 10 OR b.lifetime_external_pence >= 25000) AS is_vip,
    (b.confirmed_order_count >= 5)                                        AS is_frequent,
    CASE
      WHEN b.average_purchase_gap_hours IS NOT NULL
       AND b.last_confirmed_at IS NOT NULL
      THEN (extract(epoch FROM (now() - b.last_confirmed_at)) / 3600.0)
           / GREATEST(b.average_purchase_gap_hours, 12.0)
    END AS cadence_ratio
  FROM base b
),
-- Reusable customer-level score components (computed once).
comp AS (
  SELECT
    f.*,
    (CASE WHEN f.is_vip THEN 80
          WHEN f.is_frequent THEN 50
          WHEN f.confirmed_order_count >= 1 THEN 20
          ELSE 0 END)::int AS value_c,
    (CASE
       WHEN f.last_confirmed_at IS NULL THEN 0
       WHEN f.last_confirmed_at >= now() - interval '7 days'  THEN 60
       WHEN f.last_confirmed_at >= now() - interval '30 days' THEN 30
       WHEN f.last_confirmed_at >= now() - interval '90 days' THEN 10
       ELSE 0 END)::int AS recency_c,
    (CASE WHEN f.cadence_ratio IS NOT NULL AND f.cadence_ratio > 1.0
          THEN LEAST(120, GREATEST(0, round((f.cadence_ratio - 1.0) * 80)))
          ELSE 0 END)::int AS cadence_c,
    LEAST(100, GREATEST(0, floor(f.wallet_available_pence / 100.0)))::int AS wallet_c,
    (CASE
       WHEN f.last_win_at IS NULL THEN 0
       WHEN f.last_win_at >= now() - interval '7 days'  THEN 100
       WHEN f.last_win_at >= now() - interval '30 days' THEN 60
       WHEN f.last_win_at >= now() - interval '90 days' THEN 20
       ELSE 0 END)::int AS winner_c,
    (CASE
       WHEN f.last_abandoned_at IS NULL THEN 0
       WHEN f.last_abandoned_at >= now() - interval '2 days' THEN 80
       WHEN f.last_abandoned_at >= now() - interval '7 days' THEN 50
       ELSE 20 END
      + CASE WHEN COALESCE(f.abandoned_30d_count, 0) >= 2 THEN 20 ELSE 0 END)::int AS abandon_c
  FROM feat f
),
-- Per-customer actionable-promotion campaign picks, excluding campaigns the
-- customer already bought, ranked by soonest close then deterministic id.
-- Restricted to the customers who can actually receive them (VIP / frequent).
vip_promo_pick AS (
  SELECT user_id, campaign_id AS vip_promo_campaign_id
  FROM (
    SELECT c.user_id, vpc.campaign_id,
      ROW_NUMBER() OVER (
        PARTITION BY c.user_id
        ORDER BY vpc.end_at ASC NULLS LAST, vpc.campaign_id ASC
      ) AS prn
    FROM comp c
    CROSS JOIN vip_promo_campaigns vpc
    WHERE c.is_vip
      AND NOT EXISTS (
        SELECT 1 FROM bought_campaign bc
        WHERE bc.user_id = c.user_id
          AND bc.campaign_key = lower(vpc.campaign_id::text)
      )
  ) z WHERE prn = 1
),
rb_promo_pick AS (
  SELECT user_id, campaign_id AS rb_promo_campaign_id
  FROM (
    SELECT c.user_id, rpc.campaign_id,
      ROW_NUMBER() OVER (
        PARTITION BY c.user_id
        ORDER BY rpc.end_at ASC NULLS LAST, rpc.campaign_id ASC
      ) AS prn
    FROM comp c
    CROSS JOIN rb_promo_campaigns rpc
    WHERE c.is_frequent
      AND NOT EXISTS (
        SELECT 1 FROM bought_campaign bc
        WHERE bc.user_id = c.user_id
          AND bc.campaign_key = lower(rpc.campaign_id::text)
      )
  ) z WHERE prn = 1
),
-- Merge all concrete campaign picks onto the feature row.
cc AS (
  SELECT
    c.*,
    vpp.vip_promo_campaign_id,
    rbp.rb_promo_campaign_id
  FROM comp c
  LEFT JOIN vip_promo_pick vpp ON vpp.user_id = c.user_id
  LEFT JOIN rb_promo_pick  rbp ON rbp.user_id = c.user_id
),
-- One row per (customer, opportunity) via a fixed VALUES set unnested per
-- customer. Only matched rows survive. campaign_id is a CONCRETE id for every
-- campaign-specific detector (NULL only for non-campaign-specific ones); any
-- campaign-specific detector whose id is NULL is dropped by the invariant below.
raw_candidates AS (
  SELECT
    c.user_id,
    d.opportunity_key,
    d.campaign_id
  FROM cc c
  CROSS JOIN cfg g
  CROSS JOIN LATERAL (VALUES
    -- LIFECYCLE (non-campaign-specific) --------------------------------------
    ('new_account_no_purchase',
      c.confirmed_order_count = 0
      AND c.account_created_at IS NOT NULL
      AND c.account_created_at >= now() - interval '7 days'
      AND c.account_created_at <= now() - make_interval(mins => g.na_delay_minutes),
      NULL::uuid),
    -- (L) first -> second: exactly one order, recently, within 14 days.
    ('first_to_second_purchase',
      c.confirmed_order_count = 1
      AND c.last_confirmed_at IS NOT NULL
      AND c.last_confirmed_at >= now() - interval '14 days', NULL::uuid),
    ('lapsed_7_days',
      c.confirmed_order_count > 0 AND c.last_confirmed_at IS NOT NULL
      AND c.last_confirmed_at <  now() - interval '7 days'
      AND c.last_confirmed_at >= now() - interval '14 days', NULL::uuid),
    ('lapsed_14_days',
      c.confirmed_order_count > 0 AND c.last_confirmed_at IS NOT NULL
      AND c.last_confirmed_at <  now() - interval '14 days'
      AND c.last_confirmed_at >= now() - interval '30 days', NULL::uuid),
    ('lapsed_30_days',
      c.confirmed_order_count > 0 AND c.last_confirmed_at IS NOT NULL
      AND c.last_confirmed_at <  now() - interval '30 days', NULL::uuid),
    ('high_value_customer_at_risk',
      c.is_vip AND c.last_confirmed_at IS NOT NULL
      AND c.last_confirmed_at <  now() - interval '14 days'
      AND c.last_confirmed_at >= now() - interval '45 days', NULL::uuid),
    ('vip_reactivation',
      c.is_vip AND c.last_confirmed_at IS NOT NULL
      AND c.last_confirmed_at < now() - interval '45 days', NULL::uuid),
    ('reactivated_customer_follow_up',
      c.last_confirmed_at IS NOT NULL
      AND c.last_confirmed_at >= now() - interval '7 days'
      AND c.previous_confirmed_at IS NOT NULL
      AND c.last_confirmed_at - c.previous_confirmed_at >= interval '30 days', NULL::uuid),
    -- CADENCE (non-campaign-specific) ----------------------------------------
    ('personal_cadence_overdue',
      c.confirmed_order_count > 0 AND c.cadence_ratio IS NOT NULL
      AND c.cadence_ratio > 1.5, NULL::uuid),
    -- WALLET -----------------------------------------------------------------
    ('wtf_credit_waiting',
      c.wallet_available_pence >= g.wtf_min_wallet_pence, NULL::uuid),
    ('fresh_wallet_credit',
      c.wallet_available_pence > 0 AND c.last_wallet_credit_at IS NOT NULL
      AND c.last_wallet_credit_at >= now() - interval '7 days', NULL::uuid),
    -- (F) spendable credit + an ACTUAL relevant live unbought campaign.
    ('wallet_credit_campaign_match',
      c.wallet_available_pence > 0 AND c.relevant_campaign_id IS NOT NULL,
      c.relevant_campaign_id),
    -- WINNER (positive engagement only) --------------------------------------
    -- (D) campaign-specific winner follow-ups require last_win_campaign_id.
    ('recent_winner_follow_up',
      c.last_win_at IS NOT NULL AND c.last_win_at >= now() - interval '7 days'
      AND c.last_win_campaign_id IS NOT NULL, c.last_win_campaign_id),
    ('recent_winner_credit_available',
      c.last_win_at IS NOT NULL AND c.last_win_at >= now() - interval '30 days'
      AND c.wallet_available_pence > 0
      AND c.last_win_campaign_id IS NOT NULL, c.last_win_campaign_id),
    -- first_win_follow_up stays NON-campaign-specific.
    ('first_win_follow_up',
      c.win_count = 1 AND c.last_win_at IS NOT NULL
      AND c.last_win_at >= now() - interval '14 days', NULL::uuid),
    ('high_value_winner_follow_up',
      c.last_win_at IS NOT NULL AND c.last_win_at >= now() - interval '30 days'
      AND c.last_win_value_pence IS NOT NULL AND c.last_win_value_pence >= 25000
      AND c.last_win_campaign_id IS NOT NULL, c.last_win_campaign_id),
    -- CHECKOUT ---------------------------------------------------------------
    -- (E) abandonment candidates require last_abandoned_campaign_id.
    ('abandoned_checkout',
      COALESCE(c.abandoned_7d_count, 0) >= 1
      AND c.last_abandoned_campaign_id IS NOT NULL, c.last_abandoned_campaign_id),
    ('repeat_abandoner',
      COALESCE(c.abandoned_30d_count, 0) >= 2
      AND c.last_abandoned_campaign_id IS NOT NULL, c.last_abandoned_campaign_id),
    -- AFFINITY / CAMPAIGN (concrete relevant unbought live campaign) ---------
    ('frequent_buyer_relevant_campaign',
      c.is_frequent AND c.relevant_campaign_id IS NOT NULL, c.relevant_campaign_id),
    ('vip_relevant_campaign',
      c.is_vip AND c.relevant_campaign_id IS NOT NULL, c.relevant_campaign_id),
    -- (G) reveal match uses the reveal-only selector.
    ('reveal_affinity_campaign',
      c.reveal_campaign_id IS NOT NULL, c.reveal_campaign_id),
    ('recently_active_no_relevant_entry',
      COALESCE(c.orders_30d, 0) >= 1 AND c.relevant_campaign_id IS NOT NULL,
      c.relevant_campaign_id),
    -- PROMOTION (concrete actionable-promotion campaign) ---------------------
    ('vip_early_access',
      c.is_vip AND c.vip_promo_campaign_id IS NOT NULL, c.vip_promo_campaign_id),
    ('regular_buyer_campaign_alert',
      c.is_frequent AND c.rb_promo_campaign_id IS NOT NULL, c.rb_promo_campaign_id),
    ('campaign_closing_relevant_customer',
      c.closing_campaign_id IS NOT NULL, c.closing_campaign_id),
    ('promotion_match',
      (c.is_vip AND c.vip_promo_campaign_id IS NOT NULL)
      OR (c.is_frequent AND c.rb_promo_campaign_id IS NOT NULL),
      CASE
        WHEN c.is_vip AND c.vip_promo_campaign_id IS NOT NULL THEN c.vip_promo_campaign_id
        WHEN c.is_frequent AND c.rb_promo_campaign_id IS NOT NULL THEN c.rb_promo_campaign_id
        ELSE NULL::uuid
      END)
    -- NOTE: recent_buyer_cross_campaign is DELIBERATELY NOT detected here. It is
    -- campaign-specific but a concrete "another live unbought campaign" cannot be
    -- selected safely from the existing per-customer rollups without a broad
    -- cross join, so per requirement (I) it is reported as UNSUPPORTED rather
    -- than emitting a NULL campaign_id.
  ) AS d(opportunity_key, matched, campaign_id)
  WHERE d.matched
),
-- Attach the authoritative catalogue config (incl. campaign_specific) and carry
-- the component inputs + the candidate's OWN closing status.
scored AS (
  SELECT
    rc.user_id,
    rc.opportunity_key,
    def.family,
    def.default_priority,
    def.default_score,
    def.campaign_specific,
    rc.campaign_id,
    c.is_vip,
    c.value_c,
    c.recency_c,
    (CASE WHEN rc.opportunity_key = 'personal_cadence_overdue' THEN c.cadence_c ELSE 0 END) AS cadence_c,
    (CASE WHEN def.family = 'wallet'
            OR rc.opportunity_key = 'recent_winner_credit_available'
          THEN c.wallet_c ELSE 0 END) AS wallet_c,
    (CASE WHEN def.family = 'winner' THEN c.winner_c ELSE 0 END) AS winner_c,
    (CASE WHEN def.family = 'checkout' THEN c.abandon_c ELSE 0 END) AS abandon_c,
    -- (J) is_closing = THIS candidate's own campaign is closing. Non-campaign
    -- candidate => false. Never a customer-wide flag.
    (rc.campaign_id IS NOT NULL AND COALESCE(cl.is_closing, false)) AS is_closing,
    -- permission split (partition of the population) + sendability (K)
    (c.marketing_enabled AND NOT c.has_active_suppression)                   AS perm_backed,
    c.has_active_suppression                                                  AS perm_suppressed,
    (NOT c.marketing_enabled AND NOT c.has_active_suppression)                AS perm_not_backed,
    (c.marketing_eligible_snapshot AND NOT c.has_active_suppression)          AS sendable_now
  FROM raw_candidates rc
  JOIN cc c ON c.user_id = rc.user_id
  JOIN public.marketing_opportunity_definitions def ON def.opportunity_key = rc.opportunity_key
  LEFT JOIN closing_lu cl ON cl.campaign_id = rc.campaign_id
  -- (C) CAMPAIGN-SPECIFIC INVARIANT, enforced in executable SQL: a
  -- campaign_specific definition can NEVER survive with a NULL campaign_id.
  WHERE NOT (def.campaign_specific AND rc.campaign_id IS NULL)
),
final AS (
  SELECT
    s.*,
    -- affinity_c: ONLY genuine STRUCTURED campaign affinity/relevance. Awarded
    -- (flat 60) exclusively to opportunity types whose selected campaign came
    -- from the customer_campaign_affinity matching path (relevant_campaign_id /
    -- reveal_campaign_id / closing_campaign_id ranked by structured affinity
    -- strength). Promotion-config-only types (vip_early_access,
    -- regular_buyer_campaign_alert, promotion_match) carry a campaign_id from
    -- explicit marketing_campaign_promotions configuration, NOT from customer
    -- affinity, so they earn NOTHING here. VIP is NOT counted here at all — it is
    -- already represented once in value_c (VIP = 80); adding it again would
    -- double-count the same feature. Bounded to exactly 0 or 60 for this stage.
    (CASE
       WHEN s.opportunity_key IN (
         'wallet_credit_campaign_match',
         'frequent_buyer_relevant_campaign',
         'vip_relevant_campaign',
         'reveal_affinity_campaign',
         'recently_active_no_relevant_entry',
         'campaign_closing_relevant_customer'
       ) AND s.campaign_id IS NOT NULL THEN 60
       ELSE 0
     END)::int AS affinity_c,
    -- urgency_c: only a candidate whose OWN campaign is closing earns urgency.
    (CASE WHEN s.is_closing THEN 100 ELSE 0 END)::int AS urgency_c
  FROM scored s
),
final2 AS (
  SELECT
    f.*,
    LEAST(1000, GREATEST(0,
      round(f.default_score)::int
      + f.value_c + f.recency_c + f.cadence_c + f.wallet_c
      + f.winner_c + f.affinity_c + f.urgency_c + f.abandon_c
    ))::int AS final_score
  FROM final f
)
SELECT
  f.user_id,
  f.opportunity_key,
  f.family,
  f.default_priority,
  f.default_score,
  f.campaign_id,
  f.final_score,
  jsonb_build_object(
    'base',     round(f.default_score)::int,
    'value',    f.value_c,
    'recency',  f.recency_c,
    'cadence',  f.cadence_c,
    'wallet',   f.wallet_c,
    'winner',   f.winner_c,
    'affinity', f.affinity_c,
    'urgency',  f.urgency_c,
    'abandon',  f.abandon_c,
    'final',    f.final_score
  ) AS score_components,
  f.is_closing,
  f.perm_backed,
  f.perm_suppressed,
  f.perm_not_backed,
  f.sendable_now,
  -- NEXT-BEST-ACTION arbitration (deterministic, set-based). Ordering:
  --   1) lower default_priority first  (catalogue-authoritative rank)
  --   2) higher final_score
  --   3) this candidate's campaign closing first
  --   4) opportunity_key ascending (stable deterministic tie-break)
  ROW_NUMBER() OVER (
    PARTITION BY f.user_id
    ORDER BY f.default_priority ASC,
             f.final_score DESC,
             f.is_closing DESC,
             f.opportunity_key ASC
  )::int AS rn
FROM final2 f
$$;

COMMENT ON FUNCTION public.wtf_marketing_opportunity_candidates_preview() IS
  'Stage 3C2D PRIVATE read-only candidate model. One row per (user_id, opportunity_key) detected from the profile/intelligence/affinity rollups + campaign/promotion/automation config, with transparent 0-1000 score components and a deterministic per-customer next-best-action rank (rn=1 is the preview winner). Every campaign_specific candidate carries a concrete campaign_id (winner=last_win_campaign_id, abandonment=last_abandoned_campaign_id, affinity=ranked relevant unbought live campaign, promotion=actionable-promotion campaign) or is dropped. Writes NOTHING. Owner-only: EXECUTE granted to nobody; reached only via the two top-level preview RPCs.';

-- Owner-only: strip EXECUTE from everyone (incl. service_role). It is called
-- only inside the two SECURITY DEFINER RPCs below, under the same owner.
REVOKE ALL ON FUNCTION public.wtf_marketing_opportunity_candidates_preview() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.wtf_marketing_opportunity_candidates_preview() FROM service_role;

-- ============================================================================
-- 2. MAIN OVERVIEW RPC (aggregate only — NO identities)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_admin_marketing_opportunity_detection_preview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '10s'
AS $$
DECLARE
  v_now      timestamptz := now();
  v_profiles bigint;
  v_result   jsonb;
BEGIN
  SELECT count(*)::bigint INTO v_profiles FROM public.customer_marketing_profiles;

  WITH cand AS (
    SELECT * FROM public.wtf_marketing_opportunity_candidates_preview()
  ),
  per_customer AS (
    SELECT user_id, count(*)::int AS n
    FROM cand
    GROUP BY user_id
  ),
  winners AS (
    SELECT * FROM cand WHERE rn = 1
  )
  SELECT jsonb_build_object(
    'generatedAt', v_now,

    'population', jsonb_build_object(
      'profiles',              v_profiles,
      'detectedCustomers',     (SELECT count(*)::bigint FROM per_customer),
      'detectedCandidates',    (SELECT count(*)::bigint FROM cand),
      'noOpportunityCustomers',(v_profiles - (SELECT count(*)::bigint FROM per_customer))
    ),

    'overlap', jsonb_build_object(
      'one',              (SELECT count(*)::bigint FROM per_customer WHERE n = 1),
      'two',              (SELECT count(*)::bigint FROM per_customer WHERE n = 2),
      'threePlus',        (SELECT count(*)::bigint FROM per_customer WHERE n >= 3),
      'maxForOneCustomer',(SELECT COALESCE(max(n), 0)::int FROM per_customer),
      'totalCandidates',  (SELECT count(*)::bigint FROM cand),
      'uniqueCustomers',  (SELECT count(*)::bigint FROM per_customer)
    ),

    -- Permission + sendability partition of the WINNING candidates (K). None of
    -- these filter detection; they only describe who a winner could reach.
    'permission', jsonb_build_object(
      'winningPermissionBacked',    (SELECT count(*)::bigint FROM winners WHERE perm_backed),
      'winningNotPermissionBacked', (SELECT count(*)::bigint FROM winners WHERE perm_not_backed),
      'winningSuppressed',          (SELECT count(*)::bigint FROM winners WHERE perm_suppressed),
      'winningSendableNow',         (SELECT count(*)::bigint FROM winners WHERE sendable_now)
    ),

    'countByOpportunityType', COALESCE(
      (SELECT jsonb_object_agg(opportunity_key, cnt)
         FROM (SELECT opportunity_key, count(*)::bigint AS cnt
                 FROM cand GROUP BY opportunity_key) x),
      '{}'::jsonb),

    'winningCountByOpportunityType', COALESCE(
      (SELECT jsonb_object_agg(opportunity_key, cnt)
         FROM (SELECT opportunity_key, count(*)::bigint AS cnt
                 FROM winners GROUP BY opportunity_key) x),
      '{}'::jsonb),

    'families', jsonb_build_object(
      'detectedByFamily', COALESCE(
        (SELECT jsonb_object_agg(family, cnt)
           FROM (SELECT family, count(*)::bigint AS cnt
                   FROM cand GROUP BY family) x), '{}'::jsonb),
      'winningByFamily', COALESCE(
        (SELECT jsonb_object_agg(family, cnt)
           FROM (SELECT family, count(*)::bigint AS cnt
                   FROM winners GROUP BY family) x), '{}'::jsonb)
    ),

    -- Static detector-support matrix (which catalogue rows are actually
    -- implemented from current structured data, vs campaign-gated, vs
    -- unsupported). Declared explicitly — never pretends unsupported rows work.
    'support', jsonb_build_object(
      'supportedNow', jsonb_build_array(
        'new_account_no_purchase','first_to_second_purchase','lapsed_7_days',
        'lapsed_14_days','lapsed_30_days','high_value_customer_at_risk',
        'vip_reactivation','reactivated_customer_follow_up','personal_cadence_overdue',
        'wtf_credit_waiting','fresh_wallet_credit','first_win_follow_up'
      ),
      'requiresCampaignContext', jsonb_build_array(
        'recent_winner_follow_up','recent_winner_credit_available',
        'high_value_winner_follow_up','abandoned_checkout','repeat_abandoner',
        'wallet_credit_campaign_match','frequent_buyer_relevant_campaign',
        'vip_relevant_campaign','reveal_affinity_campaign',
        'recently_active_no_relevant_entry','vip_early_access',
        'regular_buyer_campaign_alert','campaign_closing_relevant_customer',
        'promotion_match'
      ),
      'futureUnsupported', jsonb_build_array(
        'high_value_abandoned_checkout','recent_buyer_cross_campaign'
      )
    ),

    'notes', jsonb_build_object(
      'detectionIsNotSendEligibility', true,
      'permissionReportedSeparately', true,
      'sendabilityReportedSeparately', true,
      'substrate', 'customer_marketing_profiles + customer_marketing_intelligence + customer_campaign_affinity + campaigns/promotions/automations config',
      'operationalHistoryScanned', false,
      'liveCampaignDefinition', 'status = live AND (end_at IS NULL OR end_at > now())',
      'actionablePromotionDefinition', 'promotion status scheduled/processing on a still-live campaign',
      'campaignSpecificInvariant', 'a campaign_specific definition can never survive with a NULL campaign_id',
      'winnerCampaignContext', 'last_win_campaign_id',
      'abandonmentCampaignContext', 'last_abandoned_campaign_id',
      'campaignSelectionOrdering', 'confirmed_order_count DESC, external_spend_pence DESC, last_confirmed_at DESC NULLS LAST, end_at ASC NULLS LAST, campaign_id ASC (never MIN(uuid))',
      'closingIsCandidateSpecific', true,
      'highValueAbandonedCheckoutUnsupportedReason', 'intelligence rollup carries no per-customer abandoned-checkout monetary value; computing it would require an unsafe broad checkout_intents scan',
      'recentBuyerCrossCampaignUnsupportedReason', 'a concrete another-live-unbought campaign_id cannot be selected safely from existing per-customer rollups without a broad cross join; reported unsupported rather than emitting a NULL campaign_id',
      'cadenceMinimumGapFloorHours', 12,
      'cadenceOverdueRatioThreshold', 1.5,
      'campaignClosingWindowHours', 48,
      'vipDefinition', 'confirmed_order_count >= 10 OR lifetime_external_pence >= 25000',
      'frequentBuyerDefinition', 'confirmed_order_count >= 5',
      'firstToSecondWindowDays', 14,
      'highValueWinValuePence', 25000,
      'promotionStatusesCounted', jsonb_build_array('scheduled','processing')
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_admin_marketing_opportunity_detection_preview() IS
  'Stage 3C2D READ-ONLY opportunity detection + next-best-action arbitration preview. Returns ONE aggregate jsonb (population, overlap, permission + sendability split, count/winning by type + family, and the detector-support matrix). No identities, no rows, no writes, no AI/cron/email. Service-role only.';

REVOKE ALL ON FUNCTION public.get_admin_marketing_opportunity_detection_preview() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_marketing_opportunity_detection_preview() TO service_role;

-- ============================================================================
-- 3. SAMPLE / INSPECTION RPC (bounded, anonymised winning decisions)
--    Returns at most 100 winning (rn=1) decisions with an OPAQUE user hash
--    (never the raw user_id, never email/name/checkout rows), for admin
--    inspection of WHY something ranked.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_admin_marketing_opportunity_preview_sample(p_limit integer DEFAULT 25)
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
  WITH winners AS (
    SELECT *
    FROM public.wtf_marketing_opportunity_candidates_preview()
    WHERE rn = 1
    -- deterministic, non-identifying ordering for a stable sample
    ORDER BY final_score DESC, default_priority ASC, opportunity_key ASC
    LIMIT v_limit
  )
  SELECT jsonb_build_object(
    'generatedAt', now(),
    'limit',       v_limit,
    'count',       (SELECT count(*)::int FROM winners),
    'sample', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        -- opaque short identifier only; NOT the raw user_id, NOT email/name.
        'userHash',         substr(md5(user_id::text), 1, 12),
        'opportunityKey',   opportunity_key,
        'family',           family,
        'campaignId',       campaign_id,
        'score',            final_score,
        'defaultPriority',  default_priority,
        'scoreComponents',  score_components,
        'reasons', jsonb_build_object(
          'isClosingCampaign',  is_closing,
          'permissionBacked',   perm_backed,
          'suppressed',         perm_suppressed,
          'notPermissionBacked',perm_not_backed,
          'sendableNow',        sendable_now
        )
      ) ORDER BY final_score DESC, default_priority ASC, opportunity_key ASC)
       FROM winners),
      '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_admin_marketing_opportunity_preview_sample(integer) IS
  'Stage 3C2D READ-ONLY bounded (<=100) anonymised sample of winning next-best-action decisions. Returns an opaque userHash (never raw user_id/email/name), opportunity_key, family, campaign_id, score, default_priority, score components, and compact reason/permission/sendability flags. Writes NOTHING. Service-role only.';

REVOKE ALL ON FUNCTION public.get_admin_marketing_opportunity_preview_sample(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_marketing_opportunity_preview_sample(integer) TO service_role;

COMMIT;

-- ============================================================================
-- End of Stage 3C2D detection + arbitration preview.
--   * One PRIVATE set-based candidate model + two service-role-only read RPCs.
--   * NO writes anywhere; marketing_opportunities remains at 0 rows.
--   * NO definition enabled; marketing_control_state only READ (pause assert).
--   * NO recipients, runs, AI, cron, email, sending, discovery, rollout change.
--   * NO ALTER of any existing table, NO migration 001-010 modified.
--   * Detection substrate is the profile/intelligence/affinity rollups + tiny
--     campaign/promotion/automation config only; NO broad operational scan.
--   * Every campaign_specific candidate carries a concrete campaign_id or is
--     dropped; is_closing is candidate-specific; permission & sendability are
--     reported separately and never filter detection.
-- ============================================================================
