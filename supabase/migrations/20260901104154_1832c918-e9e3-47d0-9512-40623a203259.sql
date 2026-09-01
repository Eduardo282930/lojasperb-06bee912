REVOKE EXECUTE ON FUNCTION public.discard_unpaid_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discard_unpaid_order(uuid) TO service_role;