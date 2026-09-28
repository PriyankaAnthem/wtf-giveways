-- ============================================================================
-- WTF Reporting: additive aggregate tables
-- ----------------------------------------------------------------------------
-- Run order: 001 (this) -> 002 (indexes) -> 003 (refresh fn) -> 004 (dashboard
-- RPC) -> 005 (backfill) -> 006 (verification).
--
-- These tables are ADDITIVE. They do not touch checkout_intents, checkout
-- confirmation, wallet capture, or any customer-facing path. Nothing here adds
-- a trigger to checkout_intents.
--
-- Money model (proven in production, see audit):
--   gross_pence     = SUM(total_pence)
--   credit_pence    = SUM(wallet_credit_pence)
--   external_pence  = SUM( CASE WHEN external_payment_pence IS NOT NULL
--                               THEN external_payment_pence
--                               ELSE total_pence - wallet_credit_pence END )
--   INVARIANT: gross_pence = external_pence + credit_pence
--
-- Row scope (financial reporting only):
--   state = 'confirmed'  AND  provider <> 'debug'  AND  ref NOT LIKE 'SIM-%'
--
-- Time model: UK calendar buckets (Europe/London), never the DB session UTC.
--   bucket_start is stored as the UTC instant of the START of the local
--   Europe/London minute, produced via the round-trip:
--     (date_trunc('minute', ts AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London')
--
-- NOTE ON TIMESTAMP COLUMN: the refresh/backfill bucket a confirmed row by
-- COALESCE(confirmed_at, created_at). If your checkout_intents table does not
-- have a confirmed_at column, edit 003 + 005 to use created_at only. Verify with:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='checkout_intents'
--     AND column_name IN ('confirmed_at','created_at','updated_at');
-- ============================================================================

-- ----------------------------------------------------------------------------
-- reporting_sales_minute: one row per UK minute x campaign x provider.
-- Only minutes containing confirmed sales get rows.
-- campaign_id is NOT NULL: every confirmed checkout belongs to a campaign, and
-- a NULL member would break the primary key / upsert semantics.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reporting_sales_minute (
  bucket_start      timestamptz NOT NULL,
  campaign_id       uuid        NOT NULL,
  provider          text        NOT NULL,
  gross_pence       bigint      NOT NULL DEFAULT 0,
  external_pence    bigint      NOT NULL DEFAULT 0,
  credit_pence      bigint      NOT NULL DEFAULT 0,
  confirmed_orders  bigint      NOT NULL DEFAULT 0,
  tickets_sold      bigint      NOT NULL DEFAULT 0,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reporting_sales_minute_pkey
    PRIMARY KEY (bucket_start, campaign_id, provider),
  CONSTRAINT reporting_sales_minute_invariant
    CHECK (gross_pence = external_pence + credit_pence)
);

COMMENT ON TABLE public.reporting_sales_minute IS
  'Additive minute-level sales aggregates (Europe/London buckets). Maintained asynchronously by refresh_sales_reporting(). Never read by customer paths.';

-- ----------------------------------------------------------------------------
-- reporting_sales_daily: one row per UK calendar day x campaign x provider.
-- Rebuilt from minute rows; powers long-range and all-time reporting instantly.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reporting_sales_daily (
  bucket_date       date        NOT NULL,
  campaign_id       uuid        NOT NULL,
  provider          text        NOT NULL,
  gross_pence       bigint      NOT NULL DEFAULT 0,
  external_pence    bigint      NOT NULL DEFAULT 0,
  credit_pence      bigint      NOT NULL DEFAULT 0,
  confirmed_orders  bigint      NOT NULL DEFAULT 0,
  tickets_sold      bigint      NOT NULL DEFAULT 0,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reporting_sales_daily_pkey
    PRIMARY KEY (bucket_date, campaign_id, provider),
  CONSTRAINT reporting_sales_daily_invariant
    CHECK (gross_pence = external_pence + credit_pence)
);

COMMENT ON TABLE public.reporting_sales_daily IS
  'Additive UK-day sales aggregates. Rebuilt from reporting_sales_minute by refresh_sales_reporting(). Never read by customer paths.';

-- ----------------------------------------------------------------------------
-- reporting_meta: tiny key/value store for freshness + reconciliation status.
-- Avoids scanning checkout_intents on dashboard reads.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reporting_meta (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.reporting_meta IS
  'Reporting freshness + reconciliation metadata (e.g. last_refresh, last_reconciliation).';

-- ----------------------------------------------------------------------------
-- Security: RLS enabled + FORCED, with NO policies.
-- anon / authenticated therefore cannot read these tables. The service_role
-- key (used only inside authenticated admin API + protected cron routes)
-- bypasses RLS. No PII is stored here (campaign_id + provider + integer money).
-- ----------------------------------------------------------------------------
ALTER TABLE public.reporting_sales_minute ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reporting_sales_minute FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.reporting_sales_daily  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reporting_sales_daily  FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.reporting_meta         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reporting_meta         FORCE  ROW LEVEL SECURITY;

-- Defensive: ensure the anon/authenticated roles hold no direct grants.
REVOKE ALL ON public.reporting_sales_minute FROM anon, authenticated;
REVOKE ALL ON public.reporting_sales_daily  FROM anon, authenticated;
REVOKE ALL ON public.reporting_meta          FROM anon, authenticated;
