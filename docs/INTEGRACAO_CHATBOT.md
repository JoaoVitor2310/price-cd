# Pedido do chatbot ao price-cd

> Escrito no repositório do chatbot (`chatbot-steam`) em 2026-10-28, a partir do código do price-cd no commit `50f439d`. Para importar no price-cd. Os formatos abaixo são **proposta**: o formato técnico é decisão do price-cd, desde que cumpra o que está em "O que o chatbot precisa". Se o código divergir deste texto, o código vence.

> **Duas partes.** Até "Critérios de aceite" é o pedido do chatbot, idêntico a `docs/handoff/price-cd.md` do `chatbot-steam` em 2026-11-03 — não editar, para continuar comparável com a origem. A seção [Plano no price-cd](#plano-no-price-cd) é a resposta do price-cd: o que o código confirma, onde discordamos e o roteiro dos PRs. Essa parte é **viva**: atualize-a a cada PR, e remova o arquivo quando o PR 3 entrar (o que sobrar de decisão vai para ADR, README e `CONTEXT.md`).

Vocabulário: o chatbot chama de **Supplier** quem o price-cd chama de **Fornecedor**. **Trade** é a proposta no Sistema Estoque.

## Contexto

O chatbot conversa pela Steam com os Suppliers. Quando um Supplier manda uma lista de jogos (ou o link de um tópico do SteamTrades) pelo chat, o chatbot pede ao price-cd que precifique. O price-cd pesquisa, manda os jogos ao Sistema Estoque, que decide a oferta e cria a Trade, e o chatbot mostra a oferta ao Supplier.

Hoje isso não fecha por três motivos, todos no price-cd:

1. **Ninguém fica sabendo que terminou.** `POST /api/games/research` enfileira e responde na hora; ao terminar, nada avisa quem pediu. Uma falha só vai para o log (`EnqueueResearchGamesUseCase`: "não há ninguém aguardando a resposta neste ponto").
2. **A fila está em memória.** Um reinício ou deploy perde os pedidos em andamento sem aviso.
3. **O price-cd não sabe qual Trade criou.** `HttpGameTradeImporter` descarta o corpo da resposta do Estoque (`response.body?.cancel()`).

Decisão do lado do chatbot: ADR 0003 do `chatbot-steam` ("Estado próprio em SQLite e webhook do price-cd").

## O que o chatbot precisa

### 1. Webhook ao terminar a pesquisa

Ao pedir a pesquisa, o chatbot manda um **uuid do pedido** (gerado por ele) e a **URL do webhook**. Ao terminar, o price-cd chama essa URL **sempre**, com um de três resultados:

| Resultado | Quando | Dado extra |
|---|---|---|
| `trade_created` | O Estoque criou a Trade | uuid da Trade |
| `no_trade` | Nenhum jogo passou nos filtros, ou o Estoque não criou Trade (nada lucrativo, tudo encalhado) | nenhum |
| `failed` | Erro na raspagem, na pesquisa ou ao chamar o Estoque | tipo da falha e mensagem |

Regras:

- O webhook só é chamado **depois** da resposta do Estoque: com `trade_created`, a Trade já existe.
- **Tentativas com espera crescente** quando o chatbot responder diferente de 2xx ou não responder (o chatbot pode estar reiniciando). Sugestão: até 24 horas.
- O chatbot é idempotente pelo uuid do pedido: repetir o webhook é seguro.
- Autenticação por um segredo **do chatbot** (variável nova, ex.: `CHATBOT_WEBHOOK_SECRET`), nunca o `INTERNAL_SECRET` ou o `EXTERNAL_SECRET` do price-cd.
- O tipo da falha distingue **falha ao ler o link do SteamTrades** das demais, porque o chatbot mostra uma mensagem própria para ela.

Proposta de corpo:

```http
POST {webhook_url}
Authorization: Bearer {CHATBOT_WEBHOOK_SECRET}
Content-Type: application/json

{ "request_uuid": "8c1f…", "result": "trade_created", "trade_uuid": "3a9e…" }
{ "request_uuid": "8c1f…", "result": "no_trade" }
{ "request_uuid": "8c1f…", "result": "failed", "failure": { "kind": "scrape_failed", "message": "…" } }
```

`failure.kind` sugerido: `scrape_failed`, `pricing_failed`, `stock_unavailable`.

### 2. Novos campos na pesquisa (`POST /api/games/research`)

Além do que já existe (`gameNames`, `steam_id`, `internal_secret`, ...):

- `request_uuid`: uuid do pedido, devolvido no webhook.
- `webhook_url`: para onde mandar o resultado.
- `currency`: `tf2`, `eur` ou `usd`, a moeda que o Supplier escolheu no chat. O price-cd repassa ao Estoque ao criar a Trade.

Sem `webhook_url`, o comportamento atual continua igual (compatível com quem já usa a rota).

O price-cd **não precisa saber que o pedido veio do chatbot**. `request_uuid` e `webhook_url` viajam com o job (na fila persistente, item 4) do começo ao fim; ao terminar, se o job tem `webhook_url`, o price-cd chama essa URL com o `request_uuid`. Qualquer outro consumidor futuro que mande uma URL recebe o mesmo aviso.

Cada linha de `gameNames` vem **como o Supplier escreveu**, com a região no fim quando houver (`Rust ROW`). O chatbot não separa região; conta com o algoritmo do price-cd. **A confirmar no price-cd:** uma linha `Jogo EU` chega à Trade com `region: EU`.

O chatbot limita a lista digitada no chat a 75 linhas, mas **não há limite** do lado do chatbot para o link (ver item 3).

### 3. Pesquisa a partir de um link do SteamTrades (endpoint novo)

O Supplier pode mandar o link do próprio tópico em vez de digitar a lista. O chatbot só confere o prefixo `https://www.steamtrades.com/`.

- Recebe o link, `steam_id`, `currency`, `request_uuid` e `webhook_url`.
- Raspa a seção `.have` **inteira** e precifica **todos** os jogos (sem teto).
- Usa o código do tópico como `list_code` ao criar a Trade.
- Responde na hora que aceitou; o resultado vai pelo mesmo webhook. Falha na raspagem vira `failed` com `kind: scrape_failed`.
- Não confere de quem é o tópico.

A raspagem do `.have` já existe na descoberta de Suppliers e deve poder ser reaproveitada.

### 4. Fila persistente

Para um reinício ou deploy não perder pedidos:

- Fila persistente para as pesquisas (sugestão: **BullMQ com Redis**, persistência do Redis ligada). Um pedido interrompido volta a rodar quando o serviço sobe.
- O envio do webhook também como tarefa da fila, com as tentativas do item 1.
- Fica de quebra um registro das execuções (o que rodou, quando, com que erro).
- **Parada ordenada no SIGTERM:** dentro do `stop_grace_period` do Docker, o pedido em andamento volta para a fila em vez de se perder.

O chatbot tem um prazo de 6 horas como alarme: se nenhum webhook chegar, ele avisa o Supplier e a equipe. A fila persistente faz esse alarme quase nunca disparar.

## Onde criar a Trade: `POST /api/trades` do Estoque (já existe)

O Estoque já tem a rota para as precificações pedidas pelo chatbot (implementada em 2026-10-30; contrato em `docs/PRICE_RESEARCHER.md` e `docs/CHATBOT.md` do Estoque). É **diferente** de `/trades/from-price-researcher`, que continua sendo o destino das listas e da pesquisa de bundle.

- Corpo: `supplier_steam_id`, `games[]` (mesma forma do callback), `currency` (`tf2`, `eur`, `usd`), `list_code` e `title` opcionais. Autenticação: o mesmo Bearer `EXTERNAL_SECRET`.
- Como cada resposta vira o webhook:

| Resposta do Estoque | Webhook ao chatbot |
|---|---|
| `201 { uuid, created_at, currency }` | `trade_created` com `trade_uuid` = `uuid` |
| `200 { created: false }` (nada a ofertar, Supplier bloqueado) | `no_trade` |
| `503` (sem cotação da TF2 em euro), outro erro, timeout | `failed` com `kind: stock_unavailable` |
| `422` (corpo inválido) | `failed` com `kind: pricing_failed` |

Ou seja: quando o pedido tem `webhook_url`, o price-cd cria a Trade em `POST /api/trades` e lê a resposta, em vez de chamar `from-price-researcher` e descartá-la.

## PRs sugeridos no price-cd

| # | PR | Depende de |
|---|---|---|
| 1 | Fila persistente (BullMQ + Redis) para `research`, com parada ordenada no SIGTERM | nada |
| 2 | `request_uuid`, `webhook_url` e `currency` em `research`; webhook ao terminar com os três resultados e tentativas; criar a Trade em `POST /api/trades` e ler a resposta | 1 |
| 3 | Endpoint novo: pesquisa a partir do link do SteamTrades, com o mesmo webhook | 2 |

## Critérios de aceite

- Pedido com `webhook_url` gera exatamente um resultado lógico por `request_uuid` (o webhook pode repetir, o resultado não muda).
- Reiniciar o price-cd no meio de uma pesquisa não perde o pedido: ele termina e chama o webhook.
- Chatbot fora do ar no fim da pesquisa: o webhook é repetido até o chatbot responder 2xx (ou desistir após o limite).
- Nenhum preço de mercado, popularidade ou margem vai no webhook: só o resultado e o uuid da Trade.
- Sem `webhook_url`, `research` continua como hoje.

---

# Plano no price-cd

> Levantado em 2026-11-03 sobre o `main` em `50f439d`, conferindo também o código do `sistema-estoque-jogos-cd` e do `chatbot-steam`. Status de cada PR na tabela abaixo; marque aqui ao abrir e ao mergear.

## O que o código confirma

| O pedido diz | O código diz |
|---|---|
| Ninguém fica sabendo que terminou | Confirmado. `EnqueueResearchGamesUseCase` engole o erro no `catch` e só loga. |
| A fila está em memória | Confirmado. `LimitedConcurrencyScheduler` é um array. Já é o item 9 do `docs/IMPROVEMENTS.md`. |
| O price-cd não sabe qual Trade criou | Confirmado. `HttpGameTradeImporter` faz `response.body?.cancel()`; a porta `GameTradeImporter.import()` devolve `Promise<void>`. |
| **A confirmar:** `Jogo EU` chega à Trade com `region: EU` | **Sim.** `withPrice` (`application/games/services/cached-price-fetcher.ts`) grava `getRegion(name).toUpperCase()` e tira a região do nome. Jogo global vai como `region: ""`, não `null` — o Estoque já usa `""` como "key global" (`docs/CHATBOT.md` de lá) e aceita (`games.*.region` é `nullable|string`). |
| "Nenhum jogo passou nos filtros" vira `no_trade` | Hoje, com zero jogos precificados, o `ResearchGamesUseCase` nem chama o Estoque e devolve `null`. Precisa virar desfecho explícito. |
| Raspagem do `.have` reaproveitável | Existem **duas**: `FetchListTopic.fetchList` (fluxo `lists`, browser próprio por execução, `steamTradesGate`) e `PuppeteerTopicScraper` (Descoberta, sessão **logada** do SteamTrades). As duas usam `HaveListing`, que descarta seções de GOG — "todos os jogos" é "todos os jogos de Steam". |

Do lado do Estoque (`StoreTradeWithOfferRequest` e `TradeController::store`):

- `supplier_steam_id` é **obrigatório e precisa ser SteamID64**; em `research` o `steam_id` hoje é opcional e livre.
- `currency` é opcional lá; a resposta `201` traz a moeda **efetiva** (TF2 quando não havia cotação na pedida).
- `503` vem de `CurrencyPriceUnavailable`; `422` é a validação do Laravel.
- **Não há idempotência.** É o item 2 do `docs/IMPROVEMENTS.md` do Estoque, que já propõe receber `pricing_request_id` (uuid) com índice único e devolver a Trade existente na repetição.

## Onde o price-cd diverge da proposta

1. **Segredo do webhook não pode ir para uma URL do corpo da requisição.** Mandar `Authorization: Bearer {CHATBOT_WEBHOOK_SECRET}` para qualquer `webhook_url` recebida entrega o segredo a quem mandar uma URL própria, e faz o price-cd chamar endereços arbitrários de dentro da rede interna (SSRF). Proposta:
   - assinar o corpo com HMAC-SHA256 (`X-Signature: sha256=…` + `X-Timestamp`), como GitHub e Stripe — o segredo nunca trafega;
   - lista de hosts permitidos (`WEBHOOK_ALLOWED_HOSTS`), validada no recebimento do pedido (400) e de novo no envio;
   - o nome da variável fica neutro (`WEBHOOK_SIGNING_SECRET`): o próprio pedido diz que o price-cd não sabe que o chamador é o chatbot.
   **Pendente:** combinar com o chatbot.
2. **"Exatamente um resultado por `request_uuid`" não sai só da fila.** `jobId = request_uuid` impede pedido duplicado, mas se o processo cair depois de o Estoque criar a Trade e antes de o webhook ser enfileirado, o job roda de novo e cria **outra Trade**. A correção é a idempotência do Estoque (item 2 do backlog dele): o price-cd manda `request_uuid` como `pricing_request_id`. Paliativo do lado do price-cd: gravar o `tradeUuid` no próprio job (`job.updateData`) antes de enfileirar o webhook e pular a criação na nova execução — encurta a janela, não fecha. **Pendente:** o Estoque implementar o item 2 (bloqueia o critério de aceite, não o PR 2).
3. **A rota do Estoque é escolhida por `currency`, não por `webhook_url`.** Quem exige moeda é o `/api/trades`; o aviso por webhook é independente. `currency` presente → `POST /api/trades` lendo a resposta; ausente → `/trades/from-price-researcher` como hoje.
4. **A parada ordenada não "devolve o job à fila" sozinha.** O `docker-compose.yml` não define `stop_grace_period` (vale o default de 10s) e uma pesquisa leva minutos. O `worker.close()` do BullMQ espera o job atual **terminar**. O caminho real: no SIGTERM, fechar o worker sem esperar (`close(true)`), o lock do job expira e o BullMQ o detecta como *stalled* e o recoloca na fila ao subir. Ajustar `maxStalledCount` (default 1 — um segundo travamento falha o job) e declarar `stop_grace_period`. Ordem de desligamento: parar de consumir a fila **antes** de fechar os browsers.

## Roteiro dos PRs

| # | PR | Depende de | Status |
|---|---|---|---|
| 1 | Fila persistente para `research` (BullMQ no Redis do cache, banco 1), parada ordenada | nada | implementado na branch `feat/durable-research-queue`, aguardando commit |
| 2 | `request_uuid` / `webhook_url` / `currency`; Trade em `POST /api/trades` lendo a resposta; webhook com os três resultados e tentativas | 1 | a fazer |
| 3 | Endpoint novo: pesquisa a partir do link do SteamTrades | 2 | a fazer |

### PR 1 — Fila persistente

- **Application:** porta nova `ResearchQueue` (`application/games/ports/`), com `enqueue(request: ResearchGamesRequest)`. A `BackgroundScheduler` recebe uma closure, que não serializa; `lists` e `suppliers` continuam nela por enquanto (o pedido só cobre `research`). `ResearchGamesRequest` e `SearchCriteria` já são só dado.
- **Infrastructure:** `infrastructure/background/bullmq-research-queue.ts` (produtor) e o worker que chama o `ResearchGamesUseCase`, concorrência 1 (o gargalo é a sessão única do Chromium).
- **Nest:** módulo de fila, dono da conexão e do worker, com `OnApplicationShutdown`. `EnqueueResearchGamesUseCase` passa a enfileirar dado, não função.
- **Redis:** instância **separada** do cache. O do cache roda com `--save "" --appendonly no` e `allkeys-lru` (ADR 0008): perderia job no restart e por despejo. A fila precisa de AOF + `noeviction`. Serviços `redis-queue` (prod) e `redis-queue-dev`, na rede `price-cd-internal`.
- **Env:** `QUEUE_REDIS_URL` (no `docker-compose.yml`, pelo mesmo motivo do `REDIS_URL`). Sem ela: manter o scheduler em memória (fail-open, como o cache) ou recusar o boot em produção — decidir no ADR.
- **Health:** `queue: "up" | "down" | "disabled"` no `/api/health`.
- **Registro de execuções:** `removeOnComplete` / `removeOnFail` por idade, não por contagem.
- **Docs:** ADR 0009 (fila durável, Redis separado, comportamento sem Redis); remover o item 9 e reescrever o item 4 do `IMPROVEMENTS.md` (o `research` deixa de perder job; `lists` continua); seção "Background jobs" do `CLAUDE.md`; README (status `queued` agora é durável).
- **Testes:** use case com fila fake; adapter com Redis mockado; módulo Nest com o worker; desligamento na ordem fila → browser.

**Como ficou** (decisões em `docs/adr/0009-fila-duravel-da-pesquisa.md`):
- Pergunta 5 respondida: sem `QUEUE_REDIS_URL`, **o boot falha em produção**; em dev e teste é a fila em memória.
- BullMQ **5.81**, não 6: a 6 tem três meses, e no build ESM dela a conexão por opções depende de `require('ioredis')`.
- Redis da fila fora do ar: a pesquisa autenticada responde **500** na hora (o `add` da BullMQ ficaria pendurado esperando a conexão; o adapter confere antes).
- Parada ordenada: `moveToDelayed` no `beforeApplicationShutdown`, sem consumir tentativa; `stop_grace_period: 60s`. Verificado contra Redis real (`test/integration/queue/`, opcional) e um job sobreviveu a `docker restart` do Redis com AOF.
- `attempts: 1`, sem retry automático, até o Estoque ser idempotente (divergência 2). A janela "SIGTERM com a chamada ao Estoque em voo" continua aberta pelo mesmo motivo.
- **Redis:** começou como uma instância separada (`redis-queue`) e foi unificado com o do cache: um `redis` só, com AOF e `noeviction`, cache no banco 0 e fila no 1. O cache cabe sem despejo porque toda entrada expira em 1h (ADR 0009, "Um Redis só"). A linha "Redis" do roteiro acima descreve a proposta original.
- `lists` e `suppliers` ficaram em memória (item 9 do `IMPROVEMENTS.md`).
- Retomada: o job recomeça inteiro, mas o cache de preço passou a ser gravado jogo a jogo, então o AllKeyShop só pesquisa o que faltava (ADR 0009, "O que a retomada reaproveita").
- Code review aplicado: dev sobe com `node` direto (o `npm run` engolia o SIGTERM); payload do job preserva campos não declarados (o `webhookUrl` do PR 2 não some no caminho); job que não pôde ser devolvido e terminou completa normalmente (não cria Trade duplicada); reconexão do produtor com teto de 5s; erro tipado `ResearchQueueUnavailableError` na porta.

### PR 2 — Webhook, `currency` e `POST /api/trades`

- **Schema** (`schemas/game.schema.ts`): `request_uuid` (uuid), `webhook_url` (URL, host na allowlist), `currency` (`tf2 | eur | usd`). Regras cruzadas:
  - `webhook_url` exige `request_uuid`;
  - `currency` exige `steam_id` no formato SteamID64 (senão o Estoque responde 422 e a falha vira `pricing_failed` evitável);
  - `webhook_url` com `delivery: "respond"` é 400; sem token é 400 também (demo é síncrono, não há o que avisar). **Atenção:** hoje token errado é demo 200 por contrato — o 400 vale só quando vierem os campos novos.
- **Porta de Trade:** `TradeCreator.create() → TradeOutcome` (`{ status: "created", tradeUuid } | { status: "not_created" }`). Resolve junto o item 2 do `IMPROVEMENTS.md` (o verbo "importar"). Adapter HTTP para `/api/trades`; os erros viram tipos da Application (`StockUnavailableError` para 503, timeout e outros; `TradeRejectedError` para 422).
- **Orquestração:** `RunResearchJobUseCase` (Application) roda a pesquisa, transforma o desfecho em `trade_created | no_trade | failed` e enfileira o webhook. Zero jogos precificados é `no_trade` sem chamar o Estoque. O webhook sai **depois** da resposta do Estoque.
- **Webhook:** fila própria (`webhooks`), sem browser, concorrência maior. Backoff exponencial **com teto** (ex.: 30s dobrando até 1h, totalizando ~24h), job com `jobId = request_uuid`. Adapter `HttpWebhookNotifier`, que assina com HMAC e só aceita 2xx como entregue.
- **Classificação de falha:** `scrape_failed` (só no PR 3), `pricing_failed` (erro do pipeline, 422 do Estoque), `stock_unavailable` (503, timeout, outro erro). Falha de **um jogo** no AllKeyShop (`failed` do `CatalogPriceSource`) não falha o pedido: o jogo só não entra. Browser morto ou Cloudflare definitivo falham o pedido.
- **Env:** `WEBHOOK_SIGNING_SECRET`, `WEBHOOK_ALLOWED_HOSTS`.
- **Docs:** README (campos novos, regras de 400, contrato do webhook, cabeçalhos da assinatura); ADR 0010 (contrato e autenticação do webhook); `CONTEXT.md` (Pedido de pesquisa, Resultado da pesquisa, Moeda da Trade); `docs/wiki/`.
- **Testes:** schema (combinações válidas e inválidas); use case por desfecho; adapter com cada status do Estoque; webhook (assinatura, retry, desistência); caso de contrato garantindo que o corpo sem os campos novos responde como hoje.

### PR 3 — Pesquisa a partir do link do SteamTrades

- **Rota:** `POST /api/games/research/from-topic`, 202. Corpo: `topic_url`, `steam_id`, `currency`, `request_uuid`, `webhook_url`, `internal_secret`. O host é validado como exatamente `www.steamtrades.com` e o caminho como `/trade/{code}/…` — o Puppeteer vai navegar nessa URL, então prefixo não basta.
- **Domain:** extrair o código do tópico (`/trade/{code}/slug` → `code`) em função pura, perto de `ListTopic` (`domain/lists/`). Vira o `list_code` da Trade.
- **Raspagem:** reaproveitar `FetchListTopic.fetchList` (não precisa da sessão logada). Hoje ele devolve `inactive` para HTTP não-200 (`loadPage` → `null`): precisa distinguir "tópico inativo" de "não consegui ler", senão `scrape_failed` nunca aparece.
- **Sem teto:** um tópico só, então `MAX_ACTIVE_LISTS` não se aplica; sem limite de jogos.
- **Job:** o mesmo da PR 2, com uma etapa de raspagem antes; falha nela é `scrape_failed`.
- **Docs:** README; `docs/wiki/`; remover este arquivo (ver nota no topo).
- **Testes:** parser do código do tópico; validação de URL (host errado, caminho errado); job com raspagem falha, tópico inativo e tópico ok.

## Perguntas em aberto

| # | Pergunta | Para quem | Bloqueia |
|---|---|---|---|
| 1 | Qual preset nas pesquisas do chatbot? Lista digitada cai no `default` (o chatbot não manda preset); link do tópico faz sentido usar `lists` (mesmo pipeline do Reabastecimento)? | equipe | PR 2, PR 3 |
| 2 | Tópico inativo (`.notification.yellow`) vira `no_trade` ou `scrape_failed`? | chatbot | PR 3 |
| 3 | Assinatura HMAC + allowlist no lugar do Bearer com segredo? | chatbot | PR 2 |
| 4 | Estoque implementa a idempotência (`pricing_request_id`, item 2 do backlog dele)? Nome do campo combinado antes. | Estoque | critério de aceite |
| 5 | ~~Sem `QUEUE_REDIS_URL`: fila em memória ou boot falha em produção?~~ Boot falha em produção; memória fora dela (ADR 0009). | price-cd | resolvida |
