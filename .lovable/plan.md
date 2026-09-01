# Corrigir o pagamento de vez (fim do not_found / database_error)

## O que está acontecendo, de verdade

O botão "Pagar Pix/cartão" hoje funciona em duas etapas separadas:

```text
navegador  ->  cria o pedido no banco (create_order)
navegador  ->  chama o servidor, que LÊ esse pedido de novo no banco
servidor   ->  só então pede o link para a InfinitePay
```

Essa segunda leitura é a origem dos erros. Quando ela não acha a linha,
o app mostra `not_found`; quando ela devolve erro, mostra `database_error`
(foi exatamente o que aparece na sua tela). No ambiente de desenvolvimento
a leitura funciona (o log mostra "Checkout criado"), por isso os testes
passavam e no site publicado continuava falhando.

Confirmado nos logs desta sessão: no sandbox o checkout é criado com
sucesso; não há registro equivalente vindo do site publicado.

Enquanto existir essa leitura extra, o erro vai continuar voltando de
formas diferentes. A correção certa é eliminá-la.

## A correção

Juntar tudo em uma única chamada ao servidor:

```text
navegador  ->  "quero pagar este carrinho"
servidor   ->  cria o pedido + reserva de estoque
servidor   ->  cria o link da InfinitePay
servidor   ->  devolve o link (ou apaga o pedido e explica o erro)
```

Consequências diretas:

- Não existe mais leitura intermediária, então `not_found` e
  `database_error` deixam de ser possíveis.
- O pedido só aparece em "Pedido recebido" se o link de pagamento tiver
  sido criado com sucesso; qualquer falha antes disso apaga o pedido e
  libera a reserva, como você pediu.
- A reserva temporária de estoque continua sendo criada no momento do
  pagamento, e a baixa definitiva continua acontecendo só em "Preparando".
- O envio por WhatsApp continua igual (cria o pedido sem checkout).

## Diagnóstico visível

Enquanto isso, a mensagem de erro no carrinho passa a mostrar o motivo
real devolvido pelo servidor (por exemplo, "chave do banco ausente" ou
"a InfinitePay recusou"), em vez de um código genérico. Assim, se algo
falhar no site publicado, dá para identificar na hora.

## Detalhes técnicos

- Nova server function `startCheckout` em `src/lib/payments.functions.ts`:
  recebe itens, cliente, cupom e moedas; chama a RPC `create_order` com o
  cliente de serviço; usa o `id` retornado direto na memória (sem reler);
  chama `createCheckoutLink`; grava `payment_url`, `payment_nsu` e
  `payment_provider`; em qualquer falha chama `discard_unpaid_order`.
- `src/routes/sacola.tsx`: o fluxo de pagamento passa a chamar apenas
  `startCheckout` e redirecionar para a URL; `recordOrder` fica reservado
  ao caminho do WhatsApp. `abandonOrder` deixa de ser necessário no
  caminho do cartão.
- `createOrderCheckout` continua existindo para pedidos já criados
  (botão "pagar" em Meus pedidos), com o mesmo retry atual.
- Verificação: typecheck, teste no navegador do fluxo completo do carrinho
  até a tela da InfinitePay, e conferência no banco de que a reserva foi
  criada e que nenhum pedido órfão ficou para trás.
