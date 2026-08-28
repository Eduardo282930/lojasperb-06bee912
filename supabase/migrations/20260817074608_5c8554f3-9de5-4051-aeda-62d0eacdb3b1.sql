ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_name text NOT NULL DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_phone text NOT NULL DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS coupon_code text NOT NULL DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS device_id text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS orders_customer_phone_idx ON public.orders (customer_phone);
CREATE INDEX IF NOT EXISTS coupons_customer_phone_idx ON public.coupons (customer_phone);

CREATE OR REPLACE FUNCTION public.only_digits(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g')
$$;

-- Public catalog coupons only (exclusive ones are fetched through coupons_for_phone)
DROP POLICY IF EXISTS "Anyone can view active coupons" ON public.coupons;
CREATE POLICY "Anyone can view public active coupons"
ON public.coupons FOR SELECT TO anon, authenticated
USING (active = true AND customer_phone IS NULL);

-- Exclusive coupons for a given phone
CREATE OR REPLACE FUNCTION public.coupons_for_phone(p_phone text)
RETURNS SETOF public.coupons
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.coupons
  WHERE active = true
    AND customer_phone IS NOT NULL
    AND public.only_digits(customer_phone) = public.only_digits(p_phone)
    AND public.only_digits(p_phone) <> ''
$$;
GRANT EXECUTE ON FUNCTION public.coupons_for_phone(text) TO anon, authenticated;

-- Name is locked to the first registration of each phone number
CREATE OR REPLACE FUNCTION public.save_customer(p_device_id text, p_name text, p_phone text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_locked text;
BEGIN
  SELECT name INTO v_locked
  FROM public.customers
  WHERE public.only_digits(phone) = public.only_digits(p_phone)
    AND public.only_digits(p_phone) <> ''
    AND coalesce(name, '') <> ''
  ORDER BY created_at
  LIMIT 1;

  INSERT INTO public.customers (device_id, name, phone)
  VALUES (p_device_id, coalesce(v_locked, p_name), p_phone)
  ON CONFLICT (device_id) DO UPDATE
    SET name = coalesce(v_locked, EXCLUDED.name),
        phone = EXCLUDED.phone,
        updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_customer(text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.lookup_customer_name(p_phone text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT name FROM public.customers
  WHERE public.only_digits(phone) = public.only_digits(p_phone)
    AND public.only_digits(p_phone) <> ''
    AND coalesce(name, '') <> ''
  ORDER BY created_at
  LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.lookup_customer_name(text) TO anon, authenticated;

-- Registers the WhatsApp order
CREATE OR REPLACE FUNCTION public.create_order(
  p_device_id text,
  p_name text,
  p_phone text,
  p_items jsonb,
  p_subtotal numeric,
  p_discount numeric,
  p_total numeric,
  p_coupon_code text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer uuid;
  v_coupon uuid;
  v_id uuid;
BEGIN
  SELECT id INTO v_customer FROM public.customers
   WHERE device_id = p_device_id LIMIT 1;
  IF coalesce(p_coupon_code, '') <> '' THEN
    SELECT id INTO v_coupon FROM public.coupons WHERE code = p_coupon_code LIMIT 1;
  END IF;

  INSERT INTO public.orders (
    customer_id, coupon_id, items, subtotal, discount, total, status,
    customer_name, customer_phone, coupon_code, device_id
  ) VALUES (
    v_customer, v_coupon, coalesce(p_items, '[]'::jsonb),
    coalesce(p_subtotal, 0), coalesce(p_discount, 0), coalesce(p_total, 0), 'sent',
    coalesce(p_name, ''), coalesce(p_phone, ''), coalesce(p_coupon_code, ''), coalesce(p_device_id, '')
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_order(text, text, text, jsonb, numeric, numeric, numeric, text) TO anon, authenticated;