-- ============================================================================
-- SPERB · Estoque fora do Supabase, regras de status e limpeza automática
--
-- 1. Produtos deixam de morar no Supabase. Fica apenas um retrato mínimo do
--    estoque (product_stock), atualizado do Loyverse no momento da reserva.
-- 2. A reserva NÃO é liberada em "Preparando": só o recibo do Loyverse libera.
-- 3. Status só anda para frente (Recebido → Preparando → A caminho → Entregue),
--    com uma janela de 5 minutos para voltar de Preparando para Recebido.
-- 4. Pagamento na entrega substitui a mudança manual para "Pago".
-- 5. Limpeza automática de dados temporários (nunca de histórico/auditoria).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Retrato mínimo do estoque
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_key text NOT NULL DEFAULT 'sperb',
  external_variant_id text NOT NULL,
  product_key text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  stock numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_stock_variant_uidx
  ON public.product_stock (store_key, external_variant_id);

GRANT SELECT ON public.product_stock TO anon, authenticated;
GRANT ALL ON public.product_stock TO service_role;

ALTER TABLE public.product_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product stock is readable" ON public.product_stock;
CREATE POLICY "product stock is readable"
  ON public.product_stock FOR SELECT TO anon, authenticated USING (true);

-- Migra o último estoque conhecido para não ficar sem base durante o deploy.
INSERT INTO public.product_stock (store_key, external_variant_id, product_key, name, stock, updated_at)
SELECT cp.store_key, coalesce(cp.external_variant_id, cp.product_key), cp.product_key,
       cp.name, coalesce(cp.stock, 0), coalesce(cp.synced_at, now())
  FROM public.catalog_products cp
 WHERE cp.active = true
   AND coalesce(cp.external_variant_id, cp.product_key) <> ''
ON CONFLICT (store_key, external_variant_id) DO NOTHING;

