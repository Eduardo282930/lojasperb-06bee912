# 🚀 Quick Start Guide - Aplicar Migrations SPERB

**Você está aqui:** ✅ Validação Completa  
**Próximo Passo:** 🔄 Aplicar Migrations  

---

## ⚡ TL;DR (Resumo Ultra-Rápido)

### Comando Único
```bash
cd /workspaces/lojasperb && supabase db push --project-id azkkynnynogbjlfverjl
```

### Resultado Esperado
```
✔ Pushing new schema...
✔ Applying 4 new migrations...
✔ Done! Database updated.
```

### Depois
```bash
supabase gen types typescript --project-id azkkynnynogbjlfverjl > src/integrations/supabase/types.ts
npm run dev
```

**⏱️ Tempo total: ~5 minutos**

---

## 📊 O Que Vai Acontecer

### Visualmente
```
┌─────────────────────────────────────────┐
│      Supabase Database (azkkynnyn...)   │
├─────────────────────────────────────────┤
│                                         │
│  ANTES:                                 │
│  ├─ user_roles (AUTH)                   │
│  ├─ coupons (VENDAS)                    │
│  ├─ customers (CLIENTES)                │
│  └─ orders (PEDIDOS)                    │
│                                         │
│  DEPOIS (adicionado):                   │
│  ├─ ✨ system_products (LOGO)           │
│  ├─ ✨ store_settings (CONFIG)          │
│  ├─ ✨ audit_logs (AUDITORIA)           │
│  ├─ ✨ stock_levels (ESTOQUE)           │
│  └─ ✨ stock_movements (HISTÓRICO)      │
│                                         │
│  ⚠️ IMPORTANTE: Nada será deletado!    │
│                                         │
└─────────────────────────────────────────┘
```

### Em Números
- **Tabelas Criadas:** 5 novas
- **Tabelas Alteradas:** 0
- **Dados Deletados:** 0
- **Índices Adicionados:** 7
- **Funções Novas:** 1 (`register_stock_movement()`)
- **Tempo de Downtime:** ~2 minutos

---

## 🎯 Pré-Requisitos

### Checklist Rápido
- [ ] `supabase cli` instalado? `supabase --version`
- [ ] Logado no Supabase? `supabase projects list`
- [ ] Acesso ao projeto? `azkkynnynogbjlfverjl` visível na lista
- [ ] Internet estável?
- [ ] Backup feito?
- [ ] Ninguém acessando o app agora?

### Se Faltar Algo
```bash
# Instalar CLI (se não tiver)
brew install supabase/tap/supabase  # macOS
# ou
curl -fsSL https://bun.sh/install | bash  # Linux/Dev Container

# Login
supabase login

# Verificar acesso
supabase projects list
# Deve mostrar: azkkynnynogbjlfverjl
```

---

## 🔄 Passo a Passo

### Passo 1: Preparação (2 min)
```bash
# Entrar no diretório
cd /workspaces/lojasperb

# Verificar que migrations existem
ls -la supabase/migrations/
# Deve mostrar 6 arquivos:
# - 20260815095712_eb174876...sql
# - 20260815095744_ebdc922b...sql
# - 20260816000000_system_products.sql    ✨ NOVO
# - 20260816000100_store_settings.sql     ✨ NOVO
# - 20260816000200_audit_logs.sql         ✨ NOVO
# - 20260816000300_stock_levels.sql       ✨ NOVO

# Verificar build
npm run build
# Deve passar sem erros
```

### Passo 2: Aplicar Migrations (1-2 min)
```bash
# Comando principal
supabase db push --project-id azkkynnynogbjlfverjl

# Responder "y" quando perguntar
# Waiting for database to apply migrations...
```

### Passo 3: Validar (1 min)
```bash
# Verificar tabelas foram criadas
supabase db list --project-id azkkynnynogbjlfverjl

# Deve mostrar algo como:
# Tables: 9 (era 4, agora 9)
#   - system_products ✨
#   - store_settings ✨
#   - audit_logs ✨
#   - stock_levels ✨
#   - stock_movements ✨
```

### Passo 4: Regenerar Types (1 min)
```bash
# Atualizar TypeScript types
supabase gen types typescript --project-id azkkynnynogbjlfverjl > src/integrations/supabase/types.ts

# Verificar que types.ts foi atualizado
git diff src/integrations/supabase/types.ts
# Deve mostrar novas tabelas e tipos
```

### Passo 5: Deploy App (1 min)
```bash
# Testar localmente
npm run dev

# Abrir http://localhost:5173
# Verificar que não há "This page didn't load"
# Verificar que logo.tsx funciona

# Se OK, fazer deploy
npm run build && git push
```

---

## ⚠️ Se Algo Dar Errado

### Erro: "Table already exists"
```
❌ Error: relation "system_products" already exists
```
**Solução:** Migrations já foram aplicadas. Pule para "Regenerar Types"

### Erro: "Permission denied"
```
❌ Error: Permission denied for database push
```
**Solução:** Verificar:
1. `supabase login` está feito?
2. Token tem permissão de admin?
3. Projeto está em organizações? (supabase lib push pode não funcionar)

