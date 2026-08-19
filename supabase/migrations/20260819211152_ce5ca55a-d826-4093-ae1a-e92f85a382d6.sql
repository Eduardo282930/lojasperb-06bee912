
-- ============ LOJA / STORE KEY ============
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS store_settings_store_key_uidx ON public.store_settings(store_key);

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS store_key text NOT NULL DEFAULT 'sperb';
ALTER TABLE public.coupons   ADD COLUMN IF NOT EXISTS store_key text NOT NULL DEFAULT 'sperb';
ALTER TABLE public.coupons   ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE public.orders    ADD COLUMN IF NOT EXISTS store_key text NOT NULL DEFAULT 'sperb';
ALTER TABLE public.orders    ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.orders    ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
ALTER TABLE public.orders    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS customers_phone_digits_idx ON public.customers (public.only_digits(phone));
CREATE INDEX IF NOT EXISTS orders_customer_idx ON public.orders(customer_id);
CREATE INDEX IF NOT EXISTS orders_device_idx ON public.orders(device_id);
CREATE INDEX IF NOT EXISTS orders_phone_idx ON public.orders (public.only_digits(customer_phone));

DROP TRIGGER IF EXISTS orders_touch ON public.orders;
CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ ITENS DO PEDIDO ============
CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  store_key text NOT NULL DEFAULT 'sperb',
  product_key text NOT NULL DEFAULT '',
  external_variant_id text,
  name text NOT NULL DEFAULT '',
  sku text NOT NULL DEFAULT '',
  image text,
  unit_price numeric NOT NULL DEFAULT 0,
  qty numeric NOT NULL DEFAULT 1,
  total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON public.order_items(order_id);
GRANT SELECT ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view order items" ON public.order_items;
CREATE POLICY "Admins can view order items" ON public.order_items
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ HISTÓRICO DE STATUS ============
CREATE TABLE IF NOT EXISTS public.order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  store_key text NOT NULL DEFAULT 'sperb',
  status text NOT NULL,
  payment_status text,
  note text NOT NULL DEFAULT '',
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_status_history_order_idx ON public.order_status_history(order_id);
GRANT SELECT ON public.order_status_history TO authenticated;
GRANT ALL ON public.order_status_history TO service_role;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view order history" ON public.order_status_history;
CREATE POLICY "Admins can view order history" ON public.order_status_history
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ DUPLICIDADE DE CLIENTES ============
CREATE TABLE IF NOT EXISTS public.customer_duplicates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_key text NOT NULL DEFAULT 'sperb',
  existing_customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  new_customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  incoming_name text NOT NULL DEFAULT '',
  incoming_phone text NOT NULL DEFAULT '',
  device_id text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT 'name_match',
  status text NOT NULL DEFAULT 'pending',
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_duplicates_status_idx ON public.customer_duplicates(status);
GRANT SELECT, UPDATE ON public.customer_duplicates TO authenticated;
GRANT ALL ON public.customer_duplicates TO service_role;
ALTER TABLE public.customer_duplicates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage duplicates" ON public.customer_duplicates;
CREATE POLICY "Admins manage duplicates" ON public.customer_duplicates
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Admins update duplicates" ON public.customer_duplicates;
CREATE POLICY "Admins update duplicates" ON public.customer_duplicates
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ USO E HISTÓRICO DE CUPONS ============
CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_key text NOT NULL DEFAULT 'sperb',
  coupon_id uuid REFERENCES public.coupons(id) ON DELETE SET NULL,
  coupon_code text NOT NULL DEFAULT '',
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_phone text NOT NULL DEFAULT '',
  discount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_idx ON public.coupon_redemptions(coupon_id);
CREATE INDEX IF NOT EXISTS coupon_redemptions_customer_idx ON public.coupon_redemptions(customer_id);
GRANT SELECT ON public.coupon_redemptions TO authenticated;
GRANT ALL ON public.coupon_redemptions TO service_role;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view redemptions" ON public.coupon_redemptions;
CREATE POLICY "Admins can view redemptions" ON public.coupon_redemptions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.coupon_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_key text NOT NULL DEFAULT 'sperb',
  coupon_id uuid,
  action text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coupon_audit_coupon_idx ON public.coupon_audit(coupon_id);
