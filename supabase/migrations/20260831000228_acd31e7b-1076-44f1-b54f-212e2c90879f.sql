ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_nsu text;
CREATE INDEX IF NOT EXISTS orders_payment_nsu_idx ON public.orders (payment_nsu);