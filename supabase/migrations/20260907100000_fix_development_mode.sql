-- Correção do modo manutenção/desenvolvimento da SPERB.
-- Leitura pública somente do estado; alteração somente por administrador.

CREATE OR REPLACE FUNCTION public.get_development_mode()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  SELECT COALESCE((settings->>'development_mode')::boolean, false)
    INTO v_enabled
    FROM public.store_settings
   WHERE store_key = 'sperb'
   LIMIT 1;

  RETURN COALESCE(v_enabled, false);
END;
$$;

REVOKE ALL ON FUNCTION public.get_development_mode() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_development_mode() TO anon, authenticated;

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
       COALESCE(settings, '{}'::jsonb),
       '{development_mode}',
       to_jsonb(COALESCE(p_enabled, false)),
       true
     ),
     updated_at = now()
   WHERE store_key = 'sperb';

  IF NOT FOUND THEN
    INSERT INTO public.store_settings (store_key, name, settings)
    VALUES ('sperb', 'SPERB', jsonb_build_object('development_mode', COALESCE(p_enabled, false)));
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_development_mode(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_development_mode(boolean) TO authenticated;
