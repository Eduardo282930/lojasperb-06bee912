# Opções de pedido do Loyverse + recibo para baixar

## O que muda para você

1. **A opção escolhida no Loyverse passa a mandar no status do pedido**
   - "Consumir no local" → o pedido entra direto como **Entregue e finalizado na loja** (já pago).
   - "Entrega" e "Comida para viagem" → o pedido entra como **Em preparação** (já pago).
   - A opção vem do próprio Loyverse (Opções de Pedido), nada é digitado à mão.

2. **Recibo para baixar, igual ao do Loyverse**
   - Em "Minhas compras", todo pedido **pago** ganha o botão **Baixar recibo**.
   - O recibo sai como **imagem** (PNG), no mesmo estilo do impresso: logo oficial da loja
     no momento em que é gerado, nome e endereço reais da loja, total em destaque,
     funcionário, cliente com telefone, a opção do pedido, os itens com quantidade e preço,
     total, forma de pagamento, texto de garantia, data/hora e número do recibo.
   - Melhorias no mesmo estilo: linhas separadas de **cupom**, **desconto do vendedor** e
     **moedas usadas** quando existirem.
   - Onde hoje aparece "PDV", passa a aparecer **Comprado na loja física** ou
     **Comprado online**, conforme o pedido real.

3. **Só cria quando o cliente pede, e some sozinho**
   - A imagem é gerada só no clique em "Baixar recibo".
   - Fica guardada **1 hora** e é apagada automaticamente.
   - Se o cliente pedir de novo, é gerada outra vez, sempre com os mesmos dados salvos
     (Loyverse / pedido), então o recibo sai sempre idêntico.

## Parte técnica

**Importação de recibos** (`src/lib/loyverse-receipts.functions.ts`)
- Ler `dining_option` (nome da opção) de cada recibo Loyverse e mapear:
  `consumir no local` → `status = delivered`; demais → `preparing`. Manter `paid`,
  `origin = 'store'`, idempotência por `loyverse_receipt_id`.
- Buscar e cachear `GET /v1.0/stores` (nome, endereço) e `GET /v1.0/employees`
  para o cabeçalho/funcionário do recibo; guardar no pedido os campos usados.

**Banco** (nova migração em `supabase/external-migrations/`)
- `orders.dining_option text`, `orders.receipt_number text`,
  `orders.store_name/store_address/employee_name text`.
- `import_store_receipt(...)` recebe e grava esses campos e define o status conforme a opção.
- `orders_for_customer` passa a devolver os novos campos.
- Tabela `order_receipt_files (order_id, path, created_at)` só para o controle de expiração.

**Geração da imagem**
- Server function `buildOrderReceipt({ orderId })`: monta o recibo em SVG/PNG server-side
  (sem depender do navegador), grava em bucket privado `receipts/` e devolve uma URL
  assinada de 1 hora.
- Limpeza: a rota já existente `/api/public/cleanup` apaga arquivos com mais de 1 hora.
- Logo: `fetchStoreLogoUrl` (logo oficial atual) embutido na imagem.

**Front** (`src/lib/orders.ts`, `src/routes/pedidos.tsx`)
- Mapear os novos campos; botão "Baixar recibo" nos pedidos pagos, com estado de carregando;
- Exibir "Entregue e finalizado na loja" quando `origin = 'store'` e opção "Consumir no local".

**Validação**
- `bunx tsgo --noEmit`, build de produção, importação de um recibo real de cada opção e
  conferência visual da imagem gerada contra o modelo impresso.
