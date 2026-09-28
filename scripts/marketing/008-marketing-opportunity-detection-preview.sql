-- ============================================================================
-- WTF Marketing Hub — Stage 3C2: opportunity DETECTION PREVIEW (READ-ONLY)
-- ----------------------------------------------------------------------------
-- PURPOSE
--   Install ONE read-only, service-role-only RPC that reports what the FUTURE
--   Opportunity Engine WOULD detect across the live customer intelligence base,
--   WITHOUT creating a single marketing_opportunities row. This is a planning /
--   simulation tool only.
--
--   It answers, per commercial opportunity type:
--     * MATCHED       — customers whose BEHAVIOUR satisfies the rule
--                       (marketing permission is NOT part of matching), and
--     * CURRENTLY SENDABLE — the subset of matched customers currently eligible
--                       to receive marketing (fast snapshot metric).
--   Plus cross-detector OVERLAP analysis and a deterministic PRIORITY winner
--   simulation, to prove why central arbitration is required instead of six
--   independent bots.
--
-- WHAT THIS STAGE DOES NOT DO (hard guarantees)
--   * NO persistence: inserts/updates NOTHING. marketing_opportunities stays 0.
--   * NO recipients, NO automation runs, NO selection/arbitration writes.
--   * NO AI, NO cron, NO email/Resend, NO sending, NO discovery.
--   * Does NOT change marketing_control_state, preferences, suppressions,
--     profiles, checkout_intents or campaigns.
--   * Does NOT modify migrations 001-007.
--   * Does NOT touch checkout / payment / ticket / wallet / customer-facing code.
--
-- ARCHITECTURAL RULES honoured
--   * marketing_eligible_snapshot is used ONLY as a fast aggregate "currently
--     sendable" metric (exactly as Stage 2 does). It is NOT authoritative for
--     sending: the future send worker MUST re-check
--     public.is_marketing_email_eligible(user_id, email_lc) immediately before
--     sending. This preview deliberately does NOT call that per-row function
--     (that would be an N+1 pattern); it relies on the pre-computed snapshot.
--   * checkout_intents is read ONLY for (a) bounded recent abandoned-checkout
--     detection (<= 48h window) and (b) campaign-purchase exclusion for
--     explicitly configured campaign promotions. When no promotion is
--     configured, that second read touches zero rows (empty driving set).
--   * Everything is set-based (CTEs + conditional aggregates). No loops, no temp
--     tables, no dynamic SQL, no SELECT *, no raw customer rows returned.
--
-- CANONICAL DEFINITIONS reused (do NOT diverge):
--   Eligible confirmed order:
--       state = 'confirmed'
--       AND provider IS DISTINCT FROM 'debug'
--       AND (ref IS NULL OR ref NOT LIKE 'SIM-%')
--   Frequent buyer (Stage 2 'frequent_buyers'):    confirmed_order_count >= 5
--   VIP buyer      (Stage 2 'vip_buyers'):          confirmed_order_count >= 10
--                                                   OR lifetime_external_pence >= 25000
--   New account    (Stage 2 'new_accounts_without_purchase'):
--                                                   account_created_at >= now()-7d
--                                                   AND confirmed_order_count = 0
--   Lapsed 14      (Stage 2 'lapsed_14_days'):      confirmed_order_count > 0
--                                                   AND last_confirmed_at < now()-14d
--
-- HOW TO RUN
--   The application NEVER executes this. Run it manually ONCE in the Supabase
--   SQL editor (or psql), AFTER migrations 001-007. Re-running is a no-op
--   (CREATE OR REPLACE FUNCTION only).
-- ============================================================================

BEGIN;

-- Fail fast rather than block on a busy production database; LOCAL only.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ----------------------------------------------------------------------------
-- Preflight (read-only): dependency + function existence check, single-execution
-- advisory lock, and global-pause assertion. This preview is a PRE-LAUNCH
-- planning tool, so it refuses to install unless the hub is still fully paused.
-- Nothing here writes; to_regclass / to_regprocedure are pure lookups.
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_missing text[] := ARRAY[]::text[];
  v_dep     text;
  v_sending   boolean;
  v_discovery boolean;
  v_rollout   integer;
