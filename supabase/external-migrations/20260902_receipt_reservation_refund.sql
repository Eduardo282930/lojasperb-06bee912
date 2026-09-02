-- SPERB · banco oficial (Supabase externo)
-- 1) A reserva de estoque só é encerrada depois do recibo confirmado no Loyverse.
-- 2) Reembolso do Loyverse cancela o pedido, devolve moedas e libera o cupom (idempotente).

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS loyverse_points_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyverse_refund_id text,
  ADD COLUMN IF NOT EXISTS refund_state text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_locked_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS orders_loyverse_refund_id_key
  ON public.orders (loyverse_refund_id) WHERE loyverse_refund_id IS NOT NULL;

-- Pagamento aprovado NÃO libera mais a reserva: só o recibo do Loyverse libera.
CREATE OR REPLACE FUNCTION public.confirm_order_payment(
  p_order_id uuid,
  p_provider text,
  p_external_id text,
  p_method text,
  p_amount numeric,
  p_receipt_url text,
  p_raw jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

  -- A reserva CONTINUA ativa até o recibo ser criado no Loyverse.
  UPDATE public.order_stock_reservations
     SET expires_at = NULL, updated_at = now()
   WHERE order_id = p_order_id AND active = true;

  IF v_order.customer_id IS NOT NULL THEN
    INSERT INTO public.customer_notifications (customer_id, kind, title, body)
    VALUES (v_order.customer_id, 'payment', 'Pagamento confirmado!',
            'Recebemos seu pagamento e seu pedido SPERB já está em preparação.');
  END IF;

  RETURN true;
END;
$$;

-- Guarda o recibo, mas NÃO mexe na reserva (isso é papel da finalização).
CREATE OR REPLACE FUNCTION public.mark_order_synced(p_order_id uuid, p_receipt_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.orders
     SET loyverse_receipt_id = coalesce(loyverse_receipt_id, p_receipt_id),
         flow_state = 'LOYVERSE_SYNCED',
         sync_error = NULL,
         sync_locked_at = NULL
   WHERE id = p_order_id;
  RETURN true;
END;
$$;

-- Reserva de um pedido pago vira baixa definitiva SOMENTE com o recibo confirmado.
CREATE OR REPLACE FUNCTION public.finalize_reservation_after_receipt(
  p_order_id uuid,
  p_receipt_id text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_row record;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RETURN 0; END IF;
  IF coalesce(p_receipt_id, '') = '' THEN RETURN 0; END IF;
  -- O recibo precisa ser reconhecido como daquele pedido.
  IF coalesce(v_order.loyverse_receipt_id, '') <> p_receipt_id THEN RETURN 0; END IF;
  IF v_order.payment_status <> 'paid' THEN RETURN 0; END IF;

  FOR v_row IN
    SELECT id, product_key, external_variant_id, qty
      FROM public.order_stock_reservations
     WHERE order_id = p_order_id AND active = true
     FOR UPDATE
  LOOP
    INSERT INTO public.inventory_movements (product_key, external_variant_id, delta, reason, source)
    VALUES (v_row.product_key, v_row.external_variant_id, -v_row.qty,
            'baixa confirmada pelo recibo do Loyverse', 'loyverse');

    UPDATE public.order_stock_reservations
       SET active = false, updated_at = now()
     WHERE id = v_row.id;

    v_count := v_count + 1;
  END LOOP;

  UPDATE public.orders
     SET flow_state = 'COMPLETED', sync_error = NULL, sync_locked_at = NULL
   WHERE id = p_order_id;

  RETURN v_count;
END;
$$;

-- Trava curta para não criar dois recibos do mesmo pedido em paralelo.
CREATE OR REPLACE FUNCTION public.claim_order_sync(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ok boolean := false;
BEGIN
  UPDATE public.orders
     SET sync_locked_at = now()
   WHERE id = p_order_id
     AND loyverse_receipt_id IS NULL
     AND payment_status = 'paid'
     AND (sync_locked_at IS NULL OR sync_locked_at < now() - interval '3 minutes')
  RETURNING true INTO v_ok;
  RETURN coalesce(v_ok, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_order_sync(p_order_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.orders SET sync_locked_at = NULL WHERE id = p_order_id;
$$;

-- Reembolso identificado no Loyverse: cancela o pedido, devolve moedas,
-- libera o cupom e desfaz a baixa de estoque. Idempotente por pedido.
CREATE OR REPLACE FUNCTION public.cancel_order_from_refund(
  p_order_id uuid,
  p_refund_id text,
  p_money_refunded boolean DEFAULT false
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_row record;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RETURN false; END IF;
  IF coalesce(p_refund_id, '') = '' THEN RETURN false; END IF;
  -- Já processado: nada é devolvido de novo.
  IF v_order.loyverse_refund_id IS NOT NULL THEN RETURN false; END IF;

  UPDATE public.orders
     SET status = 'canceled',
         payment_status = CASE WHEN payment_status = 'paid' THEN 'refunded' ELSE payment_status END,
         flow_state = 'CANCELLED',
         loyverse_refund_id = p_refund_id,
         refund_state = CASE WHEN p_money_refunded THEN 'refunded' ELSE 'money_pending' END,
         refunded_at = now()
   WHERE id = p_order_id;

  -- Estoque: solta reservas ainda ativas e devolve o que já tinha sido baixado.
  UPDATE public.order_stock_reservations
     SET active = false, updated_at = now()
   WHERE order_id = p_order_id AND active = true;

  FOR v_row IN
    SELECT product_key, external_variant_id, qty
      FROM public.order_stock_reservations
     WHERE order_id = p_order_id
  LOOP
    INSERT INTO public.inventory_movements (product_key, external_variant_id, delta, reason, source)
    VALUES (v_row.product_key, v_row.external_variant_id, v_row.qty,
            'reembolso no Loyverse', 'loyverse');
  END LOOP;

  -- Moedas usadas voltam uma única vez.
  IF v_order.customer_id IS NOT NULL AND coalesce(v_order.coins_used, 0) > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.customer_coin_ledger
       WHERE order_id = p_order_id AND reason = 'devolução por reembolso'
    ) THEN
      INSERT INTO public.customer_coin_ledger (customer_id, delta, reason, order_id)
      VALUES (v_order.customer_id, v_order.coins_used, 'devolução por reembolso', p_order_id);
    END IF;
  END IF;

  -- Cupom volta a ficar disponível.
  IF v_order.coupon_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.coupon_redemptions WHERE order_id = p_order_id) THEN
      DELETE FROM public.coupon_redemptions WHERE order_id = p_order_id;
      UPDATE public.coupons
         SET uses = greatest(coalesce(uses, 0) - 1, 0)
       WHERE id = v_order.coupon_id;
    END IF;
  END IF;

  INSERT INTO public.order_status_history (order_id, status, payment_status, note)
  VALUES (p_order_id, 'canceled', 'refunded',
          CASE WHEN p_money_refunded
               THEN 'Reembolso registrado no Loyverse e devolvido ao cliente'
               ELSE 'Reembolso registrado no Loyverse — devolução financeira pendente' END);

  IF v_order.customer_id IS NOT NULL THEN
    INSERT INTO public.customer_notifications (customer_id, kind, title, body)
    VALUES (v_order.customer_id, 'order', 'Pedido cancelado',
            'Seu pedido SPERB foi reembolsado e cancelado.');
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_reservation_after_receipt(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_order_from_refund(uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_order_sync(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_order_sync(uuid) TO service_role;
