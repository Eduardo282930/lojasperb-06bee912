-- Pedidos são privados: só o dono (telefone) enxerga.
DROP FUNCTION IF EXISTS public.orders_for_customer(text, text);
CREATE FUNCTION public.orders_for_customer(p_device_id text, p_phone text)
RETURNS TABLE(
  id uuid, created_at timestamptz, updated_at timestamptz, status text,
  payment_status text, payment_method text, payment_provider text,
  payment_deadline_at timestamptz, refund_state text, refund_proof_url text,
  subtotal numeric, discount numeric, total numeric, coupon_code text,
  customer_name text, items jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT o.id, o.created_at, o.updated_at, o.status, o.payment_status,
         o.payment_method, o.payment_provider, o.payment_deadline_at,
         o.refund_state, o.refund_proof_url,
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
GRANT EXECUTE ON FUNCTION public.orders_for_customer(text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.order_history_for_customer(p_order_id uuid, p_device_id text, p_phone text)
RETURNS TABLE(status text, payment_status text, note text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT h.status, h.payment_status, h.note, h.created_at
  FROM public.order_status_history h
  JOIN public.orders o ON o.id = h.order_id
  WHERE h.order_id = p_order_id
    AND CASE
      WHEN public.only_digits(coalesce(p_phone, '')) <> '' THEN
        right(public.only_digits(o.customer_phone), 8)
          = right(public.only_digits(p_phone), 8)
      ELSE
        coalesce(p_device_id, '') <> ''
        AND o.device_id = p_device_id
        AND public.only_digits(o.customer_phone) = ''
    END
  ORDER BY h.created_at ASC;
$$;
GRANT EXECUTE ON FUNCTION public.order_history_for_customer(uuid, text, text) TO anon, authenticated, service_role;
