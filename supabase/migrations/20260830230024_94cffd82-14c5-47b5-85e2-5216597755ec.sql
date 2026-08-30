ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_provider text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_id text,
  ADD COLUMN IF NOT EXISTS payment_receipt_url text,
  ADD COLUMN IF NOT EXISTS payment_url text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE TABLE IF NOT EXISTS public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_key text NOT NULL DEFAULT 'sperb',
  provider text NOT NULL DEFAULT 'infinitepay',
  external_id text NOT NULL,
  order_id uuid REFERENCES public.orders(id),
  status text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

GRANT ALL ON public.payment_events TO service_role;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_events_admin_read" ON public.payment_events;
CREATE POLICY "payment_events_admin_read" ON public.payment_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.payment_events TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_order_payment(
  p_order_id uuid,
  p_provider text,
  p_external_id text,
  p_method text,
  p_amount numeric,
  p_receipt_url text,
  p_raw jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  IF v_order.customer_id IS NOT NULL THEN
    INSERT INTO public.customer_notifications (customer_id, kind, title, body)
    VALUES (v_order.customer_id, 'payment', 'Pagamento confirmado!',
            'Recebemos seu pagamento e seu pedido SPERB já está em preparação.');
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_order_payment_link(
  p_order_id uuid,
  p_url text,
  p_provider text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.orders
     SET payment_url = p_url,
         payment_provider = coalesce(nullif(p_provider,''),'infinitepay')
   WHERE id = p_order_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_exists(p_phone text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.customers
    WHERE public.only_digits(phone) = public.only_digits(p_phone)
      AND public.only_digits(p_phone) <> ''
  );
$$;