# Entrada Inteligente com IA — corrigir o erro e escolher o tipo do produto

## 1. Fim do "This operation was aborted"

Hoje cada leitura tem um limite fixo de tempo. Fotos grandes (e o envio de várias de uma vez) estouram esse limite e a chamada é cancelada no meio, derrubando o lote.

O que muda:

- A foto é reduzida no próprio aparelho antes de subir (lado maior ~1600 px, JPEG), então chega muito mais leve e rápida.
- O tempo de espera da leitura passa a ser generoso (alguns minutos), não mais um corte curto.
- Se a leitura falhar por sobrecarga ou instabilidade momentânea, o sistema tenta de novo sozinho até 3 vezes, com pausa crescente. Erros definitivos (chave inválida, foto ilegível) não são repetidos.
- As fotos são lidas uma a uma, isoladas: se uma falhar, ela vai para **Precisa de conferência** com o motivo em português claro ("a leitura demorou demais", "a IA está ocupada") e as demais continuam.
- O painel mostra o andamento por foto ("Lendo 2 de 5") em vez de uma barra parada.
- As fotos continuam existindo só durante a leitura; nada é guardado no banco.

## 2. Escolher o tipo antes de enviar

No painel do Assistente, acima do botão de adicionar imagens, duas opções grandes:

- 🏪 **Produto da loja** (já vem marcada)
- 📦 **Produto por encomenda**

A escolha vale para todas as fotos daquele envio e pode ser trocada antes de processar.

### Produto por encomenda

- O produto é criado no Loyverse sempre na categoria **Encomenda**.
- Se essa categoria ainda não existir no Loyverse, ela é criada uma única vez e reaproveitada.
- Esses produtos **não aparecem** no aplicativo dos clientes: nem na vitrine, nem na busca, nem nas recomendações, nem no carrinho.

### Produto da loja

- Fluxo atual, mais uma novidade: a IA identifica o que é o produto e escolhe sozinha a **categoria existente mais parecida** no Loyverse (chinelo → a categoria de calçados que você já tem, fita → a de utilidades, etc.).
- Nunca cria categoria nova. Se nenhuma combinar, o produto fica sem categoria, como hoje.

## 3. Encomenda fora do aplicativo público

O bloqueio é feito em dois pontos, para não escapar por cache nem por busca:

- Na montagem do catálogo no servidor: itens da categoria Encomenda são descartados e a categoria não entra na lista de categorias.
- Na tela: uma trava extra ignora qualquer item de encomenda que venha de um cache antigo.

## Detalhes técnicos

- `src/lib/assistant.server.ts`: `GEMINI_TIMEOUT_MS` sobe para 180 s; `readPurchaseImage` ganha retry com backoff (429/503/5xx/AbortError, 3 tentativas) e mensagens de erro traduzidas; novas funções `ensureOrderCategory()` (busca `categories`, cria "Encomenda" via `POST /v1.0/categories` só se faltar, com cache em memória) e `pickCategory()` (a IA recebe a lista de categorias existentes e devolve o `category_id`, ou vazio). `upsertPurchase` recebe `mode: "store" | "order"` e grava `category_id` no item criado.
- `src/lib/assistant.functions.ts`: `runAssistant` aceita `mode` no input validado; carrega as categorias uma vez por lote; cada imagem em `try/catch` próprio (já existente) com o motivo normalizado.
- `src/components/admin/assistant-panel.tsx`: seletor de tipo (padrão `store`), redimensionamento via `canvas` antes do envio, progresso por imagem.
- `src/lib/loyverse.functions.ts`: em `buildCatalog`, `isOrderCategoryName()` (normaliza para "encomenda") descarta itens dessa categoria e a remove de `categories`; `src/lib/product-filters.ts` ganha a mesma checagem como proteção de frontend.
- Nada muda em pedidos, pagamentos, cupons, notificações, checkout ou reembolso. Nenhuma foto é persistida.

## Verificação

Typecheck, build e um teste real: uma foto como Produto da loja (confere categoria escolhida), uma como Produto por encomenda (confere categoria Encomenda no Loyverse e ausência na vitrine e na busca), e uma foto pesada/ilegível para confirmar que o lote não para.
