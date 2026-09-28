-- =============================================================================
-- 011 - Big Wins (curated marketing/social-proof module for /winners)
-- =============================================================================
-- Creates ONE new isolated table (public.big_wins) plus a dedicated public
-- storage bucket (big-wins) for winner photos. This module is DELIBERATELY
-- separate from the automatic winners_feed: it is hand-curated marketing, not
-- generated from awards. It reads/writes NOTHING in the live winner pipeline.
--
-- ISOLATION GUARANTEES (mirrors the 009 admin_schedule_events convention):
--   * Brand-new table + brand-new bucket. Alters NO existing table.
--   * NO foreign keys to campaigns/users/awards on purpose — a curated card is
--     free-text marketing copy and must be able to reference a competition or
--     winner that has no row (or a since-deleted row). created_by is a bare
--     uuid audit breadcrumb, NOT an FK.
--   * NO function, trigger, RPC, or cron. NO INSERT/UPDATE/DELETE against any
--     pre-existing table, so it cannot affect payments, awards, or winners.
--
-- SECURITY MODEL:
--   The public /winners page must READ active cards with the anon key, so this
--   is the campaigns-style public-read + admin-write model (NOT the private
--   discount_codes model):
--     * RLS enabled.
--     * anon/authenticated may SELECT only ACTIVE cards (is_active = true).
--     * admins (admin_role() = 'admin') may do everything.
--   Admin writes still go through the service-role client behind
--   authorizeAdminApi(), but the public read policy is what lets the storefront
--   render curated cards without a service key.
--
-- Safe to re-run: every statement is idempotent.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.big_wins (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Winner first name / display name shown on the card (e.g. "Grace").
  winner_name    text        NOT NULL,
  -- Big prize display text exactly as it should render, e.g. "£1,500 CASH".
  prize_text     text        NOT NULL,
  -- Public URL of the uploaded winner photo (big-wins bucket).
  image_url      text        NOT NULL,
  -- Crop/reposition focal point for object-position, 0..100 on each axis, so
  -- portrait cards stay consistent regardless of source aspect ratio.
  image_pos_x    smallint    NOT NULL DEFAULT 50,
  image_pos_y    smallint    NOT NULL DEFAULT 50,
  -- Free-text competition name, e.g. "DG's 333 Cash Chances".
  competition    text        NOT NULL,
  -- Date the prize was won (date only — cards show "Won 2 Sep").
  won_on         date        NOT NULL,
  -- Optional ticket number shown as "Ticket #12,845". NULL = hidden.
  ticket_number  integer     NULL,
  -- Manual display order (ascending). Lower = earlier in the carousel.
  display_order  integer     NOT NULL DEFAULT 0,
  -- Active/hidden toggle. Only active cards are public.
  is_active      boolean     NOT NULL DEFAULT true,
  created_by     uuid        NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Content sanity checks (idempotent via DO blocks).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'big_wins_winner_name_not_blank') THEN
    ALTER TABLE public.big_wins ADD CONSTRAINT big_wins_winner_name_not_blank CHECK (length(btrim(winner_name)) > 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'big_wins_prize_text_not_blank') THEN
    ALTER TABLE public.big_wins ADD CONSTRAINT big_wins_prize_text_not_blank CHECK (length(btrim(prize_text)) > 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'big_wins_image_url_not_blank') THEN
    ALTER TABLE public.big_wins ADD CONSTRAINT big_wins_image_url_not_blank CHECK (length(btrim(image_url)) > 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'big_wins_competition_not_blank') THEN
    ALTER TABLE public.big_wins ADD CONSTRAINT big_wins_competition_not_blank CHECK (length(btrim(competition)) > 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'big_wins_image_pos_range') THEN
    ALTER TABLE public.big_wins ADD CONSTRAINT big_wins_image_pos_range
      CHECK (image_pos_x BETWEEN 0 AND 100 AND image_pos_y BETWEEN 0 AND 100);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'big_wins_ticket_number_positive') THEN
    ALTER TABLE public.big_wins ADD CONSTRAINT big_wins_ticket_number_positive
      CHECK (ticket_number IS NULL OR ticket_number > 0);
  END IF;
END $$;

-- Public read path orders active cards by (display_order, won_on DESC).
CREATE INDEX IF NOT EXISTS idx_big_wins_active_order
  ON public.big_wins (is_active, display_order, won_on DESC);

-- ---------------------------------------------------------------------------
-- RLS: public read of ACTIVE cards, admin full control. Mirrors campaigns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.big_wins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS big_wins_public_read_active ON public.big_wins;
CREATE POLICY big_wins_public_read_active
  ON public.big_wins FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS big_wins_admin_all ON public.big_wins;
CREATE POLICY big_wins_admin_all
  ON public.big_wins FOR ALL
  TO authenticated
  USING (admin_role() = 'admin')
  WITH CHECK (admin_role() = 'admin');

COMMENT ON TABLE public.big_wins IS
  'Curated Big Wins cards for the public /winners page. Hand-managed marketing/social proof, deliberately separate from winners_feed. No FK to campaigns/users/awards. Public reads active rows; admins manage all.';

-- ---------------------------------------------------------------------------
-- Storage: dedicated PUBLIC bucket for Big Wins winner photos, with the same
-- public-read + admin-write object policies as campaign-hero.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('big-wins', 'big-wins', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS big_wins_public_read ON storage.objects;
CREATE POLICY big_wins_public_read
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'big-wins');

DROP POLICY IF EXISTS big_wins_admin_insert ON storage.objects;
CREATE POLICY big_wins_admin_insert
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'big-wins' AND admin_role() = 'admin');

DROP POLICY IF EXISTS big_wins_admin_update ON storage.objects;
CREATE POLICY big_wins_admin_update
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'big-wins' AND admin_role() = 'admin')
  WITH CHECK (bucket_id = 'big-wins' AND admin_role() = 'admin');

DROP POLICY IF EXISTS big_wins_admin_delete ON storage.objects;
CREATE POLICY big_wins_admin_delete
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'big-wins' AND admin_role() = 'admin');

COMMIT;
