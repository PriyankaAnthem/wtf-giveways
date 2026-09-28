-- ============================================================================
-- WTF Reporting index 4 of 5  —  reporting_sales_daily (bucket_date)
-- ----------------------------------------------------------------------------
-- RUN MANUALLY. RUN OUTSIDE A TRANSACTION. ONE STATEMENT ONLY.
--   * CREATE INDEX CONCURRENTLY cannot run inside a transaction block. Run this
--     file on its own. Safe to re-run: uses IF NOT EXISTS.
--
-- PURPOSE: date-range scans over the daily rollup (This month / Previous month /
-- All time dashboard reads), and the affected-day delete/insert performed by
-- refresh_sales_reporting.
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reporting_daily_bucket_date
  ON public.reporting_sales_daily (bucket_date);
