-- Modo manutenção SPERB: versão final, sem depender de has_role().
-- Usa os mesmos user_roles do administrador já existente no painel.

ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.admin_get_development_mode()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  SELECT COALESCE((settings ->> 'development_mode')::boolean, false)
    INTO v_enabled
    FROM public.store_settings
   WHERE store_key = 'sperb'
   LIMIT 1;

  RETURN COALESCE(v_enabled, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_development_mode(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  -- O mesmo cadastro de administrador usado pelo painel SPERB.
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.user_roles ur
     WHERE ur.user_id = v_user_id
       AND ur.role = 'admin'::public.app_role
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.store_settings (store_key, name, settings)
  VALUES (
    'sperb',
    'SPERB',
    jsonb_build_object('development_mode', COALESCE(p_enabled, false))
  )
  ON CONFLICT (store_key) DO UPDATE
    SET settings = jsonb_set(
      COALESCE(public.store_settings.settings, '{}'::jsonb),
      '{development_mode}',
      to_jsonb(COALESCE(p_enabled, false)),
      true
    ),
    updated_at = now();

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_development_mode() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_development_mode() TO anon, authenticated;

REVOKE ALL ON FUNCTION public.admin_set_development_mode(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_development_mode(boolean) TO authenticated;

-- Faz o PostgREST recarregar imediatamente as funções novas.
NOTIFY pgrst, 'reload schema';
