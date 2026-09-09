# Reforma completa do painel Admin (estilo ERP)

Só a tela `/admin` muda. Loja, pedidos do cliente, estoque, cupons, moedas, pagamentos e Loyverse continuam funcionando exatamente como hoje — a reforma é de tela e organização, não de regras.

## Como vai ficar

**No computador/tablet:** um menu lateral fixo à esquerda, sempre visível, com todos os módulos e seus ícones coloridos. Clicou, o conteúdo troca na hora, sem sair da página.

**No celular:** o menu vira uma faixa de módulos redondos e coloridos no topo — o mesmo estilo das categorias da tela inicial da loja — que rola de lado e acompanha o módulo aberto.

Os grupos intermediários (Operação, Clientes, Vitrine, Sistema) somem: cada módulo fica a um toque só.

## Tela inicial (novo dashboard)

Ao abrir, você vê primeiro os números do dia e o que precisa da sua ação:

- Cartões de resumo: vendas de hoje (R$), pedidos a pagar, em preparo, a caminho, entregues hoje, e produtos com estoque baixo ou zerado.
- Lista curta "Precisa de você": pedidos aguardando pagamento perto de vencer, pedidos pagos ainda não preparados, reembolsos pendentes de confirmação e cadastros repetidos para revisar. Cada linha leva direto ao pedido/módulo certo.
- Abaixo, a grade colorida de módulos.

Todos esses números saem dos dados que o painel já carrega hoje (pedidos, estoque, duplicidades) — nada novo no banco.

## Módulos, cada um com sua cor e ícone

| Módulo | Cor |
| --- | --- |
| Pedidos | azul |
| Pagamentos | roxo |
| Clientes | ciano |
| Revisão de cadastros | âmbar |
| Destaques da vitrine | amarelo/ouro |
| Cupons | rosa |
| Meu estoque | verde |
| Recibos Loyverse | índigo |
| Modo desenvolvimento | vermelho |

A cor acompanha o módulo em todo lugar: botão do menu, cabeçalho do módulo e detalhes internos, para você reconhecer onde está de relance.

## O que melhora dentro de cada módulo

Padrão comum a todos: cabeçalho com título, cor e ação principal à direita; campo de busca e filtros na mesma linha; tabela/lista com colunas alinhadas no computador e cartões no celular; estado vazio explicando o que fazer; carregamento sem tela branca.

- **Pedidos** — mantém o estilo e as abas atuais (a pagar, preparando, a caminho, entregue, cancelado), só ganha busca por nome/telefone/número, contadores nas abas e botões de ação mais claros e agrupados.
- **Cupons** — lista em tabela com código, benefício, mínimo, usos e situação; criar/editar abre um painel lateral em vez de formulário longo; ligar/desligar direto na linha.
- **Clientes** — busca no topo, lista com nome, telefone, pedidos e moedas; ao escolher um cliente, ficha com histórico, moedas e ajustes numa coluna organizada.
- **Estoque** — filtros (tudo/em estoque/baixo/zerado) como pílulas, totais de mercadoria em destaque, ordenação por valor e busca.
- **Destaques, Pagamentos, Recibos, Revisão de cadastros, Modo desenvolvimento** — mesma moldura, mesmos filtros e mesma barra de ações, cada um com sua cor.

## Detalhes técnicos

- Novos arquivos em `src/components/admin/`: `admin-shell.tsx` (menu lateral + faixa de módulos + cabeçalho), `admin-modules.ts` (lista de módulos, ícones, cores, tokens), `admin-ui.tsx` (cabeçalho de módulo, barra de filtros, tabela responsiva, estado vazio, cartão de indicador), `dashboard-panel.tsx` (KPIs + fila de ação).
- Painéis grandes de `src/routes/admin.tsx` movidos para `src/components/admin/panels/*.tsx` (pedidos, cupons, clientes, estoque, destaques, pagamentos, recibos, duplicidades, desenvolvimento) sem mudar a lógica interna; `admin.tsx` fica só com autenticação, estado do módulo ativo e roteamento local.
- Módulo ativo passa a viver em `?m=<modulo>` na URL, para recarregar sem perder o lugar e permitir voltar pelo navegador.
- Cores como tokens locais do admin em `admin-modules.ts` (oklch), aplicadas por variável CSS no cabeçalho de cada módulo; nada muda em `src/styles.css` nem no tema da loja.
- KPIs derivados no cliente a partir de `fetchOrders`, do estoque já carregado e de `fetchDuplicates`, com React Query e o `useLiveInvalidate` existente para atualização automática.
- Nenhuma mudança em banco, RPC, checkout, reservas, moedas, cupons ou integrações.

## Verificação

`bunx tsgo --noEmit`, build de produção e conferência visual do admin em 390 px, 820 px e 1440 px, passando por todos os módulos.
