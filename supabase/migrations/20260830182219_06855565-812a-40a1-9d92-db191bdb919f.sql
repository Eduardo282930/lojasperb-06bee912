-- 1) Novos campos de fluxo no pedido
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS flow_state text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS loyverse_receipt_id text,
  ADD COLUMN IF NOT EXISTS sync_error text;

CREATE UNIQUE INDEX IF NOT EXISTS orders_loyverse_receipt_id_key
  ON public.orders (loyverse_receipt_id) WHERE loyverse_receipt_id IS NOT NULL;

-- 2) Reservas de estoque
CREATE TABLE IF NOT EXISTS public.order_stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_key text NOT NULL DEFAULT 'sperb',
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_key text NOT NULL DEFAULT '',
  external_variant_id text,
  qty numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, product_key, external_variant_id)
);

GRANT SELECT ON public.order_stock_reservations TO anon, authenticated;
GRANT ALL ON public.order_stock_reservations TO service_role;
ALTER TABLE public.order_stock_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reservations readable" ON public.order_stock_reservations;
CREATE POLICY "reservations readable" ON public.order_stock_reservations
  FOR SELECT USING (true);

DROP TRIGGER IF EXISTS order_stock_reservations_touch ON public.order_stock_reservations;
CREATE TRIGGER order_stock_reservations_touch BEFORE UPDATE
  ON public.order_stock_reservations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3) Produtos em destaque na vitrine
CREATE TABLE IF NOT EXISTS public.featured_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_key text NOT NULL DEFAULT 'sperb',
  product_key text NOT NULL,
  section text NOT NULL DEFAULT 'featured',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_key, section, product_key)
);

GRANT SELECT ON public.featured_products TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.featured_products TO authenticated;
GRANT ALL ON public.featured_products TO service_role;
ALTER TABLE public.featured_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "featured readable" ON public.featured_products;
CREATE POLICY "featured readable" ON public.featured_products FOR SELECT USING (true);
DROP POLICY IF EXISTS "featured admin write" ON public.featured_products;
CREATE POLICY "featured admin write" ON public.featured_products FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS featured_products_touch ON public.featured_products;
CREATE TRIGGER featured_products_touch BEFORE UPDATE
  ON public.featured_products FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4) Estoque reservado (para descontar da vitrine)
