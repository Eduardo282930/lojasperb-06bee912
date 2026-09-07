-- Corrige a ativação do modo manutenção.
-- A função anterior chamava has_role(), mas essa função teve o EXECUTE
-- revogado para authenticated em uma migration anterior. Por isso o botão
-- sempre retornava false mesmo para um administrador.
-- Aqui a própria função SECURITY DEFINER consulta user_roles diretamente.

CREATE OR REPLACE FUNCTION public.set_development_mode(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = v_user_id
      AND role = 'admin'::public.app_role
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
    );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_development_mode(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_development_mode(boolean) TO authenticated;
