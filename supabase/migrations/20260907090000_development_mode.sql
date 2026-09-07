-- Modo desenvolvimento/manutenção da SPERB.
-- O estado fica no store_settings e só o administrador pode alterá-lo.

CREATE OR REPLACE FUNCTION public.set_development_mode(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN false;
  END IF;

  UPDATE public.store_settings
     SET settings = jsonb_set(
       coalesce(settings, '{}'::jsonb),
       '{development_mode}',
       to_jsonb(coalesce(p_enabled, false)),
       true
     )
   WHERE store_key = 'sperb';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.set_development_mode(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_development_mode(boolean) TO authenticated;

-- Permite que a tela administrativa invalide/atualize o estado sem abrir
-- UPDATE geral da tabela para usuários autenticados.
DROP POLICY IF EXISTS "Admins can update store settings" ON public.store_settings;
CREATE POLICY "Admins can update store settings"
  ON public.store_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
