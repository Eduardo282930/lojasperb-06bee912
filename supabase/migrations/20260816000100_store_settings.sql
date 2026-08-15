-- ============================================================================
-- Migration: 20260816000100
-- Configurações da Loja
-- ============================================================================
-- Tabela para armazenar configurações globais da loja (SPERB).
-- Será usada tanto pelo catálogo quanto pelo gestor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.store_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text NOT NULL UNIQUE,
  setting_value jsonb NOT NULL,
  description text,
  is_secret boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.store_settings IS 'Configurações globais da loja (nome, telefone, endereço, etc)';
COMMENT ON COLUMN public.store_settings.setting_key IS 'Chave única da configuração (ex: store_name, store_phone, etc)';
COMMENT ON COLUMN public.store_settings.setting_value IS 'Valor da configuração em JSON (permite diferentes tipos de dados)';
COMMENT ON COLUMN public.store_settings.is_secret IS 'Se true, não deve ser exposto para clientes anônimos';

-- Permissões
GRANT SELECT ON public.store_settings TO anon, authenticated;
GRANT ALL ON public.store_settings TO service_role;
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Clientes anônimos veem apenas configurações públicas
CREATE POLICY "Public can view public store settings" ON public.store_settings
FOR SELECT TO anon USING (is_secret = false);

-- Usuários autenticados veem todas as configurações (para o catálogo)
CREATE POLICY "Authenticated can view store settings" ON public.store_settings
FOR SELECT TO authenticated USING (true);

-- Apenas admins podem modificar configurações
CREATE POLICY "Admins can insert store settings" ON public.store_settings
FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update store settings" ON public.store_settings
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete store settings" ON public.store_settings
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Trigger para atualizar updated_at
CREATE TRIGGER store_settings_touch BEFORE UPDATE ON public.store_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Índices
CREATE INDEX idx_store_settings_key ON public.store_settings(setting_key);
CREATE INDEX idx_store_settings_secret ON public.store_settings(is_secret);

-- Inserir configurações padrão (serão sobrescritas se já existirem)
INSERT INTO public.store_settings (setting_key, setting_value, description, is_secret)
VALUES 
  ('store_name', '"SPERB"'::jsonb, 'Nome da loja', false),
  ('store_phone', '""'::jsonb, 'Telefone da loja para contato', false),
  ('store_address', '""'::jsonb, 'Endereço da loja', false),
  ('store_email', '""'::jsonb, 'Email da loja', false),
  ('store_currency', '"BRL"'::jsonb, 'Moeda padrão (ISO 4217)', false),
  ('enable_catalog', 'true'::jsonb, 'Habilitar catálogo público', false),
  ('enable_pdv', 'true'::jsonb, 'Habilitar PDV/Ponto de Venda', false),
  ('loyalty_enabled', 'false'::jsonb, 'Habilitar programa de fidelidade', false),
  ('max_cart_items', '999'::jsonb, 'Quantidade máxima de itens no carrinho', false)
ON CONFLICT (setting_key) DO NOTHING;
