-- ============================================================================
-- WTF Reporting index 3 of 5  —  reporting_sales_minute (campaign_id, bucket_start)
-- ----------------------------------------------------------------------------
-- RUN MANUALLY. RUN OUTSIDE A TRANSACTION. ONE STATEMENT ONLY.
--   * CREATE INDEX CONCURRENTLY cannot run inside a transaction block. Run this
--     file on its own. Safe to re-run: uses IF NOT EXISTS.
--
-- PURPOSE: per-campaign time scans over the minute rollup (campaign-filtered
-- Today / Last 7 days dashboard reads and per-campaign minute charts).
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reporting_minute_campaign_bucket
  ON public.reporting_sales_minute (campaign_id, bucket_start);
