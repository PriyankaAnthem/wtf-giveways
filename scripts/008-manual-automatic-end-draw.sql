-- Migration: campaign-level Manual / Automatic END-PRIZE draw mode.
--
-- SCOPE: the main/end-prize draw ONLY, i.e. winner_records.placed = 1.
-- This migration deliberately does NOT touch:
--   * confirm_payment_and_award
--   * instant_win_slots / instant_win_prizes / instant_win_awards
--   * ticket allocation, checkout, or wallet behaviour
--   * any existing winner_records row
--   * the ticket_allocations data anomalies noted during the audit
--
-- It is additive and backwards compatible: every existing campaign resolves to
-- 'automatic', which is exactly the behaviour production has today.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) campaigns.end_draw_mode
-- ---------------------------------------------------------------------------
-- text + CHECK (not an enum) so future modes need no type migration.
-- NOT NULL DEFAULT 'automatic' means ADD COLUMN backfills every existing row
-- to 'automatic' in place: live, sold_out, ended and draft campaigns all keep
-- their current behaviour, and new campaigns default to automatic too.
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS end_draw_mode text NOT NULL DEFAULT 'automatic';

-- Defensive: if the column already existed as nullable from an earlier partial
-- run, normalise it before the CHECK constraint is applied.
UPDATE public.campaigns
   SET end_draw_mode = 'automatic'
 WHERE end_draw_mode IS NULL
    OR end_draw_mode NOT IN ('automatic', 'manual');

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_end_draw_mode_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_end_draw_mode_check
  CHECK (end_draw_mode IN ('automatic', 'manual'));

COMMENT ON COLUMN public.campaigns.end_draw_mode IS
  'Main/end-prize draw mode. automatic = draw_campaign_winner() runs when the '
  'campaign ends or sells out. manual = the campaign is closed WITHOUT a main '
  'winner and an admin must draw afterwards. Does not affect instant wins.';

-- ---------------------------------------------------------------------------
-- 2) Hard guarantee: at most one main winner per campaign
-- ---------------------------------------------------------------------------
-- This index already exists in production. It is (re)asserted here so the
-- migration is safe to run on any environment. It is the real duplicate-winner
-- guarantee; the advisory lock below is only for orderly execution.
CREATE UNIQUE INDEX IF NOT EXISTS winner_records_one_main_winner_per_campaign
  ON public.winner_records (giveaway_id)
  WHERE placed = 1;

