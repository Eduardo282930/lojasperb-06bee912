-- ============================================================================
-- Migration: 20260816000300
-- Nível de Estoque
-- ============================================================================
-- Tabela para rastrear estoque de produtos (variantes).
-- Integração com Loyverse API - dados sincronizados periodicamente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.stock_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id text NOT NULL UNIQUE,
  product_id text NOT NULL,
  warehouse_id uuid DEFAULT NULL,
  quantity_on_hand integer NOT NULL DEFAULT 0,
  quantity_reserved integer NOT NULL DEFAULT 0,
  quantity_available integer GENERATED ALWAYS AS (quantity_on_hand - quantity_reserved) STORED,
  reorder_point integer DEFAULT 10,
  reorder_quantity integer DEFAULT 50,
  last_synced_at timestamptz,
  last_movement_at timestamptz,
  loyverse_synced boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.stock_levels IS 'Nível de estoque atual por variante de produto (integrado com Loyverse)';
COMMENT ON COLUMN public.stock_levels.variant_id IS 'ID da variante no Loyverse (chave única)';
COMMENT ON COLUMN public.stock_levels.product_id IS 'ID do produto no Loyverse';
COMMENT ON COLUMN public.stock_levels.quantity_on_hand IS 'Quantidade total disponível';
COMMENT ON COLUMN public.stock_levels.quantity_reserved IS 'Quantidade reservada em pedidos';
COMMENT ON COLUMN public.stock_levels.quantity_available IS 'Calculado: on_hand - reserved';
COMMENT ON COLUMN public.stock_levels.loyverse_synced IS 'Se dados foram sincronizados com Loyverse';

-- Permissões
GRANT SELECT ON public.stock_levels TO anon, authenticated;
GRANT ALL ON public.stock_levels TO service_role;
ALTER TABLE public.stock_levels ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Qualquer um pode ver estoque (informação pública)
CREATE POLICY "Anyone can view stock levels" ON public.stock_levels
FOR SELECT TO anon, authenticated USING (true);

-- Apenas admins podem atualizar estoque (via API ou manualmente)
CREATE POLICY "Admins can update stock levels" ON public.stock_levels
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Service role pode fazer sync com Loyverse
CREATE POLICY "Service role can manage stock levels" ON public.stock_levels
FOR ALL TO service_role USING (true);

-- Trigger para atualizar updated_at
CREATE TRIGGER stock_levels_touch BEFORE UPDATE ON public.stock_levels
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Índices para performance
CREATE INDEX idx_stock_levels_variant_id ON public.stock_levels(variant_id);
CREATE INDEX idx_stock_levels_product_id ON public.stock_levels(product_id);
CREATE INDEX idx_stock_levels_warehouse_id ON public.stock_levels(warehouse_id) WHERE warehouse_id IS NOT NULL;
CREATE INDEX idx_stock_levels_quantity_available ON public.stock_levels(quantity_available);
CREATE INDEX idx_stock_levels_last_synced ON public.stock_levels(last_synced_at DESC);

-- Criar tabela de movimentações de estoque (histórico)
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_level_id uuid NOT NULL REFERENCES public.stock_levels(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN (
    'INITIAL', 'PURCHASE', 'SALE', 'ADJUSTMENT',
    'RETURN', 'DAMAGE', 'WASTE', 'TRANSFER'
  )),
  quantity integer NOT NULL,
  reason text,
  reference_type text,
  reference_id uuid,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.stock_movements IS 'Histórico de movimentações de estoque';
COMMENT ON COLUMN public.stock_movements.movement_type IS 'Tipo de movimentação (entrada/saída/ajuste)';
COMMENT ON COLUMN public.stock_movements.reference_type IS 'Tipo de referência (order, purchase_order, etc)';
COMMENT ON COLUMN public.stock_movements.reference_id IS 'ID da referência (order_id, purchase_order_id, etc)';

-- Permissões
GRANT SELECT ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can view stock movements" ON public.stock_movements
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Service role can manage stock movements" ON public.stock_movements
FOR ALL TO service_role USING (true);

-- Índices
CREATE INDEX idx_stock_movements_stock_level_id ON public.stock_movements(stock_level_id);
CREATE INDEX idx_stock_movements_type ON public.stock_movements(movement_type);
CREATE INDEX idx_stock_movements_user_id ON public.stock_movements(user_id);
CREATE INDEX idx_stock_movements_created_at ON public.stock_movements(created_at DESC);
CREATE INDEX idx_stock_movements_reference ON public.stock_movements(reference_type, reference_id);

-- Função para registrar movimentação de estoque
CREATE OR REPLACE FUNCTION public.register_stock_movement(
  p_stock_level_id uuid,
  p_movement_type text,
  p_quantity integer,
  p_reason text DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movement_id uuid;
BEGIN
  INSERT INTO public.stock_movements (
    stock_level_id,
    movement_type,
    quantity,
    reason,
    reference_type,
    reference_id,
    user_id,
    notes
  ) VALUES (
    p_stock_level_id,
    p_movement_type,
    p_quantity,
    p_reason,
    p_reference_type,
    p_reference_id,
    auth.uid(),
    p_notes
  ) RETURNING id INTO v_movement_id;
  
  -- Atualizar last_movement_at
  UPDATE public.stock_levels SET last_movement_at = now()
  WHERE id = p_stock_level_id;
  
  RETURN v_movement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_stock_movement TO authenticated, service_role;
