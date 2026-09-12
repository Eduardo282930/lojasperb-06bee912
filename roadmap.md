# Assistente SPERB
- [x] Conversa de tela inteira e preços editáveis integrados.
- [x] Funções administrativas com contexto persistente e isolamento por proprietário.
- [x] Migração SQL externa entregue (fotos não persistidas); expiração de 30 dias com cron.
- [x] Extração independente e progressiva por imagem; cadastro por produto.
- [x] Produtos simples FIXED com unidade técnica autorizada; encomendas excluídas.
- [x] Identificação de compras por rastreio + produto e bloqueios de escrita.
- [x] SQL e tabelas do Assistente disponíveis no banco externo.
- [ ] Validar chat autenticado ponta a ponta após execução da migração.

## Otimização do Assistente
- [x] Fixar Flash-Lite sem alternância e eliminar raciocínio extra.
- [x] Paralelizar leitura com limite, deduplicar imagens e aproveitar resultados progressivamente.
- [x] Integrar categoria na extração, sincronizar uma vez por lote e medir chamada Gemini.
- [x] Modelo fixo atualizado para gemini-3.5-flash-lite e chamada real validada com a chave atual.

## Correções do Assistente
- [x] Limitar nomes completos a 64 caracteres e preservar variação.
- [x] Instruções editáveis, reinício por cancelamento e exclusão de histórico sem apagar idempotência.
- [ ] Validar operações autenticadas no banco externo (acesso de teste indisponível).

## Nomes e preços do Assistente
- [x] Reforçar resumo do nome e preservar variação nas correções.
- [x] Mostrar campo de preço desde a identificação; liberar salvamento após cadastro sem aguardar todo o lote.
- [x] Exibir falhas reais e exigir preço na mensagem atual.
