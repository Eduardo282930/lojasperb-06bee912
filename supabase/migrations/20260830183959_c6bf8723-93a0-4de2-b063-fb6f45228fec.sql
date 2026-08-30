ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS reward_type text NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS reward_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_min_order numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_max_coins integer;

ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_reward_type_check;
ALTER TABLE public.coupons ADD CONSTRAINT coupons_reward_type_check CHECK (reward_type IN ('fixed','percent'));

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

  IF v_status = 'delivered' THEN
    IF v_order.customer_id IS NOT NULL AND v_order.coupon_id IS NOT NULL THEN
      SELECT * INTO v_coupon FROM public.coupons WHERE id = v_order.coupon_id;

      IF v_coupon.id IS NOT NULL THEN
        IF coalesce(v_coupon.reward_type, 'fixed') = 'percent' THEN
          -- Porcentagem do valor da compra; 1 moeda = R$ 0,01
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
$function$;