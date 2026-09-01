CREATE OR REPLACE FUNCTION public.save_customer(p_device_id text, p_name text, p_phone text, p_email text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_digits text := public.only_digits(p_phone);
  v_full text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_id uuid;
  v_locked text;
  v_match uuid;
  v_reason text;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_first text := lower(split_part(trim(coalesce(p_name, '')), ' ', 1));
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
       SET name = coalesce(nullif(trim(p_name), ''), v_locked, ''),
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

  -- 1) Telefone muito parecido (mesmos 7 dígitos finais).
  SELECT id INTO v_match FROM public.customers
   WHERE id <> v_id
     AND right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 7) = right(v_full, 7)
     AND right(v_full, 7) <> ''
   ORDER BY created_at LIMIT 1;
  IF v_match IS NOT NULL THEN v_reason := 'similar_phone'; END IF;

  -- 2) Mesmo primeiro nome (pode ser a mesma pessoa com outro número).
  IF v_match IS NULL AND v_first <> '' THEN
    SELECT id INTO v_match FROM public.customers
     WHERE id <> v_id
       AND lower(split_part(trim(name), ' ', 1)) = v_first
     ORDER BY created_at LIMIT 1;
    IF v_match IS NOT NULL THEN v_reason := 'same_first_name'; END IF;
  END IF;

  -- 3) Mesmo e-mail.
  IF v_match IS NULL AND v_email <> '' THEN
    SELECT id INTO v_match FROM public.customers
     WHERE id <> v_id AND lower(trim(email)) = v_email
     ORDER BY created_at LIMIT 1;
    IF v_match IS NOT NULL THEN v_reason := 'same_email'; END IF;
  END IF;

  IF v_match IS NOT NULL THEN
    INSERT INTO public.customer_duplicates (
      existing_customer_id, new_customer_id, incoming_name, incoming_phone, device_id, reason
    ) VALUES (v_match, v_id, coalesce(trim(p_name), ''), p_phone, coalesce(p_device_id, ''), v_reason);
  END IF;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.discard_unpaid_order(p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RETURN false; END IF;
  IF v_order.payment_status = 'paid' OR v_order.loyverse_receipt_id IS NOT NULL THEN
    RETURN false;
  END IF;

  DELETE FROM public.order_stock_reservations WHERE order_id = p_order_id;
  DELETE FROM public.order_status_history WHERE order_id = p_order_id;
  DELETE FROM public.order_items WHERE order_id = p_order_id;
  DELETE FROM public.coupon_redemptions WHERE order_id = p_order_id;
  DELETE FROM public.payment_events WHERE order_id = p_order_id;
  DELETE FROM public.customer_coin_ledger WHERE order_id = p_order_id;
  DELETE FROM public.orders WHERE id = p_order_id;
  RETURN true;
END;
$function$;