-- ---------------------------------------------------------------------------
-- 3) draw_campaign_winner: the single authoritative main-winner algorithm
-- ---------------------------------------------------------------------------
-- Replaces the existing function in place (same name/signature) so this stays
-- the one and only draw implementation. Changes versus the current production
-- definition:
--   * prize_title now mirrors the application fallback chain
--     (main_prize_title -> title -> 'Prize') instead of hard-coding
--     'Main Prize'. Historical rows are NOT rewritten.
--   * adds a transaction-level advisory lock so concurrent callers serialise.
--   * returns a richer idempotent jsonb result on SUCCESS so callers can tell a
--     fresh draw from an already-drawn campaign.
-- Unchanged: RETURNS jsonb, the raise-based ERROR contract (no_tickets_sold /
-- winner_allocation_not_found / winner_entry_not_found are still raised, not
-- returned), the ticket_allocations pool keyed on campaign_id, PostgreSQL
-- random(), ticket -> entry -> user resolution, placed = 1, conflict-safe
-- insert.
--
-- ERROR CONTRACT: failures RAISE (SQLSTATE P0001). Success returns jsonb.
-- An already-drawn campaign is a SUCCESS (ok = true, already_drawn = true),
-- never an exception, so idempotent retries stay cheap and non-fatal.
CREATE OR REPLACE FUNCTION public.draw_campaign_winner(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campaign      public.campaigns;
  v_existing      public.winner_records;
  v_total_tickets bigint;
  v_pick          bigint;
  v_ticket        bigint;
  v_entry_id      uuid;
  v_user_id       uuid;
  v_prize_title   text;
  v_inserted_id   uuid;
BEGIN
  -- Defensive guards not present in the production function. Implemented as
  -- RAISE so this function has ONE consistent error contract (raise on
  -- failure, jsonb on success) rather than two.
  IF p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'missing_campaign_id';
  END IF;

  -- Serialise concurrent draws for THIS campaign until the transaction ends.
  -- The unique partial index remains the hard guarantee; this just prevents two
  -- callers doing the selection work simultaneously.
  PERFORM pg_advisory_xact_lock(hashtext('draw_campaign_winner:' || p_campaign_id::text));

  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  -- Idempotency: a main winner already exists. Scoped to placed = 1 so future
  -- runner-up rows can never suppress a main draw.
  SELECT * INTO v_existing
    FROM public.winner_records
   WHERE giveaway_id = p_campaign_id
     AND placed = 1
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_drawn', true,
      'winner_record_id', v_existing.id,
      'user_id', v_existing.user_id,
      'prize_title', v_existing.prize_title
    );
  END IF;

  -- Authoritative pool: issued ticket ranges for this campaign.
  SELECT COALESCE(SUM(end_ticket - start_ticket + 1), 0)
    INTO v_total_tickets
    FROM public.ticket_allocations
   WHERE campaign_id = p_campaign_id;

  -- PRESERVED PRODUCTION CONTRACT: raise, do not return ok=false. Bare RAISE
  -- EXCEPTION yields SQLSTATE P0001 with this exact message, matching the
  -- existing function byte-for-byte.
  IF v_total_tickets IS NULL OR v_total_tickets <= 0 THEN
    RAISE EXCEPTION 'no_tickets_sold';
  END IF;

  -- Uniform random ticket position in [1 .. v_total_tickets].
  v_pick := floor(random() * v_total_tickets) + 1;

  -- Resolve that position to its allocation, then to the owning entry.
  SELECT a.entry_id,
         a.start_ticket + (v_pick - a.cum_from)
    INTO v_entry_id, v_ticket
    FROM (
      SELECT ta.entry_id,
             ta.start_ticket,
             ta.end_ticket,
             COALESCE(
               SUM(ta.end_ticket - ta.start_ticket + 1) OVER (
                 ORDER BY ta.start_ticket, ta.id
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ), 0
             ) + 1 AS cum_from
        FROM public.ticket_allocations ta
       WHERE ta.campaign_id = p_campaign_id
    ) a
   WHERE v_pick >= a.cum_from
     AND v_pick <  a.cum_from + (a.end_ticket - a.start_ticket + 1)
   LIMIT 1;

  -- PRESERVED PRODUCTION CONTRACT.
  IF v_entry_id IS NULL THEN
    RAISE EXCEPTION 'winner_allocation_not_found';
  END IF;

  SELECT e.user_id INTO v_user_id FROM public.entries e WHERE e.id = v_entry_id;

  -- PRESERVED PRODUCTION CONTRACT.
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'winner_entry_not_found';
  END IF;

  -- Mirror the application's historical fallback chain exactly.
  v_prize_title := COALESCE(
    NULLIF(v_campaign.main_prize_title, ''),
    NULLIF(v_campaign.title, ''),
    'Prize'
  );

  INSERT INTO public.winner_records (giveaway_id, user_id, placed, prize_title, announced_at)
  VALUES (p_campaign_id, v_user_id, 1, v_prize_title, now())
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_inserted_id;

  -- Lost a race against another caller: report the winner that did land.
  IF v_inserted_id IS NULL THEN
    SELECT * INTO v_existing
      FROM public.winner_records
     WHERE giveaway_id = p_campaign_id
       AND placed = 1
     LIMIT 1;

    RETURN jsonb_build_object(
      'ok', true,
      'already_drawn', true,
      'winner_record_id', v_existing.id,
      'user_id', v_existing.user_id,
      'prize_title', v_existing.prize_title
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'already_drawn', false,
    'winner_record_id', v_inserted_id,
    'user_id', v_user_id,
    'winning_ticket', v_ticket,
    'total_tickets', v_total_tickets,
    'prize_title', v_prize_title
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Execute privileges
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE keeps pre-existing grants, and PostgreSQL grants EXECUTE to
-- PUBLIC on functions by default, so these REVOKEs are required to ensure no
-- ordinary customer (anon / authenticated / PUBLIC) can invoke the draw via the
-- Supabase REST RPC endpoint. Only service_role may call it, which covers both
-- trusted callers: the cron draw worker and the admin manual-draw endpoint
-- (both of which use the service-role key server-side after their own checks).
REVOKE ALL ON FUNCTION public.draw_campaign_winner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.draw_campaign_winner(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.draw_campaign_winner(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.draw_campaign_winner(uuid) TO service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- Post-run verification (read-only, run manually after COMMIT)
-- ---------------------------------------------------------------------------
-- SELECT end_draw_mode, count(*) FROM public.campaigns GROUP BY 1;
-- SELECT indexdef FROM pg_indexes WHERE indexname = 'winner_records_one_main_winner_per_campaign';
-- SELECT proacl FROM pg_proc WHERE proname = 'draw_campaign_winner';
