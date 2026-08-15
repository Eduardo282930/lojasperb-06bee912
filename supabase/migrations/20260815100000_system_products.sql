-- System/Internal Products Table
-- This table stores internal products like the store logo that are not part of the commercial catalog.

CREATE TABLE public.system_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_type text NOT NULL UNIQUE CHECK (product_type IN ('store_logo')),
  display_name text NOT NULL,
  image_url text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS Policies
GRANT SELECT ON public.system_products TO anon, authenticated;
GRANT ALL ON public.system_products TO service_role;
ALTER TABLE public.system_products ENABLE ROW LEVEL SECURITY;

-- Anyone can view system products
CREATE POLICY "Anyone can view system products" ON public.system_products
FOR SELECT TO anon, authenticated USING (true);

-- Only admins can update system products
CREATE POLICY "Admins can update system products" ON public.system_products
FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Only admins can insert system products
CREATE POLICY "Admins can insert system products" ON public.system_products
FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Auto-update trigger
CREATE TRIGGER system_products_touch BEFORE UPDATE ON public.system_products
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Ensure only one store logo exists
-- If someone tries to insert/update with product_type='store_logo', ensure uniqueness
CREATE OR REPLACE FUNCTION public.ensure_single_store_logo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.product_type = 'store_logo' THEN
    -- Check if another store_logo already exists (different id)
    IF EXISTS (
      SELECT 1 FROM public.system_products
      WHERE product_type = 'store_logo' AND id != NEW.id
    ) THEN
      RAISE EXCEPTION 'Only one store logo can exist. Delete or update the existing one.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER store_logo_uniqueness BEFORE INSERT OR UPDATE ON public.system_products
FOR EACH ROW EXECUTE FUNCTION public.ensure_single_store_logo();
