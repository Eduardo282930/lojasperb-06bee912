DROP FUNCTION IF EXISTS public.top_selling_products();

CREATE OR REPLACE FUNCTION public.top_selling_products()
RETURNS TABLE(variant_id text, product_key text, qty numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(i.external_variant_id, '') AS variant_id,
         coalesce(i.product_key, '') AS product_key,
         sum(i.qty)::numeric AS qty
  FROM public.order_items i
  JOIN public.orders o ON o.id = i.order_id
  WHERE o.status <> 'canceled'
    AND o.created_at > now() - interval '90 days'
  GROUP BY 1, 2
  ORDER BY sum(i.qty) DESC
  LIMIT 60
$$;