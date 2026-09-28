-- ============================================================================
-- WTF First-Party Traffic: foundation (table + checkout linkage + retention)
-- ----------------------------------------------------------------------------
-- Additive, production-safe. Creates the WTF-owned analytics event store whose
-- SOLE purpose is the commercial funnel:
--
--   visitor -> session -> campaign view -> checkout -> confirmed -> revenue
--
-- This is NOT a Google-Analytics clone. It records only what we need to
-- deterministically compute visitors, sessions, conversion and revenue-per-
-- visitor, and to attribute those to a traffic source. GA, Vercel Analytics and
-- Meta Pixel are untouched and continue to run alongside this system.
--
-- SECURITY MODEL
--   * Browsers NEVER write here. Ingestion is server-side via the service role
--     only (POST /api/track). RLS is ON with NO permissive policy, so anon /
--     authenticated clients cannot select or insert. service_role bypasses RLS.
--   * Aggregate reporting RPCs (010-...) are SECURITY DEFINER and return counts
--     only — the admin UI never reads raw rows from this table.
--
-- IDEMPOTENT: safe to run more than once (IF NOT EXISTS / ADD COLUMN IF NOT
-- EXISTS / CREATE INDEX IF NOT EXISTS).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) Event-type enum. Intentionally minimal — only 'page_view' today. New
--    values can be appended later with ALTER TYPE ... ADD VALUE (never remove).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'traffic_event_type') THEN
    CREATE TYPE public.traffic_event_type AS ENUM ('page_view');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2) traffic_events — one row per (deduplicated) commercial event.
--    All identifiers are opaque UUIDs minted by the server; no PII is stored.
--    visitor_id / session_id come from first-party cookies (see ingestion doc).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.traffic_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at      timestamptz NOT NULL DEFAULT now(),

  -- Identity chain (anonymous-first; user_id is set only when authenticated).
  visitor_id       uuid        NOT NULL,          -- persistent anon cookie (1y)
  session_id       uuid        NOT NULL,          -- session cookie (30m idle)
  user_id          uuid        NULL,              -- auth.users.id when signed in

  event_type       public.traffic_event_type NOT NULL DEFAULT 'page_view',

  -- Page context (query string ALWAYS stripped before insert).
  path             text        NOT NULL,
  campaign_slug    text        NULL,              -- parsed from /giveaways/[slug]
  campaign_id      uuid        NULL,              -- resolved server-side when known
  landing_path     text        NULL,              -- first path of the session
  referrer_host    text        NULL,              -- host only, never full URL

  -- Visitor-side attribution (the ACTIVE /t attribution cookie at arrival).
  -- Kept CONCEPTUALLY SEPARATE from checkout_intents.attribution_* which is a
  -- frozen checkout-time snapshot. This is "how the visitor reached the site".
  source           text        NULL,
  medium           text        NULL,
  channel          text        NULL,
  campaign         text        NULL,
  tracking_link_id uuid        NULL,

  is_bot           boolean     NOT NULL DEFAULT false,

  -- Guardrails so noise/garbage can never bloat a text column.
  CONSTRAINT traffic_events_path_len        CHECK (char_length(path) <= 512),
  CONSTRAINT traffic_events_campaign_slug_len CHECK (campaign_slug IS NULL OR char_length(campaign_slug) <= 200),
  CONSTRAINT traffic_events_referrer_len     CHECK (referrer_host IS NULL OR char_length(referrer_host) <= 255),
  CONSTRAINT traffic_events_source_len       CHECK (source IS NULL OR char_length(source) <= 100),
  CONSTRAINT traffic_events_medium_len       CHECK (medium IS NULL OR char_length(medium) <= 100),
  CONSTRAINT traffic_events_channel_len      CHECK (channel IS NULL OR char_length(channel) <= 100),
  CONSTRAINT traffic_events_campaign_len     CHECK (campaign IS NULL OR char_length(campaign) <= 200)
);

COMMENT ON TABLE public.traffic_events IS
  'WTF first-party commercial analytics events (page_view only today). Server/service-role ingest only; RLS denies all client access. Aggregate RPCs read this; the admin UI never selects raw rows.';

-- ----------------------------------------------------------------------------
-- 3) Indexes — sized for the aggregate RPCs (time-window + campaign + source),
--    and for dedup / per-visitor + per-session rollups. All partial/composite
--    to stay small. Human buyers dominate reads, so most exclude bots.
-- ----------------------------------------------------------------------------
-- Primary time-window scan (overall + funnel + source rollups), humans only.
CREATE INDEX IF NOT EXISTS idx_traffic_events_occurred_at
  ON public.traffic_events (occurred_at)
  WHERE is_bot = false;