-- Estoque disponível passa a ler o retrato mínimo.
CREATE OR REPLACE FUNCTION public.available_stock(p_variant_id text, p_ignore_hold uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT greatest(
    coalesce((
      SELECT max(ps.stock) FROM public.product_stock ps
       WHERE ps.external_variant_id = p_variant_id OR ps.product_key = p_variant_id
    ), 0)
    - coalesce((
      SELECT sum(r.qty) FROM public.order_stock_reservations r
       WHERE r.active = true
         AND (r.external_variant_id = p_variant_id OR r.product_key = p_variant_id)
    ), 0)
    - coalesce((
      SELECT sum(h.qty) FROM public.stock_holds h
       WHERE h.active = true AND h.expires_at > now()
         AND (p_ignore_hold IS NULL OR h.hold_key <> p_ignore_hold)
         AND (h.external_variant_id = p_variant_id OR h.product_key = p_variant_id)
    ), 0),
  0);
$$;

-- Atualiza o retrato do estoque a partir do Loyverse (chamado pelo servidor).
CREATE OR REPLACE FUNCTION public.sync_product_stock(p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item jsonb;
  v_count integer := 0;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) LOOP
    CONTINUE WHEN coalesce(v_item->>'id', '') = '';
    INSERT INTO public.product_stock (store_key, external_variant_id, product_key, name, stock, updated_at)
    VALUES ('sperb', v_item->>'id', coalesce(v_item->>'productKey', v_item->>'id'),
            coalesce(v_item->>'name', ''), coalesce((v_item->>'stock')::numeric, 0), now())
    ON CONFLICT (store_key, external_variant_id) DO UPDATE
      SET stock = excluded.stock,
          product_key = excluded.product_key,
          name = excluded.name,
          updated_at = now();
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

DROP TABLE IF EXISTS public.catalog_products;
DROP TABLE IF EXISTS public.catalog_categories;

-- ---------------------------------------------------------------------------
-- 2/3/4. Regras de status no Admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_status_rank(p_status text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_status
    WHEN 'sent' THEN 1
    WHEN 'preparing' THEN 2
    WHEN 'shipping' THEN 3
    WHEN 'delivered' THEN 4
    WHEN 'canceled' THEN 9
    ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_order_status(p_order_id uuid, p_status text, p_payment_status text, p_note text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_order public.orders;
  v_coupon public.coupons;
  v_reward integer := 0;
  v_since timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN false;
  END IF;

  v_status := coalesce(nullif(p_status, ''), '');
  IF v_status = '' THEN RETURN false; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RETURN false; END IF;
  IF v_order.status = v_status THEN RETURN true; END IF;

  -- Pedido entregue ou cancelado não volta atrás.
  IF v_order.status IN ('delivered', 'canceled') THEN RETURN false; END IF;

  IF v_status <> 'canceled'
     AND public.order_status_rank(v_status) < public.order_status_rank(v_order.status) THEN
    -- Única volta permitida: Preparando → Recebido em até 5 minutos.
    IF NOT (v_order.status = 'preparing' AND v_status = 'sent') THEN
      RETURN false;
    END IF;
    SELECT max(created_at) INTO v_since
      FROM public.order_status_history
     WHERE order_id = p_order_id AND status = 'preparing';
    IF v_since IS NULL OR v_since < now() - interval '5 minutes' THEN
      RETURN false;
    END IF;
  END IF;

  UPDATE public.orders SET status = v_status WHERE id = p_order_id;

  INSERT INTO public.order_status_history (order_id, status, payment_status, note)
  VALUES (p_order_id, v_status, NULL, coalesce(p_note, ''));

  IF v_status = 'canceled' THEN
    UPDATE public.order_stock_reservations SET active = false, updated_at = now()
     WHERE order_id = p_order_id AND active = true;
    UPDATE public.orders SET flow_state = 'CANCELLED' WHERE id = p_order_id;
  ELSIF v_status = 'delivered' THEN
    UPDATE public.orders SET flow_state = 'COMPLETED' WHERE id = p_order_id;
  END IF;

  -- A reserva de estoque continua ativa: só o recibo do Loyverse a libera.

  IF v_status = 'delivered' AND v_order.customer_id IS NOT NULL AND v_order.coupon_id IS NOT NULL THEN
    SELECT * INTO v_coupon FROM public.coupons WHERE id = v_order.coupon_id;
    IF v_coupon.id IS NOT NULL THEN
      IF coalesce(v_coupon.reward_type, 'fixed') = 'percent' THEN
        IF coalesce(v_order.total, 0) >= coalesce(v_coupon.reward_min_order, 0) THEN
          v_reward := floor(coalesce(v_order.total, 0) * coalesce(v_coupon.reward_percent, 0));
          IF v_coupon.reward_max_coins IS NOT NULL THEN
            v_reward := least(v_reward, v_coupon.reward_max_coins);
          END IF;
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

  RETURN true;
END;
$function$;

-- Pagamento na entrega: o pedido segue como pago, mas a reserva continua
-- até o recibo do Loyverse — exatamente a mesma regra do Pix/cartão.
CREATE OR REPLACE FUNCTION public.admin_set_pay_on_delivery(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order public.orders;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN false;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL OR v_order.status = 'canceled' THEN RETURN false; END IF;
  IF coalesce(v_order.payment_status, '') = 'paid' THEN RETURN true; END IF;

  UPDATE public.orders
     SET payment_status = 'paid',
         payment_method = 'delivery',
         payment_provider = 'delivery',
         paid_at = coalesce(paid_at, now()),
         flow_state = CASE WHEN coalesce(flow_state, '') IN ('', 'PENDING', 'RESERVED', 'SYNC_ERROR')
                           THEN 'PAID' ELSE flow_state END
   WHERE id = p_order_id;

  INSERT INTO public.order_status_history (order_id, status, payment_status, note)
  VALUES (p_order_id, v_order.status, 'paid', 'pagamento na entrega');

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Limpeza automática de dados temporários
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_temporary_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_holds integer := 0;
  v_stock integer := 0;
  v_coupons integer := 0;
  v_notifs integer := 0;
BEGIN
  DELETE FROM public.stock_holds WHERE expires_at < now() OR active = false;
  GET DIAGNOSTICS v_holds = ROW_COUNT;

  -- Retratos de estoque que ninguém mais usa (o Loyverse é a fonte).
  DELETE FROM public.product_stock ps
   WHERE ps.updated_at < now() - interval '7 days'
     AND NOT EXISTS (
       SELECT 1 FROM public.order_stock_reservations r
        WHERE r.active = true
          AND (r.external_variant_id = ps.external_variant_id OR r.product_key = ps.product_key))
     AND NOT EXISTS (
       SELECT 1 FROM public.stock_holds h
        WHERE h.active = true
          AND (h.external_variant_id = ps.external_variant_id OR h.product_key = ps.product_key));
  GET DIAGNOSTICS v_stock = ROW_COUNT;

  -- Cupons desativados/expirados sem nenhum vínculo (resgate, uso ou pedido).
  DELETE FROM public.coupons c
   WHERE (c.active = false OR (c.expires_at IS NOT NULL AND c.expires_at < now() - interval '7 days'))
     AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.coupon_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM public.coupon_redemptions r WHERE r.coupon_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM public.customer_coupon_claims k WHERE k.coupon_id = c.id);
  GET DIAGNOSTICS v_coupons = ROW_COUNT;

  -- Avisos já lidos e antigos (não são histórico de pedido/pagamento).
  DELETE FROM public.customer_notifications
   WHERE read_at IS NOT NULL AND created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_notifs = ROW_COUNT;

  RETURN jsonb_build_object(
    'holds', v_holds, 'stock', v_stock, 'coupons', v_coupons, 'notifications', v_notifs);
END;
$$;

GRANT EXECUTE ON FUNCTION public.available_stock(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.order_status_rank(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_product_stock(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_order_status(uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_pay_on_delivery(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_temporary_data() TO service_role;