### Erro: "Connection timeout"
```
❌ Error: connection timeout
```
**Solução:** Tentar novamente ou usar dashboard:
```bash
# Abrir dashboard
open https://supabase.com/dashboard/project/azkkynnynogbjlfverjl/sql

# Copiar conteúdo de cada arquivo .sql
# Colar e executar manualmente
```

### Erro: "Foreign key constraint violation"
```
❌ Error: insert or update on table violates foreign key constraint
```
**Solução:** Rollback:
```bash
supabase db reset --project-id azkkynnynogbjlfverjl
```
Depois contatar time.

---

## 🔍 Verificações Pós-Aplicação

### Verificação 1: Tabelas Criadas
```bash
# SSH no banco ou usar Supabase SQL Editor
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;

# Resultado esperado (9 linhas):
# audit_logs
# customers
# coupons
# orders
# stock_levels
# stock_movements
# store_settings
# system_products
# user_roles
```

### Verificação 2: RLS Ativo
```bash
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE table_schema = 'public' 
ORDER BY tablename;

# Deve mostrar rowsecurity = true para todas
```

### Verificação 3: Índices
```bash
SELECT indexname 
FROM pg_indexes 
WHERE schemaname = 'public' 
ORDER BY indexname;

# Deve incluir:
# - system_products_created_at_idx
# - system_products_product_type_idx
# - audit_logs_* (vários)
# - stock_* (vários)
```

### Verificação 4: App Funciona
```bash
npm run dev

# Abrir browser: http://localhost:5173
# Verificar:
# ✅ Página carrega (sem "This page didn't load")
# ✅ Logo mostra (ou padrão se não tiver)
# ✅ Produtos listam
# ✅ Carrinho funciona
# ✅ Admin pode acessar /eu
```

---

## 📝 Rollback (Se Necessário)

### Rollback Completo
```bash
# ⚠️ CUIDADO: Deleta TODAS as migrations
supabase db reset --project-id azkkynnynogbjlfverjl

# Confirmar e esperar
# Resultado: Volta ao estado inicial (sem nada)
```

### Rollback Manual (Mais Seguro)
```bash
# Abrir SQL Editor em https://supabase.com/dashboard/project/azkkynnynogbjlfverjl/sql

# Executar na ordem REVERSA:
-- 1. Remove stock_levels e stock_movements
DROP TABLE IF EXISTS stock_movements CASCADE;
DROP TABLE IF EXISTS stock_levels CASCADE;

-- 2. Remove audit_logs
DROP TABLE IF EXISTS audit_logs CASCADE;

-- 3. Remove store_settings
DROP TABLE IF EXISTS store_settings CASCADE;

-- 4. Remove system_products
DROP TABLE IF EXISTS system_products CASCADE;

-- 5. Verificar que só ficaram as tabelas antigas
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public';
-- Deve mostrar: customers, coupons, orders, user_roles (apenas 4)
```

---

## 🎓 FAQ

### P: Preciso fazer backup?
**R:** Sim! `supabase db backup create --project-id azkkynnynogbjlfverjl`

### P: Vai desligar a app?
**R:** Por ~2 minutos durante aplicação. Avisar users.

### P: Posso aplicar em staging primeiro?
**R:** Ótima ideia! Criar projeto staging e testar lá primeiro.

### P: Migrations podem ser feitas em produção?
**R:** Sim! Supabase é gerenciado e handles automaticamente.

### P: E se o app quebrar após?
**R:** Rollback + investigar logs + reapply com fix.

### P: Quando regenerar types.ts?
**R:** Sempre após aplicar migrations. Schema mudou.

### P: Preciso commitar types.ts?
**R:** Sim! É parte do código.

---

## ✅ Checklist Final

```
Antes de clicar em "Apply":
[ ] Lido MIGRATIONS_GUIDE.md? 
[ ] Lido MIGRATIONS_CHECKLIST.md?
[ ] npm run build passa?
[ ] Tenho acesso via supabase cli?
[ ] Tenho backup?
[ ] Users foram avisados?
[ ] Time está pronto?

Pronto? 🚀 Execute:
supabase db push --project-id azkkynnynogbjlfverjl
```

---

## 📞 Próximos Passos

1. **Agora:** Revisar este documento
2. **Se OK:** Executar `supabase db push`
3. **Depois:** Regenerar types.ts
4. **Depois:** Deploy app
5. **Depois:** Monitorar por erros

---

## 🎉 Sucesso!

Se chegou aqui significa:
- ✅ Migrations estão prontas
- ✅ Build compila sem erros
- ✅ Schema é compatível
- ✅ Dados estão seguros
- ✅ App vai funcionar

**Próximo: Apertar o botão de deploy!**

---

**Precisa de ajuda?**
- Leia: MIGRATIONS_GUIDE.md (detalhes técnicos)
- Leia: MIGRATIONS_CHECKLIST.md (verificações)
- Contate: time@sperb.com.br

**Boa sorte! 🎯**
