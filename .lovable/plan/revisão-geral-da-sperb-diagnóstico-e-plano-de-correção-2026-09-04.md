# Revisão geral da SPERB — diagnóstico e plano de correção

## O que foi verificado

- `/` responde 200; `/pedidos` responde 307 (redirecionamento normal que só acrescenta `?status=topay`).
- Verificação de tipos (`tsgo --noEmit`): sem erros.
- Log do servidor: sem exceções — apenas avisos (`inputValidator` obsoleto e CSRF).
- HTML do servidor: CSS incluído corretamente, uma vez.
- Não existe service worker no projeto.
- Mapeamento de todos os elementos `fixed`/`sticky` e seus `z-index` (lista abaixo).

## Problemas encontrados e causa

### 1. Tela branca / RUNTIME_ERROR na home
A home lê a cópia local do catálogo no carregamento do módulo, fora do ciclo do React. Quando o servidor devolve vitrine vazia (Loyverse indisponível/lento) e o aparelho já tem cópia local, o conteúdo montado no aparelho difere do enviado pelo servidor → erro de hidratação → tela branca.

### 2. Sem tempo limite no Loyverse
A busca do catálogo no servidor não tem timeout: em rede ruim a resposta fica pendurada até o gateway cortar.

### 3. Celular sem CSS/Tailwind
As páginas HTML saem sem instrução de cache. Um celular que guardou o HTML de um deployment anterior continua pedindo um CSS versionado que não existe mais → 404 → página "crua". Nos outros aparelhos, sem HTML velho em cache, funciona.

### 4. Cópia local do catálogo sem versão
A chave `sperb-catalog-v1` nunca muda e vale 24h. Se o formato dos produtos mudar entre versões, aparelhos com cópia antiga podem quebrar.

### 5. Carrinho flutuante sobrepondo cabeçalhos (confirmado)
`FloatingCart` usa `fixed top-3 right-4 z-40`, enquanto os cabeçalhos das telas são `sticky top-0` com `z-10`/`z-20`. Em `/pedidos`, `/produto/$id`, `/eu`, `/cupons`, `/moedas` e `/admin` ele fica por cima do cabeçalho e pode cobrir título e botão voltar em telas estreitas.

### 6. Escala de z-index inconsistente
Cabeçalhos usam `z-10` em algumas telas e `z-20` em outras; barras inferiores fixas usam `z-20`; carrinho `z-30`/`z-40`; modais `z-50`. Sem uma escala única, sobreposições reaparecem a cada mudança.

### 7. Áreas seguras (notch / barra inferior) não tratadas
Nenhuma tela usa `env(safe-area-inset-*)`. As barras fixas inferiores de `/sacola` e `/confirmar` e o botão flutuante da home podem ficar sob a barra de gestos do celular.

### 8. Conteúdo atrás de barras fixas
Onde há barra inferior fixa, o espaçamento inferior do conteúdo é fixo em px e pode não cobrir a altura real da barra em telas pequenas, escondendo o último item.

## Correções (arquivos e mudanças)

| Arquivo | O que muda |
| --- | --- |
| `src/routes/index.tsx` | Cópia local lida dentro do ciclo do React (fim do erro de hidratação); revisão do cabeçalho/busca/categorias/cards para telas estreitas (grid com `min-w-0`, `truncate`, ícones `shrink-0`), badges e botões de adicionar/compartilhar sem sobreposição, espaçamento inferior suficiente e botão flutuante com área segura. |
| `src/lib/loyverse.functions.ts` | Tempo limite na chamada ao Loyverse no servidor; em caso de estouro, vitrine vazia e nova tentativa no aparelho (sem alterar regras de produto/estoque). |
| `src/server.ts` | `cache-control: no-store` só para páginas HTML; arquivos versionados mantêm cache longo. Fim do descasamento HTML velho × CSS novo. |
| `src/routes/__root.tsx` | Remover o `<link>` de CSS duplicado; autocorreção única (recarrega uma vez) se a folha de estilos não carregar; `viewport-fit=cover` mantido para áreas seguras. |
| `src/lib/catalog-cache.ts` | Chave versionada e validação de formato; cópia antiga descartada silenciosamente. |
| `src/components/floating-cart.tsx` | Carrinho deixa de flutuar sobre cabeçalhos: passa a ficar ancorado no canto inferior direito, acima das barras inferiores fixas, respeitando área segura, e some nas telas onde o carrinho já existe no cabeçalho ou onde há barra de ação inferior. Correção estrutural, não por z-index. |
| `src/styles.css` | Escala única de camadas (conteúdo < cabeçalho < barra fixa < flutuante < modal) e utilitários de área segura, para as telas usarem os mesmos valores. |
| `src/routes/pedidos.tsx` | Somente ajuste visual: cabeçalho/abas sem sobreposição e sem corte de texto. Lógica de abas, arraste e barra azul intocada. |
| `src/routes/sacola.tsx`, `src/routes/confirmar.tsx` | Barras inferiores fixas com área segura e espaçamento inferior do conteúdo calculado, para nada ficar escondido. |
| `src/routes/eu.tsx`, `src/routes/cupons.tsx`, `src/routes/moedas.tsx`, `src/routes/produto.$id.tsx`, `src/routes/admin.tsx` | Cabeçalhos na mesma camada, títulos com truncamento, alvos de toque mínimos de 44px, tabelas/listas do admin com rolagem própria para acabar com a rolagem horizontal da página. |

Nenhuma mudança em pedidos, pagamentos, InfinitePay, estoque, reservas, Loyverse, cupons, moedas, reembolsos, sincronização ou dados de clientes. Se algo aparecer errado nessas áreas durante os testes, será relatado antes de qualquer alteração.

## Validação

1. `tsgo --noEmit` limpo e build de produção sem erros.
2. Navegador automatizado percorrendo `/`, `/pedidos`, `/sacola`, `/confirmar`, `/eu`, `/cupons`, `/moedas`, `/produto/$id` e `/admin` em três larguras (celular 390, tablet 820, desktop 1440), com capturas de tela.
3. Verificação automática em cada rota/largura: ausência de rolagem horizontal, nenhum elemento ultrapassando a largura, nenhum elemento fixo cobrindo cabeçalho ou botão, console sem erros, CSS aplicado, nenhum 404 de arquivo.
4. Home aberta com Loyverse indisponível para confirmar vitrine em vez de tela branca.
5. Cabeçalhos: HTML `no-store`, arquivos versionados com cache longo.
6. "Minhas compras": tocar em cada aba leva direto a ela (sem duplo toque), o arraste funciona e a barra azul acompanha — verificado manualmente no navegador automatizado.

## Riscos

- Mudança de posição do carrinho flutuante é visível ao usuário (é o objetivo).
- Aparelhos com cópia antiga do catálogo farão um carregamento extra uma única vez.
- Ajustes de layout podem alterar levemente espaçamentos já existentes; nada de comportamento.
