# Reembolso visível ao cliente + reserva de estoque até o recibo

## 1. Pedido reembolsado aparece como cancelado/reembolsado em "Meus pedidos"

A tela do cliente já sabe mostrar "Pedido reembolsado e cancelado" quando o pedido vem com pagamento `refunded`. O que falta garantir é que o pedido reembolsado no Loyverse chegue nesse estado rapidamente e que a listagem do cliente traga esse campo.

- Conferir a função do banco que lista os pedidos do cliente e garantir que ela devolva o pedido cancelado/reembolsado (sem filtrar cancelados) com o status de pagamento correto.
- Garantir que a rotina de reembolso marque sempre: pedido `cancelado`, pagamento `reembolsado`, estoque liberado, moedas devolvidas uma vez e cupom liberado uma vez.
- Fazer o app detectar o reembolso sem esperar: além do aviso automático do Loyverse (webhook), disparar uma verificação leve de reembolsos quando o cliente abre "Meus pedidos" e quando o Admin abre a tela de pedidos.
- Ao detectar, o pedido sai imediatamente da aba atual e vai para "Cancelado", com a etiqueta "Reembolsado e cancelado".

## 2. Nunca vender sem estoque

- Produto sem estoque não pode ser adicionado à sacola (botão bloqueado com aviso).
- Ao clicar em "Fazer pedido", o estoque é revalidado em tempo real e reservado de forma atômica na mesma operação (já existe; será revisada e testada com dois clientes simultâneos).
- Enquanto o cliente está na tela de confirmação, a unidade fica reservada e indisponível para os outros.
- Se o cliente sair/desistir, a reserva é liberada na hora; se ele apenas parar, a reserva vence sozinha por tempo.

## 3. Reserva só é baixada quando o recibo existir no Loyverse

- Ao clicar em pagar, o pedido definitivo é criado e a reserva continua ativa (o estoque permanece bloqueado para os outros clientes).
- A baixa definitiva só acontece quando o recibo é criado com sucesso no Loyverse e identificado como daquele pedido.
- Busca automática: além do aviso do Loyverse, uma verificação periódica curta procura pedidos pagos ainda sem recibo, tenta criar/localizar o recibo e finaliza a reserva. Falha de sincronização mantém o pedido em erro visível no Admin, nunca cria venda pelo valor cheio.
- Se o pagamento não for concluído dentro do prazo, o pedido é descartado e a reserva liberada automaticamente.

## Detalhes técnicos

- Banco (migração no Supabase externo, se necessário): revisar `orders_for_customer` para incluir `payment_status` de pedidos cancelados/reembolsados; garantir idempotência de `cancel_order_from_refund`.
- Frontend: `src/routes/pedidos.tsx` (agrupamento já manda refund para "canceled"), `src/routes/index.tsx` e `src/routes/produto.$id.tsx` (bloqueio de adicionar sem estoque), `src/routes/sacola.tsx` / `src/routes/confirmar.tsx` (reserva e liberação).
- Sincronização: `src/lib/loyverse-reconcile.functions.ts` ganha um modo "rápido" (janela curta) chamado ao abrir Meus Pedidos/Admin; `src/routes/api/public/loyverse-reconcile.ts` e `expire-reservations` seguem como rede de segurança.
- Recibo/reserva: `confirm_order_receipt` → `finalize_reservation_after_receipt` continua sendo o único caminho de baixa.

## Validação

- Teste de concorrência: dois clientes tentando a última unidade — só um consegue reservar.
- Pedido pago sem recibo: verificação automática cria o recibo e libera a reserva.
- Reembolso feito no Loyverse: pedido aparece como "Reembolsado e cancelado" na área do cliente, estoque devolvido, moedas e cupom devolvidos uma única vez.
