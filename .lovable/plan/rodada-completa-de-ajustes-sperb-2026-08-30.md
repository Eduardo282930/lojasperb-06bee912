# Rodada completa de ajustes SPERB

Trabalho dividido em 4 fases. Nada do que já funciona é recriado: catálogo/logo continuam vindo do Loyverse, cupons/moedas/pedidos continuam no banco central.

## Fase 1 — Pedidos, estoque reservado e pagamento

- Novo campo de fluxo no pedido: `PENDING → RESERVED → PAID → LOYVERSE_SYNCED → COMPLETED`, mais `CANCELLED` e `SYNC_ERROR`. Esse fluxo é interno e fica **separado** do status de entrega que o admin usa (Recebido → Preparando → A caminho → Entregue) e do status de pagamento.
- Nova tabela de reservas de estoque por pedido/variação. Ao criar o pedido, a reserva é gravada uma única vez (chave única por pedido); ao cancelar, é liberada. Nunca desconta duas vezes.
- O estoque mostrado no app = estoque do Loyverse − reservas ativas, para impedir venda duplicada da mesma unidade.
- Pedido novo nasce sempre como não pago.

## Fase 2 — Loyverse (recibos e clientes)

- Recibo real no Loyverse só é criado quando o pagamento é confirmado. O ID do recibo é guardado no pedido; se já existir ID, uma nova tentativa não cria outro recibo.
- Falha na sincronização marca `SYNC_ERROR` com a mensagem do erro e botão "Tentar novamente" no admin, seguro contra duplicação.
- Recibos passam a carregar os últimos 90 dias (respeitando o limite do plano do Loyverse: se a API recusar o período, cai automaticamente para o máximo permitido, sem tela branca).
- Clientes do Loyverse com nome e telefone são cadastrados/atualizados automaticamente no banco central, identificados pelos 8 últimos dígitos do telefone. A mensagem "ainda não tem cadastro no banco central" só aparece quando realmente não há telefone válido.

## Fase 3 — Cupons, moedas e notificações

- Tela de criação de cupom reorganizada: primeiro escolhe o tipo (% de desconto / R$ de desconto / Moedas) e só os campos daquele tipo aparecem. Continuam disponíveis: desconto máximo, limite de usos, limite por cliente e moedas de volta ao concluir.
- Cupons inativos ou excluídos somem das telas do cliente (já parcialmente feito; será revisado).
- Moedas: ledger continua sendo a fonte; crédito de recompensa só quando o pedido é Entregue, uma única vez por pedido.
- Notificações: ao ativar, o cliente recebe imediatamente a confirmação "🔔 Notificações ativadas!" com a mensagem de agradecimento, e a tela Eu passa a mostrar "Notificações ativadas ✓".
- No admin, ao criar cupom/promoção, caixa "Enviar notificação aos clientes" que gera automaticamente uma notificação curta e adequada à ação, sem repetir a mesma notificação.

## Fase 4 — Vitrine, Minhas compras e tela Eu

- Home deixa de ser ordem alfabética: nova seleção de destaques (🔥 Mais vendidos, ⭐ Destaques SPERB, 🏷️ Ofertas) escolhida manualmente no admin. Sem escolha manual, o sistema ordena pelos mais vendidos com base nos pedidos existentes e, sem dados suficientes, por um critério comercial (com estoque e com foto primeiro).
- Minhas compras: deslize horizontal mais suave, com parada centralizada e sem trocar de aba rápido demais; tocar numa aba leva direto à seção correspondente, com abas e conteúdo sempre sincronizados.
- Tela Eu: cartão do cliente mais compacto mantendo nome/telefone/identificação; moedas mostrando quantidade e valor (ex.: 1.001 moedas = R$ 10,01); contador de cupons disponíveis; pequenos feedbacks visuais ao ganhar moedas/cupom ou mudar status.

## Segurança

Token do Loyverse permanece só no backend; todas as operações críticas (reserva, recibo, moedas) ficam protegidas por chaves únicas no banco para nunca duplicarem; falhas de API não apagam pedidos e ficam registradas como erro reprocessável.

## Detalhes técnicos

- Novas estruturas no banco: `order_stock_reservations`, colunas `flow_state`, `loyverse_receipt_id`, `sync_error` em `orders`, `featured_products` (ou campo equivalente em `store_settings`), e ajustes nas funções de criação/atualização de pedido para manterem a idempotência via `ON CONFLICT`.
- Sincronização com o Loyverse feita em server functions no backend (token nunca no cliente).
- Ao final, teste dos fluxos: criar pedido → reserva → Recebido → Preparando → A caminho → Entregue → moedas liberadas uma vez; recibo criado só após pagamento; retry sem duplicar; recibos 90 dias; destaques na home; deslize de Minhas compras.
