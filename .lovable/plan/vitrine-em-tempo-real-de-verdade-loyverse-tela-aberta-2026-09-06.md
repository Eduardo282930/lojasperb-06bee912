# Vitrine em tempo real de verdade (Loyverse → tela aberta)

Objetivo: mudou estoque/preço/disponibilidade no Loyverse, a tela aberta muda sozinha em poucos segundos, atualizando só o produto que mudou — sem piscar, sem girar carregando e sem perder o lugar da rolagem.

## O que está errado hoje

- A conferência automática roda **de minuto em minuto** (é o menor intervalo que o agendador do banco aceita), então a mudança pode demorar até ~1 minuto.
- Quando o aviso chega, o app **joga fora a vitrine inteira e busca tudo de novo** — é o que provoca o "pulo" na tela.
- Cada busca do app volta a consultar o Loyverse; como o servidor guarda uma cópia curta na memória e pode responder por máquinas diferentes, às vezes ainda vem o dado antigo.
- O aviso do Loyverse (webhook) só é aproveitado se estiver cadastrado no painel do Loyverse.

## Como vai funcionar

1. **O servidor passa a ser o dono do catálogo.** Uma cópia oficial do catálogo fica guardada no banco. O app lê essa cópia (rápida e sempre igual para todos os aparelhos) em vez de cada aparelho depender da memória temporária do servidor.
2. **Detecção do que mudou.** A cada leitura do Loyverse o servidor compara produto por produto (preço, estoque, disponível/indisponível, variações, nome, foto, categoria) e guarda **a lista dos que mudaram**.
3. **Aviso instantâneo.** Só os produtos alterados são anunciados em tempo real para todos os aparelhos abertos.
4. **Atualização cirúrgica na tela.** O app recebe os produtos alterados e troca **apenas aqueles cartões** na vitrine e na página do produto. Nada de recarregar a lista, nada de spinner, a rolagem fica onde está.
5. **Gatilhos (do mais rápido ao de segurança):**
   - aviso do Loyverse (webhook) — reação imediata;
   - verificação leve de estoque a cada ~5 segundos, feita **uma vez no servidor** para todos os clientes (poucas chamadas à API, nunca uma por aparelho);
   - conferência completa do catálogo a cada minuto, como rede de segurança.

Nada muda na conferência de segurança do checkout, na reserva de estoque, no pagamento, no recibo, no reembolso, nas moedas nem nos cupons.

## Detalhes técnicos

**Banco (nova migração em `supabase/external-migrations/`)**
- `catalog_snapshot (id text pk, revision bigint, payload jsonb, fingerprint text, updated_at)` — 1 linha por produto; leitura pública `TO anon` + GRANTs; publicada em `supabase_realtime` com `REPLICA IDENTITY FULL`.
- `catalog_revision` ganha `changed_ids text[]` para o aviso agregado.
- RPC `apply_catalog_snapshot(p_rows jsonb, p_full boolean)`: faz upsert das linhas alteradas, apaga as removidas, devolve os ids que mudaram e sobe `catalog_revision` só quando há diferença.
- Segundo job `pg_cron` "poll rápido": roda a cada minuto e dispara `net.http_get` para `/api/public/sync-stock` em 12 passos de 5 s (`pg_sleep`), respeitando o limite da API do Loyverse.

**Servidor**
- `src/lib/catalog-snapshot.server.ts`: `productFingerprint(p)`, `writeSnapshot(catalog)` (chama a RPC e devolve os ids alterados), `readSnapshot()`.
- `src/lib/loyverse.functions.ts`: `getCatalog()` passa a ler o snapshot do banco (com a memória só como aceleração e checagem de revisão); `fetchCatalog`/`fetchProducts`/`fetchProduct` continuam com a mesma assinatura. Novo `fetchProductsByIds({ ids })` para as atualizações cirúrgicas.
- Nova rota `src/routes/api/public/sync-stock.ts`: leitura leve só de níveis de estoque + itens modificados (`updated_at_min`), grava snapshot e avisa.
- `src/routes/api/public/sync-catalog.ts`: conferência completa (mantida) usando o mesmo caminho de snapshot.
- `src/routes/api/public/loyverse-webhook.ts`: após tratar o evento, dispara a sincronização de estoque (rápida) em vez do catálogo inteiro quando o evento for de `inventory_levels`.

**App**
- `src/lib/live.ts`: `useLiveCatalog` passa a ler os `changed_ids` do aviso, buscar só esses produtos e aplicar com `queryClient.setQueryData` em `["catalog"]` e `["produto", id]` — sem `invalidateQueries`, sem estado de carregando.
- `src/routes/index.tsx` e `src/routes/produto.$id.tsx`: manter `refetchOnWindowFocus` e o intervalo longo de segurança; o cache local (`saveCachedCatalog`) é regravado com o catálogo já corrigido.

**Configuração no Loyverse (uma vez, no painel do Loyverse)**
- Em Integrações → Webhooks, cadastrar a URL do app para os eventos de itens, níveis de estoque e recibos. Sem isso, o app continua funcionando pelo poll de 5 s; com isso, a reação é imediata.

## Validação
- `bunx tsgo --noEmit` e build de produção.
- Teste com a vitrine aberta: no Loyverse mudar estoque 0 → 1 e 1 → 0 e cronometrar a mudança (esperado: poucos segundos), conferindo que a rolagem não se mexe e nenhum outro cartão pisca.
- Conferir no banco que só os produtos alterados aparecem na lista de mudanças.
