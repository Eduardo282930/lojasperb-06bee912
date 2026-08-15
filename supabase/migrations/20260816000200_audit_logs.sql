-- ============================================================================
-- Migration: 20260816000200
-- Auditoria e Logs
-- ============================================================================
-- Tabela para rastrear ações críticas realizadas no sistema.
-- Essencial para conformidade e debugging.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type text NOT NULL CHECK (action_type IN (
    'CREATE', 'READ', 'UPDATE', 'DELETE',
    'ADMIN_LOGIN', 'ADMIN_ACTION', 'SYSTEM_EVENT',
    'COUPON_USED', 'ORDER_CREATED', 'ORDER_UPDATED'
  )),
  table_name text,
  record_id uuid,
  old_values jsonb,
  new_values jsonb,
  details jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.audit_logs IS 'Log de auditoria de todas as ações críticas do sistema';
COMMENT ON COLUMN public.audit_logs.user_id IS 'Usuário que realizou a ação (NULL para ações de sistema)';
COMMENT ON COLUMN public.audit_logs.action_type IS 'Tipo de ação realizada';
COMMENT ON COLUMN public.audit_logs.table_name IS 'Tabela afetada pela ação';
COMMENT ON COLUMN public.audit_logs.record_id IS 'ID do registro afetado';
COMMENT ON COLUMN public.audit_logs.old_values IS 'Valores anteriores (para UPDATE)';
COMMENT ON COLUMN public.audit_logs.new_values IS 'Novos valores (para CREATE/UPDATE)';
COMMENT ON COLUMN public.audit_logs.details IS 'Detalhes adicionais em JSON';

-- Permissões
GRANT SELECT ON public.audit_logs TO service_role;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS: Apenas admins e sistema podem ver logs
CREATE POLICY "Service role can manage audit logs" ON public.audit_logs
FOR ALL TO service_role USING (true);

CREATE POLICY "Admins can view audit logs" ON public.audit_logs
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Índices para performance em queries de log
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_action_type ON public.audit_logs(action_type);
CREATE INDEX idx_audit_logs_table_name ON public.audit_logs(table_name);
CREATE INDEX idx_audit_logs_record_id ON public.audit_logs(record_id);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_user_action ON public.audit_logs(user_id, action_type, created_at DESC);

-- Função para registrar ação de auditoria
CREATE OR REPLACE FUNCTION public.log_audit_action(
  p_action_type text,
  p_table_name text DEFAULT NULL,
  p_record_id uuid DEFAULT NULL,
  p_old_values jsonb DEFAULT NULL,
  p_new_values jsonb DEFAULT NULL,
  p_details jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id uuid;
BEGIN
  INSERT INTO public.audit_logs (
    user_id,
    action_type,
    table_name,
    record_id,
    old_values,
    new_values,
    details
  ) VALUES (
    auth.uid(),
    p_action_type,
    p_table_name,
    p_record_id,
    p_old_values,
    p_new_values,
    p_details
  ) RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_audit_action TO authenticated, service_role;