-- Per-campaign time window (campaign funnel + campaign viewers).
CREATE INDEX IF NOT EXISTS idx_traffic_events_campaign_occurred
  ON public.traffic_events (campaign_slug, occurred_at)
  WHERE is_bot = false AND campaign_slug IS NOT NULL;

-- COUNT(DISTINCT visitor_id) over a window; also supports dedup lookups.
CREATE INDEX IF NOT EXISTS idx_traffic_events_visitor_occurred
  ON public.traffic_events (visitor_id, occurred_at);

-- Session rollups (sessions = COUNT(DISTINCT session_id)).
CREATE INDEX IF NOT EXISTS idx_traffic_events_session
  ON public.traffic_events (session_id);

-- Source attribution rollups over a window (visitors/buyers by source).
CREATE INDEX IF NOT EXISTS idx_traffic_events_source_occurred
  ON public.traffic_events (source, occurred_at)
  WHERE is_bot = false;

-- Dedup guard: at most one identical event per session+path+minute. This makes
-- rapid duplicate page_views (SPA re-renders, double beacons) a no-op insert.
-- The app also debounces, but this is the hard backstop.
CREATE UNIQUE INDEX IF NOT EXISTS uq_traffic_events_dedup
  ON public.traffic_events (session_id, path, date_trunc('minute', occurred_at), event_type);

-- ----------------------------------------------------------------------------
-- 4) RLS: ON, and deliberately NO policy -> anon/authenticated get zero rows
--    and cannot insert. Only service_role (which bypasses RLS) can write/read.
-- ----------------------------------------------------------------------------
ALTER TABLE public.traffic_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traffic_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.traffic_events FROM public, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.traffic_events TO service_role;

-- ----------------------------------------------------------------------------
-- 5) Checkout linkage — the deterministic join between traffic and revenue.
--    Snapshotted onto checkout_intents when the intent is CREATED, exactly like
--    the existing attribution_* snapshot. Nullable + additive: historical rows
--    and any non-tracked checkout simply carry NULLs.
-- ----------------------------------------------------------------------------
ALTER TABLE public.checkout_intents
  ADD COLUMN IF NOT EXISTS visitor_id uuid NULL,
  ADD COLUMN IF NOT EXISTS session_id uuid NULL;

COMMENT ON COLUMN public.checkout_intents.visitor_id IS
  'First-party analytics visitor_id snapshotted at checkout creation. Links a confirmed order back to traffic_events for visitor->buyer conversion. Separate from attribution_* (checkout-time marketing snapshot).';
COMMENT ON COLUMN public.checkout_intents.session_id IS
  'First-party analytics session_id snapshotted at checkout creation. Enables session->checkout->buyer funnel joins.';

-- Join support: given a visitor/session, find their confirmed orders fast.
CREATE INDEX IF NOT EXISTS idx_checkout_intents_visitor
  ON public.checkout_intents (visitor_id)
  WHERE visitor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_checkout_intents_session
  ON public.checkout_intents (session_id)
  WHERE session_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 6) Retention / cleanup. Raw events are only needed for recent windows and
--    drill-downs; long-range dashboards read the daily rollup (010). Keep raw
--    events for 90 days. Call from the existing cron (CRON_SECRET) daily.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prune_traffic_events(p_keep_days integer DEFAULT 90)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted bigint;
BEGIN
  IF p_keep_days < 1 THEN
    RAISE EXCEPTION 'p_keep_days must be >= 1';
  END IF;
  DELETE FROM public.traffic_events
   WHERE occurred_at < now() - make_interval(days => p_keep_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_traffic_events(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_traffic_events(integer) TO service_role;

COMMIT;

-- ============================================================================
-- EXPECTED VOLUME / PERFORMANCE NOTES (this migration is APPLIED in production):
--   * ~10-50 page_views per confirmed order. At a few thousand orders/month
--     this is low-hundreds-of-thousands of rows/month — trivial for Postgres
--     with the partial indexes above.
--   * The dedup unique index caps per-session-per-path-per-minute spam.
--   * 90-day retention keeps the hot table small; 010 provides a daily rollup
--     table so 30d/long-range dashboards never scan raw rows.
-- ============================================================================
