# As rotas de pesquisa aceitam um token por consumidor

`POST /api/games/research` e `POST /api/games/research/from-topic` só aceitavam o `internal_secret` conferido contra o `INTERNAL_SECRET`, o segredo que a interface web e o Sistema Estoque já usam. Para pedir pesquisa, o chatbot teria de guardar esse mesmo segredo. A regra do ecossistema é cada serviço ter o seu, e com um segredo compartilhado não dá para cortar o acesso de um consumidor sem cortar o de todos.

**Decisão:** as duas rotas aceitam, em `internal_secret`, **qualquer** dos tokens configurados: o `INTERNAL_SECRET` (consumidor `internal`) ou o `CHATBOT_INTERNAL_SECRET` (consumidor `chatbot`). O contrato não muda: o campo é o mesmo, e token ausente ou errado continua sendo demo na `research` e `401` na `from-topic`.

## Como

- **Um ponto só:** `researchConsumer`, em `src/nest/games/internal-secret.guard.ts`, diz de qual consumidor é o token. O guard da `from-topic` e o `isAuthenticated` da `research` leem dali. É apresentação: autenticação é HTTP, e o use case continua sem saber quem pediu.
- **Comparação em tempo constante** (`src/lib/constant-time-equal.ts`, a mesma do Basic Auth do painel, ADR 0011), contra **todos** os segredos, sempre: parar no primeiro que casa diria pelo tempo de qual consumidor é o token. Antes era `===`, que para na primeira diferença.
- **Revogar é tirar a variável:** sem `CHATBOT_INTERNAL_SECRET`, o token do chatbot deixa de valer e os outros consumidores seguem iguais. O log diz qual consumidor entrou (nunca o token), o que mostra se um token ainda está em uso antes de revogá-lo.
- **O schema** exige 32 caracteres no token do chatbot e recusa o mesmo valor do `INTERNAL_SECRET`: repetido, revogar um derrubaria o outro.

## Alternativas

- **O chatbot usar o `INTERNAL_SECRET`**, com a exceção registrada: nenhum código, mas um vazamento do chatbot exigiria trocar o segredo também na interface web e no Sistema Estoque, ao mesmo tempo.
- **Um header `Authorization: Bearer`** no lugar do campo no corpo: é o mais comum, mas mudaria o contrato dos consumidores atuais. O campo continua; mudar de lugar é outra decisão, se um dia valer.
- **Uma lista genérica de tokens** (`RESEARCH_TOKENS=nome:token,...`): escala para muitos consumidores, mas hoje são dois, e o nome no log viria de texto livre do ambiente. Um consumidor novo é uma linha em `CONSUMER_SECRETS` e uma variável.

## Consequences

- Uma variável nova, `CHATBOT_INTERNAL_SECRET`, no `.env` do price-cd, com o **mesmo valor** no `.env` do chatbot.
- Nenhuma mudança para a interface web e o Sistema Estoque.
