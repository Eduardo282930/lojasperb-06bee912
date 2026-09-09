# Ajustes no painel Admin

Tudo abaixo é só na tela `/admin`. Loja, checkout, estoque, moedas, cupons e Loyverse continuam funcionando igual.

## Início (painel)

- Novo cartão **Lucro hoje**: soma do lucro dos pedidos pagos hoje (preço de venda menos o custo de cada item, usando o custo que já vem do Loyverse). Fica ao lado de "Vendas hoje".
- A grade de módulos coloridos no fim da tela sai (o menu lateral e a faixa de cima já dão acesso a tudo).
- Cada linha de "Precisa de você" passa a levar direto ao lugar certo: abre o módulo já com o pedido daquele cliente selecionado, na aba certa e com o cartão aberto. Nos casos de reembolso pendente, a própria linha mostra o botão **Confirmar reembolso**, sem precisar procurar o pedido.

## Reembolso em qualquer pedido

- Todo pedido do Admin ganha o botão **Confirmar reembolso**.
- Ao apertar, aparece a primeira pergunta e, em seguida, a segunda: "Tem certeza de que você já devolveu o dinheiro do pedido {número} de {cliente}?".
- Só depois dessa segunda confirmação o pedido vira "Reembolso realizado" e a prova é salva — igual à regra atual, sem mudar nada no banco.

## Pagamentos

- Módulo removido do menu, da faixa e do painel; o conteúdo dele sai junto.

## Recibos

- A lista passa a mostrar **todos os pedidos**, em linhas estreitas (cliente, número, data e valor numa linha só), para caber bastante na tela.
- Cada linha tem **Ver mais informações**, que abre os itens, descontos, cupons, moedas e forma de pagamento.
- O botão **Enviar no WhatsApp** passa a enviar o recibo oficial do app daquele pedido, em imagem JPG — o mesmo que o cliente vê e baixa — em vez do texto simples de hoje.

## Estoque

- A faixa azul do topo fica bem mais baixa e compacta (custo, valor de venda e lucro em uma linha discreta).
- O filtro **Zerado** passa a incluir todo produto marcado como "sem estoque", usando a mesma regra da vitrine, para não ficar produto sem estoque fora da lista.

## Cupons

- Criação mais simples e bonita: um painel lateral com poucos campos grandes (código, tipo de desconto, valor, mínimo, validade), com exemplo do resultado ("R$ 10 de desconto acima de R$ 50") e botão único de salvar.

## Pedidos

- Além de tocar nas abas, dá para **deslizar o dedo** para a esquerda/direita e trocar de status (A pagar, Preparando, A caminho, Finalizado, Cancelado), com a barra azul acompanhando.

## Detalhes técnicos

- `src/components/admin/dashboard-panel.tsx`: KPI de lucro derivado de `fetchOrders` + custos de `fetchCatalog` (casando item por id/sku); remoção da grade de módulos; itens da fila passam a carregar `target` + `orderId`/`action`.
- `src/routes/admin.tsx`: `OrdersPanel` recebe pedido/aba iniciais via props, ação `Confirmar reembolso` com dupla confirmação em todos os cartões, gestos de swipe nas abas; `PaymentsPanel` e sua entrada em `admin-modules.tsx` removidos; `ReceiptsPanel` reescrito sobre `fetchOrders` com linhas compactas, expandir e `ReceiptDownload`; header do estoque compactado e filtro "zerado" alinhado à disponibilidade real; formulário de cupom virando painel lateral.
- `src/components/receipt-download.tsx`: saída em JPG e envio do arquivo pelo compartilhamento nativo (fallback atual mantido).
- Sem mudanças em banco, RPCs, regras de negócio ou nas telas do cliente.

## Verificação

`bunx tsgo --noEmit`, build de produção e conferência visual do admin em 390 px, 820 px e 1440 px.
