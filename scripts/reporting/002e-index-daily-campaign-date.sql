-- ============================================================================
-- WTF Reporting index 5 of 5  —  reporting_sales_daily (campaign_id, bucket_date)
-- ----------------------------------------------------------------------------
-- RUN MANUALLY. RUN OUTSIDE A TRANSACTION. ONE STATEMENT ONLY.
--   * CREATE INDEX CONCURRENTLY cannot run inside a transaction block. Run this
--     file on its own. Safe to re-run: uses IF NOT EXISTS.
--
-- PURPOSE: per-campaign date scans over the daily rollup (campaign performance
-- table across This month / All time).
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reporting_daily_campaign_date
  ON public.reporting_sales_daily (campaign_id, bucket_date);
