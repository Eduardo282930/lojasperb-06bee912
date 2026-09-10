-- Avisos automáticos de pedido: um único envio por evento real.
create table if not exists public.order_push_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  event text not null,
  sent integer not null default 0,
  created_at timestamptz not null default now(),
  unique (order_id, event)
);

create index if not exists order_push_events_order_idx on public.order_push_events (order_id);

grant all on public.order_push_events to service_role;

alter table public.order_push_events enable row level security;
-- Sem políticas públicas: apenas o servidor (service_role) grava e lê.

-- Cancelamento automático por falta de pagamento devolvendo os pedidos
-- cancelados, para que o servidor avise cada cliente uma única vez.
create or replace function public.cancel_expired_unpaid_orders_ids()
returns setof uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  for v_id in
    select id from public.orders
     where payment_deadline_at is not null
       and payment_deadline_at < now()
       and coalesce(payment_status, 'pending') = 'pending'
       and status <> 'canceled'
     limit 200
  loop
    update public.orders
       set status = 'canceled',
           flow_state = 'CANCELLED',
           updated_at = now()
     where id = v_id;

    update public.order_stock_reservations
       set active = false, updated_at = now()
     where order_id = v_id and active = true;

    insert into public.order_status_history (order_id, status, payment_status, note)
    values (v_id, 'canceled', 'pending', 'Cancelado automaticamente — falta de pagamento');

    return next v_id;
  end loop;
end;
$$;

grant execute on function public.cancel_expired_unpaid_orders_ids() to service_role;
