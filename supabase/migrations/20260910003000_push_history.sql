-- Histórico de notificações push enviadas pelo Admin.
create table if not exists public.push_history (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'info',
  title text not null,
  body text not null,
  target_url text not null default '/',
  sent integer not null default 0,
  failed integer not null default 0,
  created_at timestamptz not null default now()
);

grant all on public.push_history to service_role;

alter table public.push_history enable row level security;
-- Sem políticas: acesso somente pelo servidor (service_role).
