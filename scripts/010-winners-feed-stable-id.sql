-- =============================================================================
-- 010 - winners_feed: stable feed_id + future-proof instant joins
-- =============================================================================
-- CREATE OR REPLACE of the public.winners_feed view. Two changes, both
-- additive/non-destructive:
--
--   1. Adds a stable, unique `feed_id` per row so /winners can paginate and
--      deduplicate deterministically:
--        main arm    -> 'main:'    || wr.id   (winner_records PK, uuid)
--        instant arm -> 'instant:' || a.id    (instant_win_awards PK, uuid)
--      This is a real, already-existing row identity - not a synthesised
--      timestamp offset. It is appended as the LAST column so CREATE OR REPLACE
--      is legal (all pre-existing columns keep their name/type/order).
--
--   2. Relaxes the instant arm's checkout_intents + entries joins from INNER
--      to LEFT. Today every one of the ~13,891 instant awards has an entry, so
--      this changes NObody's visibility right now (verified before writing).
--      It exists purely so a FUTURE legitimate award method that is not tied to
--      a paid entry (e.g. a promo/manual grant with no checkout_intent) still
--      surfaces instead of silently vanishing inside an INNER JOIN. When there
--      is no entry, user_id is NULL and display_name falls back to
--      'Verified winner' via the existing COALESCE.
--
-- Everything else (columns, the main arm, the placed = 1 rule, the
-- profiles_public_snapshot visibility join) is byte-for-byte the original.
--
-- Eligibility (excluding wallet_credit, etc.) is intentionally NOT expressed
-- here - it lives in the application layer (lib/winners.ts) so the rule stays
-- in one place. This view stays a faithful projection of the source rows.
--
-- Safe to re-run: CREATE OR REPLACE is idempotent.
-- =============================================================================

CREATE OR REPLACE VIEW public.winners_feed AS
 SELECT 'main'::text AS kind,
    wr.giveaway_id AS campaign_id,
    c.slug AS campaign_slug,
    c.title AS campaign_title,
    wr.user_id,
    COALESCE(pp.display_name, 'Verified winner'::text) AS display_name,
    wr.prize_title,
    wr.announced_at AS happened_at,
    NULL::text AS fulfilment_type,
    NULL::bigint AS prize_value_pence,
    NULL::text AS prize_value_text,
    NULL::integer AS winning_ticket,
    ('main:'::text || wr.id::text) AS feed_id
   FROM winner_records wr
     JOIN campaigns c ON c.id = wr.giveaway_id
     LEFT JOIN profiles_public_snapshot pp ON pp.user_id = wr.user_id AND pp.public_visible = true
  WHERE wr.placed = 1
UNION ALL
 SELECT 'instant'::text AS kind,
    p.campaign_id,
    c.slug AS campaign_slug,
    c.title AS campaign_title,
    e.user_id,
    COALESCE(pp.display_name, 'Verified winner'::text) AS display_name,
    p.prize_title,
    a.awarded_at AS happened_at,
    a.fulfilment_type,
    a.prize_value_pence,
    p.prize_value_text,
    s.winning_ticket,
    ('instant:'::text || a.id::text) AS feed_id
   FROM instant_win_awards a
     JOIN instant_win_prizes p ON p.id = a.prize_id
     JOIN instant_win_slots s ON s.id = a.instant_win_slot_id
     LEFT JOIN checkout_intents ci ON ci.id = a.checkout_intent_id
     LEFT JOIN entries e ON e.checkout_intent_id = ci.id
     JOIN campaigns c ON c.id = p.campaign_id
     LEFT JOIN profiles_public_snapshot pp ON pp.user_id = e.user_id AND pp.public_visible = true;

COMMENT ON VIEW public.winners_feed IS
  'Faithful projection of genuine awarded prizes (main winner_records + instant_win_awards). feed_id is a stable per-row id for deterministic pagination/dedup. Eligibility (e.g. excluding wallet_credit) is applied in lib/winners.ts, not here.';