CREATE OR REPLACE FUNCTION public.reserved_stock()
RETURNS TABLE(product_key text, external_variant_id text, qty numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT r.product_key, r.external_variant_id, sum(r.qty)::numeric
  FROM public.order_stock_reservations r
  WHERE r.active = true
  GROUP BY r.product_key, r.external_variant_id
$$;

-- 5) Mais vendidos (últimos 90 dias)
CREATE OR REPLACE FUNCTION public.top_selling_products()
RETURNS TABLE(product_key text, qty numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT i.product_key, sum(i.qty)::numeric AS qty
  FROM public.order_items i
  JOIN public.orders o ON o.id = i.order_id
  WHERE i.product_key <> ''
    AND o.status <> 'canceled'
    AND o.created_at > now() - interval '90 days'
  GROUP BY i.product_key
  ORDER BY sum(i.qty) DESC
  LIMIT 40
$$;

-- 6) create_order agora reserva o estoque e nasce como RESERVED/não pago
CREATE OR REPLACE FUNCTION public.create_order(p_device_id text, p_name text, p_phone text, p_items jsonb, p_subtotal numeric, p_discount numeric, p_total numeric, p_coupon_code text, p_coins integer DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    coins_used, coins_discount, flow_state
  ) VALUES (
    'sperb', v_customer, v_coupon, coalesce(p_items, '[]'::jsonb),
    coalesce(p_subtotal, 0), coalesce(p_discount, 0), v_total, 'sent',
    'pending', coalesce(p_name, ''), coalesce(p_phone, ''), coalesce(p_coupon_code, ''),
    coalesce(p_device_id, ''), v_coins, v_coin_discount, 'RESERVED'
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

    INSERT INTO public.order_stock_reservations (order_id, product_key, external_variant_id, qty)
    VALUES (
      v_id,
      coalesce(v_item->>'productKey', ''),
      nullif(v_item->>'id', ''),
      coalesce((v_item->>'qty')::numeric, 1)
    )
    ON CONFLICT (order_id, product_key, external_variant_id) DO UPDATE
      SET qty = public.order_stock_reservations.qty + EXCLUDED.qty, active = true;
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
$function$;

-- 7) Mudança de status: libera reserva ao cancelar, marca fluxo, credita moedas uma vez
CREATE OR REPLACE FUNCTION public.admin_set_order_status(p_order_id uuid, p_status text, p_payment_status text, p_note text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_payment text;
  v_order public.orders;
  v_reward integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN false;
  END IF;

  v_status := coalesce(nullif(p_status, ''), '');
  v_payment := coalesce(nullif(p_payment_status, ''), '');

  UPDATE public.orders
     SET status = coalesce(nullif(p_status, ''), status),
         payment_status = coalesce(nullif(p_payment_status, ''), payment_status)
   WHERE id = p_order_id;

  INSERT INTO public.order_status_history (order_id, status, payment_status, note)
  VALUES (p_order_id, coalesce(nullif(p_status, ''), 'sent'), nullif(p_payment_status, ''), coalesce(p_note, ''));

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;

  IF v_status = 'canceled' THEN
    UPDATE public.order_stock_reservations SET active = false, updated_at = now()
     WHERE order_id = p_order_id AND active = true;
    UPDATE public.orders SET flow_state = 'CANCELLED' WHERE id = p_order_id;
  ELSIF v_status = 'delivered' THEN
    UPDATE public.orders SET flow_state = 'COMPLETED' WHERE id = p_order_id;
  ELSIF v_payment = 'paid' AND coalesce(v_order.flow_state, '') IN ('PENDING', 'RESERVED', 'SYNC_ERROR') THEN
    UPDATE public.orders SET flow_state = 'PAID' WHERE id = p_order_id;
  END IF;

  IF v_status = 'delivered' THEN
    IF v_order.customer_id IS NOT NULL AND v_order.coupon_id IS NOT NULL THEN
      SELECT coalesce(reward_coins, 0) INTO v_reward FROM public.coupons WHERE id = v_order.coupon_id;
      IF v_reward > 0 AND NOT EXISTS (
        SELECT 1 FROM public.customer_coin_ledger
         WHERE order_id = p_order_id AND reason = 'moedas do cupom (pedido concluído)'
      ) THEN
        INSERT INTO public.customer_coin_ledger (customer_id, delta, reason, order_id)
        VALUES (v_order.customer_id, v_reward, 'moedas do cupom (pedido concluído)', p_order_id);

        INSERT INTO public.customer_notifications (customer_id, kind, title, body)
        VALUES (v_order.customer_id, 'coins', 'Você ganhou ' || v_reward || ' moedas!',
                'Seu pedido foi concluído e as moedas já estão na sua conta SPERB.');
      END IF;
    END IF;
  END IF;

  RETURN true;
END;
$function$;

-- 8) Recibo do Loyverse: grava uma única vez
CREATE OR REPLACE FUNCTION public.admin_mark_receipt_synced(p_order_id uuid, p_receipt_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RETURN false; END IF;
  UPDATE public.orders
     SET loyverse_receipt_id = coalesce(loyverse_receipt_id, p_receipt_id),
         flow_state = 'LOYVERSE_SYNCED',
         sync_error = NULL
   WHERE id = p_order_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_mark_sync_error(p_order_id uuid, p_error text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RETURN false; END IF;
  UPDATE public.orders
     SET flow_state = 'SYNC_ERROR', sync_error = left(coalesce(p_error, ''), 500)
   WHERE id = p_order_id AND loyverse_receipt_id IS NULL;
  RETURN true;
END;
$$;

-- 9) Aviso para todos os clientes (sem repetir o mesmo aviso)
CREATE OR REPLACE FUNCTION public.admin_broadcast_notification(p_kind text, p_title text, p_body text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RETURN 0; END IF;
  INSERT INTO public.customer_notifications (customer_id, kind, title, body)
  SELECT c.id, coalesce(nullif(p_kind, ''), 'info'), p_title, p_body
  FROM public.customers c
  WHERE public.only_digits(c.phone) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.customer_notifications n
      WHERE n.customer_id = c.id AND n.title = p_title
        AND n.created_at > now() - interval '7 days'
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_mark_receipt_synced(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_mark_sync_error(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_broadcast_notification(text, text, text) FROM anon;