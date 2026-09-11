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
- [x] Fixar Flash-Lite sem alternância e eliminar raciocínio extra.
- [x] Paralelizar leitura com limite, deduplicar imagens e aproveitar resultados progressivamente.
- [x] Integrar categoria na extração, sincronizar uma vez por lote e medir chamada Gemini.
- [ ] Validação real bloqueada: Google respondeu 404, gemini-2.5-flash-lite indisponível para novos usuários desta chave. Sintaxe verificada; nenhum estoque alterado.