GRANT SELECT ON public.coupon_audit TO authenticated;
GRANT ALL ON public.coupon_audit TO service_role;
ALTER TABLE public.coupon_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view coupon audit" ON public.coupon_audit;
CREATE POLICY "Admins can view coupon audit" ON public.coupon_audit
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.log_coupon_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.coupon_audit (coupon_id, action, after_data, changed_by)
    VALUES (NEW.id, 'insert', to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.coupon_audit (coupon_id, action, before_data, after_data, changed_by)
    VALUES (NEW.id, 'update', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSE
    INSERT INTO public.coupon_audit (coupon_id, action, before_data, changed_by)
    VALUES (OLD.id, 'delete', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  END IF;
END;
$$;
DROP TRIGGER IF EXISTS coupons_audit ON public.coupons;
CREATE TRIGGER coupons_audit AFTER INSERT OR UPDATE OR DELETE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.log_coupon_change();

-- ============ MOVIMENTAÇÕES DE ESTOQUE ============
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_key text NOT NULL DEFAULT 'sperb',
  product_key text NOT NULL DEFAULT '',
  external_variant_id text,
  previous_stock numeric,
  new_stock numeric,
  delta numeric NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT 'loyverse_sync',
  source text NOT NULL DEFAULT 'loyverse',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_movements_product_idx ON public.inventory_movements(store_key, product_key, created_at DESC);
GRANT SELECT ON public.inventory_movements TO authenticated;
GRANT ALL ON public.inventory_movements TO service_role;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view stock movements" ON public.inventory_movements;
CREATE POLICY "Admins can view stock movements" ON public.inventory_movements
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ CRIAÇÃO DE PEDIDO (itens + histórico) ============
CREATE OR REPLACE FUNCTION public.create_order(
  p_device_id text, p_name text, p_phone text, p_items jsonb,
  p_subtotal numeric, p_discount numeric, p_total numeric, p_coupon_code text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer uuid;
  v_coupon uuid;
  v_id uuid;
  v_item jsonb;
BEGIN
  SELECT id INTO v_customer FROM public.customers
   WHERE public.only_digits(phone) = public.only_digits(p_phone)
     AND public.only_digits(p_phone) <> '' LIMIT 1;
  IF v_customer IS NULL THEN
    SELECT id INTO v_customer FROM public.customers WHERE device_id = p_device_id LIMIT 1;
  END IF;
  IF coalesce(p_coupon_code, '') <> '' THEN
    SELECT id INTO v_coupon FROM public.coupons WHERE code = p_coupon_code LIMIT 1;
  END IF;

  INSERT INTO public.orders (
    store_key, customer_id, coupon_id, items, subtotal, discount, total, status,
    payment_status, customer_name, customer_phone, coupon_code, device_id
  ) VALUES (
    'sperb', v_customer, v_coupon, coalesce(p_items, '[]'::jsonb),
    coalesce(p_subtotal, 0), coalesce(p_discount, 0), coalesce(p_total, 0), 'sent',
    'pending', coalesce(p_name, ''), coalesce(p_phone, ''), coalesce(p_coupon_code, ''),
    coalesce(p_device_id, '')
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

  RETURN v_id;
END;
$$;

-- ============ CLIENTE: pedidos próprios ============
CREATE OR REPLACE FUNCTION public.orders_for_customer(p_device_id text, p_phone text)
RETURNS TABLE (
  id uuid, created_at timestamptz, status text, payment_status text,
  subtotal numeric, discount numeric, total numeric, coupon_code text,
  customer_name text, items jsonb
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.created_at, o.status, o.payment_status, o.subtotal, o.discount,
         o.total, o.coupon_code, o.customer_name, o.items
  FROM public.orders o
  WHERE (coalesce(p_device_id, '') <> '' AND o.device_id = p_device_id)
     OR (public.only_digits(coalesce(p_phone, '')) <> ''
         AND public.only_digits(o.customer_phone) = public.only_digits(p_phone))
  ORDER BY o.created_at DESC
  LIMIT 100;
$$;

CREATE OR REPLACE FUNCTION public.order_history_for_customer(p_order_id uuid, p_device_id text, p_phone text)
RETURNS TABLE (status text, payment_status text, note text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT h.status, h.payment_status, h.note, h.created_at
  FROM public.order_status_history h
  JOIN public.orders o ON o.id = h.order_id
  WHERE h.order_id = p_order_id
    AND ((coalesce(p_device_id, '') <> '' AND o.device_id = p_device_id)
      OR (public.only_digits(coalesce(p_phone, '')) <> ''
          AND public.only_digits(o.customer_phone) = public.only_digits(p_phone)))
  ORDER BY h.created_at ASC;
$$;

-- ============ ADMIN: status do pedido ============
CREATE OR REPLACE FUNCTION public.admin_set_order_status(
  p_order_id uuid, p_status text, p_payment_status text, p_note text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN false;
  END IF;
  UPDATE public.orders
     SET status = coalesce(nullif(p_status, ''), status),
         payment_status = coalesce(nullif(p_payment_status, ''), payment_status)
   WHERE id = p_order_id;
  INSERT INTO public.order_status_history (order_id, status, payment_status, note, changed_by)
  VALUES (p_order_id, coalesce(nullif(p_status, ''), 'sent'), nullif(p_payment_status, ''), coalesce(p_note, ''), auth.uid());
  RETURN true;
END;
$$;

-- ============ CLIENTES: cadastro sem mesclagem automática ============
DROP FUNCTION IF EXISTS public.save_customer(text, text, text);
CREATE OR REPLACE FUNCTION public.save_customer(p_device_id text, p_name text, p_phone text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_digits text := public.only_digits(p_phone);
  v_id uuid;
  v_locked text;
  v_match uuid;
BEGIN
  IF v_digits = '' THEN
    RETURN NULL;
  END IF;

  SELECT id, nullif(name, '') INTO v_id, v_locked
  FROM public.customers
  WHERE public.only_digits(phone) = v_digits
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.customers SET device_id = NULL
     WHERE device_id = p_device_id AND id <> v_id;
    UPDATE public.customers
       SET name = coalesce(v_locked, nullif(trim(p_name), ''), ''),
           phone = p_phone,
           device_id = coalesce(p_device_id, device_id),
           updated_at = now()
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.customers (device_id, name, phone, source, store_key)
  VALUES (p_device_id, coalesce(nullif(trim(p_name), ''), ''), p_phone, 'app', 'sperb')
  RETURNING id INTO v_id;

  -- Possível duplicidade por nome: apenas registra para revisão manual.
  IF nullif(trim(p_name), '') IS NOT NULL THEN
    SELECT id INTO v_match FROM public.customers
     WHERE id <> v_id AND lower(trim(name)) = lower(trim(p_name))
     ORDER BY created_at LIMIT 1;
    IF v_match IS NOT NULL THEN
      INSERT INTO public.customer_duplicates (
        existing_customer_id, new_customer_id, incoming_name, incoming_phone, device_id, reason
      ) VALUES (v_match, v_id, trim(p_name), p_phone, coalesce(p_device_id, ''), 'name_match');
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_resolve_duplicate(p_id uuid, p_action text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.customer_duplicates;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN false;
  END IF;
  SELECT * INTO v_row FROM public.customer_duplicates WHERE id = p_id;
  IF v_row.id IS NULL THEN RETURN false; END IF;

  IF p_action = 'update_phone' AND v_row.existing_customer_id IS NOT NULL THEN
    UPDATE public.orders SET customer_id = v_row.existing_customer_id
     WHERE customer_id = v_row.new_customer_id;
    UPDATE public.coupons SET customer_id = v_row.existing_customer_id
     WHERE customer_id = v_row.new_customer_id;
    DELETE FROM public.customers WHERE id = v_row.new_customer_id;
    UPDATE public.customers
       SET phone = v_row.incoming_phone,
           device_id = coalesce(nullif(v_row.device_id, ''), device_id),
           updated_at = now()
     WHERE id = v_row.existing_customer_id;
    UPDATE public.customer_duplicates
       SET status = 'phone_updated', resolved_at = now(), resolved_by = auth.uid() WHERE id = p_id;
  ELSIF p_action = 'keep_new' THEN
    UPDATE public.customer_duplicates
       SET status = 'kept_new', resolved_at = now(), resolved_by = auth.uid() WHERE id = p_id;
  ELSE
    UPDATE public.customer_duplicates
       SET status = 'later', resolved_at = now(), resolved_by = auth.uid() WHERE id = p_id;
  END IF;
  RETURN true;
END;
$$;
