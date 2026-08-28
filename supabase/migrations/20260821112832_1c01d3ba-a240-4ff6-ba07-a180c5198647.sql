-- Helper: resolve customer by device/phone
CREATE OR REPLACE FUNCTION public.resolve_customer(p_device_id text, p_phone text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF public.only_digits(coalesce(p_phone, '')) <> '' THEN
    SELECT id INTO v_id FROM public.customers
     WHERE public.only_digits(phone) = public.only_digits(p_phone)
     ORDER BY created_at LIMIT 1;
  END IF;
  IF v_id IS NULL AND coalesce(p_device_id, '') <> '' THEN
    SELECT id INTO v_id FROM public.customers
     WHERE device_id = p_device_id ORDER BY created_at LIMIT 1;
  END IF;
  RETURN v_id;
END;
$$;

-- Cupons resgatados por cliente
CREATE TABLE public.customer_coupon_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_key text NOT NULL DEFAULT 'sperb',
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, coupon_id)
);

GRANT SELECT ON public.customer_coupon_claims TO authenticated;
GRANT ALL ON public.customer_coupon_claims TO service_role;

ALTER TABLE public.customer_coupon_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view coupon claims"
ON public.customer_coupon_claims FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER customer_coupon_claims_touch
BEFORE UPDATE ON public.customer_coupon_claims
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Histórico de moedas
CREATE TABLE public.customer_coin_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_key text NOT NULL DEFAULT 'sperb',
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  delta integer NOT NULL,
  reason text NOT NULL DEFAULT '',
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customer_coin_ledger_customer_idx ON public.customer_coin_ledger (customer_id, created_at DESC);

GRANT SELECT ON public.customer_coin_ledger TO authenticated;
GRANT ALL ON public.customer_coin_ledger TO service_role;

ALTER TABLE public.customer_coin_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view coin ledger"
ON public.customer_coin_ledger FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Moedas no pedido
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS coins_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coins_discount numeric NOT NULL DEFAULT 0;

