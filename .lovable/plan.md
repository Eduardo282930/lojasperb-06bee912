# Assistente SPERB — cadastro de produtos por foto

Uma nova ação dentro de **Meu estoque**, no painel admin. Você envia as fotos das compras da Shopee, a inteligência artificial lê cada foto e os produtos são criados na hora no Loyverse — sem perguntas no meio do caminho.

## Como vai funcionar

1. No topo de "Meu estoque" aparece o botão **Assistente SPERB**.
2. Abre um painel simples: "Envie as fotos das suas compras e eu cadastro os produtos para você" + botão **Adicionar imagens** (uma ou várias de uma vez, até 10 por envio).
3. As fotos são enviadas juntas para leitura. Aparece só uma barra de progresso.
4. Terminou: **✓ 5 produtos cadastrados** e, logo abaixo, **Defina os preços de venda** — todas as caixinhas juntas na tela.
5. Cada caixinha mostra nome, variação, quantidade, custo real e preço anunciado, com um campo de preço de venda. Enter ou "Salvar" grava na hora e mostra **✓ Preço salvo**, sem sair da tela e sem confirmação extra. A caixinha continua editável.
6. Fotos ilegíveis ou com dados faltando não param o lote: o resto é cadastrado normalmente e essas aparecem numa lista **Precisa de conferência**, dizendo qual imagem e o que faltou.

## O que a IA extrai de cada foto

Nome completo do produto (reconstruído, nunca cortado com "..."), variação, quantidade, vendedor, preço anunciado, valor realmente pago, código de rastreio, data da compra e observações úteis.

Regras de preço:
- **Preço anunciado** = o preço atual mostrado. Preço riscado é ignorado por completo.
- **Custo** = o valor realmente pago.
- **Economia** = anunciado − pago, guardada só como informação.
- A IA **nunca** sugere, arredonda ou altera preço de venda. O preço de venda é sempre o que você digitar (39, 39,90, 45…), salvo exatamente assim.

## Onde os dados ficam

- O produto é criado **no Loyverse** (nome, variação, custo, estoque da compra), então já aparece na vitrine como hoje. O preço de venda que você digitar é gravado no Loyverse.
- Preço anunciado na Shopee, economia, vendedor, código de rastreio, data da compra e o link da foto ficam numa tabela nova no seu Supabase externo, ligada à variação do Loyverse. Nada substitui custo por preço de venda nem o contrário.

## Duplicados

Antes de criar, o Assistente procura pelo SKU/código de barras, pelo nome normalizado + variação e pelo código de rastreio já registrado. Se já existir, **não** cria produto novo: soma a quantidade comprada ao estoque daquele item no Loyverse e registra a nova compra no histórico.

## Detalhes técnicos

- **Chave**: `GEMINI_API_KEY` guardada só no cofre de segredos, lida apenas no servidor. Modelo Flash multimodal atual configurável por `GEMINI_MODEL` (padrão: `gemini-flash-latest`), sem `gemini-1.5-flash`; se o Google mudar o modelo, basta trocar a variável.
- **Backend**: `src/lib/assistant.functions.ts` com `createServerFn` protegido por `requireSupabaseAuth` + checagem de `has_role(admin)`. Valida tipo de arquivo (jpeg/png/webp), tamanho (até 8 MB por imagem) e quantidade (até 10 por lote). Chama a API do Gemini (`generateContent`) com JSON estruturado, imagem a imagem em paralelo limitado, cada falha isolada.
- **Loyverse**: nova escrita `POST /v1.0/items` e `POST /v1.0/inventory` em um `loyversePost` ao lado do `loyverseGet` atual; atualização de preço em `PUT`/`POST /v1.0/items`. Depois do lote, o catálogo é ressincronizado para a vitrine refletir na hora (mesmo mecanismo em tempo real já existente).
- **Migration externa** `supabase/external-migrations/20260911_product_purchases.sql`: tabela `product_purchases` (external_variant_id, product_name, variant_label, qty, cost, listed_price, savings, seller, tracking_code, purchased_at, source_image_url, needs_review, raw jsonb), índice único por `tracking_code + external_variant_id`, RLS só para `service_role`. Aplicada apenas no Supabase externo — Lovable Cloud continua desativado.
- **Frontend**: `src/components/admin/assistant-panel.tsx` (upload, progresso, resultado, grade de caixinhas de preço) e um botão no cabeçalho do painel de estoque em `src/routes/admin.tsx`. Visual e tokens iguais ao restante do admin.
- Nada muda em Home, pedidos, pagamentos, cupons, notificações, carrinho, checkout ou nos outros módulos.

## Antes de começar

Vou precisar que você salve a `GEMINI_API_KEY` no cofre de segredos (peço no formulário seguro assim que o plano for aprovado) e que o seu token do Loyverse tenha permissão de escrita em itens e estoque — sem isso o cadastro automático não consegue criar o produto.

## Verificação

Typecheck e build, um lote de teste com várias fotos (incluindo uma ilegível), conferência de duplicado reenviando a mesma foto e teste visual do admin em 390 px e 1440 px.
