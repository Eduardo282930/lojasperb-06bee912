-- ============ STORE SETTINGS (logo da loja, nunca um produto) ============
CREATE TABLE IF NOT EXISTS public.store_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_key text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT 'SPERB',
  logo_url text,
  logo_source text NOT NULL DEFAULT 'loyverse',
  logo_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.store_settings TO anon, authenticated;
GRANT ALL ON public.store_settings TO service_role;
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view store settings" ON public.store_settings
  FOR SELECT TO anon, authenticated USING (true);
CREATE TRIGGER store_settings_touch BEFORE UPDATE ON public.store_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
INSERT INTO public.store_settings (store_key, name) VALUES ('sperb', 'SPERB')
  ON CONFLICT (store_key) DO NOTHING;

-- ============ CATALOG CATEGORIES ============
CREATE TABLE IF NOT EXISTS public.catalog_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_key text NOT NULL DEFAULT 'sperb',
  external_id text NOT NULL,
  name text NOT NULL DEFAULT 'Outros',
  source text NOT NULL DEFAULT 'loyverse',
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_key, external_id)
);
GRANT SELECT ON public.catalog_categories TO anon, authenticated;
GRANT ALL ON public.catalog_categories TO service_role;
ALTER TABLE public.catalog_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view catalog categories" ON public.catalog_categories
  FOR SELECT TO anon, authenticated USING (true);
CREATE TRIGGER catalog_categories_touch BEFORE UPDATE ON public.catalog_categories
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ CATALOG PRODUCTS (resultado FINAL do catálogo) ============
CREATE TABLE IF NOT EXISTS public.catalog_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_key text NOT NULL DEFAULT 'sperb',
  product_key text NOT NULL,
  source text NOT NULL DEFAULT 'loyverse',
  external_item_id text,
  external_variant_id text,
  name text NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  image text,
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  stock numeric NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  generated_description boolean NOT NULL DEFAULT false,
  sku text NOT NULL DEFAULT '',
  category_external_id text,
  category_name text NOT NULL DEFAULT 'Outros',
  variant_axis text NOT NULL DEFAULT '',
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_key, product_key)
);
CREATE INDEX IF NOT EXISTS catalog_products_variant_idx
  ON public.catalog_products (external_variant_id);
GRANT SELECT ON public.catalog_products TO anon, authenticated;
GRANT ALL ON public.catalog_products TO service_role;
ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view catalog products" ON public.catalog_products
  FOR SELECT TO anon, authenticated USING (true);
CREATE TRIGGER catalog_products_touch BEFORE UPDATE ON public.catalog_products
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ CUSTOMERS: identidade central ============
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS loyverse_id text,
  ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS synced_at timestamptz;

-- device_id deixa de ser obrigatório (clientes vindos do Loyverse não têm device)
ALTER TABLE public.customers ALTER COLUMN device_id DROP NOT NULL;

-- unifica telefones duplicados antes de criar a restrição
WITH ranked AS (
  SELECT id, public.only_digits(phone) AS d,
         row_number() OVER (PARTITION BY public.only_digits(phone)
                            ORDER BY (coalesce(name,'') <> '') DESC, created_at) AS rn
  FROM public.customers
  WHERE public.only_digits(phone) <> ''
)
DELETE FROM public.customers c USING ranked r
WHERE c.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_digits_key
  ON public.customers (public.only_digits(phone))
  WHERE public.only_digits(phone) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS customers_loyverse_id_key
  ON public.customers (loyverse_id) WHERE loyverse_id IS NOT NULL;

-- ============ ROTINAS ============
CREATE OR REPLACE FUNCTION public.save_customer(p_device_id text, p_name text, p_phone text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_digits text := public.only_digits(p_phone);
  v_id uuid;
  v_locked text;
BEGIN
  IF v_digits = '' THEN
    RETURN;
  END IF;

  SELECT id, nullif(name, '') INTO v_id, v_locked
  FROM public.customers
  WHERE public.only_digits(phone) = v_digits
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- evita conflito com outro registro que já usa este device
    UPDATE public.customers SET device_id = NULL
     WHERE device_id = p_device_id AND id <> v_id;
    UPDATE public.customers
       SET name = coalesce(v_locked, nullif(trim(p_name), ''), ''),
           phone = p_phone,
           device_id = coalesce(p_device_id, device_id),
           updated_at = now()
     WHERE id = v_id;
  ELSE
    INSERT INTO public.customers (device_id, name, phone, source)
    VALUES (p_device_id, coalesce(nullif(trim(p_name), ''), ''), p_phone, 'app');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_customer_from_loyverse(
  p_loyverse_id text, p_name text, p_phone text, p_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_digits text := public.only_digits(p_phone);
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.customers WHERE loyverse_id = p_loyverse_id LIMIT 1;

  IF v_id IS NULL AND v_digits <> '' THEN
    SELECT id INTO v_id FROM public.customers
     WHERE public.only_digits(phone) = v_digits LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.customers
       SET loyverse_id = p_loyverse_id,
           name = coalesce(nullif(trim(p_name), ''), name),
           phone = CASE WHEN v_digits <> '' THEN p_phone ELSE phone END,
           email = coalesce(nullif(trim(p_email), ''), email),
           source = 'loyverse',
           synced_at = now(),
           updated_at = now()
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.customers (device_id, loyverse_id, name, phone, email, source, synced_at)
  VALUES (NULL, p_loyverse_id, coalesce(nullif(trim(p_name), ''), ''),
          coalesce(p_phone, ''), coalesce(p_email, ''), 'loyverse', now())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;