# Finalização do Assistente SPERB

## Resultado esperado
Transformar o Assistente, dentro de **Meu estoque**, em uma conversa de tela inteira: mensagens, anexos, cadastro automático, preços e correções no mesmo lugar. Preservar as demais funções da SPERB e usar o Loyverse como fonte permanente dos produtos.

## 1. Conversa com contexto
- Abrir uma tela completa com histórico, campo de mensagem, anexos e botão enviar no rodapé.
- Manter **Produto da loja** como padrão e **Produto por encomenda** como alternativa dentro da conversa. A seleção vale para os próximos envios; instruções explícitas podem definir o tipo de cada produto, inclusive em lotes mistos.
- Relacionar cada produto a um identificador estável, à mensagem de origem e à posição no lote. Entender referências como “chinelo azul”, “os dois primeiros” e “o último”.
- Permitir conversar sobre nome, descrição, quantidade, custo, categoria, tipo e preço sem reiniciar o fluxo.
- **Quando a referência for ambígua, perguntar somente qual produto deve ser alterado.** Não pedir confirmação para cadastros ou alterações claras.
- Tratar texto encontrado nas imagens como informação de compra, nunca como autorização para executar comandos.

## 2. Imagens e cadastro automático
- Analisar cada imagem separadamente e identificar todos os produtos legíveis, incluindo combinações diferentes de modelo, cor e tamanho.
- Extrair nome, descrição disponível, variação, quantidade, preço anunciado atual, custo real, economia, vendedor, rastreio, data e observações. Ignorar preços riscados; não inventar dados ilegíveis.
- Reduzir imagens preservando legibilidade, validar arquivos e informar o limite antes do envio, sem descartar anexos silenciosamente.
- Mostrar progresso por imagem e resultado por produto. Falhas isoladas entram em **Precisa de conferência**, sem cancelar o restante.
- Guardar imagens apenas na memória durante o processamento e liberar também as prévias locais ao terminar. Não criar bucket, URL permanente ou histórico de fotos; no histórico restam apenas texto e dados extraídos.
- Informar o resultado real: quantos produtos foram criados, atualizados e ficaram pendentes. Nunca anunciar sucesso total se houver falhas.

## 3. Produtos simples e integração Loyverse
- Cada combinação produto + variação será um produto simples separado, com a variação incorporada ao nome: “Chinelo Azul 37/38”.
- Nunca criar opções internas de cor/tamanho, nem usar preço `VARIABLE`.
- Conferir o contrato oficial e testar a criação de produto simples **sem enviar `variants`**, conforme solicitado. Há uma incompatibilidade potencial: preço, custo e estoque na API são associados a uma unidade técnica padrão mesmo em produtos simples. Se as operações exigirem enviar esse campo, apresentar a limitação antes de implementá-la; não contrariar a proibição silenciosamente.
- Não converter ou desmembrar produtos antigos com variações automaticamente. Se um deles conflitar com uma nova compra, isolar o caso para conferência, preservando vendas e estoque existentes.
- Atualizar custo e estoque de compras novas do mesmo produto, sem duplicar o cadastro. Correções de quantidade ajustam apenas a diferença da compra, não substituem o estoque total nem desfazem vendas posteriores.
- Produto da loja: selecionar somente uma categoria existente adequada, excluindo Encomenda; não criar categorias comuns automaticamente.
- Produto por encomenda: garantir a categoria **Encomenda** antes de concluir o cadastro. Falha ao atribuí-la impede anunciar sucesso ou disponibilizar o produto publicamente.

## 4. Preço exclusivamente informado por você
- A IA nunca sugere, inventa ou calcula preço de venda a partir do custo ou economia.
- Interpretar preços informados na conversa e aplicá-los somente aos produtos identificados com segurança.
- Mostrar todos os campos de preço necessários dentro da conversa, editáveis simultaneamente, com salvamento ao concluir a edição ou pressionar Enter.
- Exibir **✓ Preço salvo** somente após confirmação do Loyverse; erros preservam o valor digitado.
- **Produtos novos sem preço ficam fora da vitrine e indisponíveis para compra.** Ao informar um preço válido, liberar apenas os produtos da loja. Encomendas continuam ocultas.
- Preservar o preço existente quando uma nova compra apenas acrescentar estoque, salvo instrução explícita sua.

## 5. Duplicados, reenvios e segurança das alterações
- Procurar correspondências por SKU e código de barras quando confiáveis, nome normalizado e combinação produto + variação.
- Usar rastreio/pedido em conjunto com a identificação do item para reconhecer compras; um mesmo rastreio pode conter vários produtos.
- Separar **nova compra**, **reenvio da mesma compra** e **correção**: somente uma nova compra soma a quantidade integral.
- Registrar operações com identificadores únicos e etapas confirmadas. Após queda de conexão ou resposta incerta, conferir o estado no Loyverse antes de repetir qualquer escrita.
- Serializar alterações concorrentes do mesmo produto para reduzir risco de estoque sobrescrito ou duplicado.
- Preços e demais comandos passam por validação no servidor; a IA não recebe acesso livre a APIs ou ao banco.

