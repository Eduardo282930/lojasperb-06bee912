-- Agendamento automático de cupons: entra e sai sozinho.
alter table public.coupons add column if not exists starts_at timestamptz;
alter table public.coupons add column if not exists expires_at timestamptz;
