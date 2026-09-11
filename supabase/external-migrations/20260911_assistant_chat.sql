-- Execute somente no Supabase externo SPERB. Não armazena imagens.
begin;
create table if not exists public.assistant_conversations (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null,
 created_at timestamptz not null default now(), expires_at timestamptz not null default (now()+interval '30 days')
);
grant all on public.assistant_conversations to service_role;
alter table public.assistant_conversations enable row level security;
create table if not exists public.assistant_messages (
 id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
 role text not null check(role in ('user','assistant')), content text not null,
 created_at timestamptz not null default now()
);
grant all on public.assistant_messages to service_role;
alter table public.assistant_messages enable row level security;
create table if not exists public.assistant_products (
 id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
 draft jsonb not null, mode text not null check(mode in ('store','order')), result jsonb,
 status text not null default 'pending', error text, created_at timestamptz not null default now()
);
grant all on public.assistant_products to service_role;
alter table public.assistant_products enable row level security;
-- Identificadores mínimos de operações são permanentes para impedir dupla entrada após expiração da conversa.
create table if not exists public.assistant_operations (
 operation_key text primary key, status text not null default 'started', result jsonb,
 created_at timestamptz not null default now()
);
grant all on public.assistant_operations to service_role;
alter table public.assistant_operations enable row level security;
create table if not exists public.assistant_locks (
 lock_key text primary key, owner uuid not null, expires_at timestamptz not null
);
grant all on public.assistant_locks to service_role;
alter table public.assistant_locks enable row level security;
create index if not exists assistant_messages_thread on public.assistant_messages(conversation_id,created_at);
create index if not exists assistant_products_thread on public.assistant_products(conversation_id,created_at);
create index if not exists assistant_expiration on public.assistant_conversations(expires_at);
create or replace function public.assistant_lock(k text, who uuid) returns boolean language plpgsql security definer set search_path=public as $$
begin
 insert into assistant_locks values(k,who,now()+interval '15 minutes') on conflict(lock_key) do update set owner=excluded.owner,expires_at=excluded.expires_at where assistant_locks.expires_at<now();
 return found;
end $$;
revoke all on function public.assistant_lock(text,uuid) from public,anon,authenticated;
grant execute on function public.assistant_lock(text,uuid) to service_role;
create or replace function public.cleanup_assistant_memory() returns void language sql security definer set search_path=public as $$
 delete from assistant_conversations where expires_at <= now();
 delete from assistant_locks where expires_at <= now();
$$;
revoke all on function public.cleanup_assistant_memory() from public,anon,authenticated;
grant execute on function public.cleanup_assistant_memory() to service_role;
commit;
-- Ative pg_cron em Extensões se ainda não estiver habilitado.
-- Execute as linhas abaixo após ativá-lo; limpeza horária, sem depender de abrir o app.
select cron.schedule('sperb-assistant-memory-cleanup','0 * * * *','select public.cleanup_assistant_memory()');
