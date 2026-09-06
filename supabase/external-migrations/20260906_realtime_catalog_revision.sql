-- Atualização automática (tempo real) + sincronizador de segurança do catálogo.
-- Nada aqui altera regras de reserva, pagamento, recibo, reembolso, moedas ou cupons.

-- 1. Marcador de versão do catálogo (preço/estoque/disponibilidade/variações).
CREATE TABLE IF NOT EXISTS public.catalog_revision (
  store_key   text PRIMARY KEY,
  revision    bigint NOT NULL DEFAULT 1,
  fingerprint text NOT NULL DEFAULT '',
  changed_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.catalog_revision TO anon;
GRANT SELECT ON public.catalog_revision TO authenticated;
GRANT ALL ON public.catalog_revision TO service_role;

ALTER TABLE public.catalog_revision ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catalog_revision readable" ON public.catalog_revision;
CREATE POLICY "catalog_revision readable"
  ON public.catalog_revision FOR SELECT
  USING (true);

INSERT INTO public.catalog_revision (store_key) VALUES ('sperb')
ON CONFLICT (store_key) DO NOTHING;

-- Sobe a revisão apenas quando a impressão digital do catálogo muda de verdade.
CREATE OR REPLACE FUNCTION public.bump_catalog_revision(p_fingerprint text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current text;
BEGIN
  SELECT fingerprint INTO v_current
  FROM public.catalog_revision WHERE store_key = 'sperb' FOR UPDATE;

  IF v_current IS NULL THEN
    INSERT INTO public.catalog_revision (store_key, revision, fingerprint, changed_at)
    VALUES ('sperb', 1, coalesce(p_fingerprint, ''), now());
    RETURN true;
  END IF;

  IF v_current IS NOT DISTINCT FROM coalesce(p_fingerprint, '') THEN
    RETURN false;
  END IF;

  UPDATE public.catalog_revision
     SET revision = revision + 1,
         fingerprint = coalesce(p_fingerprint, ''),
         changed_at = now()
   WHERE store_key = 'sperb';

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bump_catalog_revision(text) TO service_role;

-- 2. Tempo real nas tabelas que alimentam as telas.
ALTER TABLE public.catalog_revision REPLICA IDENTITY FULL;
ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER TABLE public.order_status_history REPLICA IDENTITY FULL;
ALTER TABLE public.customer_coin_ledger REPLICA IDENTITY FULL;
ALTER TABLE public.customer_notifications REPLICA IDENTITY FULL;
ALTER TABLE public.customer_coupon_claims REPLICA IDENTITY FULL;
ALTER TABLE public.product_stock REPLICA IDENTITY FULL;
ALTER TABLE public.coupons REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'catalog_revision','orders','order_status_history','customer_coin_ledger',
    'customer_notifications','customer_coupon_claims','product_stock','coupons'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- 3. Agendador de verdade: o servidor chama o sincronizador sozinho, 1x por minuto.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.app_config (
  key   text PRIMARY KEY,
  value text NOT NULL
);
GRANT ALL ON public.app_config TO service_role;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.run_catalog_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_url text;
BEGIN
  SELECT value INTO v_url FROM public.app_config WHERE key = 'sync_catalog_url';
  IF v_url IS NULL OR v_url = '' THEN RETURN; END IF;
  PERFORM net.http_get(url => v_url, timeout_milliseconds => 20000);
END;
$$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sperb-sync-catalog';
SELECT cron.schedule('sperb-sync-catalog', '* * * * *', $$SELECT public.run_catalog_sync();$$);
