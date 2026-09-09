-- Aparelhos inscritos para receber notificações Push (Web Push / VAPID).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  device_id text,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_customer_idx on public.push_subscriptions (customer_id);
create index if not exists push_subscriptions_device_idx on public.push_subscriptions (device_id);

grant all on public.push_subscriptions to service_role;

alter table public.push_subscriptions enable row level security;
-- Sem políticas públicas: apenas o servidor (service_role) grava e lê.
