CREATE OR REPLACE FUNCTION public.create_order_from_hold(p_hold_id uuid, p_device_id text, p_name text, p_phone text, p_email text, p_items jsonb, p_subtotal numeric, p_discount numeric, p_total numeric, p_coupon_code text, p_coins integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    p_device_id => p_device_id,
    p_name => p_name,
    p_phone => p_phone,
    p_email => p_email,
    p_items => p_items,
    p_subtotal => p_subtotal,
    p_discount => p_discount,
    p_total => p_total,
    p_coupon_code => p_coupon_code,
    p_coins => p_coins
  );

  RETURN v_id;
END;
$function$

;
