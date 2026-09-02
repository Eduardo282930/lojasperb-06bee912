# Migração do SPERB para o Supabase externo

## Resposta direta

Não, apenas com a URL `https://cemxxuuzvrugmdpnejoq.supabase.co` eu **não** consigo acessar nem migrar nada. Essa URL é pública e não autentica: sem credencial, qualquer chamada é rejeitada. Nenhuma alteração foi feita em nenhum banco.

Além disso, este projeto está vinculado ao Lovable Cloud. O conector oficial de Supabase não aceita trocar o banco de um projeto que já usa Cloud — isso já foi testado antes e foi recusado pela plataforma. Ou seja, não existe hoje um caminho "clique e conecte" para apontar este app ao seu Supabase externo.

## O que é necessário (métodos oficiais)

Existem dois caminhos possíveis. Escolha um.

### Caminho A — Você aplica, eu preparo tudo

1. Eu gero (já gerei antes) o SQL completo: tabelas, enums, funções/RPCs, triggers, RLS, policies, grants e relacionamentos.
2. Você abre o SQL Editor do seu Supabase externo e executa o arquivo.
3. Eu gero os CSVs dos dados; você importa pela tela de Table Editor respeitando a ordem de dependências (customers → coupons → orders → order_items → ledgers).
4. Eu ajusto o código para ler as variáveis do novo banco.

Nada sensível passa pelo chat nem pelo código.

### Caminho B — Eu aplico via credencial guardada em Secrets

Para eu executar a migração diretamente eu preciso de credencial do seu projeto, armazenada pelo mecanismo de Secrets (nunca no código, nunca no GitHub):

- `EXT_SUPABASE_URL` — a URL que você já enviou
- `EXT_SUPABASE_SERVICE_ROLE_KEY` — chave service_role do projeto externo
- `EXT_SUPABASE_DB_URL` — string de conexão Postgres (Connect → Session pooler), necessária para criar funções, triggers e policies

Com isso eu aplico o schema, copio os dados e valido. Você pode revogar/rotacionar as chaves depois.

## Limitações que valem para os dois caminhos

- **Auth não migra**: usuários do Supabase Auth do Cloud não são transferidos. O login de administrador precisa ser recriado no banco novo, e a função `claim_admin` continua liberando o e-mail já configurado.
- **Segredos de servidor** (`LOYVERSE_TOKEN`, `INFINITEPAY_HANDLE`) precisam ser recadastrados no ambiente onde o app for hospedado.
- **Hospedagem**: enquanto o app rodar dentro do Lovable, o backend continua sendo o Cloud. Apontar 100% para o seu Supabase implica publicar na Vercel com as variáveis do banco novo.

## Depois da migração (em qualquer caminho)

1. Trocar as variáveis de ambiente para o projeto externo.
2. Validar leitura/escrita: produtos, categorias, clientes, cupons, moedas, pedidos, reservas.
3. Testar as funções críticas: `create_order`, `discard_unpaid_order`, `expire_stale_reservations`, `confirm_order_payment`, `daily_checkin`, `has_role`.
4. Testar login de admin, pagamento InfinitePay, webhook e sincronização Loyverse.
5. Só então o banco antigo pode ser desativado — nada será apagado antes da sua confirmação.

## Variáveis de ambiente reais usadas pelo código

Frontend (públicas): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`

Servidor (Vercel): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LOYVERSE_TOKEN`, `INFINITEPAY_HANDLE`
