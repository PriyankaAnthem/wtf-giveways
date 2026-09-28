-- Returns total confirmed revenue (in pence) grouped by campaign_id
-- Used by /admin/reports to avoid fetching thousands of raw checkout rows

CREATE OR REPLACE FUNCTION get_revenue_by_campaign()
RETURNS TABLE (
  campaign_id uuid,
  total_pence bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    ci.campaign_id,
    COALESCE(SUM(ci.total_pence), 0)::bigint AS total_pence
  FROM public.checkout_intents ci
  WHERE ci.state = 'confirmed'
  GROUP BY ci.campaign_id;
$$;
