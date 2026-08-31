-- 1. E-mail no pedido e validade das reservas
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_email text NOT NULL DEFAULT '';
ALTER TABLE public.order_stock_reservations ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- 2. Cadastro do cliente com e-mail
CREATE OR REPLACE FUNCTION public.save_customer(p_device_id text, p_name text, p_phone text, p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_digits text := public.only_digits(p_phone);
  v_id uuid;
  v_locked text;
  v_match uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
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
           email = CASE WHEN v_email <> '' THEN v_email ELSE email END,
           device_id = coalesce(p_device_id, device_id),
           updated_at = now()
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.customers (device_id, name, phone, email, source, store_key)
  VALUES (p_device_id, coalesce(nullif(trim(p_name), ''), ''), p_phone, v_email, 'app', 'sperb')
  RETURNING id INTO v_id;

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
$function$;

-- 3. Perfil por telefone (nome + e-mail já cadastrados) e busca por e-mail
CREATE OR REPLACE FUNCTION public.lookup_customer_profile(p_phone text)
RETURNS TABLE(name text, email text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT c.name, c.email FROM public.customers c
  WHERE public.only_digits(c.phone) = public.only_digits(p_phone)
    AND public.only_digits(p_phone) <> ''
  ORDER BY c.created_at
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.lookup_customer_by_email(p_email text)
RETURNS TABLE(name text, phone text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT c.name, c.phone FROM public.customers c
  WHERE lower(trim(c.email)) = lower(trim(coalesce(p_email, '')))
    AND trim(coalesce(p_email, '')) <> ''
  ORDER BY c.created_at
  LIMIT 1
$function$;

-- 4. Criação do pedido com e-mail e reserva com validade
DROP FUNCTION IF EXISTS public.create_order(text, text, text, jsonb, numeric, numeric, numeric, text, integer);

CREATE OR REPLACE FUNCTION public.create_order(
  p_device_id text, p_name text, p_phone text, p_items jsonb,
  p_subtotal numeric, p_discount numeric, p_total numeric,
  p_coupon_code text, p_coins integer DEFAULT 0, p_email text DEFAULT ''
)
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
    payment_status, customer_name, customer_phone, customer_email, coupon_code, device_id,
    coins_used, coins_discount, flow_state
  ) VALUES (
    'sperb', v_customer, v_coupon, coalesce(p_items, '[]'::jsonb),
    coalesce(p_subtotal, 0), coalesce(p_discount, 0), v_total, 'sent',
    'pending', coalesce(p_name, ''), coalesce(p_phone, ''), lower(trim(coalesce(p_email, ''))),
    coalesce(p_coupon_code, ''), coalesce(p_device_id, ''), v_coins, v_coin_discount, 'RESERVED'
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

    INSERT INTO public.order_stock_reservations (order_id, product_key, external_variant_id, qty, expires_at)
    VALUES (
      v_id,
      coalesce(v_item->>'productKey', ''),
      nullif(v_item->>'id', ''),
      coalesce((v_item->>'qty')::numeric, 1),
      now() + interval '30 minutes'
    )
    ON CONFLICT (order_id, product_key, external_variant_id) DO UPDATE
      SET qty = public.order_stock_reservations.qty + EXCLUDED.qty, active = true;
  END LOOP;

  INSERT INTO public.order_status_history (order_id, status, payment_status, note)
  VALUES (v_id, 'sent', 'pending', 'Pedido criado e estoque reservado');

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

-- 5. Liberação automática de reservas de pedidos abandonados
CREATE OR REPLACE FUNCTION public.expire_stale_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  v_order record;
BEGIN
  FOR v_order IN
    SELECT o.id, o.customer_id, o.coins_used
    FROM public.orders o
    WHERE o.payment_status <> 'paid'
      AND o.status <> 'canceled'
      AND coalesce(o.flow_state, '') IN ('PENDING', 'RESERVED')
      AND EXISTS (
        SELECT 1 FROM public.order_stock_reservations r
        WHERE r.order_id = o.id AND r.active = true
          AND r.expires_at IS NOT NULL AND r.expires_at < now()
      )
  LOOP
    UPDATE public.order_stock_reservations
       SET active = false, updated_at = now()
     WHERE order_id = v_order.id AND active = true;

    UPDATE public.orders
       SET status = 'canceled', flow_state = 'CANCELLED'
     WHERE id = v_order.id;

    INSERT INTO public.order_status_history (order_id, status, payment_status, note)
    VALUES (v_order.id, 'canceled', 'pending', 'Cancelado automaticamente: pagamento não concluído');

    -- Devolve as moedas usadas, uma única vez.
    IF v_order.customer_id IS NOT NULL AND coalesce(v_order.coins_used, 0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.customer_coin_ledger
         WHERE order_id = v_order.id AND reason = 'estorno de moedas (pedido cancelado)'
       ) THEN
      INSERT INTO public.customer_coin_ledger (customer_id, delta, reason, order_id)
      VALUES (v_order.customer_id, v_order.coins_used, 'estorno de moedas (pedido cancelado)', v_order.id);
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.expire_stale_reservations() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_reservations() TO service_role;

-- 6. Sincronização com o Loyverse (somente backend)
CREATE OR REPLACE FUNCTION public.mark_order_synced(p_order_id uuid, p_receipt_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.orders
     SET loyverse_receipt_id = coalesce(loyverse_receipt_id, p_receipt_id),
         flow_state = 'LOYVERSE_SYNCED',
         sync_error = NULL
   WHERE id = p_order_id;

  UPDATE public.order_stock_reservations
     SET active = false, updated_at = now()
   WHERE order_id = p_order_id AND active = true;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_order_sync_failed(p_order_id uuid, p_error text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.orders
     SET flow_state = 'SYNC_ERROR', sync_error = left(coalesce(p_error, ''), 500)
   WHERE id = p_order_id AND loyverse_receipt_id IS NULL;
  RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.mark_order_synced(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_order_sync_failed(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_synced(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_order_sync_failed(uuid, text) TO service_role;

-- 7. Claim do pedido pelo dono: reserva já criada não pode ser reaproveitada por outro
CREATE INDEX IF NOT EXISTS idx_reservations_expiry
  ON public.order_stock_reservations (active, expires_at);