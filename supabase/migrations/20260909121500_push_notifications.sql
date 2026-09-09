-- Push real por aparelho. As chaves nunca ficam no banco: somente a assinatura do navegador.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_key text NOT NULL DEFAULT 'sperb',
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  device_id text,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
CREATE INDEX IF NOT EXISTS push_subscriptions_customer_idx ON public.push_subscriptions(customer_id);

ALTER TABLE public.customer_notifications ADD COLUMN IF NOT EXISTS target_url text NOT NULL DEFAULT '/';
GRANT SELECT ON public.customer_notifications TO authenticated;

-- O RPC legado continua funcionando para moedas/cupons; novos avisos do Admin
-- usam o endpoint de Push e também salvam target_url diretamente.
