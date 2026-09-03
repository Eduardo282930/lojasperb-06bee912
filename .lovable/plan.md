# Diagnóstico completo da SPERB (sem alterações ainda)

## O que foi verificado agora

- Servidor de desenvolvimento: `/` responde 200, `/pedidos` responde 307 (redirecionamento normal que só acrescenta `?status=topay` — não é erro).
- Verificação de tipos (`tsgo --noEmit`): sem erros.
- Log do servidor: sem exceções; apenas avisos de API antiga (`inputValidator` em vez de `validator`) e um aviso de CSRF. Nada disso derruba o app.
- HTML gerado pelo servidor: o CSS é incluído corretamente uma única vez.
- Nenhum service worker registrado no projeto (então o problema de CSS no celular não vem de service worker).

## Erros e riscos encontrados

### 1. Tela branca / RUNTIME_ERROR na home
Causa provável (dois fatores somados):
- A home depende do Loyverse já na renderização do servidor. Se o token do Loyverse faltar ou a API demorar, o servidor devolve a vitrine vazia enquanto o aparelho já tem uma cópia local salva. Essa diferença entre o que o servidor mandou e o que o aparelho monta gera erro de hidratação — resultado visível: tela branca.
- A cópia local é lida no momento em que o arquivo da home é carregado (fora do ciclo do React), o que torna esse descompasso mais provável.
- Além disso a chamada ao Loyverse não tem tempo limite: em rede ruim o servidor pode ficar pendurado até o gateway cortar a resposta.

### 2. Vitrine sem CSS no celular (funciona nos outros aparelhos)
Causa provável: o celular guardou em cache o HTML de uma versão anterior do site. Esse HTML aponta para um arquivo de CSS com nome versionado que não existe mais no deployment atual → o CSS retorna 404 e a página aparece "crua". As páginas HTML hoje saem sem instrução de "não guardar em cache", o que permite exatamente esse descasamento entre HTML velho e arquivos novos.

### 3. Cópia local do catálogo sem controle de versão
A chave `sperb-catalog-v1` nunca muda. Se o formato dos produtos mudar entre versões, um aparelho com cópia antiga (válida por 24h) pode quebrar ao ler campos que não existem — falha que aparece só em alguns aparelhos, como no caso relatado.

### 4. Pontos menores (sem impacto atual)
- `<link>` de CSS repetido manualmente no shell além do automático (redundante).
- Avisos de `inputValidator` obsoleto e de CSRF nas funções de servidor.

## Correções propostas

| Arquivo | O que muda |
| --- | --- |
| `src/routes/index.tsx` | Ler a cópia local dentro do ciclo do React (não mais no carregamento do módulo) e usar os dados do servidor na primeira renderização, atualizando com a cópia local só depois da hidratação. Elimina a tela branca por descompasso. |
| `src/lib/loyverse.functions.ts` | Tempo limite na chamada ao Loyverse durante a renderização no servidor, devolvendo vitrine vazia em vez de travar a resposta. |
| `src/server.ts` | Enviar `cache-control: no-store` apenas para as páginas HTML (não para os arquivos versionados). Assim o celular nunca reabre um HTML velho apontando para CSS que não existe mais. |
| `src/routes/__root.tsx` | Remover o `<link>` de CSS duplicado e adicionar uma verificação leve: se a folha de estilos não carregar, o app recarrega uma única vez sozinho (autocorreção para aparelhos com cache preso). |
| `src/lib/catalog-cache.ts` | Chave versionada + validação do formato antes de usar a cópia local; formato antigo é descartado silenciosamente. |

Sem alterações em `pedidos.tsx`, nas regras de pedidos, estoque, cupons, moedas, Loyverse ou InfinitePay.

## Como será testado

1. `tsgo --noEmit` limpo.
2. Home, `/pedidos`, `/sacola`, `/confirmar`, `/eu`, `/produto/$id` e `/admin` abertos via navegador automatizado em viewport de celular e de tablet, conferindo status 200, ausência de erros no console e CSS aplicado.
3. Home aberta com token do Loyverse indisponível para confirmar que aparece a vitrine (e não tela branca).
4. Verificação dos cabeçalhos: HTML com `no-store`, arquivos de CSS/JS ainda com cache longo.
5. Em "Minhas compras": tocar em cada aba leva direto a ela, o arraste entre abas continua funcionando e a barra azul acompanha o arraste — conferido manualmente no navegador automatizado.

## Impacto em funcionalidades que já funcionam

- "Minhas compras" (toque nas abas, arraste, barra azul): intocado.
- Fluxo de pedido/pagamento/estoque/reembolso: intocado.
- Único efeito colateral esperado: aparelhos com cópia antiga do catálogo farão um carregamento inicial a mais (a cópia velha é descartada uma vez).
