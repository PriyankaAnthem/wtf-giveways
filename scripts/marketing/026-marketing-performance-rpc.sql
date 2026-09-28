-- ============================================================================
-- WTF Marketing: single admin PERFORMANCE dashboard RPC (additive, read-only)
-- ----------------------------------------------------------------------------
-- get_marketing_performance(range, from, to, channel)
--   Returns ONE compact jsonb payload attributing GENUINE confirmed revenue to
--   the immutable per-order marketing snapshot captured at checkout:
--     * summary  — net revenue, orders, AOV, tracked revenue + attribution rate,
--                  voucher usage (over KNOWN orders only) + discount given
--     * byChannel                 (attribution_channel)
--     * bySource   (channel + attribution_source)
--     * byCampaign (channel + source + attribution_campaign)
--     * byVoucher  (snapshotted discount_code_entered, with truthful status)
--
--   This is DECOUPLED from the live tracking_links table on purpose: channel /
--   source / campaign are read ONLY from the frozen checkout_intents snapshot
--   (attribution_channel / attribution_source / attribution_campaign), so later
--   edits to a tracking link never rewrite history. It is ALSO independent of
--   the legacy Resend recipient-attribution model (get_marketing_admin_analytics)
--   and must NOT be merged with it — the two answer different questions.
--
--   Eligible confirmed scope (identical to the reporting refresh / Growth RPC):
--     state = 'confirmed'
--     AND provider IS DISTINCT FROM 'debug'
--     AND (ref IS NULL OR ref NOT LIKE 'SIM-%')
--   Revenue keys off confirmed_at (the canonical financial timestamp; a partial
--   index idx_checkout_intents_confirmed_at_confirmed already supports it).
--   Net external cash always uses the proven fallback:
--     COALESCE(external_payment_pence, total_pence - COALESCE(wallet_credit_pence,0))
--   All period boundaries are Europe/London.
--
--   Untracked / historic orders (attribution_channel IS NULL) are never dropped
--   — they are grouped under the canonical bucket 'direct_unknown'.
--
--   STABLE, SECURITY DEFINER, service_role only. No writes, no DDL, no triggers.
--   Returns AGGREGATES ONLY — never a customer identity or an individual row.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_marketing_performance(
  p_range   text DEFAULT 'today',
  p_from    date DEFAULT NULL,
  p_to      date DEFAULT NULL,
  p_channel text DEFAULT NULL       -- optional drill filter on the canonical channel
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now    timestamptz := now();
  v_today  date        := (v_now AT TIME ZONE 'Europe/London')::date;
  v_tz     text        := 'Europe/London';

  v_start  timestamptz;
  v_end    timestamptz;

  v_summary   jsonb;
  v_channel   jsonb;
  v_source    jsonb;
  v_campaign  jsonb;
  v_voucher   jsonb;
BEGIN
  -- Transaction-local safety limit: a pathological run self-terminates.
  PERFORM set_config('statement_timeout', '15s', true);

  ------------------------------------------------------------------
  -- 1) Resolve the period (Europe/London). Same vocabulary/meaning as the
  --    Growth + Sales dashboards, plus last_30_days.
  ------------------------------------------------------------------
  IF p_range = 'today' THEN
    v_start := (v_today::timestamp AT TIME ZONE v_tz);
    v_end   := v_now;

  ELSIF p_range = 'yesterday' THEN
    v_start := ((v_today - 1)::timestamp AT TIME ZONE v_tz);
    v_end   := (v_today::timestamp AT TIME ZONE v_tz);

  ELSIF p_range = 'last_7_days' THEN
    v_start := v_now - interval '7 days';
    v_end   := v_now;

  ELSIF p_range = 'last_30_days' THEN
    v_start := v_now - interval '30 days';
    v_end   := v_now;

  ELSIF p_range = 'custom' THEN
    IF p_from IS NULL OR p_to IS NULL THEN
      RAISE EXCEPTION 'custom range requires p_from and p_to';
    END IF;
    IF p_to < p_from THEN
      RAISE EXCEPTION 'p_to must be on or after p_from';
    END IF;
    IF (p_to - p_from) > 366 THEN
      RAISE EXCEPTION 'custom range too large (max 366 days)';
    END IF;
    v_start := (p_from::timestamp AT TIME ZONE v_tz);
    v_end   := ((p_to + 1)::timestamp AT TIME ZONE v_tz);   -- inclusive end date
  ELSE
    RAISE EXCEPTION 'unknown range: %', p_range;
  END IF;

  ------------------------------------------------------------------
  -- 2) One bounded aggregate over the sargable confirmed_at window.
  --    `base` is the single eligible-order projection; every section below
  --    aggregates from it so the window is scanned once.
  --
  --    Voucher classification — three TRUTHFUL states derived from the exact
  --    values checkout/create writes (verified against the app: BOTH insert
  --    branches always spread the discount snapshot, so subtotal_pence and
  --    discount_pence are non-null on every modern order):
  --      * 'code'        discount_code_entered IS NOT NULL  → a voucher was used
  --                      (the snapshotted code is authoritative)
  --      * 'no_voucher'  modern order, snapshot present, none used:
  --                      discount_code_entered IS NULL
  --                      AND discount_pence = 0        (NULL is NOT = 0, so this
  --                                                     excludes historic rows)
  --                      AND subtotal_pence IS NOT NULL
  --      * 'unknown'     everything else with no code — chiefly historic orders
  --                      that predate the discount snapshot (all discount_* NULL)
  --                      AND any ambiguous/partial combination. Classified
  --                      conservatively so we NEVER assert "no voucher" about an
  --                      order we cannot prove.
  --    Unknown orders are excluded from the voucher-usage denominator.
  ------------------------------------------------------------------
  WITH base AS (
    SELECT
      COALESCE(ci.attribution_channel, 'direct_unknown') AS channel,
      ci.attribution_source                              AS source,
      ci.attribution_campaign                            AS campaign,
      (ci.attribution_channel IS NOT NULL)               AS tracked,
      ci.discount_code_entered                           AS voucher_code,
      CASE
        WHEN ci.discount_code_entered IS NOT NULL THEN 'code'
        WHEN ci.discount_code_entered IS NULL
             AND ci.discount_pence = 0
             AND ci.subtotal_pence IS NOT NULL           THEN 'no_voucher'
        ELSE 'unknown'
      END                                                AS voucher_status,
      COALESCE(ci.discount_pence, 0)                     AS discount_pence,
      (CASE WHEN ci.external_payment_pence IS NOT NULL
            THEN ci.external_payment_pence
            ELSE ci.total_pence - COALESCE(ci.wallet_credit_pence, 0) END) AS net_pence
      FROM public.checkout_intents ci
     WHERE ci.state = 'confirmed'
       AND ci.provider IS DISTINCT FROM 'debug'
       AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
       AND ci.confirmed_at >= v_start
       AND ci.confirmed_at <  v_end
       AND (p_channel IS NULL OR COALESCE(ci.attribution_channel, 'direct_unknown') = p_channel)
  ),
  totals AS (
    SELECT COALESCE(SUM(net_pence), 0) AS net_total
      FROM base
  )

  ------------------------------------------------------------------
  -- 2a) Summary. Voucher usage % is over KNOWN orders only (code + no_voucher);
  --     historic 'unknown' orders are surfaced separately so the UI can say
  --     "31% of 1,420 known orders" instead of letting unknowns distort it.
  ------------------------------------------------------------------
  SELECT jsonb_build_object(
           'netRevenuePence',      COALESCE(SUM(net_pence), 0),
           'orders',               COUNT(*),
           'aovPence',             CASE WHEN COUNT(*) > 0
                                        THEN round(SUM(net_pence)::numeric / COUNT(*)) ELSE NULL END,
           'trackedRevenuePence',  COALESCE(SUM(net_pence) FILTER (WHERE tracked), 0),
           'attributionRatePct',   CASE WHEN COALESCE(SUM(net_pence), 0) > 0
                                        THEN round(
                                               SUM(net_pence) FILTER (WHERE tracked)::numeric
                                               / SUM(net_pence) * 100, 1) ELSE NULL END,
           'voucherOrders',        COUNT(*) FILTER (WHERE voucher_status = 'code'),
           'voucherKnownOrders',   COUNT(*) FILTER (WHERE voucher_status IN ('code','no_voucher')),
           'voucherUnknownOrders', COUNT(*) FILTER (WHERE voucher_status = 'unknown'),
           'voucherUsagePct',      CASE WHEN COUNT(*) FILTER (WHERE voucher_status IN ('code','no_voucher')) > 0
                                        THEN round(
                                               COUNT(*) FILTER (WHERE voucher_status = 'code')::numeric
                                               / COUNT(*) FILTER (WHERE voucher_status IN ('code','no_voucher')) * 100, 1)
                                        ELSE NULL END,
           'discountGivenPence',   COALESCE(SUM(discount_pence), 0)
         )
    INTO v_summary
    FROM base;

  ------------------------------------------------------------------
  -- 2b) By channel.
  ------------------------------------------------------------------
  SELECT COALESCE(jsonb_agg(row ORDER BY net_revenue DESC, channel ASC), '[]'::jsonb)
    INTO v_channel
    FROM (
      SELECT
        b.channel,
        SUM(b.net_pence) AS net_revenue,
        jsonb_build_object(
          'channel',              b.channel,
          'orders',               COUNT(*),
          'netRevenuePence',      COALESCE(SUM(b.net_pence), 0),
          'aovPence',             CASE WHEN COUNT(*) > 0
                                       THEN round(SUM(b.net_pence)::numeric / COUNT(*)) ELSE NULL END,
          'voucherOrders',        COUNT(*) FILTER (WHERE b.voucher_status = 'code'),
          'voucherKnownOrders',   COUNT(*) FILTER (WHERE b.voucher_status IN ('code','no_voucher')),
          'voucherUnknownOrders', COUNT(*) FILTER (WHERE b.voucher_status = 'unknown'),
          'voucherPct',           CASE WHEN COUNT(*) FILTER (WHERE b.voucher_status IN ('code','no_voucher')) > 0
                                       THEN round(
                                              COUNT(*) FILTER (WHERE b.voucher_status = 'code')::numeric
                                              / COUNT(*) FILTER (WHERE b.voucher_status IN ('code','no_voucher')) * 100, 1)
                                       ELSE NULL END,
          'discountGivenPence',   COALESCE(SUM(b.discount_pence), 0),
          'revenueSharePct',      CASE WHEN t.net_total > 0
                                       THEN round(SUM(b.net_pence)::numeric / t.net_total * 100, 1) ELSE NULL END
        ) AS row
        FROM base b CROSS JOIN totals t
       GROUP BY b.channel, t.net_total
    ) c;

  ------------------------------------------------------------------
  -- 2c) By channel + source. NULL source (typical for direct_unknown) is
  --     preserved as a canonical NULL and never dropped.
  ------------------------------------------------------------------
  SELECT COALESCE(jsonb_agg(row ORDER BY net_revenue DESC, channel ASC), '[]'::jsonb)
    INTO v_source
    FROM (
      SELECT
        b.channel,
        SUM(b.net_pence) AS net_revenue,
        jsonb_build_object(
          'channel',              b.channel,
          'source',               b.source,
          'orders',               COUNT(*),
          'netRevenuePence',      COALESCE(SUM(b.net_pence), 0),
          'aovPence',             CASE WHEN COUNT(*) > 0
                                       THEN round(SUM(b.net_pence)::numeric / COUNT(*)) ELSE NULL END,
          'voucherOrders',        COUNT(*) FILTER (WHERE b.voucher_status = 'code'),
          'voucherKnownOrders',   COUNT(*) FILTER (WHERE b.voucher_status IN ('code','no_voucher')),
          'voucherUnknownOrders', COUNT(*) FILTER (WHERE b.voucher_status = 'unknown'),
          'voucherPct',           CASE WHEN COUNT(*) FILTER (WHERE b.voucher_status IN ('code','no_voucher')) > 0
                                       THEN round(
                                              COUNT(*) FILTER (WHERE b.voucher_status = 'code')::numeric
                                              / COUNT(*) FILTER (WHERE b.voucher_status IN ('code','no_voucher')) * 100, 1)
                                       ELSE NULL END,
          'mostUsedVoucher',      mode() WITHIN GROUP (ORDER BY b.voucher_code)
                                    FILTER (WHERE b.voucher_status = 'code'),
          'discountGivenPence',   COALESCE(SUM(b.discount_pence), 0),
          'revenueSharePct',      CASE WHEN t.net_total > 0
                                       THEN round(SUM(b.net_pence)::numeric / t.net_total * 100, 1) ELSE NULL END
        ) AS row
        FROM base b CROSS JOIN totals t
       GROUP BY b.channel, b.source, t.net_total
    ) s;

  ------------------------------------------------------------------
  -- 2d) By channel + source + campaign. campaign is the immutable
  --     attribution_campaign slug snapshot.
  ------------------------------------------------------------------
  SELECT COALESCE(jsonb_agg(row ORDER BY net_revenue DESC, channel ASC), '[]'::jsonb)
    INTO v_campaign
    FROM (
      SELECT
        b.channel,
        SUM(b.net_pence) AS net_revenue,
        jsonb_build_object(
          'channel',              b.channel,
          'source',               b.source,
          'campaign',             b.campaign,
          'orders',               COUNT(*),
          'netRevenuePence',      COALESCE(SUM(b.net_pence), 0),
          'aovPence',             CASE WHEN COUNT(*) > 0
                                       THEN round(SUM(b.net_pence)::numeric / COUNT(*)) ELSE NULL END,
          'voucherOrders',        COUNT(*) FILTER (WHERE b.voucher_status = 'code'),
          'voucherKnownOrders',   COUNT(*) FILTER (WHERE b.voucher_status IN ('code','no_voucher')),
          'voucherUnknownOrders', COUNT(*) FILTER (WHERE b.voucher_status = 'unknown'),
          'voucherPct',           CASE WHEN COUNT(*) FILTER (WHERE b.voucher_status IN ('code','no_voucher')) > 0
                                       THEN round(
                                              COUNT(*) FILTER (WHERE b.voucher_status = 'code')::numeric
                                              / COUNT(*) FILTER (WHERE b.voucher_status IN ('code','no_voucher')) * 100, 1)
                                       ELSE NULL END,
          'mostUsedVoucher',      mode() WITHIN GROUP (ORDER BY b.voucher_code)
                                    FILTER (WHERE b.voucher_status = 'code'),
          'discountGivenPence',   COALESCE(SUM(b.discount_pence), 0),
          'revenueSharePct',      CASE WHEN t.net_total > 0
                                       THEN round(SUM(b.net_pence)::numeric / t.net_total * 100, 1) ELSE NULL END
        ) AS row
        FROM base b CROSS JOIN totals t
       GROUP BY b.channel, b.source, b.campaign, t.net_total
    ) g;

  ------------------------------------------------------------------
  -- 2e) By voucher. Genuine codes each get their own row; the two null-code
  --     states collapse to one row apiece and are labelled honestly. The
  --     voucherStatus field lets the UI distinguish code / no_voucher / unknown
  --     and NEVER present a historic unknown as a genuine no-voucher order.
  ------------------------------------------------------------------
  SELECT COALESCE(jsonb_agg(row ORDER BY net_revenue DESC, voucher ASC), '[]'::jsonb)
    INTO v_voucher
    FROM (
      SELECT
        CASE b.voucher_status
          WHEN 'code'       THEN b.voucher_code
          WHEN 'no_voucher' THEN 'No voucher'
          ELSE                   'Unknown'
        END AS voucher,
        SUM(b.net_pence) AS net_revenue,
        jsonb_build_object(
          'voucher',            CASE b.voucher_status
                                  WHEN 'code'       THEN b.voucher_code
                                  WHEN 'no_voucher' THEN 'No voucher'
                                  ELSE                   'Unknown'
                                END,
          'voucherStatus',      b.voucher_status,
          'orders',             COUNT(*),
          'netRevenuePence',    COALESCE(SUM(b.net_pence), 0),
          'discountGivenPence', COALESCE(SUM(b.discount_pence), 0),
          'aovPence',           CASE WHEN COUNT(*) > 0
                                     THEN round(SUM(b.net_pence)::numeric / COUNT(*)) ELSE NULL END
        ) AS row
        FROM base b
       GROUP BY b.voucher_status,
                CASE b.voucher_status
                  WHEN 'code'       THEN b.voucher_code
                  WHEN 'no_voucher' THEN 'No voucher'
                  ELSE                   'Unknown'
                END
    ) v;

  ------------------------------------------------------------------
  -- 3) Assemble the compact payload (camelCase; aggregates only).
  ------------------------------------------------------------------
  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'start',    v_start,
      'end',      v_end,
      'timezone', 'Europe/London'),
    'summary',    v_summary,
    'byChannel',  v_channel,
    'bySource',   v_source,
    'byCampaign', v_campaign,
    'byVoucher',  v_voucher,
    'generatedAt', v_now
  );
END;
$$;

COMMENT ON FUNCTION public.get_marketing_performance(text,date,date,text) IS
  'Single compact Marketing Performance payload attributing genuine confirmed revenue (confirmed_at, Europe/London) to the immutable checkout attribution + discount snapshot. Groups untracked orders as direct_unknown and classifies vouchers as code/no_voucher/unknown. Aggregates only; no customer identities. Independent of tracking_links and of the Resend recipient-attribution model.';

-- Execution grants: service_role only (called from the authenticated admin API).
REVOKE ALL ON FUNCTION public.get_marketing_performance(text,date,date,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_marketing_performance(text,date,date,text) TO service_role;
