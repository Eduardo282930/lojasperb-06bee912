# Notificações de pedido: só para o cliente dono do pedido

## O que já existe hoje (verificado no projeto)

- O aparelho já é registrado com o cliente: `savePushSubscription` resolve o cliente pelo telefone e grava `customer_id` em `push_subscriptions`.
- Já existe envio direcionado: `sendNotificationToCustomer(customerId, ...)` busca somente inscrições com aquele `customer_id`, e remove inscrições que respondem 404/410.
- O painel Admin já envia as mensagens de "Pagamento confirmado", "A caminho", "Entregue/Finalizado" e "Cancelado" apenas para o cliente do pedido, com link `/pedidos?status=...&order=ID`.
- O ícone azul com "S" já foi removido do envio e do service worker.

## O que está faltando / errado

1. **Pagamento pelo Pix/cartão não avisa ninguém.** O webhook da InfinitePay confirma o pagamento mas não dispara nenhuma notificação.
2. **Cancelamento automático por falta de pagamento não avisa.** A rotina de limpeza cancela o pedido em silêncio.
3. **Risco de aviso repetido.** O webhook pode chegar várias vezes e o Admin pode salvar o mesmo status de novo; hoje não existe registro de "este aviso já foi enviado".
4. **O link da notificação não abre o pedido.** A tela de pedidos ignora o `order=ID`, abrindo só a aba.
5. **Aparelho sem cliente.** Se o telefone ainda não estiver cadastrado quando o cliente permite o aviso, a inscrição fica sem cliente e nunca é corrigida depois.
6. **A ativação não é oferecida na Sacola** (hoje só na tela "Eu").
7. **Erros escondidos.** Falhas de envio são engolidas, sem registro para diagnóstico.

## O que será feito

### Banco (somente Supabase da loja, nada no Cloud)
- Nova tabela `order_push_events` com `order_id` + `event` únicos: garante que cada evento real (pago, a caminho, entregue/finalizado, cancelado) gere **um único** aviso, venha de onde vier.
- `cancel_expired_unpaid_orders` passa a devolver a lista de pedidos cancelados, para avisar cada cliente.

### Servidor
- Função central `notifyOrderEvent(orderId, event)` em `web-push.server.ts`: monta o texto conforme o evento e a origem do pedido (app ou loja), reserva o evento na tabela e envia **somente** para as inscrições daquele `customer_id`. Se não houver aparelho vinculado, registra no log: "Push não enviado: nenhum dispositivo vinculado ao cliente X".
- `infinitepay-webhook.ts`: consulta o pedido antes de confirmar; só chama o evento "pago" quando o pedido realmente saiu de não pago para pago.
- `cleanup.ts`: dispara o evento "cancelado por falta de pagamento" para cada pedido expirado.
- Admin continua enviando, mas pelo mesmo caminho central, então nunca duplica com o webhook.
- Envio geral (manual do Admin) continua exatamente como está.

### Aplicativo
- `notifications.ts`: quando o telefone do perfil mudar ou for cadastrado depois, o aparelho é re-registrado para corrigir o vínculo com o cliente; recusa registrar vínculo errado.
- `pedidos.tsx`: aceita `order=ID` no endereço, abre a aba certa e já mostra o pedido aberto e rolado até ele.
- `sacola.tsx`: mostra a mesma faixa de ativação da tela "Eu" — "Notificações ativadas" quando já permitido, "Notificações desativadas — Ative" quando não, com orientação para o ajuste do navegador se ele não permitir perguntar de novo. A Home continua sem pedir permissão.
- Histórico do pedido passa a mostrar "Cancelado automaticamente — falta de pagamento" ou "Cancelado pelo vendedor — Motivo: ...".

## Testes antes de entregar

- Dois clientes com aparelhos diferentes: confirmar pagamento do pedido de A e verificar que só A recebe.
- Reenviar o mesmo webhook e salvar o mesmo status duas vezes: nenhum aviso repetido.
- Clicar no aviso: abre exatamente aquele pedido.
- Pedido sem aparelho vinculado: nada é enviado e o log explica o motivo.
- Verificação de tipos e build.

## Não será alterado

Login/cadastro, checkout, InfinitePay, Loyverse, chaves de notificação, painel administrativo, envio manual, histórico de envios e service worker (fora da remoção de ícone já feita).
