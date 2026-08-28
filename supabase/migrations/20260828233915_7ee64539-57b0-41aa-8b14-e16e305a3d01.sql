ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS max_uses_per_customer integer;

CREATE OR REPLACE FUNCTION public.coupon_uses_for_customer(p_device_id text, p_phone text)
RETURNS TABLE(coupon_id uuid, uses integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.coupon_id, count(*)::int AS uses
  FROM public.coupon_redemptions r
  WHERE r.coupon_id IS NOT NULL
    AND r.customer_id IS NOT NULL
    AND r.customer_id = (
      SELECT c.id FROM public.customers c
      WHERE (public.only_digits(p_phone) <> '' AND public.only_digits(c.phone) = public.only_digits(p_phone))
         OR (p_device_id <> '' AND c.device_id = p_device_id)
      ORDER BY (public.only_digits(c.phone) = public.only_digits(p_phone)) DESC, c.created_at
      LIMIT 1
    )
  GROUP BY r.coupon_id
$$;

GRANT EXECUTE ON FUNCTION public.coupon_uses_for_customer(text, text) TO anon, authenticated;