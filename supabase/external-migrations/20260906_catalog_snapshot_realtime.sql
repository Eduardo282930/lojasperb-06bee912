-- Vitrine em tempo real: cópia oficial do catálogo no banco + aviso do que mudou.
-- Não altera reserva, pagamento, recibo, reembolso, moedas ou cupons.

-- 1. Cópia oficial do catálogo (1 linha por produto + 1 linha de metadados).
CREATE TABLE IF NOT EXISTS public.catalog_snapshot (
  id          text PRIMARY KEY,
  fingerprint text NOT NULL,
  payload     jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.catalog_snapshot TO service_role;
ALTER TABLE public.catalog_snapshot ENABLE ROW LEVEL SECURITY;

-- 2. O aviso em tempo real passa a dizer QUAIS produtos mudaram.
ALTER TABLE public.catalog_revision
  ADD COLUMN IF NOT EXISTS changed_ids text[] NOT NULL DEFAULT '{}';

-- 3. Grava a cópia e sobe a revisão apenas com o que realmente mudou.
CREATE OR REPLACE FUNCTION public.apply_catalog_snapshot(
  p_rows jsonb,
  p_full boolean DEFAULT true
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_changed text[] := '{}';
  v_removed text[] := '{}';
  v_ids text[];
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN '{}';
  END IF;

  SELECT array_agg(r->>'id') INTO v_ids
  FROM jsonb_array_elements(p_rows) r;

  WITH incoming AS (
    SELECT r->>'id' AS id, r->>'fingerprint' AS fingerprint, r->'payload' AS payload
    FROM jsonb_array_elements(p_rows) r
  ),
  changed AS (
    SELECT i.* FROM incoming i
    LEFT JOIN public.catalog_snapshot s ON s.id = i.id
    WHERE s.id IS NULL OR s.fingerprint IS DISTINCT FROM i.fingerprint
  ),
  upserted AS (
    INSERT INTO public.catalog_snapshot (id, fingerprint, payload, updated_at)
    SELECT id, fingerprint, payload, now() FROM changed
    ON CONFLICT (id) DO UPDATE
      SET fingerprint = EXCLUDED.fingerprint,
          payload = EXCLUDED.payload,
          updated_at = now()
    RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}') INTO v_changed FROM upserted;

  IF p_full THEN
    WITH gone AS (
      DELETE FROM public.catalog_snapshot
      WHERE NOT (id = ANY (coalesce(v_ids, '{}')))
      RETURNING id
    )
    SELECT coalesce(array_agg(id), '{}') INTO v_removed FROM gone;
    v_changed := v_changed || v_removed;
  END IF;

  -- A linha de metadados não é um produto: não vira aviso de mudança na tela.
  v_changed := array_remove(v_changed, '__meta__');

  IF array_length(v_changed, 1) > 0 THEN
    UPDATE public.catalog_revision
       SET revision = revision + 1,
           changed_ids = v_changed,
           changed_at = now()
     WHERE store_key = 'sperb';
  END IF;

  RETURN v_changed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_catalog_snapshot(jsonb, boolean) TO service_role;

-- 4. Verificação rápida de estoque: 11 chamadas por minuto (~5 em 5 segundos),
--    feitas UMA vez pelo servidor para todos os aparelhos.
CREATE OR REPLACE FUNCTION public.run_stock_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_url text;
  i int;
BEGIN
  SELECT value INTO v_url FROM public.app_config WHERE key = 'sync_stock_url';
  IF v_url IS NULL OR v_url = '' THEN RETURN; END IF;
  FOR i IN 1..11 LOOP
    PERFORM net.http_get(url => v_url, timeout_milliseconds => 8000);
    PERFORM pg_sleep(5);
  END LOOP;
END;
$$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sperb-sync-stock';
SELECT cron.schedule('sperb-sync-stock', '* * * * *', $$SELECT public.run_stock_sync();$$);