-- Resgate de cupom vinculado ao cliente
CREATE OR REPLACE FUNCTION public.claim_coupon(p_device_id text, p_phone text, p_coupon_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_customer uuid;
  v_ok boolean;
BEGIN
  v_customer := public.resolve_customer(p_device_id, p_phone);
  IF v_customer IS NULL THEN RETURN false; END IF;

  SELECT true INTO v_ok FROM public.coupons
   WHERE id = p_coupon_id AND active = true
     AND (max_uses IS NULL OR uses < max_uses)
     AND (customer_phone IS NULL
          OR public.only_digits(customer_phone) = public.only_digits(p_phone));
  IF v_ok IS NULL THEN RETURN false; END IF;

  INSERT INTO public.customer_coupon_claims (customer_id, coupon_id)
  VALUES (v_customer, p_coupon_id)
  ON CONFLICT (customer_id, coupon_id) DO NOTHING;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.coupons_claimed_for_customer(p_device_id text, p_phone text)
RETURNS SETOF public.coupons
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.* FROM public.coupons c
  JOIN public.customer_coupon_claims cc ON cc.coupon_id = c.id
  WHERE cc.customer_id = public.resolve_customer(p_device_id, p_phone)
  ORDER BY cc.claimed_at DESC;
$$;

-- Moedas
CREATE OR REPLACE FUNCTION public.coin_balance_for_customer(p_device_id text, p_phone text)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(sum(delta), 0)::integer FROM public.customer_coin_ledger
  WHERE customer_id = public.resolve_customer(p_device_id, p_phone);
$$;

CREATE OR REPLACE FUNCTION public.coin_history_for_customer(p_device_id text, p_phone text)
RETURNS TABLE(id uuid, delta integer, reason text, order_id uuid, created_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT l.id, l.delta, l.reason, l.order_id, l.created_at
  FROM public.customer_coin_ledger l
  WHERE l.customer_id = public.resolve_customer(p_device_id, p_phone)
  ORDER BY l.created_at DESC
  LIMIT 100;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_coins(p_customer_id uuid, p_delta integer, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_balance integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  IF p_delta = 0 THEN
    SELECT coalesce(sum(delta), 0)::integer INTO v_balance
      FROM public.customer_coin_ledger WHERE customer_id = p_customer_id;
    RETURN v_balance;
  END IF;

  SELECT coalesce(sum(delta), 0)::integer INTO v_balance
    FROM public.customer_coin_ledger WHERE customer_id = p_customer_id;
  IF v_balance + p_delta < 0 THEN
    p_delta := -v_balance;
  END IF;

  INSERT INTO public.customer_coin_ledger (customer_id, delta, reason, created_by)
  VALUES (p_customer_id, p_delta, coalesce(nullif(trim(p_reason), ''), 'ajuste manual'), auth.uid());

  RETURN v_balance + p_delta;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_coin_balance(p_customer_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN public.has_role(auth.uid(), 'admin')
    THEN (SELECT coalesce(sum(delta), 0)::integer FROM public.customer_coin_ledger WHERE customer_id = p_customer_id)
    ELSE NULL END;
$$;

-- create_order com moedas
DROP FUNCTION IF EXISTS public.create_order(text, text, text, jsonb, numeric, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.create_order(
  p_device_id text, p_name text, p_phone text, p_items jsonb,
  p_subtotal numeric, p_discount numeric, p_total numeric, p_coupon_code text,
  p_coins integer DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_customer uuid;
  v_coupon uuid;
  v_id uuid;
  v_item jsonb;
  v_balance integer := 0;
  v_coins integer := 0;
  v_eligible numeric := 0;
  v_max_coins integer := 0;
  v_coin_discount numeric := 0;
  v_total numeric;
BEGIN
  v_customer := public.resolve_customer(p_device_id, p_phone);

  IF coalesce(p_coupon_code, '') <> '' THEN
    SELECT id INTO v_coupon FROM public.coupons WHERE code = p_coupon_code LIMIT 1;
  END IF;

  v_eligible := greatest(coalesce(p_subtotal, 0) - coalesce(p_discount, 0), 0);
  IF v_customer IS NOT NULL AND coalesce(p_coins, 0) > 0 THEN
    SELECT coalesce(sum(delta), 0)::integer INTO v_balance
      FROM public.customer_coin_ledger WHERE customer_id = v_customer;
    v_max_coins := floor(v_eligible * 0.30 * 100)::integer;
    v_coins := least(coalesce(p_coins, 0), greatest(v_balance, 0), greatest(v_max_coins, 0));
    v_coin_discount := round(v_coins / 100.0, 2);
  END IF;

  v_total := greatest(v_eligible - v_coin_discount, 0);

  INSERT INTO public.orders (
    store_key, customer_id, coupon_id, items, subtotal, discount, total, status,
    payment_status, customer_name, customer_phone, coupon_code, device_id,
    coins_used, coins_discount
  ) VALUES (
    'sperb', v_customer, v_coupon, coalesce(p_items, '[]'::jsonb),
    coalesce(p_subtotal, 0), coalesce(p_discount, 0), v_total, 'sent',
    'pending', coalesce(p_name, ''), coalesce(p_phone, ''), coalesce(p_coupon_code, ''),
    coalesce(p_device_id, ''), v_coins, v_coin_discount
  ) RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) LOOP
    INSERT INTO public.order_items (
      order_id, product_key, external_variant_id, name, sku, image, unit_price, qty, total
    ) VALUES (
      v_id,
      coalesce(v_item->>'productKey', ''),
      nullif(v_item->>'id', ''),
      coalesce(v_item->>'name', ''),
      coalesce(v_item->>'sku', ''),
      nullif(v_item->>'image', ''),
      coalesce((v_item->>'price')::numeric, 0),
      coalesce((v_item->>'qty')::numeric, 1),
      coalesce((v_item->>'price')::numeric, 0) * coalesce((v_item->>'qty')::numeric, 1)
    );
  END LOOP;

  INSERT INTO public.order_status_history (order_id, status, payment_status, note)
  VALUES (v_id, 'sent', 'pending', 'Pedido enviado pelo WhatsApp');

  IF v_coupon IS NOT NULL THEN
    INSERT INTO public.coupon_redemptions (coupon_id, coupon_code, order_id, customer_id, customer_phone, discount)
    VALUES (v_coupon, p_coupon_code, v_id, v_customer, public.only_digits(p_phone), coalesce(p_discount, 0));
  END IF;

  IF v_coins > 0 THEN
    INSERT INTO public.customer_coin_ledger (customer_id, delta, reason, order_id)
    VALUES (v_customer, -v_coins, 'uso em pedido', v_id);
  END IF;

  RETURN v_id;
END;
$$;