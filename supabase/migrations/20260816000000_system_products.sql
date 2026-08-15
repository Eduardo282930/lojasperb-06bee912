-- ============================================================================
-- Migration: 20260816000000
-- Sistema de Produtos Técnicos (Internos)
-- ============================================================================
-- Tabela para armazenar produtos técnicos/internos que não fazem parte do catálogo comercial.
-- Exemplos: Logo da Loja, Banners, etc
-- 
-- IMPORTANTE: Esta tabela reutiliza a função has_role() criada em migration anterior.
-- ============================================================================

-- Criar tabela system_products
CREATE TABLE IF NOT EXISTS public.system_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_type text NOT NULL UNIQUE CHECK (product_type IN ('store_logo', 'store_banner')),
  display_name text NOT NULL,
  image_url text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Comentários para documentação
COMMENT ON TABLE public.system_products IS 'Produtos técnicos/internos que não são comerciais (ex: logo da loja)';
COMMENT ON COLUMN public.system_products.product_type IS 'Tipo de produto técnico (store_logo, store_banner, etc) - UNIQUE para garantir um de cada';
COMMENT ON COLUMN public.system_products.image_url IS 'URL da imagem armazenada no Supabase Storage ou CDN';

-- Permissões
GRANT SELECT ON public.system_products TO anon, authenticated;
GRANT ALL ON public.system_products TO service_role;
ALTER TABLE public.system_products ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Qualquer um pode visualizar produtos técnicos (ex: logo público)
CREATE POLICY "Anyone can view system products" ON public.system_products
FOR SELECT TO anon, authenticated USING (true);

-- Apenas admins podem inserir produtos técnicos
CREATE POLICY "Admins can insert system products" ON public.system_products
FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Apenas admins podem atualizar produtos técnicos
CREATE POLICY "Admins can update system products" ON public.system_products
FOR UPDATE TO authenticated 
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Apenas admins podem deletar produtos técnicos
CREATE POLICY "Admins can delete system products" ON public.system_products
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Trigger para atualizar updated_at automaticamente
CREATE TRIGGER system_products_touch BEFORE UPDATE ON public.system_products
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Função para garantir que haja apenas um registro de cada tipo
CREATE OR REPLACE FUNCTION public.ensure_single_system_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Se estamos inserindo/atualizando um produto técnico com tipo único
  -- verificar se outro com o mesmo tipo já existe
  IF EXISTS (
    SELECT 1 FROM public.system_products
    WHERE product_type = NEW.product_type AND id != NEW.id
  ) THEN
    RAISE EXCEPTION 'Only one product of type % can exist. Update or delete the existing one.',
      NEW.product_type;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger para enforcement de unicidade por tipo
CREATE TRIGGER system_product_uniqueness BEFORE INSERT OR UPDATE ON public.system_products
FOR EACH ROW EXECUTE FUNCTION public.ensure_single_system_product();

-- Índices para performance
CREATE INDEX idx_system_products_type ON public.system_products(product_type);
CREATE INDEX idx_system_products_created_at ON public.system_products(created_at DESC);
