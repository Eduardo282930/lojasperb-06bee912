# Pedido, cupom, moedas, Loyverse e reembolso

## 1. Carrinho → tela de confirmação

- No carrinho ficam apenas os itens, o total e **um** botão: **Fazer pedido**. Saem o botão "Mudar" e o botão separado de WhatsApp.
- Cupom e moedas deixam de ser aplicados sozinhos: o carrinho mostra "Nenhum cupom" e "Moedas não usadas" até o cliente escolher.
- Nova tela `/confirmar`: lista de produtos com quantidade, subtotal, cupom escolhido (com link para a área de cupons), moedas, entrega e **valor final**.
- No rodapé dessa tela, dois botões grandes: **Fazer pedido pelo WhatsApp** e **Pagar agora via Pix**. O pedido só é criado ao tocar em um deles (Pix: só depois do checkout abrir sem erro).

## 2. Cupom no Loyverse

- O recibo passa a levar o desconto real, nunca o valor cheio.
- Cupom em R$ → desconto "Desconto – Cupom | Variável, Σ" (valor fixo).
  Cupom em % → desconto "Desconto – Cupom | Variável, %".
- O valor enviado é exatamente o calculado no app, e o nome/código do cupom vai no recibo.
- Se o desconto correspondente não existir no Loyverse, o pedido fica com erro de sincronização visível no admin (nunca cria recibo pelo valor cheio).

## 3. Moedas = pontos do Loyverse

- As moedas passam a refletir os **pontos reais do cliente no Loyverse**.
- O app calcula sozinho quanto pode usar (até 30% do pedido); o cliente apenas aceita ou não usar.
- No recibo vão os pontos deduzidos e o valor correspondente — sem desconto percentual "Desconto – Moedas".

## 4. Sincronização nos dois sentidos

- App → Loyverse: venda, cupom e pontos usados no recibo.
- Loyverse → App: uma rotina de sincronização lê recibos, estoque e pontos recentes e atualiza pedidos, estoque e saldo de moedas no app. Pode ser chamada por agendador e roda também ao abrir o app/admin.

## 5. Estoque só é liberado após o recibo

- Pagar → reserva temporária (estoque do app diminui).
- Pagamento aprovado → pedido vai para **Preparando**, mas a reserva **continua ativa**.
- Só depois de o Loyverse confirmar o recibo criado a reserva é encerrada e o estoque volta a ser o do Loyverse.

## 6. Reembolso

- A rotina de sincronização detecta recibo de reembolso no Loyverse: o pedido vira **Cancelado**, a reserva é encerrada, moedas usadas voltam ao cliente e o uso do cupom é liberado.
- InfinitePay: estorno automático só se a API permitir. Se não permitir, o pedido fica marcado como "reembolso financeiro pendente" — o app nunca diz que o dinheiro foi devolvido sem confirmação.

## Detalhes técnicos

- Migração: `orders.refund_state`, `orders.loyverse_points_used`, `orders.loyverse_discount_id`; RPCs `finalize_reservation_after_receipt(order_id)`, `cancel_order_from_refund(order_id)` (devolve moedas e libera cupom, idempotentes por pedido).
- `src/lib/loyverse-sync.functions.ts`: monta `total_discounts` (valor fixo ou %) usando os IDs dos descontos de cupom lidos de `GET /discounts`, envia `points_deducted`, e só chama a finalização da reserva depois do `POST /receipts` responder com o recibo.
- Novo `src/lib/loyverse-reconcile.functions.ts` + rota `src/routes/api/public/loyverse-reconcile.ts`: lê `GET /receipts` recentes (inclui `REFUND`), pontos do cliente e estoque, e concilia com o app.
- Webhook InfinitePay: marca pago/Preparando e dispara o recibo; a liberação da reserva sai do webhook e passa a depender da confirmação do recibo.
- Carrinho: `src/routes/sacola.tsx` (sem auto-aplicar cupom/moedas), nova rota `src/routes/confirmar.tsx`, ajuste em `src/lib/coupons.ts` para escolha manual.
