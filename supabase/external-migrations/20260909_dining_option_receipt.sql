-- A opção escolhida no Loyverse (Opções de Pedido) manda no status do pedido
-- e o recibo passa a guardar loja, funcionário e número do recibo.
--
-- "Consumir no local"  -> pedido entregue e finalizado na loja
-- "Entrega" / "Comida para viagem" -> pedido em preparação

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS dining_option text,
  ADD COLUMN IF NOT EXISTS receipt_number text,
  ADD COLUMN IF NOT EXISTS store_name text,
  ADD COLUMN IF NOT EXISTS store_address text,
  ADD COLUMN IF NOT EXISTS employee_name text;

DROP FUNCTION IF EXISTS public.import_store_receipt(
  text, timestamptz, text, text, text, text, jsonb, numeric, numeric, text,
  integer, numeric, numeric, numeric, text
);

CREATE FUNCTION public.import_store_receipt(
  p_receipt_id text,
  p_receipt_date timestamptz,
  p_loyverse_customer_id text,
  p_name text,
  p_phone text,
  p_email text,
  p_items jsonb,
  p_subtotal numeric,
  p_coupon_discount numeric,
  p_coupon_code text,
  p_coins_used integer,
  p_coins_discount numeric,
  p_seller_discount numeric,
  p_total numeric,
  p_payment_type text,
  p_dining_option text DEFAULT NULL,
  p_store_name text DEFAULT NULL,
  p_store_address text DEFAULT NULL,
  p_employee_name text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_customer_id uuid;
  v_digits text := public.only_digits(coalesce(p_phone, ''));
  v_coins integer := greatest(0, coalesce(p_coins_used, 0));
  v_option text := lower(translate(coalesce(p_dining_option, ''),
    'áàãâéêíóôõúüçÁÀÃÂÉÊÍÓÔÕÚÜÇ', 'aaaaeeiooouucAAAAEEIOOOUUC'));
  v_status text;
  v_note text;
BEGIN
  IF coalesce(p_receipt_id, '') = '' THEN
    RETURN NULL;
  END IF;

  -- Consumir no local: o cliente já levou a compra, pedido finalizado na loja.
  IF v_option LIKE '%no local%' OR v_option LIKE '%dine%' THEN
    v_status := 'delivered';
    v_note := 'Comprado na loja física — entregue na hora pelo vendedor';
  ELSE
    v_status := 'preparing';
    v_note := 'Pedido feito pelo vendedor da loja';
  END IF;

  SELECT id INTO v_order_id FROM public.orders
   WHERE loyverse_receipt_id = p_receipt_id LIMIT 1;
  IF v_order_id IS NOT NULL THEN
    RETURN v_order_id;
  END IF;

  IF coalesce(p_loyverse_customer_id, '') <> '' THEN
    v_customer_id := public.upsert_customer_from_loyverse(
      p_loyverse_customer_id, coalesce(p_name, ''), coalesce(p_phone, ''),
      coalesce(p_email, '')
    );
  ELSIF v_digits <> '' THEN
    SELECT id INTO v_customer_id FROM public.customers
     WHERE right(public.only_digits(phone), 8) = right(v_digits, 8)
     ORDER BY created_at LIMIT 1;
  END IF;

  INSERT INTO public.orders (
    customer_id, items, subtotal, discount, total, status, payment_status,
    customer_name, customer_phone, customer_email, coupon_code,
    coins_used, coins_discount, seller_discount, flow_state,
    loyverse_receipt_id, payment_provider, payment_method, payment_type_label,
    origin, dining_option, receipt_number, store_name, store_address,
    employee_name, paid_at, created_at, updated_at
  ) VALUES (
    v_customer_id, coalesce(p_items, '[]'::jsonb),
    coalesce(p_subtotal, 0), coalesce(p_coupon_discount, 0), coalesce(p_total, 0),
    v_status, 'paid',
    coalesce(nullif(trim(p_name), ''), 'Cliente da loja'),
    coalesce(p_phone, ''), coalesce(p_email, ''), coalesce(p_coupon_code, ''),
    v_coins, coalesce(p_coins_discount, 0), coalesce(p_seller_discount, 0),
    'LOYVERSE_SYNCED', p_receipt_id, 'loyverse', 'store',
    nullif(trim(coalesce(p_payment_type, '')), ''),
    'store', nullif(trim(coalesce(p_dining_option, '')), ''), p_receipt_id,
    nullif(trim(coalesce(p_store_name, '')), ''),
    nullif(trim(coalesce(p_store_address, '')), ''),
    nullif(trim(coalesce(p_employee_name, '')), ''),
    coalesce(p_receipt_date, now()),
    coalesce(p_receipt_date, now()), now()
  )
  ON CONFLICT (loyverse_receipt_id) WHERE loyverse_receipt_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_order_id;

  IF v_order_id IS NULL THEN
    SELECT id INTO v_order_id FROM public.orders
     WHERE loyverse_receipt_id = p_receipt_id LIMIT 1;
    RETURN v_order_id;
  END IF;

  INSERT INTO public.order_status_history (order_id, status, payment_status, note)
  VALUES (v_order_id, v_status, 'paid', v_note);

  IF v_coins > 0 AND v_customer_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.customer_coin_ledger
       WHERE order_id = v_order_id AND delta < 0
    ) THEN
      INSERT INTO public.customer_coin_ledger (customer_id, delta, reason, order_id)
      VALUES (v_customer_id, -v_coins, 'Moedas usadas na loja', v_order_id);
    END IF;
  END IF;

  RETURN v_order_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_store_receipt(
  text, timestamptz, text, text, text, text, jsonb, numeric, numeric, text,
  integer, numeric, numeric, numeric, text, text, text, text, text
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_store_receipt(
  text, timestamptz, text, text, text, text, jsonb, numeric, numeric, text,
  integer, numeric, numeric, numeric, text, text, text, text, text
) TO service_role;

-- O cliente passa a receber também os dados do recibo.
DROP FUNCTION IF EXISTS public.orders_for_customer(text, text);

CREATE FUNCTION public.orders_for_customer(p_device_id text, p_phone text)
RETURNS TABLE(
  id uuid, created_at timestamptz, updated_at timestamptz, status text,
  payment_status text, payment_method text, payment_provider text,
  payment_deadline_at timestamptz, payment_receipt_url text, refund_state text,
  refund_proof_url text, refund_confirmed_at timestamptz, subtotal numeric,
  discount numeric, total numeric, coupon_code text, customer_name text,
  items jsonb, origin text, payment_type_label text, coins_used integer,
  coins_discount numeric, seller_discount numeric, loyverse_receipt_id text,
  dining_option text, receipt_number text, store_name text, store_address text,
  employee_name text, customer_phone text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT o.id, o.created_at, o.updated_at, o.status, o.payment_status,
         o.payment_method, o.payment_provider, o.payment_deadline_at,
         o.payment_receipt_url,
         o.refund_state, o.refund_proof_url, o.refund_confirmed_at,
         o.subtotal, o.discount, o.total, o.coupon_code, o.customer_name, o.items,
         o.origin, o.payment_type_label, o.coins_used, o.coins_discount,
         o.seller_discount, o.loyverse_receipt_id,
         o.dining_option, o.receipt_number, o.store_name, o.store_address,
         o.employee_name, o.customer_phone
  FROM public.orders o
  WHERE
    CASE
      WHEN public.only_digits(coalesce(p_phone, '')) <> '' THEN
        right(public.only_digits(o.customer_phone), 8)
          = right(public.only_digits(p_phone), 8)
      ELSE
        coalesce(p_device_id, '') <> ''
        AND o.device_id = p_device_id
        AND public.only_digits(o.customer_phone) = ''
    END
  ORDER BY o.created_at DESC
  LIMIT 100;
$function$;

GRANT EXECUTE ON FUNCTION public.orders_for_customer(text, text)
  TO anon, authenticated, service_role;
