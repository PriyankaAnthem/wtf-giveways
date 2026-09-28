-- Migration: allow 'treasure_chest' as a third campaigns.reveal_type value.
--
-- reveal_type is PRESENTATION ONLY (it controls how a customer sees their
-- already-decided checkout result, never allocation or win logic).
--
-- This migration is intentionally minimal and non-destructive:
--   * It ONLY replaces the existing CHECK constraint.
--   * It does NOT change the column type (stays text).
--   * It does NOT change NOT NULL.
--   * It does NOT change the default ('normal').
--   * It does NOT touch, backfill, or migrate any existing rows.
--
-- Existing 'normal' and 'scratch_card' campaigns are unaffected.

BEGIN;

-- 1) Drop only the current reveal_type check constraint.
ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_reveal_type_check;

-- 2) Recreate it allowing exactly the three supported values.
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_reveal_type_check
  CHECK (reveal_type IN ('normal', 'scratch_card', 'treasure_chest'));

-- Note: column type (text), NOT NULL, and DEFAULT 'normal' are deliberately
-- left exactly as they were and are not re-declared here.

COMMIT;
