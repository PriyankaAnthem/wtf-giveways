-- ============================================================================
-- WTF Reporting index 2 of 5  —  reporting_sales_minute (bucket_start)
-- ----------------------------------------------------------------------------
-- RUN MANUALLY. RUN OUTSIDE A TRANSACTION. ONE STATEMENT ONLY.
--   * CREATE INDEX CONCURRENTLY cannot run inside a transaction block. Run this
--     file on its own. Safe to re-run: uses IF NOT EXISTS.
--
-- PURPOSE: time-range scans over the minute rollup (Today / Yesterday / Last 7
-- days dashboard reads and minute-granularity charts), and the minute-range
-- delete/insert performed by refresh_sales_reporting.
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reporting_minute_bucket_start
  ON public.reporting_sales_minute (bucket_start);
