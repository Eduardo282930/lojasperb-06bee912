-- ---------------------------------------------------------------------------
-- SPERB — Reembolso confirmado e prazo de pagamento de 60 minutos
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_proof_url text,
  ADD COLUMN IF NOT EXISTS refund_amount numeric,
  ADD COLUMN IF NOT EXISTS refund_confirmed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 1. Reembolso: cancelar não é reembolsar
-- ---------------------------------------------------------------------------
-- O recibo reembolsado no Loyverse cancela o pedido e devolve moedas/cupom,
-- mas o pedido só fica "Reembolsado" quando o dinheiro for confirmado.
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
  IF v_order.loyverse_refund_id IS NOT NULL THEN RETURN false; END IF;

  UPDATE public.orders
     SET status = 'canceled',
         payment_status = CASE
           WHEN p_money_refunded AND payment_status = 'paid' THEN 'refunded'
           ELSE payment_status END,
         flow_state = 'CANCELLED',
         loyverse_refund_id = p_refund_id,
         refund_state = CASE WHEN p_money_refunded THEN 'refunded' ELSE 'money_pending' END,
         refunded_at = now(),
         refund_confirmed_at = CASE WHEN p_money_refunded THEN now() ELSE refund_confirmed_at END
   WHERE id = p_order_id;

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

  IF v_order.customer_id IS NOT NULL AND coalesce(v_order.coins_used, 0) > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.customer_coin_ledger
       WHERE order_id = p_order_id AND reason = 'devolução por reembolso'
    ) THEN
      INSERT INTO public.customer_coin_ledger (customer_id, delta, reason, order_id)
      VALUES (v_order.customer_id, v_order.coins_used, 'devolução por reembolso', p_order_id);
    END IF;
  END IF;

  IF v_order.coupon_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.coupon_redemptions WHERE order_id = p_order_id) THEN
      DELETE FROM public.coupon_redemptions WHERE order_id = p_order_id;
      UPDATE public.coupons
         SET uses = greatest(coalesce(uses, 0) - 1, 0)
       WHERE id = v_order.coupon_id;
    END IF;
  END IF;

  INSERT INTO public.order_status_history (order_id, status, payment_status, note)
  VALUES (p_order_id, 'canceled',
          CASE WHEN p_money_refunded THEN 'refunded' ELSE v_order.payment_status END,
          CASE WHEN p_money_refunded
               THEN 'Pedido cancelado e reembolso confirmado'
               ELSE 'Pedido cancelado no Loyverse — reembolso financeiro em análise' END);

  IF v_order.customer_id IS NOT NULL THEN
    INSERT INTO public.customer_notifications (customer_id, kind, title, body)
    VALUES (v_order.customer_id, 'order', 'Pedido cancelado',
            CASE WHEN p_money_refunded
                 THEN 'Seu pedido SPERB foi cancelado e o reembolso já foi confirmado.'
                 ELSE 'Seu pedido SPERB foi cancelado. O reembolso está sendo processado.' END);
  END IF;

  RETURN true;
END;
$$;

-- Admin confirma o reembolso no InfinitePay e anexa o comprovante.
CREATE OR REPLACE FUNCTION public.admin_confirm_refund(
  p_order_id uuid,
  p_proof_url text DEFAULT '',
  p_amount numeric DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order public.orders;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RETURN false; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RETURN false; END IF;
  IF coalesce(v_order.refund_state, 'none') = 'refunded' THEN RETURN true; END IF;

  UPDATE public.orders
     SET status = 'canceled',
         flow_state = 'CANCELLED',
         payment_status = 'refunded',
         refund_state = 'refunded',
         refund_proof_url = nullif(coalesce(p_proof_url, ''), ''),
         refund_amount = coalesce(p_amount, v_order.total),
         refunded_at = coalesce(v_order.refunded_at, now()),
         refund_confirmed_at = now()
   WHERE id = p_order_id;

  INSERT INTO public.order_status_history (order_id, status, payment_status, note)
  VALUES (p_order_id, 'canceled', 'refunded', 'Reembolso confirmado no InfinitePay');

  IF v_order.customer_id IS NOT NULL THEN
    INSERT INTO public.customer_notifications (customer_id, kind, title, body)
    VALUES (v_order.customer_id, 'order', 'Reembolso confirmado',
            'O reembolso do seu pedido SPERB foi confirmado. O comprovante está em Meus pedidos.');
  END IF;

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Prazo de 60 minutos para pagar (somente pagamento online)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_payment_deadline(
  p_order_id uuid,
  p_minutes integer DEFAULT 60
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_deadline timestamptz;
BEGIN
  UPDATE public.orders
     SET payment_deadline_at = coalesce(payment_deadline_at,
                                        now() + make_interval(mins => greatest(1, p_minutes)))
   WHERE id = p_order_id AND coalesce(payment_status, '') <> 'paid'
   RETURNING payment_deadline_at INTO v_deadline;
  RETURN v_deadline;
END;
$$;

-- Pedidos online sem pagamento no prazo: cancelados e reserva liberada.
-- Pedidos de WhatsApp (sem prazo) nunca entram aqui.
CREATE OR REPLACE FUNCTION public.cancel_expired_unpaid_orders()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_count integer := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM public.orders
     WHERE payment_deadline_at IS NOT NULL
       AND payment_deadline_at < now()
       AND coalesce(payment_status, 'pending') = 'pending'
       AND status <> 'canceled'
     LIMIT 200
  LOOP
    UPDATE public.orders
       SET status = 'canceled',
           flow_state = 'CANCELLED',
           updated_at = now()
     WHERE id = v_id;

    UPDATE public.order_stock_reservations
       SET active = false, updated_at = now()
     WHERE order_id = v_id AND active = true;

    INSERT INTO public.order_status_history (order_id, status, payment_status, note)
    VALUES (v_id, 'canceled', 'pending', 'Cancelado por falta de pagamento em 60 minutos');

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. O cliente precisa enxergar prazo, forma de pagamento e comprovante
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.orders_for_customer(text, text);
CREATE FUNCTION public.orders_for_customer(p_device_id text, p_phone text)
RETURNS TABLE(
  id uuid, created_at timestamptz, updated_at timestamptz, status text,
  payment_status text, payment_method text, payment_provider text,
  payment_deadline_at timestamptz, refund_state text, refund_proof_url text,
  subtotal numeric, discount numeric, total numeric, coupon_code text,
  customer_name text, items jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT o.id, o.created_at, o.updated_at, o.status, o.payment_status,
         o.payment_method, o.payment_provider, o.payment_deadline_at,
         o.refund_state, o.refund_proof_url,
         o.subtotal, o.discount, o.total, o.coupon_code, o.customer_name, o.items
  FROM public.orders o
  WHERE (coalesce(p_device_id, '') <> '' AND o.device_id = p_device_id)
     OR (public.only_digits(coalesce(p_phone, '')) <> ''
         AND public.only_digits(o.customer_phone) = public.only_digits(p_phone))
  ORDER BY o.created_at DESC
  LIMIT 100;
$$;

GRANT EXECUTE ON FUNCTION public.orders_for_customer(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_order_from_refund(uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_confirm_refund(uuid, text, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_payment_deadline(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_expired_unpaid_orders() TO anon, authenticated, service_role;
