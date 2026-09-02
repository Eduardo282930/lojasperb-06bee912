-- ============================================================================
-- SPERB · Reserva atômica de estoque antes do pedido definitivo
--
-- "Fazer pedido" cria apenas uma RESERVA (hold). O pedido definitivo nasce
-- somente quando o cliente escolhe WhatsApp ou Pix. Dois clientes simultâneos
-- nunca conseguem a mesma unidade: toda a checagem acontece dentro de uma
-- transação serializada por advisory lock.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.stock_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_key text NOT NULL DEFAULT 'sperb',
  hold_key uuid NOT NULL,
  device_id text NOT NULL DEFAULT '',
  product_key text NOT NULL DEFAULT '',
  external_variant_id text,
  qty numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '20 minutes',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_holds_key_idx ON public.stock_holds (hold_key);
CREATE INDEX IF NOT EXISTS stock_holds_active_idx ON public.stock_holds (active, expires_at);
CREATE INDEX IF NOT EXISTS stock_holds_variant_idx ON public.stock_holds (external_variant_id);

GRANT SELECT ON public.stock_holds TO anon, authenticated;
GRANT ALL ON public.stock_holds TO service_role;

ALTER TABLE public.stock_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock holds are readable" ON public.stock_holds;
CREATE POLICY "stock holds are readable"
  ON public.stock_holds FOR SELECT
  TO anon, authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- Limpeza das reservas temporárias vencidas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_stock_holds()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  DELETE FROM public.stock_holds WHERE expires_at < now() OR active = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Estoque realmente disponível de uma variação:
-- estoque do Loyverse − reservas de pedidos − reservas temporárias de outros.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.available_stock(p_variant_id text, p_ignore_hold uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT greatest(
    coalesce((
      SELECT max(cp.stock) FROM public.catalog_products cp
       WHERE cp.active = true
         AND (cp.external_variant_id = p_variant_id OR cp.product_key = p_variant_id)
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

-- ---------------------------------------------------------------------------
-- Reserva atômica. Devolve {ok, hold_id, expires_at} ou {ok:false, problems}.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_stock_hold(
  p_device_id text,
  p_items jsonb,
  p_minutes integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item jsonb;
  v_key text;
  v_qty numeric;
  v_available numeric;
  v_problems jsonb := '[]'::jsonb;
  v_hold uuid := gen_random_uuid();
  v_expires timestamptz := now() + make_interval(mins => greatest(coalesce(p_minutes, 20), 1));
BEGIN
  -- Serializa a validação: dois clientes nunca leem o mesmo estoque livre.
  PERFORM pg_advisory_xact_lock(hashtext('sperb-stock-hold'));

  DELETE FROM public.stock_holds WHERE expires_at < now() OR active = false;
  -- Cada tentativa do mesmo aparelho substitui a anterior.
  DELETE FROM public.stock_holds WHERE device_id = coalesce(p_device_id, '') AND device_id <> '';

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) LOOP
    v_key := coalesce(v_item->>'id', '');
    v_qty := coalesce((v_item->>'qty')::numeric, 0);
    CONTINUE WHEN v_key = '' OR v_qty <= 0;

    v_available := public.available_stock(v_key, NULL);

    IF v_qty > v_available THEN
      v_problems := v_problems || jsonb_build_object(
        'id', v_key,
        'name', coalesce(v_item->>'name', ''),
        'requested', v_qty,
        'available', v_available
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_problems) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'problems', v_problems);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) LOOP
    v_key := coalesce(v_item->>'id', '');
    v_qty := coalesce((v_item->>'qty')::numeric, 0);
    CONTINUE WHEN v_key = '' OR v_qty <= 0;

    INSERT INTO public.stock_holds (hold_key, device_id, product_key, external_variant_id, qty, expires_at)
    VALUES (v_hold, coalesce(p_device_id, ''), coalesce(v_item->>'productKey', v_key), v_key, v_qty, v_expires);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'hold_id', v_hold, 'expires_at', v_expires);
END;
$$;

-- ---------------------------------------------------------------------------
-- O cliente desistiu antes de fechar: a reserva temporária é liberada.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_stock_hold(p_hold_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.stock_holds WHERE hold_key = p_hold_id;
  DELETE FROM public.stock_holds WHERE expires_at < now();
  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- Pedido definitivo: consome a reserva temporária dentro da MESMA transação
-- em que o pedido e a reserva do pedido são criados.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_order_from_hold(
  p_hold_id uuid,
  p_device_id text,
  p_name text,
  p_phone text,
  p_email text,
  p_items jsonb,
  p_subtotal numeric,
  p_discount numeric,
  p_total numeric,
  p_coupon_code text,
  p_coins integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item jsonb;
  v_key text;
  v_qty numeric;
  v_available numeric;
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('sperb-stock-hold'));

  DELETE FROM public.stock_holds WHERE expires_at < now();

  -- Revalida sempre: a reserva pode ter vencido enquanto o cliente conferia.
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) LOOP
    v_key := coalesce(v_item->>'id', '');
    v_qty := coalesce((v_item->>'qty')::numeric, 0);
    CONTINUE WHEN v_key = '' OR v_qty <= 0;

    v_available := public.available_stock(v_key, p_hold_id);
    IF v_qty > v_available THEN
      RAISE EXCEPTION 'out_of_stock:%', coalesce(v_item->>'name', v_key)
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- A reserva temporária vira reserva do pedido.
  DELETE FROM public.stock_holds WHERE hold_key = p_hold_id;

  v_id := public.create_order(
    p_device_id, p_name, p_phone, p_email, p_items,
    p_subtotal, p_discount, p_total, p_coupon_code, p_coins
  );

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- A vitrine passa a considerar também as reservas temporárias.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserved_stock()
RETURNS TABLE(product_key text, external_variant_id text, qty numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT t.product_key, t.external_variant_id, sum(t.qty)::numeric
  FROM (
    SELECT r.product_key, r.external_variant_id, r.qty
      FROM public.order_stock_reservations r
     WHERE r.active = true
    UNION ALL
    SELECT h.product_key, h.external_variant_id, h.qty
      FROM public.stock_holds h
     WHERE h.active = true AND h.expires_at > now()
  ) t
  GROUP BY t.product_key, t.external_variant_id
$$;

-- ---------------------------------------------------------------------------
-- Loyverse → SPERB: recibo confirmado por webhook.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_order_receipt(p_order_id uuid, p_receipt_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(p_receipt_id, '') = '' THEN RETURN false; END IF;
  PERFORM public.mark_order_synced(p_order_id, p_receipt_id);
  PERFORM public.finalize_reservation_after_receipt(p_order_id, p_receipt_id);
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_stock_holds() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.available_stock(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_stock_hold(text, jsonb, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_stock_hold(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_order_from_hold(uuid, text, text, text, text, jsonb, numeric, numeric, numeric, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserved_stock() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_order_receipt(uuid, text) TO service_role;
