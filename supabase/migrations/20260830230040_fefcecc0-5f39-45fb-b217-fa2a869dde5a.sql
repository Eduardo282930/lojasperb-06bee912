REVOKE ALL ON FUNCTION public.confirm_order_payment(uuid, text, text, text, numeric, text, jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_order_payment_link(uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_order_payment(uuid, text, text, text, numeric, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_order_payment_link(uuid, text, text) TO service_role;