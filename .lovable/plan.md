# Atualização automática + conferência obrigatória no Loyverse

Duas mudanças, sem mexer no que já funciona (reserva de estoque, pagamento, recibo, reembolso, moedas e cupons).

## 1. As telas se atualizam sozinhas

Hoje cada tela consulta o banco em intervalos (30s a 90s) e algumas só atualizam quando o cliente puxa a tela. Vamos trocar isso por avisos em tempo real, mantendo um reforço em segundo plano.

- **Pedidos (cliente) e Admin**: quando o pedido muda no banco (Preparando → A caminho, pagamento confirmado, reembolso, pedido novo), o app recebe o aviso na hora e só aquela parte da tela se atualiza — sem recarregar a página. Vale também para moedas, cupons e avisos.
- **Preço e estoque do Loyverse**: o Loyverse não avisa o app sozinho de forma confiável, então usamos duas camadas:
  1. o aviso do Loyverse que já chega no app (webhook) passa a atualizar o catálogo imediatamente e avisar todos os aparelhos abertos;
  2. uma conferência automática de segurança a cada ~60 segundos, feita no servidor, que compara o catálogo e avisa os aparelhos apenas quando algo realmente mudou.
- **Reforço**: cada tela também reconsulta ao voltar do segundo plano (quando o cliente volta para a aba) e num intervalo longo, para o caso de um aviso se perder.

## 2. Conferência obrigatória no Loyverse antes de fechar o pedido

Ao tocar em "Fazer pedido" e ao finalizar (WhatsApp ou Pix), o servidor consulta o Loyverse na hora e confere item por item: preço atual, estoque atual, variação correta, produto ainda à venda e quantidade pedida.

- Se estiver tudo igual, o pedido segue normalmente (reserva → pedido → pagamento), usando **os valores vindos do Loyverse**, nunca os do aparelho.
- Se algo mudou, o pedido é **bloqueado**, o carrinho é atualizado com os dados novos e o cliente vê uma mensagem clara do tipo "O preço de X mudou de R$ 10,00 para R$ 12,00" ou "Restam apenas 2 unidades de X". Ele revisa e confirma de novo.
- Isso vale para os dois caminhos de finalização: WhatsApp e Pix/cartão. Hoje o caminho do WhatsApp fecha o pedido direto do aparelho com o preço do carrinho — passa a fechar pelo servidor, com conferência.

## Detalhes técnicos

**Tempo real (banco)**
- Nova migração em `supabase/external-migrations/` adicionando `orders`, `order_history`, `customer_coin_ledger`, `notifications`, `customer_coupon_claims` e `product_stock` à publicação `supabase_realtime` (com `REPLICA IDENTITY FULL` onde faltar).
- Novo `src/lib/live.ts`: hook `useLiveInvalidate(table, keys)` que abre um canal `postgres_changes` dentro de `useEffect`, invalida as chaves do React Query e remove o canal no unmount. Usado em `pedidos.tsx`, `admin.tsx`, `eu.tsx`, `moedas.tsx`, `cupons.tsx`, `notifications.ts`.
- Nas queries afetadas: manter `staleTime` curto, trocar `refetchInterval` curto por `refetchOnWindowFocus: true` + intervalo longo (5 min) como rede de segurança.

**Tempo real (catálogo Loyverse)**
- Nova tabela leve `catalog_revision (store_key text pk, revision bigint, changed_at timestamptz)` + RPC `bump_catalog_revision()`, publicada em realtime (com GRANT para `anon`/`authenticated` no SELECT e política de leitura pública).
- `src/routes/api/public/loyverse-webhook.ts`: após tratar o evento, chamar `syncCatalogFromLoyverse()` e `bump_catalog_revision()`.
- `src/routes/api/public/sync-catalog.ts`: comparar o catálogo novo com o anterior (impressão digital de id+preço+estoque+disponibilidade+variações); só chamar `bump_catalog_revision()` quando mudar.
- **Agendador de verdade**: extensões `pg_cron` e `pg_net` ativadas no banco e um job de 1 em 1 minuto que chama essa rota sozinho. Não depende de ninguém abrir a página nem de reload.
- `src/routes/index.tsx` e `src/routes/produto.$id.tsx`: assinar `catalog_revision`; ao mudar a revisão, invalidar `["catalog"]` / `["produto", id]` e regravar o cache local (`saveCachedCatalog`). Remove-se o `refetchInterval` de 5s do produto.
- `src/lib/loyverse.functions.ts`: `FRESH_MS` cai para ~10s e `syncCatalogFromLoyverse` passa a devolver também se houve mudança, para alimentar o hash acima.

**Conferência antes da venda**
- Novo `src/lib/checkout-validate.server.ts`: `validateCartAgainstLoyverse(items)` força uma leitura do Loyverse (ignorando o cache em memória), localiza cada `id` como produto ou variação e devolve `{ ok, items: [{id, name, price, stock, available}], problems: [{id, name, kind: "price"|"stock"|"missing"|"unavailable", expected, actual}] }`.
- `src/lib/stock.functions.ts` (`createHoldOnServer`): passa a chamar essa validação antes de `sync_product_stock`/`create_stock_hold` e a devolver os problemas de preço junto com os de estoque.
- `src/lib/payments.functions.ts` (`startCheckout`): valida de novo imediatamente antes de `create_order_from_hold`/`create_order`; recalcula subtotal/desconto/total a partir dos preços do Loyverse e aborta com `reason: "cart_changed"` + lista de problemas se divergir.
- Novo `finalizeWhatsAppOrder` (server fn em `src/lib/orders.functions.ts`) com a mesma validação, substituindo a chamada direta de `recordOrder` no aparelho em `src/routes/confirmar.tsx`.
- `src/lib/cart.ts`: função para aplicar os preços/estoques corrigidos no carrinho quando a validação falhar.
- `src/routes/sacola.tsx` e `src/routes/confirmar.tsx`: exibir as mensagens de preço/estoque alterados e liberar o botão para nova tentativa após o cliente conferir.

**Compatibilidade**: nenhuma RPC existente muda de assinatura; as regras de reserva de 20 minutos, prazo de 60 minutos, recibo Loyverse, reembolso com dupla confirmação, cupons e moedas continuam iguais.

## Validação
- `bunx tsgo --noEmit` e build de produção.
- Teste com dois navegadores: mudar status no Admin e ver a tela do cliente mudar sozinha; alterar preço no Loyverse e ver a vitrine atualizar sem recarregar.
- Teste de bloqueio: alterar preço/estoque no Loyverse com o carrinho montado e confirmar que o pedido é barrado com mensagem clara.
