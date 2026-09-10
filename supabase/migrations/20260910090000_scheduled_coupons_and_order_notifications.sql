ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS starts_at timestamptz;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE INDEX IF NOT EXISTS coupons_schedule_idx ON public.coupons (starts_at, expires_at);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS canceled_by_label text;

CREATE OR REPLACE FUNCTION public.sperb_order_notification_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_title text;
  v_body text;
  v_url text;
  v_reason text;
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;

  IF OLD.payment_status IS DISTINCT FROM 'paid' AND NEW.payment_status = 'paid' THEN
    v_title := 'Pagamento confirmado!';
    IF coalesce(NEW.origin, 'app') = 'store' THEN
      v_body := 'Seu pedido realizado na loja foi confirmado e o pagamento já está certinho. 💙';
    ELSE
      v_body := 'Seu pagamento foi confirmado e seu pedido já está sendo preparado. 💙';
    END IF;
    v_url := '/pedidos?status=preparing&order=' || NEW.id::text;
    INSERT INTO public.customer_notifications (customer_id, kind, title, body, target_url)
    VALUES (NEW.customer_id, 'order', v_title, v_body, v_url);
  END IF;

  IF OLD.status IS DISTINCT FROM 'shipping' AND NEW.status = 'shipping' THEN
    INSERT INTO public.customer_notifications (customer_id, kind, title, body, target_url)
    VALUES (NEW.customer_id, 'order', '🚚 Eba! Seu pedido está a caminho!', 'Já estamos levando seu pedido até você! 💙', '/pedidos?status=shipping&order=' || NEW.id::text);
  END IF;

  IF OLD.status IS DISTINCT FROM 'delivered' AND NEW.status = 'delivered' THEN
    IF coalesce(NEW.origin, 'app') = 'store' THEN
      v_title := '🎉 Pedido finalizado!';
      v_body := 'Seu pedido foi concluído com sucesso. Obrigado por comprar com a SPERB! 💙';
    ELSE
      v_title := '📦 Pedido entregue!';
      v_body := 'Verifique todos os itens e confira se está tudo certinho. Se tiver qualquer problema, fale conosco pelo WhatsApp.';
    END IF;
    INSERT INTO public.customer_notifications (customer_id, kind, title, body, target_url)
    VALUES (NEW.customer_id, 'order', v_title, v_body, '/pedidos?status=delivered&order=' || NEW.id::text);
  END IF;

  IF OLD.status IS DISTINCT FROM 'canceled' AND NEW.status = 'canceled' THEN
    IF OLD.payment_status IS DISTINCT FROM 'paid' THEN
      v_title := '❌ Pedido cancelado';
      v_body := 'O prazo para pagamento terminou e o pedido foi cancelado automaticamente.';
      UPDATE public.orders SET canceled_by_label = 'Automático — falta de pagamento', cancel_reason = 'Falta de pagamento' WHERE id = NEW.id;
    ELSE
      v_reason := coalesce(nullif(NEW.cancel_reason, ''), 'não informado');
      v_title := '❌ Pedido cancelado';
      v_body := 'Seu pedido foi cancelado pelo vendedor. Motivo: ' || v_reason || '.';
    END IF;
    INSERT INTO public.customer_notifications (customer_id, kind, title, body, target_url)
    VALUES (NEW.customer_id, 'order', v_title, v_body, '/pedidos?status=canceled&order=' || NEW.id::text);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sperb_order_notification_trigger ON public.orders;
CREATE TRIGGER sperb_order_notification_trigger
AFTER UPDATE OF status, payment_status ON public.orders
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.payment_status IS DISTINCT FROM NEW.payment_status)
EXECUTE FUNCTION public.sperb_order_notification_trigger();

CREATE OR REPLACE FUNCTION public.consume_coupon(p_coupon_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE updated integer;
BEGIN
  UPDATE public.coupons
     SET uses = uses + 1,
         active = CASE WHEN max_uses IS NOT NULL AND uses + 1 >= max_uses THEN false ELSE active END
   WHERE id = p_coupon_id
     AND active = true
     AND (max_uses IS NULL OR uses < max_uses)
     AND (starts_at IS NULL OR now() >= starts_at)
     AND (expires_at IS NULL OR now() < expires_at);
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$;
GRANT EXECUTE ON FUNCTION public.consume_coupon(uuid) TO anon, authenticated;


-- Mantém o fluxo atual do pedido e também registra quem/motivo ao cancelar.
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
  IF NOT public.has_role(auth.uid(), 'admin') THEN RETURN false; END IF;
  v_status := coalesce(nullif(p_status, ''), '');
  v_payment := coalesce(nullif(p_payment_status, ''), '');

  UPDATE public.orders
     SET status = coalesce(nullif(p_status, ''), status),
         payment_status = coalesce(nullif(p_payment_status, ''), payment_status),
         cancel_reason = CASE WHEN v_status = 'canceled' THEN left(coalesce(nullif(p_note,''), 'Cancelado pelo vendedor.'), 500) ELSE cancel_reason END,
         canceled_by_label = CASE WHEN v_status = 'canceled' THEN 'Vendedor' ELSE canceled_by_label END
   WHERE id = p_order_id;

  INSERT INTO public.order_status_history (order_id, status, payment_status, note, changed_by)
  VALUES (p_order_id, coalesce(nullif(p_status, ''), 'sent'), nullif(p_payment_status, ''), coalesce(p_note, ''), auth.uid());

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
            IF v_coupon.reward_max_coins IS NOT NULL THEN v_reward := least(v_reward, v_coupon.reward_max_coins); END IF;
          ELSE v_reward := 0; END IF;
        ELSE v_reward := coalesce(v_coupon.reward_coins, 0); END IF;
      END IF;
      IF v_reward > 0 AND NOT EXISTS (
        SELECT 1 FROM public.customer_coin_ledger WHERE order_id = p_order_id AND reason = 'moedas do cupom (pedido concluído)'
      ) THEN
        INSERT INTO public.customer_coin_ledger (customer_id, delta, reason, order_id)
        VALUES (v_order.customer_id, v_reward, 'moedas do cupom (pedido concluído)', p_order_id);
        INSERT INTO public.customer_notifications (customer_id, kind, title, body, target_url)
        VALUES (v_order.customer_id, 'coins', 'Você ganhou ' || v_reward || ' moedas!', 'Seu pedido foi concluído e as moedas já estão na sua conta SPERB.', '/moedas');
      END IF;
    END IF;
  END IF;
  RETURN true;
END;
$$;


CREATE OR REPLACE FUNCTION public.notifications_for_customer(p_device_id text, p_phone text)
RETURNS TABLE(id uuid, kind text, title text, body text, read_at timestamptz, created_at timestamptz, target_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT n.id, n.kind, n.title, n.body, n.read_at, n.created_at, n.target_url
  FROM public.customer_notifications n
  WHERE n.customer_id = public.resolve_customer(p_device_id, p_phone)
  ORDER BY n.created_at DESC
  LIMIT 50;
$$;
GRANT EXECUTE ON FUNCTION public.notifications_for_customer(text,text) TO anon, authenticated;
