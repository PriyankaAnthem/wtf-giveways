-- =============================================================================
-- 009 - Admin Schedule Events (manual forward-planning calendar)
-- =============================================================================
-- Creates ONE new isolated table: admin_schedule_events.
--
-- ISOLATION GUARANTEES (spec s3 / s42 / s46):
--   * Creates a brand-new table. Alters NO existing table.
--   * Creates NO function, NO trigger, NO RPC, NO cron job.
--   * Modifies NO existing function, trigger, policy or index.
--   * References NO other table. There is deliberately NO foreign key to
--     campaigns, campaign_hosts, users, prizes, tickets or instant wins, so a
--     planning row can exist for a competition/host that does not exist yet
--     (spec s4 / s5).
--   * created_by is a bare uuid with NO foreign key on purpose: it is an audit
--     breadcrumb only, and must never make a planning row depend on an account.
--   * Contains NO INSERT/UPDATE/DELETE against any pre-existing table, so it
--     cannot alter payments, checkout, ticket allocation, instant wins,
--     balloon placement, draws, winners, campaigns or marketing.
--
-- SECURITY MODEL (spec s29):
--   RLS is ENABLED with NO policies for anon/authenticated. This mirrors the
--   established discount_codes convention: browser clients (anon key) get zero
--   rows, and all reads/writes happen server-side through the service-role
--   client AFTER authorizeAdminApi() has verified the admin session. Verified
--   empirically before writing this: discount_codes returns [] to the anon key
--   and rows to the service key.
--
--   Note: enabling RLS without policies is what makes this table private. Do
--   NOT add a permissive SELECT policy "for convenience" - that would expose
--   internal forward planning to every logged-in customer.
--
-- Safe to re-run: every statement is idempotent.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_schedule_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text        NOT NULL,
  event_type     text        NOT NULL,
  scheduled_date date        NOT NULL,
  -- NULL when all_day is true (spec s14).
  scheduled_time time        NULL,
  all_day        boolean     NOT NULL DEFAULT false,
  status         text        NOT NULL DEFAULT 'idea',
  notes          text        NULL,
  -- Audit breadcrumb only. Intentionally NOT a foreign key (see above).
  created_by     uuid        NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Controlled vocabularies (spec s19 / s20). Added via DO blocks so re-running
-- this migration cannot fail on an already-present constraint.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'admin_schedule_events_event_type_check'
  ) THEN
    ALTER TABLE public.admin_schedule_events
      ADD CONSTRAINT admin_schedule_events_event_type_check
      CHECK (event_type IN (
        'balloon_pop',
        'instant_win',
        'cash',
        'competition_launch',
        'tiktok_live',
        'final_draw',
        'other'
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'admin_schedule_events_status_check'
  ) THEN
    ALTER TABLE public.admin_schedule_events
      ADD CONSTRAINT admin_schedule_events_status_check
      CHECK (status IN ('idea', 'planned', 'confirmed'));
  END IF;
END $$;

-- Title must carry real content, not whitespace (spec s36).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'admin_schedule_events_title_not_blank'
  ) THEN
    ALTER TABLE public.admin_schedule_events
      ADD CONSTRAINT admin_schedule_events_title_not_blank
      CHECK (length(btrim(title)) > 0);
  END IF;
END $$;

-- A timed event needs a time; an all-day event must not have one (spec s36).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'admin_schedule_events_time_matches_all_day'
  ) THEN
    ALTER TABLE public.admin_schedule_events
      ADD CONSTRAINT admin_schedule_events_time_matches_all_day
      CHECK (
        (all_day = true  AND scheduled_time IS NULL) OR
        (all_day = false AND scheduled_time IS NOT NULL)
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Index: every query is "one month, ordered by time" (spec s28), so a single
-- composite index covers the month-range scan and the in-day ordering.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_admin_schedule_events_date
  ON public.admin_schedule_events (scheduled_date, scheduled_time);

-- ---------------------------------------------------------------------------
-- RLS: enabled with NO anon/authenticated policies. Service-role bypasses RLS,
-- which is the only access path (see SECURITY MODEL above).
-- ---------------------------------------------------------------------------
ALTER TABLE public.admin_schedule_events ENABLE ROW LEVEL SECURITY;

-- Defensive: revoke the default grants PostgREST's roles inherit, so the table
-- is unreachable with the anon/authenticated keys even if RLS were toggled off.
REVOKE ALL ON TABLE public.admin_schedule_events FROM anon;
REVOKE ALL ON TABLE public.admin_schedule_events FROM authenticated;

COMMENT ON TABLE public.admin_schedule_events IS
  'Manual admin forward-planning calendar. Isolated: no FK to campaigns/hosts/users, no automation, no triggers. Service-role access only.';

COMMIT;
