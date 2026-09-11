# Assistente SPERB
- [x] Conversa de tela inteira e preços editáveis integrados.
- [x] Funções administrativas com contexto persistente e isolamento por proprietário.
- [x] Migração SQL externa entregue (fotos não persistidas); expiração de 30 dias com cron.
- [x] Extração independente e progressiva por imagem; cadastro por produto.
- [x] Produtos simples FIXED com unidade técnica autorizada; encomendas excluídas.
- [x] Identificação de compras por rastreio + produto e bloqueios de escrita.
- [ ] Executar SQL no banco externo: ação do proprietário.
- [ ] Validar chat autenticado ponta a ponta após execução da migração.

## Otimização do Assistente
- [ ] Fixar Flash-Lite sem alternância e eliminar raciocínio extra.
- [ ] Paralelizar leitura com limite, deduplicar imagens e aproveitar resultados progressivamente.
- [ ] Reduzir chamadas de categoria e medir etapas sem registrar fotos.
- [ ] Validar chamadas e testes sem alterar estoque real.
