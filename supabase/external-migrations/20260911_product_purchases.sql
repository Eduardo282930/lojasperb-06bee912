-- Assistente SPERB: dados auxiliares da compra (Shopee), sem guardar imagens.
-- O Loyverse continua sendo a fonte principal: nome, variação, custo, estoque
-- e preço de venda. Aqui ficam só as informações que o Loyverse não guarda.
create table if not exists public.product_purchases (
  id uuid primary key default gen_random_uuid(),
  external_variant_id text not null,
  loyverse_item_id text,
  product_name text not null default '',
  variant_label text not null default '',
  qty integer not null default 1,
  cost numeric not null default 0,
  listed_price numeric not null default 0,
  savings numeric not null default 0,
  seller text,
  tracking_code text,
  purchased_at date,
  needs_review boolean not null default false,
  review_note text,
  created_at timestamptz not null default now()
);

create index if not exists product_purchases_variant_idx
  on public.product_purchases (external_variant_id);

-- Mesma compra (mesmo rastreio) não entra duas vezes para a mesma variação.
create unique index if not exists product_purchases_tracking_uidx
  on public.product_purchases (tracking_code, external_variant_id)
  where tracking_code is not null and tracking_code <> '';

grant all on public.product_purchases to service_role;

alter table public.product_purchases enable row level security;
-- Sem políticas públicas: apenas o servidor (service_role) lê e grava.
