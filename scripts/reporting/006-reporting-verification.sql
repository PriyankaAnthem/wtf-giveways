-- ============================================================================
-- WTF Reporting: verification / health checks (READ-ONLY)
-- Run after 001-005. Every query here is read-only.
-- ============================================================================

-- 1) Existing indexes (audit for duplicates before/after 002).
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('checkout_intents','reporting_sales_minute','reporting_sales_daily')
ORDER BY tablename, indexname;

-- 2) Table-level invariant: gross = external + credit (must return 0 rows).
SELECT 'minute' AS tbl, COUNT(*) AS violations
  FROM public.reporting_sales_minute
 WHERE gross_pence <> external_pence + credit_pence
UNION ALL
SELECT 'daily', COUNT(*)
  FROM public.reporting_sales_daily
 WHERE gross_pence <> external_pence + credit_pence;

-- 3) Minute vs daily cross-check (must all be zero).
WITH m AS (
  SELECT SUM(gross_pence) g, SUM(external_pence) e, SUM(credit_pence) c,
         SUM(confirmed_orders) o, SUM(tickets_sold) t
  FROM public.reporting_sales_minute
), d AS (
  SELECT SUM(gross_pence) g, SUM(external_pence) e, SUM(credit_pence) c,
         SUM(confirmed_orders) o, SUM(tickets_sold) t
  FROM public.reporting_sales_daily
)
SELECT (m.g-d.g) diff_gross, (m.e-d.e) diff_external, (m.c-d.c) diff_credit,
       (m.o-d.o) diff_orders, (m.t-d.t) diff_tickets
FROM m CROSS JOIN d;

-- 4) Reference figures from the audit (Europe/London).
--    Expected TODAY at audit time:      gross £363.54 / external £341.35 / credit £22.19 / 71 orders / 348 tickets
--    Expected THIS WEEK (last 7d) then:  gross £463.25 / external £441.06 / credit £22.19 / 103 orders / 577 tickets
--    (Live values will have grown; use reconciliation, not exact equality.)
SELECT 'today' AS period,
       SUM(gross_pence) gross_pence, SUM(external_pence) external_pence, SUM(credit_pence) credit_pence,
       SUM(confirmed_orders) orders, SUM(tickets_sold) tickets
  FROM public.reporting_sales_minute
 WHERE bucket_start >= ((now() AT TIME ZONE 'Europe/London')::date::timestamp AT TIME ZONE 'Europe/London')
UNION ALL
SELECT 'last_7_days',
       SUM(gross_pence), SUM(external_pence), SUM(credit_pence),
       SUM(confirmed_orders), SUM(tickets_sold)
  FROM public.reporting_sales_minute
 WHERE bucket_start >= now() - interval '7 days';

-- 5) Direct source recomputation of the same two periods (compare to #4).
SELECT 'today_source' AS period,
       COALESCE(SUM(total_pence),0) gross_pence,
       COALESCE(SUM(CASE WHEN external_payment_pence IS NOT NULL THEN external_payment_pence
                         ELSE total_pence - COALESCE(wallet_credit_pence,0) END),0) external_pence,
       COALESCE(SUM(COALESCE(wallet_credit_pence,0)),0) credit_pence,
       COUNT(*) orders, COALESCE(SUM(COALESCE(qty,0)),0) tickets
  FROM public.checkout_intents
 WHERE state='confirmed' AND provider IS DISTINCT FROM 'debug' AND (ref IS NULL OR ref NOT LIKE 'SIM-%')
   AND confirmed_at IS NOT NULL
   AND confirmed_at >= ((now() AT TIME ZONE 'Europe/London')::date::timestamp AT TIME ZONE 'Europe/London')
UNION ALL
SELECT 'last_7_days_source',
       COALESCE(SUM(total_pence),0),
       COALESCE(SUM(CASE WHEN external_payment_pence IS NOT NULL THEN external_payment_pence
                         ELSE total_pence - COALESCE(wallet_credit_pence,0) END),0),
       COALESCE(SUM(COALESCE(wallet_credit_pence,0)),0),
       COUNT(*), COALESCE(SUM(COALESCE(qty,0)),0)
  FROM public.checkout_intents
 WHERE state='confirmed' AND provider IS DISTINCT FROM 'debug' AND (ref IS NULL OR ref NOT LIKE 'SIM-%')
   AND confirmed_at IS NOT NULL
   AND confirmed_at >= now() - interval '7 days';

-- 6) Freshness + reconciliation snapshot.
SELECT key, value, updated_at FROM public.reporting_meta ORDER BY key;

-- 7) RLS confirmation (rowsecurity + forced must both be true).
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname IN ('reporting_sales_minute','reporting_sales_daily','reporting_meta');

-- 8) EXPLAIN for the bounded refresh read path (confirm index usage; run if tuning).
--    Uses bare confirmed_at (sargable) to match the shipped refresh function.
--    See 007-explain-plan-pack.sql for the full read-only (no ANALYZE) pack.
-- EXPLAIN
-- SELECT campaign_id, provider, SUM(total_pence)
--   FROM public.checkout_intents
--  WHERE state='confirmed' AND confirmed_at >= now() - interval '15 minutes'
--                        AND confirmed_at <  now() + interval '1 minute'
--  GROUP BY campaign_id, provider;

-- 9) The dashboard RPC returns a bounded payload (smoke test).
SELECT jsonb_pretty(public.get_admin_sales_dashboard('today')) AS today_payload;
