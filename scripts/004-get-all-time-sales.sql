-- RPC function to get all-time confirmed sales total
-- Returns sum of total_pence from checkout_intents where state = 'confirmed'
-- Called by admin dashboard to avoid REST row-fetch limitations

CREATE OR REPLACE FUNCTION get_all_time_sales_pence()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(SUM(total_pence), 0)::bigint
  FROM checkout_intents
  WHERE state = 'confirmed';
$$;

-- Grant execute to service role (admin dashboard uses service client)
GRANT EXECUTE ON FUNCTION get_all_time_sales_pence() TO service_role;
