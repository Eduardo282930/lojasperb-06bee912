-- ---------------------------------------------------------------------------
-- SPERB — Reembolso: dados da transação InfinitePay + estado pendente/realizado
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_slug text,
  ADD COLUMN IF NOT EXISTS payment_order_nsu text,
  ADD COLUMN IF NOT EXISTS payment_transaction_nsu text;

-- Guarda os identificadores oficiais da InfinitePay do pedido pago.
CREATE OR REPLACE FUNCTION public.record_payment_identifiers(
  p_order_id uuid,
  p_order_nsu text,
  p_transaction_nsu text,
  p_slug text,
  p_receipt_url text DEFAULT ''
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.orders
     SET payment_order_nsu = coalesce(nullif(p_order_nsu, ''), payment_order_nsu),
         payment_transaction_nsu =
           coalesce(nullif(p_transaction_nsu, ''), payment_transaction_nsu),
         payment_slug = coalesce(nullif(p_slug, ''), payment_slug),
         payment_receipt_url = coalesce(nullif(p_receipt_url, ''), payment_receipt_url)
   WHERE id = p_order_id;
  RETURN found;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_payment_identifiers(uuid, text, text, text, text)
  TO service_role;

-- O cliente também precisa enxergar o estado do reembolso e o comprovante.
DROP FUNCTION IF EXISTS public.orders_for_customer(text, text);
CREATE FUNCTION public.orders_for_customer(p_device_id text, p_phone text)
RETURNS TABLE(
  id uuid, created_at timestamptz, updated_at timestamptz, status text,
  payment_status text, payment_method text, payment_provider text,
  payment_deadline_at timestamptz, refund_state text, refund_proof_url text,
  refund_confirmed_at timestamptz,
  subtotal numeric, discount numeric, total numeric, coupon_code text,
  customer_name text, items jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT o.id, o.created_at, o.updated_at, o.status, o.payment_status,
         o.payment_method, o.payment_provider, o.payment_deadline_at,
         o.refund_state, o.refund_proof_url, o.refund_confirmed_at,
         o.subtotal, o.discount, o.total, o.coupon_code, o.customer_name, o.items
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
$$;

GRANT EXECUTE ON FUNCTION public.orders_for_customer(text, text)
  TO anon, authenticated, service_role;
