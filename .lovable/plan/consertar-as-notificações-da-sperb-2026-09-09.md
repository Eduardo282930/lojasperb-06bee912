# Consertar as notificações da SPERB

## O que eu encontrei

Investiguei o caminho inteiro (tela do Admin → servidor → banco → celular). O botão "Enviar agora" nunca teve chance de funcionar. São três falhas reais, todas confirmadas:

1. **A tabela dos aparelhos não existe no banco.** O servidor grava e lê os aparelhos inscritos numa tabela chamada `push_subscriptions`. Consultei o banco da loja: ela nunca foi criada. Por isso o envio quebra e a tela mostra "Não foi possível enviar." Pelo mesmo motivo, nenhum celular chegou a ser registrado.
2. **As chaves de notificação (VAPID) não estão configuradas.** Sem elas o app não consegue pedir permissão de verdade nem o servidor consegue assinar o envio. Hoje a lista de chaves do projeto não tem nenhuma delas.
3. **O código de envio tem erros e usa recursos que o servidor de produção não suporta.** A curva de criptografia está escrita errada (`prime256v` em vez de `prime256v1`), a ordem de derivação das chaves de criptografia está trocada, e as funções usadas (`createECDH`/`createSign`) não funcionam no ambiente onde o site roda publicado. Ou seja: mesmo com tabela e chaves, o envio falharia.

O restante está correto: a checagem de administrador, o Service Worker que mostra o aviso com o app fechado, e a tela do Admin.

## O que vou fazer

1. Criar a tabela dos aparelhos no banco da loja, com as proteções de acesso corretas (só o servidor grava/lê).
2. Gerar e salvar as chaves de notificação do projeto.
3. Reescrever a parte de criptografia/envio usando recursos suportados pelo servidor publicado, corrigindo os erros encontrados.
4. Melhorar as mensagens de erro do painel: em vez de "Não foi possível enviar", mostrar o motivo real (sem expor dados sensíveis).
5. Registrar automaticamente o aparelho de quem já autorizou notificações, para que a base de aparelhos se forme sozinha.
6. Testar de ponta a ponta: pedir permissão num navegador de teste, confirmar o aparelho salvo no banco, disparar pelo Admin e conferir que a notificação chega com o app fechado.

Nada fora das notificações será alterado: pedidos, estoque, cupons, moedas, recibos e Loyverse ficam exatamente como estão.

## Detalhes técnicos

- **Migração nova** `supabase/external-migrations/20260909_push_subscriptions.sql`: tabela `public.push_subscriptions` (`id`, `customer_id` → `customers`, `device_id`, `endpoint` único, `p256dh`, `auth`, `created_at`, `updated_at`), índice por `customer_id`, RLS ativa sem políticas públicas, `GRANT ALL ... TO service_role` (acesso só pelo servidor). Aplicada no banco externo.
- **Segredos**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (gerados com `scripts/generate-vapid-keys.mjs`) e `VAPID_SUBJECT`.
- **`src/lib/web-push.server.ts`**: trocar `node:crypto` por WebCrypto (`crypto.subtle`) — ECDH P-256, HKDF e AES-128-GCM para o payload aes128gcm, e ECDSA P-256 para o JWT VAPID (assinatura já em formato raw, elimina a conversão DER frágil). Corrigir a ordem HKDF (`PRK = HMAC(auth, ECDH)`, `IKM = expand(PRK, "WebPush: info\0"||clientPub||serverPub)`, depois `PRK2 = HMAC(salt, IKM)` e daí `key`/`nonce`). Manter as assinaturas exportadas (`sendWebPush`, `savePushSubscription`, `sendNotificationToAll`) para não afetar quem as chama.
- **`src/routes/api/public/push.ts`**: devolver mensagem de erro específica em `send` (chaves ausentes, tabela indisponível, nenhum aparelho) e retornar também `failed` para diagnóstico.
- **`src/lib/notifications.ts`**: repassar a mensagem real do servidor; reinscrever o aparelho quando a permissão já estiver concedida (inclusive sem telefone, associando por `device_id` quando o cliente existir).
- **`src/components/admin/notifications-panel.tsx`**: exibir a causa retornada; sem mudança de layout.
- **Verificação**: `bunx tsgo --noEmit`, build de produção, consulta ao banco confirmando o aparelho salvo, e teste com navegador (Playwright) permitindo notificações e disparando pelo Admin.
