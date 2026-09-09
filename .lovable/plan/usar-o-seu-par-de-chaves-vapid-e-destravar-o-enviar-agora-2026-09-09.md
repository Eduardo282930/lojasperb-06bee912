# Usar o seu par de chaves VAPID e destravar o "Enviar agora"

## O que eu vou fazer com as chaves

Vou abrir um formulário seguro para você colar os três valores (chave pública, chave privada e o e-mail de contato). Eles vão direto para o cofre do projeto — não passam pelo chat, não entram no código, no site, no GitHub nem no banco. Como já existem chaves salvas de antes, o formulário vai substituir os valores antigos pelos seus, exatamente como você enviar. Não vou gerar nenhuma chave nova.

## O ponto que ainda trava o envio

Trocar o par de chaves invalida todos os aparelhos que já estavam inscritos com o par anterior: o serviço de push do celular passa a recusar o envio. Hoje o painel também tenta enviar mesmo quando nenhum aparelho válido está registrado, e a mensagem final fica genérica.

Então, além de salvar as chaves, preciso:

1. Fazer o app perceber quando o aparelho está inscrito com uma chave diferente da atual, cancelar essa inscrição antiga e refazer com a chave nova, sozinho, na primeira vez que a pessoa abrir o app.
2. Limpar do banco os registros de aparelhos feitos com a chave antiga, para não somarem falhas no envio.
3. Deixar o painel dizer o motivo real quando nada for enviado (nenhum aparelho registrado, aparelho recusado, chave ausente) em vez de só "Não foi possível enviar".

## Como vamos confirmar que funcionou

Você abre o app no celular e autoriza as notificações. Eu confiro no banco que o aparelho foi registrado com a chave nova, disparo um aviso pelo painel Admin e você me diz se chegou com o app fechado. Se der erro, eu vejo a resposta exata do serviço de push e corrijo.

Nada fora das notificações muda: pedidos, estoque, cupons, moedas, recibos e Loyverse ficam como estão.

## Detalhes técnicos

- Secrets: `update_secret` para `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:admin@sperb.com.br`). Só servidor; `src/routes/api/public/push.ts` (GET) continua sendo a única forma de o navegador obter a chave pública.
- `src/lib/notifications.ts`: comparar `subscription.options.applicationServerKey` com a chave pública retornada pelo GET; se diferir, `await subscription.unsubscribe()` e reinscrever com a chave atual, depois `POST action=subscribe`.
- Limpeza única das linhas antigas de `public.push_subscriptions` (feitas com o par anterior) via SQL no banco externo.
- `src/lib/web-push.server.ts` / `src/routes/api/public/push.ts`: retornar motivo específico quando `total === 0` e propagar `lastError` (status + corpo truncado) do serviço de push; manter remoção automática de 404/410.
- `src/components/admin/notifications-panel.tsx`: exibir a causa retornada, sem mudança de layout.
- Verificação: `bunx tsgo --noEmit`, build de produção, consulta ao banco confirmando o aparelho novo e envio real pelo Admin.
