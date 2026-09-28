-- ============================================================================
-- WTF Reporting index 1 of 5  —  checkout_intents (confirmed_at) WHERE confirmed
-- ----------------------------------------------------------------------------
-- RUN MANUALLY. RUN OUTSIDE A TRANSACTION. ONE STATEMENT ONLY.
--   * CREATE INDEX CONCURRENTLY cannot run inside a transaction block. In the
--     Supabase SQL editor, run THIS FILE ON ITS OWN (do not paste it together
--     with other statements). Via psql: no BEGIN/COMMIT wrapper.
--   * Safe to re-run: uses IF NOT EXISTS.
--
-- PURPOSE: the only new read pattern against checkout_intents is the bounded,
-- recurring refresh window, which filters `state = 'confirmed'` and a bare
-- `confirmed_at >= v_from AND confirmed_at < v_to` range (see 003). This partial
-- index makes that window an index range scan instead of a full confirmed scan.
--
-- NOTE: no companion index on created_at is created. The recurring refresh path
-- filters confirmed_at only (no COALESCE fallback), so a created_at index would
-- add write overhead to every checkout with no matching read. Do not add one
-- unless a separate, EXPLAIN-proven production query requires it.
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_checkout_intents_confirmed_at_confirmed
  ON public.checkout_intents (confirmed_at)
  WHERE state = 'confirmed';
