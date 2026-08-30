-- 1) Cupom pode devolver moedas na próxima compra
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS reward_coins integer NOT NULL DEFAULT 0;

-- 2) Cupom excluído some dos resgates do cliente
ALTER TABLE public.customer_coupon_claims
  DROP CONSTRAINT IF EXISTS customer_coupon_claims_coupon_id_fkey;
ALTER TABLE public.customer_coupon_claims
  ADD CONSTRAINT customer_coupon_claims_coupon_id_fkey
  FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE CASCADE;

-- 3) Cupons resgatados: só os ativos
CREATE OR REPLACE FUNCTION public.coupons_claimed_for_customer(p_device_id text, p_phone text)
RETURNS SETOF public.coupons
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT c.* FROM public.coupons c
  JOIN public.customer_coupon_claims cc ON cc.coupon_id = c.id
  WHERE cc.customer_id = public.resolve_customer(p_device_id, p_phone)
    AND c.active = true
  ORDER BY cc.claimed_at DESC;
$$;

-- 4) Avisos do cliente
CREATE TABLE IF NOT EXISTS public.customer_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_key text NOT NULL DEFAULT 'sperb',
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'info',
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.customer_notifications TO authenticated;
GRANT ALL ON public.customer_notifications TO service_role;
ALTER TABLE public.customer_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view notifications" ON public.customer_notifications
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS customer_notifications_customer_idx
  ON public.customer_notifications (customer_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.notifications_for_customer(p_device_id text, p_phone text)
RETURNS TABLE(id uuid, kind text, title text, body text, read_at timestamptz, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT n.id, n.kind, n.title, n.body, n.read_at, n.created_at
  FROM public.customer_notifications n
  WHERE n.customer_id = public.resolve_customer(p_device_id, p_phone)
  ORDER BY n.created_at DESC
  LIMIT 50;
$$;

CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_device_id text, p_phone text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_customer uuid := public.resolve_customer(p_device_id, p_phone);
BEGIN
  IF v_customer IS NULL THEN RETURN false; END IF;
  UPDATE public.customer_notifications SET read_at = now()
   WHERE customer_id = v_customer AND read_at IS NULL;
  RETURN true;
END;
$$;

-- 5) Ao concluir (entregue) o pedido, credita as moedas do cupom usado
CREATE OR REPLACE FUNCTION public.admin_set_order_status(p_order_id uuid, p_status text, p_payment_status text, p_note text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
  v_order public.orders;
  v_reward integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN false;
  END IF;

  v_status := coalesce(nullif(p_status, ''), '');

  UPDATE public.orders
     SET status = coalesce(nullif(p_status, ''), status),
         payment_status = coalesce(nullif(p_payment_status, ''), payment_status)
   WHERE id = p_order_id;

  INSERT INTO public.order_status_history (order_id, status, payment_status, note, changed_by)
  VALUES (p_order_id, coalesce(nullif(p_status, ''), 'sent'), nullif(p_payment_status, ''), coalesce(p_note, ''), auth.uid());

  IF v_status = 'delivered' THEN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
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
$$;

-- 6) Aviso automático de cupom exclusivo novo
CREATE OR REPLACE FUNCTION public.notify_new_exclusive_coupon()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_customer uuid;
  v_label text;
BEGIN
  IF NEW.active IS NOT TRUE THEN RETURN NEW; END IF;
  v_customer := NEW.customer_id;
  IF v_customer IS NULL AND coalesce(NEW.customer_phone, '') <> '' THEN
    v_customer := public.resolve_customer('', NEW.customer_phone);
  END IF;
  IF v_customer IS NULL THEN RETURN NEW; END IF;

  v_label := CASE WHEN NEW.type = 'percent'
    THEN NEW.value::text || '% OFF'
    ELSE 'R$ ' || to_char(NEW.value, 'FM999990.00') || ' OFF' END;

  INSERT INTO public.customer_notifications (customer_id, kind, title, body)
  VALUES (v_customer, 'coupon', 'Novo cupom de ' || v_label,
          'Um cupom SPERB chegou para você. Abra o app e resgate.');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coupons_notify_new ON public.coupons;
CREATE TRIGGER coupons_notify_new AFTER INSERT ON public.coupons
FOR EACH ROW EXECUTE FUNCTION public.notify_new_exclusive_coupon();