BEGIN
  FOREACH v_dep IN ARRAY ARRAY[
    'public.campaigns',
    'public.checkout_intents',
    'public.customer_marketing_profiles',
    'public.marketing_automations',
    'public.marketing_campaign_promotions',
    'public.marketing_control_state',
    'public.marketing_external_contacts',
    'public.marketing_preferences',
    'public.marketing_suppressions',
    'public.marketing_opportunities'
  ] LOOP
    IF to_regclass(v_dep) IS NULL THEN
      v_missing := array_append(v_missing, v_dep);
    END IF;
  END LOOP;

  IF to_regprocedure('public.is_marketing_email_eligible(uuid, text)') IS NULL THEN
    v_missing := array_append(v_missing, 'public.is_marketing_email_eligible(uuid, text)');
  END IF;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'Stage 3C2 preview aborted: required dependency % is missing. Run migrations 001-007 first.',
      array_to_string(v_missing, ', ');
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_stage_3c2_detection_preview')) THEN
    RAISE EXCEPTION
      'Stage 3C2 preview aborted: another execution is already in progress (advisory lock held).';
  END IF;

  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state
   WHERE key = 'default';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Stage 3C2 preview aborted: marketing_control_state singleton (key=''default'') not found; cannot confirm Marketing is paused.';
  END IF;

  IF v_sending IS DISTINCT FROM false
     OR v_discovery IS DISTINCT FROM false
     OR v_rollout   IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'Stage 3C2 preview aborted: Marketing is not globally paused (sending_enabled=%, discovery_enabled=%, rollout_limit=%). Refusing to install a detection preview once live.',
      v_sending, v_discovery, v_rollout;
  END IF;
END
$preflight$;

-- ============================================================================
-- get_admin_marketing_opportunity_detection_preview
--   Single read-only aggregate simulation. No arguments. Returns one jsonb.
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
  v_now             timestamptz := now();
  -- Rolling behavioural thresholds (fixed offsets from now()).
  v_14d             timestamptz := v_now - interval '14 days';
  v_new_window_from timestamptz := v_now - interval '7 days';        -- canonical new-account window
  v_abandoned_from  timestamptz := v_now - interval '48 hours';      -- hard bounded recent window

  -- Automation-driven config (fall back to seeded values if a row is missing).
  v_ac_first_delay  integer;    -- abandoned_checkout.first_delay_minutes  (seed 45)
  v_na_first_delay  integer;    -- new_account_no_purchase.first_delay_minutes (seed 1440)
  v_wtf_min_wallet  bigint;     -- wtf_credit_waiting.minimum_wallet_pence  (seed 1)

  v_ac_cutoff       timestamptz;  -- checkout must be older than this (>= first delay)
  v_na_cutoff       timestamptz;  -- account must be older than this (>= first delay)

  v_vip_promos      bigint;     -- qualifying configured VIP promotions
  v_rb_promos       bigint;     -- qualifying configured regular-buyer promotions

  v_result          jsonb;
