# Vitrine mais rápida + reembolso com dupla confirmação

## O que está acontecendo hoje (verificado no código)

**Imagens lentas**
- A vitrine mostra a foto exatamente como o Loyverse entrega: arquivo grande, no formato original, sem redimensionar. Num quadradinho de catálogo isso significa baixar muitas vezes mais dados do que o necessário.
- Todas as fotos, inclusive as primeiras da tela, estão marcadas como "carregamento preguiçoso" e com **prioridade baixa** (`loading="lazy"`, `fetchPriority="low"`). O navegador deixa as primeiras fotos para depois, disputando banda com dezenas de outras.
- Não há nenhuma antecipação do próximo lote: as fotos só começam a baixar quando o produto já está quase na tela.

**Ordem errada dos produtos**
- O catálogo chega do servidor ordenado por ordem alfabética.
- A ordem comercial (destaques, mais vendidos, com estoque/foto) só é montada no aparelho, depois que três consultas ao banco terminam. Resultado: a vitrine aparece alfabética, depois se reorganiza — e as fotos já baixadas eram de outros produtos, jogando trabalho fora e atrasando as fotos que realmente importam.

## Correções propostas

### 1. Ordem final já no servidor
- Passar a ordenação comercial (destaques do admin, mais vendidos, estoque/foto, rotação da sessão) para o servidor, retornando o catálogo **já na ordem da vitrine**.
- Assim a primeira tela já mostra destaques e recomendados; nada de lista alfabética que depois se reorganiza.
- Continua 30 produtos por lote, com os lotes seguintes na mesma ordem.
- A rotação por visita fica com uma semente enviada pelo aparelho, para não mudar durante a rolagem.

### 2. Fotos otimizadas no servidor/CDN
- Criar um endereço de imagem próprio da loja que devolve a foto **já reduzida ao tamanho da vitrine** e no melhor formato: **AVIF primeiro, WebP como alternativa**, JPEG só como último recurso.
- A conversão acontece fora do celular, num serviço de imagens na borda (CDN), com a URL montada a partir do endereço original do Loyverse — nada é processado pelo aparelho do cliente e nada exige baixar o catálogo inteiro.
- Duas larguras: uma para telefone (cerca de 400px) e uma para tela grande (cerca de 640px), escolhidas automaticamente.
- As URLs carregam a identificação da foto do Loyverse, então quando o produto muda a foto muda junto — sem depender do cache do celular.

### 3. Prioridade de carregamento
- **8 primeiras fotos**: prioridade máxima (`fetchpriority="high"`, sem carregamento preguiçoso) + pré-carregamento declarado no cabeçalho da página, para começarem junto com o HTML.
- Da 9ª em diante: carregamento normal, de cima para baixo.
- Antecipação: quando o cliente se aproxima do fim do lote, as fotos do próximo lote já começam a baixar (margem maior que a atual), de forma que a rolagem nunca encontre um quadrado cinza.
- Espaço reservado com proporção fixa (já existe) para não haver "pulo" de layout.

### 4. Reembolso InfinitePay com dupla confirmação
- Ao tocar em **💳 Devolver dinheiro com InfinitePay**, abre um painel com o recibo/identificação da transação (comprovante, transaction_nsu, slug, order_nsu) e, ao lado, o botão **Confirmar que fiz o reembolso**.
- Esse botão abre uma segunda pergunta: *"Tem certeza de que você realizou o reembolso no InfinitePay?"*
- Só depois dessa segunda confirmação o pedido vira **✅ Reembolso realizado** e a prova é gravada.
- Abrir o recibo ou tocar no botão de devolver dinheiro **não marca mais nada** como reembolsado (hoje ele já pede a prova logo depois de abrir a venda; isso sai).
- Pagamento na entrega/dinheiro continua com o botão "Confirmar reembolso" simples, sem mudanças.

## Testes de velocidade (depois da implementação)
- Medir, em telefone simulado com internet 4G lenta, o tempo até as **8 primeiras fotos** estarem visíveis, antes e depois.
- Conferir o peso baixado por foto (esperado: de centenas de KB para algumas dezenas) e o formato entregue (AVIF onde houver suporte).
- Conferir que a primeira tela já vem com destaques/recomendados, sem reorganização visível.
- Rolagem contínua: nenhum quadrado cinza entre os lotes.

## Detalhes técnicos
- `src/lib/loyverse.functions.ts`: remover a ordenação alfabética final; o catálogo passa a sair na ordem comercial. Os dados de destaques/mais vendidos/reservas são lidos no servidor (cliente Supabase de leitura pública ou admin dentro do handler) e combinados com `merchandiseOrder` movido para um módulo compartilhado.
- `src/routes/index.tsx`: consumir a ordem já pronta; `merch` fica só para selos/estoque reservado, sem reordenar. `ProductCard` recebe `index` para decidir prioridade; `<picture>` com `source type="image/avif"`, `source type="image/webp"` e `<img>` de fallback; `srcSet`/`sizes` para as duas larguras; pré-carregamento das 8 primeiras via `head()`/`link rel="preload"`.
- Novo `src/lib/image-url.ts`: monta as URLs otimizadas a partir de `product.image`, com largura, formato e qualidade; usa serviço de transformação na borda e mantém a chave da imagem original na URL (invalidação natural quando a foto muda).
- Cabeçalhos de cache longos e imutáveis nas imagens transformadas (a URL muda quando a foto muda), sem depender do cache do aparelho para dados de catálogo.
- `src/routes/admin.tsx`: substituir `refundWithInfinitePay` por um painel/diálogo com os identificadores e dois passos de confirmação; `confirmRefund` só é chamado no segundo passo. Nenhuma alteração em RPCs, estoque, prazos de pagamento ou nos demais fluxos.
