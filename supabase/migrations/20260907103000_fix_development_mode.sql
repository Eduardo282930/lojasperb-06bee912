-- Corrige o modo desenvolvimento/manutenção da SPERB.
-- Garante que a configuração exista e que somente o administrador possa alterá-la.

ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.set_development_mode(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  -- O mesmo usuário administrador usado pelo painel SPERB.
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = v_user_id
      AND role = 'admin'::public.app_role
  ) THEN
    RETURN false;
  END IF;

  -- Cria a configuração caso ela ainda não exista e atualiza o estado.
  INSERT INTO public.store_settings (store_key, name, settings)
  VALUES (
    'sperb',
    'SPERB',
    jsonb_build_object('development_mode', coalesce(p_enabled, false))
  )
  ON CONFLICT (store_key) DO UPDATE
    SET settings = jsonb_set(
      coalesce(public.store_settings.settings, '{}'::jsonb),
      '{development_mode}',
      to_jsonb(coalesce(p_enabled, false)),
      true
    ),
    updated_at = now();

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_development_mode(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_development_mode(boolean) TO authenticated;
