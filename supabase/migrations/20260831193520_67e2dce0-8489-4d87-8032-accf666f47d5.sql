-- only_digits precisa ser IMMUTABLE para uso em índice
CREATE OR REPLACE FUNCTION public.only_digits(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 8)
$$;

-- Um telefone = um cliente
CREATE UNIQUE INDEX IF NOT EXISTS customers_store_phone_unique
  ON public.customers (store_key, public.only_digits(phone))
  WHERE public.only_digits(phone) <> '';

-- Baixa definitiva do estoque reservado
CREATE OR REPLACE FUNCTION public.consume_order_reservations(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT id, product_key, external_variant_id, qty
      FROM public.order_stock_reservations
     WHERE order_id = p_order_id AND active = true
  LOOP
    INSERT INTO public.inventory_movements (product_key, external_variant_id, delta, reason, source)
    VALUES (v_row.product_key, v_row.external_variant_id, -v_row.qty,
            'baixa definitiva (pedido em preparação)', 'app');

    UPDATE public.order_stock_reservations
       SET active = false, updated_at = now()
     WHERE id = v_row.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_order_reservations(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_order_reservations(uuid) TO service_role;

-- Pagamento confirmado -> preparando -> baixa definitiva
CREATE OR REPLACE FUNCTION public.confirm_order_payment(
  p_order_id uuid, p_provider text, p_external_id text, p_method text,
  p_amount numeric, p_receipt_url text, p_raw jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_inserted integer := 0;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RETURN false; END IF;

  INSERT INTO public.payment_events (provider, external_id, order_id, status, amount, raw)
  VALUES (coalesce(nullif(p_provider,''),'infinitepay'), p_external_id, p_order_id, 'paid',
          coalesce(p_amount, 0), coalesce(p_raw, '{}'::jsonb))
  ON CONFLICT (provider, external_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 OR v_order.payment_status = 'paid' THEN
    RETURN false;
  END IF;

  UPDATE public.orders
     SET payment_status = 'paid',
         status = CASE WHEN status IN ('sent', '') THEN 'preparing' ELSE status END,
         flow_state = 'PAID',
         payment_provider = coalesce(nullif(p_provider,''),'infinitepay'),
         payment_method = coalesce(p_method, ''),
         payment_id = p_external_id,
         payment_receipt_url = nullif(p_receipt_url, ''),
         paid_at = now(),
         sync_error = NULL
   WHERE id = p_order_id;

  INSERT INTO public.order_status_history (order_id, status, payment_status, note)
  VALUES (p_order_id, 'preparing', 'paid', 'Pagamento confirmado automaticamente');

  -- Em preparação: a reserva temporária vira baixa definitiva.
  PERFORM public.consume_order_reservations(p_order_id);

  IF v_order.customer_id IS NOT NULL THEN
    INSERT INTO public.customer_notifications (customer_id, kind, title, body)
    VALUES (v_order.customer_id, 'payment', 'Pagamento confirmado!',
            'Recebemos seu pagamento e seu pedido SPERB já está em preparação.');
  END IF;

  RETURN true;
END;
$$;

-- Admin muda status: preparando também faz a baixa definitiva
CREATE OR REPLACE FUNCTION public.admin_set_order_status(
  p_order_id uuid, p_status text, p_payment_status text, p_note text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_payment text;
  v_order public.orders;
  v_coupon public.coupons;
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

  IF v_status = 'preparing' THEN
    PERFORM public.consume_order_reservations(p_order_id);
  END IF;

  IF v_status = 'delivered' THEN
    IF v_order.customer_id IS NOT NULL AND v_order.coupon_id IS NOT NULL THEN
      SELECT * INTO v_coupon FROM public.coupons WHERE id = v_order.coupon_id;

      IF v_coupon.id IS NOT NULL THEN
        IF coalesce(v_coupon.reward_type, 'fixed') = 'percent' THEN
          IF coalesce(v_order.total, 0) >= coalesce(v_coupon.reward_min_order, 0) THEN
            v_reward := floor(coalesce(v_order.total, 0) * coalesce(v_coupon.reward_percent, 0));
            IF v_coupon.reward_max_coins IS NOT NULL THEN
              v_reward := least(v_reward, v_coupon.reward_max_coins);
            END IF;
          ELSE
            v_reward := 0;
          END IF;
        ELSE
          v_reward := coalesce(v_coupon.reward_coins, 0);
        END IF;
      END IF;

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
$$;

-- Cadastro: telefones muito parecidos entram na revisão de duplicidades
CREATE OR REPLACE FUNCTION public.save_customer(
  p_device_id text, p_name text, p_phone text, p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text := public.only_digits(p_phone);
  v_full text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
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

  -- Número muito parecido (mesmos 7 dígitos finais) => revisão manual
  SELECT id INTO v_match FROM public.customers
   WHERE id <> v_id
     AND right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 7) = right(v_full, 7)
     AND right(v_full, 7) <> ''
   ORDER BY created_at LIMIT 1;

  IF v_match IS NULL AND nullif(trim(p_name), '') IS NOT NULL THEN
    SELECT id INTO v_match FROM public.customers
     WHERE id <> v_id AND lower(trim(name)) = lower(trim(p_name))
     ORDER BY created_at LIMIT 1;
  END IF;

  IF v_match IS NOT NULL THEN
    INSERT INTO public.customer_duplicates (
      existing_customer_id, new_customer_id, incoming_name, incoming_phone, device_id, reason
    ) VALUES (v_match, v_id, coalesce(trim(p_name), ''), p_phone, coalesce(p_device_id, ''), 'similar_phone_or_name');
  END IF;

  RETURN v_id;
END;
$$;

-- Limpeza de pedidos de um cliente de teste (somente administrador)
CREATE OR REPLACE FUNCTION public.admin_delete_customer_orders(p_phone text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_count integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN 0;
  END IF;
  IF public.only_digits(p_phone) = '' THEN
    RETURN 0;
  END IF;

  SELECT array_agg(id) INTO v_ids FROM public.orders
   WHERE public.only_digits(customer_phone) = public.only_digits(p_phone);

  IF v_ids IS NULL THEN RETURN 0; END IF;
  v_count := array_length(v_ids, 1);

  DELETE FROM public.order_stock_reservations WHERE order_id = ANY(v_ids);
  DELETE FROM public.order_status_history WHERE order_id = ANY(v_ids);
  DELETE FROM public.order_items WHERE order_id = ANY(v_ids);
  DELETE FROM public.coupon_redemptions WHERE order_id = ANY(v_ids);
  DELETE FROM public.payment_events WHERE order_id = ANY(v_ids);
  DELETE FROM public.customer_coin_ledger WHERE order_id = ANY(v_ids);
  DELETE FROM public.orders WHERE id = ANY(v_ids);

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_customer_orders(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_customer_orders(text) TO authenticated, service_role;