BEGIN
  ------------------------------------------------------------------
  -- Automation config (single read of the tiny automations table).
  ------------------------------------------------------------------
  SELECT
    COALESCE(max(first_delay_minutes)  FILTER (WHERE automation_key = 'abandoned_checkout'),      45),
    COALESCE(max(first_delay_minutes)  FILTER (WHERE automation_key = 'new_account_no_purchase'), 1440),
    COALESCE(max(minimum_wallet_pence) FILTER (WHERE automation_key = 'wtf_credit_waiting'),      1)
  INTO v_ac_first_delay, v_na_first_delay, v_wtf_min_wallet
  FROM public.marketing_automations;

  v_ac_cutoff := v_now - make_interval(mins => v_ac_first_delay);
  v_na_cutoff := v_now - make_interval(mins => v_na_first_delay);

  ------------------------------------------------------------------
  -- Qualifying configured promotions (status scheduled/processing).
  -- These GATE the two promotion-driven detectors. Zero => zero matches,
  -- and (critically) no checkout scan for regular-buyer exclusion.
  ------------------------------------------------------------------
  SELECT count(*) INTO v_vip_promos
    FROM public.marketing_campaign_promotions
   WHERE promotion_type = 'vip_early_access'
     AND status IN ('scheduled', 'processing');

  SELECT count(*) INTO v_rb_promos
    FROM public.marketing_campaign_promotions
   WHERE promotion_type = 'regular_buyer_campaign_alert'
     AND status IN ('scheduled', 'processing');

  ------------------------------------------------------------------
  -- One set-based statement computes every detector, overlap and winner.
  ------------------------------------------------------------------
  WITH
  -- Configured regular-buyer promotion campaigns (drives the bounded checkout
  -- read below; empty when none configured -> no scan).
  rb_promo_campaigns AS (
    SELECT DISTINCT campaign_id
      FROM public.marketing_campaign_promotions
     WHERE promotion_type = 'regular_buyer_campaign_alert'
       AND status IN ('scheduled', 'processing')
  ),

  -- === Abandoned checkout: the ONLY checkout_intents read for detection. =====
  -- Strictly bounded recent window [now-48h, now-first_delay], not confirmed,
  -- not debug, not SIM/test, with a real user identity. Uses
  -- idx_checkout_intents_created_at.
  abandoned_window AS (
    SELECT ci.user_id, ci.campaign_id, ci.created_at
      FROM public.checkout_intents ci
     WHERE ci.created_at >= v_abandoned_from
       AND ci.created_at <= v_ac_cutoff
       AND ci.state IS DISTINCT FROM 'confirmed'
       AND ci.provider IS DISTINCT FROM 'debug'
       AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
       AND ci.user_id IS NOT NULL
  ),
  -- Exclude an abandoned checkout when the SAME customer later CONFIRMED the
  -- SAME campaign (set-based anti-join, not a per-customer loop).
  abandoned_no_conversion AS (
    SELECT aw.user_id
      FROM abandoned_window aw
     WHERE NOT EXISTS (
       SELECT 1
         FROM public.checkout_intents c
        WHERE c.user_id = aw.user_id
          AND c.campaign_id = aw.campaign_id
          AND c.state = 'confirmed'
          AND c.provider IS DISTINCT FROM 'debug'
          AND (c.ref IS NULL OR c.ref NOT LIKE 'SIM-%')
          AND c.confirmed_at >= aw.created_at
     )
  ),
  abandoned_users AS (   -- deduplicate by customer
    SELECT DISTINCT user_id FROM abandoned_no_conversion
  ),

  -- === Regular buyer: purchases of CONFIGURED promotion campaigns only. ======
  -- Bounded by the JOIN to rb_promo_campaigns: empty set => zero checkout rows.
  rb_purchasers AS (
    SELECT DISTINCT c.user_id, c.campaign_id
      FROM public.checkout_intents c
      JOIN rb_promo_campaigns rc ON rc.campaign_id = c.campaign_id
     WHERE c.state = 'confirmed'
       AND c.provider IS DISTINCT FROM 'debug'
       AND (c.ref IS NULL OR c.ref NOT LIKE 'SIM-%')
       AND c.user_id IS NOT NULL
  ),
  frequent_buyers AS (
    SELECT p.user_id, p.marketing_eligible_snapshot AS eligible
      FROM public.customer_marketing_profiles p
     WHERE p.confirmed_order_count >= 5
  ),
  -- Every (frequent buyer x configured campaign) pair, flagged if already bought.
  rb_pairs AS (
    SELECT fb.user_id,
           fb.eligible,
           (pur.user_id IS NOT NULL) AS already_purchased
      FROM frequent_buyers fb
      CROSS JOIN rb_promo_campaigns rc
      LEFT JOIN rb_purchasers pur
        ON pur.user_id = fb.user_id AND pur.campaign_id = rc.campaign_id
  ),
  -- Frequent buyers who have NOT purchased at least one configured campaign.
  rb_candidate_users AS (
    SELECT DISTINCT user_id, eligible
      FROM rb_pairs
     WHERE already_purchased = false
  ),

  -- === Per-customer opportunity flags over the profile base. ================
  flags AS (
    SELECT
      p.user_id,
      p.marketing_eligible_snapshot AS eligible,
      p.wallet_available_pence      AS wallet_pence,
      -- 1) VIP early access (behaviour) — gated by a configured VIP promotion.
      (v_vip_promos > 0
        AND (p.confirmed_order_count >= 10 OR p.lifetime_external_pence >= 25000)) AS f_vip,
      -- 2) Abandoned checkout (profile users present in the bounded set).
      (au.user_id IS NOT NULL) AS f_abandoned,
      -- 3) WTF credit waiting.
      (p.wallet_available_pence >= v_wtf_min_wallet) AS f_wtf,
      -- 4) Regular buyer campaign alert — gated by configured promotion +
      --    already-purchased exclusion (rb_candidate_users empty otherwise).
      (rc.user_id IS NOT NULL) AS f_rb,
      -- 5) New account, no purchase (older than first delay, within 7d window).
      (p.confirmed_order_count = 0
        AND p.account_created_at IS NOT NULL
        AND p.account_created_at <= v_na_cutoff
        AND p.account_created_at >= v_new_window_from) AS f_new,
      -- 6) Lapsed 14 days.
      (p.confirmed_order_count > 0
        AND p.last_confirmed_at IS NOT NULL
        AND p.last_confirmed_at < v_14d) AS f_lapsed
    FROM public.customer_marketing_profiles p
    LEFT JOIN abandoned_users au      ON au.user_id = p.user_id
    LEFT JOIN rb_candidate_users rc   ON rc.user_id = p.user_id
  ),
  flag_counts AS (
    SELECT
      f.*,
      (f.f_vip::int + f.f_abandoned::int + f.f_wtf::int
        + f.f_rb::int + f.f_new::int + f.f_lapsed::int) AS match_count
    FROM flags f
  ),

  -- === Deterministic winner per customer, using marketing_automations.priority.
  -- (LATERAL over a fixed 6-row set joined to the 6-row automations table; the
  -- lowest priority wins. This is NOT a checkout scan and NOT a procedural loop.)
  winners AS (
    SELECT fc.user_id, w.win_type
      FROM flag_counts fc
      CROSS JOIN LATERAL (
        SELECT f.key AS win_type
          FROM (VALUES
            ('vip_early_access',             fc.f_vip),
            ('abandoned_checkout',           fc.f_abandoned),
            ('wtf_credit_waiting',           fc.f_wtf),
            ('regular_buyer_campaign_alert', fc.f_rb),
            ('new_account_no_purchase',      fc.f_new),
            ('lapsed_14_days',               fc.f_lapsed)
          ) AS f(key, matched)
          JOIN public.marketing_automations a ON a.automation_key = f.key
         WHERE f.matched
         ORDER BY a.priority ASC
         LIMIT 1
      ) w
     WHERE fc.match_count > 0
  ),
  winner_counts AS (
    SELECT win_type, count(*)::bigint AS cnt
      FROM winners
     GROUP BY win_type
  ),

  -- === Population + external contacts. ======================================
  population AS (
    SELECT
      count(*)::bigint                                          AS total_profiles,
      count(*) FILTER (WHERE marketing_enabled)::bigint         AS marketing_enabled,
      count(*) FILTER (WHERE marketing_eligible_snapshot)::bigint AS currently_eligible
    FROM public.customer_marketing_profiles
  ),
  ext AS (
    SELECT count(*) FILTER (WHERE marketing_enabled)::bigint    AS enabled_external
    FROM public.marketing_external_contacts
  ),

  -- === Detector + overlap aggregates (single pass over flag_counts). ========
  detector_agg AS (
    SELECT
      -- VIP (behaviour, gated).
      count(*) FILTER (WHERE f_vip)::bigint                           AS vip_matched,
      count(*) FILTER (WHERE f_vip AND eligible)::bigint              AS vip_sendable,
      -- WTF credit.
      count(*) FILTER (WHERE f_wtf)::bigint                           AS wtf_matched,
      count(*) FILTER (WHERE f_wtf AND eligible)::bigint              AS wtf_sendable,
      COALESCE(SUM(wallet_pence) FILTER (WHERE f_wtf), 0)::bigint             AS wtf_total_pence,
      COALESCE(SUM(wallet_pence) FILTER (WHERE f_wtf AND eligible), 0)::bigint AS wtf_sendable_pence,
      -- Regular buyer (profile-based, gated + exclusion applied).
      count(*) FILTER (WHERE f_rb)::bigint                            AS rb_matched,
      count(*) FILTER (WHERE f_rb AND eligible)::bigint               AS rb_sendable,
      -- New account.
      count(*) FILTER (WHERE f_new)::bigint                           AS new_matched,
      count(*) FILTER (WHERE f_new AND eligible)::bigint              AS new_sendable,
      -- Lapsed 14.
      count(*) FILTER (WHERE f_lapsed)::bigint                        AS lapsed_matched,
      count(*) FILTER (WHERE f_lapsed AND eligible)::bigint           AS lapsed_sendable,
      -- Overlap.
      count(*) FILTER (WHERE match_count > 0)::bigint                 AS any_matched,
      count(*) FILTER (WHERE match_count > 0 AND eligible)::bigint    AS any_sendable,
      COALESCE(SUM(match_count), 0)::bigint                          AS total_matches,
      count(*) FILTER (WHERE match_count > 1)::bigint                 AS multi_matched,
      COALESCE(MAX(match_count), 0)::int                             AS max_matched,
      count(*) FILTER (WHERE match_count = 0)::bigint                 AS dist0,
      count(*) FILTER (WHERE match_count = 1)::bigint                 AS dist1,
      count(*) FILTER (WHERE match_count = 2)::bigint                 AS dist2,
      count(*) FILTER (WHERE match_count = 3)::bigint                 AS dist3,
      count(*) FILTER (WHERE match_count = 4)::bigint                 AS dist4,
      count(*) FILTER (WHERE match_count = 5)::bigint                 AS dist5,
      count(*) FILTER (WHERE match_count = 6)::bigint                 AS dist6
    FROM flag_counts
  ),

  -- Abandoned detector counts come from the checkout-derived set directly (may
  -- include users without a profile row); sendability requires an eligible
  -- profile. recentCheckoutRowsScanned = bounded candidate rows in the window.
  abandoned_agg AS (
    SELECT
      (SELECT count(*)::bigint FROM abandoned_users)                 AS matched,
      (SELECT count(*)::bigint
         FROM abandoned_users au
         JOIN public.customer_marketing_profiles p ON p.user_id = au.user_id
        WHERE p.marketing_eligible_snapshot)                         AS sendable,
      (SELECT count(*)::bigint FROM abandoned_window)                AS scanned
  ),
  -- Regular-buyer (frequent buyer x configured campaign) pairs excluded because
  -- the customer already purchased that campaign.
  rb_excluded_agg AS (
    SELECT count(*)::bigint AS excluded
      FROM rb_pairs
     WHERE already_purchased = true
  )

  SELECT jsonb_build_object(
    'generatedAt', v_now,

    'config', jsonb_build_object(
      'abandonedFirstDelayMinutes', v_ac_first_delay,
      'newAccountFirstDelayMinutes', v_na_first_delay,
      'wtfMinimumWalletPence', v_wtf_min_wallet,
      'abandonedWindowHours', 48,
      'promotionStatusesCounted', jsonb_build_array('scheduled', 'processing'),
      'eligibilityMetric', 'marketing_eligible_snapshot (fast count only; send-time gate remains is_marketing_email_eligible)'
    ),

    'population', jsonb_build_object(
      'totalCustomerProfiles',              pop.total_profiles,
      'marketingEnabledProfiles',           pop.marketing_enabled,
      'currentlyEligibleProfiles',          pop.currently_eligible,
      'enabledExternalContacts',            e.enabled_external,
      -- External contacts have no behavioural customer profile in the current
      -- schema, so every enabled external contact is unscored by definition.
      'externalContactsNotBehaviourScored', e.enabled_external
    ),

    'opportunities', jsonb_build_object(
      'vip_early_access', jsonb_build_object(
        'configuredPromotions', v_vip_promos,
        'matched',              d.vip_matched,
        'currentlySendable',    d.vip_sendable
      ),
      'abandoned_checkout', jsonb_build_object(
        'matched',                  ab.matched,
        'currentlySendable',        ab.sendable,
        'recentCheckoutRowsScanned', ab.scanned
      ),
      'wtf_credit_waiting', jsonb_build_object(
        'matched',                d.wtf_matched,
        'currentlySendable',      d.wtf_sendable,
        'totalMatchedWalletPence', d.wtf_total_pence,
        'sendableWalletPence',    d.wtf_sendable_pence
      ),
      'regular_buyer_campaign_alert', jsonb_build_object(
        'configuredPromotions',    v_rb_promos,
        'matched',                 d.rb_matched,
        'currentlySendable',       d.rb_sendable,
        'alreadyPurchasedExcluded', rbx.excluded
      ),
      'new_account_no_purchase', jsonb_build_object(
        'matched',           d.new_matched,
        'currentlySendable', d.new_sendable
      ),
      'lapsed_14_days', jsonb_build_object(
        'matched',           d.lapsed_matched,
        'currentlySendable', d.lapsed_sendable
      )
    ),

    'overlap', jsonb_build_object(
      'uniqueCustomersMatchingAnyOpportunity',         d.any_matched,
      'uniqueCurrentlySendableMatchingAnyOpportunity', d.any_sendable,
      'totalOpportunityMatches',                       d.total_matches,
      'customersMatchingMoreThanOneOpportunity',       d.multi_matched,
      'maximumOpportunitiesMatchedByOneCustomer',      d.max_matched,
      'opportunityMatchDistribution', jsonb_build_object(
        '0', d.dist0, '1', d.dist1, '2', d.dist2, '3', d.dist3,
        '4', d.dist4, '5', d.dist5, '6', d.dist6
      )
    ),

    'wouldWinByType', jsonb_build_object(
      'vip_early_access',             (SELECT COALESCE(SUM(cnt), 0)::bigint FROM winner_counts WHERE win_type = 'vip_early_access'),
      'abandoned_checkout',           (SELECT COALESCE(SUM(cnt), 0)::bigint FROM winner_counts WHERE win_type = 'abandoned_checkout'),
      'wtf_credit_waiting',           (SELECT COALESCE(SUM(cnt), 0)::bigint FROM winner_counts WHERE win_type = 'wtf_credit_waiting'),
      'regular_buyer_campaign_alert', (SELECT COALESCE(SUM(cnt), 0)::bigint FROM winner_counts WHERE win_type = 'regular_buyer_campaign_alert'),
      'new_account_no_purchase',      (SELECT COALESCE(SUM(cnt), 0)::bigint FROM winner_counts WHERE win_type = 'new_account_no_purchase'),
      'lapsed_14_days',               (SELECT COALESCE(SUM(cnt), 0)::bigint FROM winner_counts WHERE win_type = 'lapsed_14_days')
    )
  )
  INTO v_result
  FROM population pop, ext e, detector_agg d, abandoned_agg ab, rb_excluded_agg rbx;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_admin_marketing_opportunity_detection_preview() IS
  'Stage 3C2 READ-ONLY opportunity detection preview. Simulates what the future Opportunity Engine WOULD detect (matched vs currently-sendable), cross-detector overlap, and deterministic priority winner, as one aggregate jsonb. Inserts/updates NOTHING (marketing_opportunities stays 0). No identities, no rows, no AI, no cron, no sending. checkout_intents read only for bounded abandoned detection + configured-promotion purchase exclusion. Service-role only.';

-- Service-role-only execution.
REVOKE ALL ON FUNCTION public.get_admin_marketing_opportunity_detection_preview() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_marketing_opportunity_detection_preview() TO service_role;

COMMIT;

-- ============================================================================
-- End of Stage 3C2 detection preview.
--   * One STABLE, SECURITY DEFINER, service-role-only read RPC installed.
--   * NO writes anywhere; marketing_opportunities remains at 0 rows.
--   * NO recipients, runs, AI, cron, email, sending, discovery, or rollout
--     changes. marketing_control_state only READ (pause assertion).
--   * NO ALTER of any existing table, NO migration 001-007 modified.
-- ============================================================================