## 6. Memória por 30 dias
- Persistir no **banco externo já usado pela SPERB** somente conversas, mensagens textuais, dados extraídos, referências dos produtos e decisões — nunca imagens.
- Restringir cada conversa ao administrador responsável e validar autorização em todas as leituras e alterações.
- Cada conversa terá validade de 30 dias a partir da criação, sem renovação silenciosa. Após expirar, iniciar uma nova conversa.
- Excluir automaticamente a conversa e sua memória associada ao fim do prazo; impedir acesso a conteúdo vencido mesmo antes da próxima limpeza agendada.
- A limpeza não apaga produtos, estoque, preços ou registros permanentes de compras. Manter apenas o mínimo necessário de identificação operacional para evitar repetir compras, separado da memória conversacional.

## 7. Gemini e processamento resistente a falhas
- Preservar a integração direta com Gemini e `GEMINI_API_KEY` exclusivamente no servidor; modelo multimodal configurável por `GEMINI_MODEL`, sem `gemini-1.5-flash`.
- Usar autenticação documentada por cabeçalho e não rejeitar chaves pelo prefixo, incluindo `AQ`. Validar a chave configurada em uma chamada real sem expor seu valor.
- Investigar os cancelamentos no fluxo completo, incluindo leitura da resposta e limites de hospedagem; aumentar um temporizador isolado não basta.
- Usar respostas progressivas para operações demoradas, sem cancelamento prematuro, e chamadas independentes por imagem.
- Repetir apenas falhas transitórias com espera crescente e limite de tentativas, respeitando `Retry-After`. Erros de autenticação ou entrada inválida são exibidos e não repetidos automaticamente.
- Não repetir gravações de estoque apenas porque uma leitura ou resposta falhou. Permitir retomar etapas já extraídas sem guardar a foto; caso a extração não tenha terminado, solicitar reenvio apenas da imagem necessária.

## 8. Catálogo e preservação do aplicativo
- Reutilizar a sincronização atual após alterações confirmadas no Loyverse.
- Conferir exclusão de Encomenda na origem do catálogo e nas proteções de cache, vitrine, busca, recomendações, detalhes e compra.
- Restringir mudanças fora do Assistente ao necessário para impedir exposição de encomendas e produtos novos sem preço. Preservar checkout, pagamentos, pedidos, moedas, cupons e notificações.

## Detalhes técnicos
- Evoluir `assistant.server.ts` e `assistant.functions.ts`, separando interpretação contextual, validação de comandos e operações Loyverse. Chamadas internas usam funções autenticadas; respostas HTTP progressivas usam uma rota autenticada própria.
- Substituir a apresentação de `assistant-panel.tsx` pela experiência de conversa de tela inteira integrada ao Admin, com componentes menores e padrões visuais existentes.
- O contexto será carregado do servidor, com estado estruturado por produto e recuperação de mensagens relevantes durante os 30 dias, não apenas as últimas mensagens enviadas pelo navegador.
- Criar migrações no banco externo após verificar seu esquema real: conversas, mensagens, referências e controle mínimo de operações, com permissões explícitas, RLS e índices para expiração.
- Verificar o agendamento existente antes de integrar a limpeza; não depender de alguém abrir o aplicativo.
- A inspeção atual confirmou processamento por imagem, seleção de tipo, salvamento de preço e validação administrativa, mas não uma conversa persistente. Também identificou soma de estoque por nome/variação e erros de categoria/metadados que podem ser ocultados; esses caminhos serão corrigidos.

## Verificação antes de concluir
1. Testar imagem real → Gemini → produto simples no Loyverse → custo, estoque, categoria e preço fixo.
2. Enviar cinco imagens, incluindo uma ilegível e outra com mais de um produto: processar todas e isolar pendências.
3. Misturar loja e encomenda, mudar o tipo na conversa e conferir ausência de Encomenda em todos os acessos públicos.
4. Informar “esse é 39,90”, “chinelo azul 45” e “os dois primeiros são 35 reais”; verificar os preços reais e a pergunta somente nos casos ambíguos.
5. Corrigir nome, quantidade e custo; reenviar a mesma operação e simular falha após escrita para verificar que estoque não dobra.
6. Verificar produto novo sem preço oculto, liberação após preço e manutenção do preço de produtos existentes.
7. Reabrir a conversa, testar isolamento entre administradores e expiração de 30 dias, comprovando que o Loyverse permanece intacto.
8. Verificar a conversa em celular, tablet e computador, com teclado aberto, anexos, progresso e mensagens longas.
9. Executar testes direcionados e conferir erros da aplicação; relatar separadamente qualquer teste real bloqueado por acesso ou limitação da API.

**Ponto de atenção:** não prometer a operação sem `variants` antes de validar o contrato real do Loyverse. Caso seja impossível cumprir literalmente, essa etapa fica bloqueada para decisão sua, sem criar produtos em formato diferente do solicitado.
