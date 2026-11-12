# O resultado da pesquisa volta por webhook assinado com HMAC, numa fila própria

O chatbot pede a pesquisa, recebe `202` e precisa saber como terminou para mostrar a oferta ao Fornecedor. Até aqui o price-cd não avisava ninguém, e nem sabia qual Trade tinha criado: o callback `/trades/from-price-researcher` do Estoque não devolve identificador.

**Decisão:** o pedido ganha três campos (`currency`, `request_uuid`, `webhook_url`). Com `currency`, a Trade é criada **com oferta** no `POST /api/trades` do Estoque, que devolve o uuid. Com `webhook_url`, o Resultado da pesquisa (`trade_created | no_trade | failed`) vai para essa URL **depois** da resposta do Estoque, assinado com HMAC-SHA256, por uma fila BullMQ própria que tenta de novo por ~24h. Um resultado por `request_uuid`.

## Onde cada coisa mora

- **Application:** `RunResearchJobUseCase` é o que o worker da pesquisa executa. Roda a pesquisa e cria a Trade (`CreateResearchTrade`), traduz o desfecho em Resultado da pesquisa e o entrega à porta `ResearchResultNotifier`. A porta `TradeWithOfferCreator` cria a Trade com oferta e falha com dois tipos — `StockUnavailableError` e `TradeRejectedError` —, que viram o `failure.kind` sem a Application conhecer status HTTP. A política do pedido repetido é do `EnqueueResearchGamesUseCase` (abaixo). A allowlist é uma regra pura (`webhook-target.ts`).
- **Infrastructure:** `HttpTradeWithOfferCreator` (o contrato do Estoque), `BullmqWebhookQueue` (a entrega), `HttpWebhookSender` + `webhook-signature.ts` (`node:crypto`).
- **Nest:** o schema valida os campos e as regras entre eles; o controller recusa os campos sem token; o filter da rota transforma `InvalidResearchRequestError` no 400 dela.

## HMAC, não Bearer

O pedido do chatbot propunha `Authorization: Bearer <segredo>`. Recusado: o segredo viajaria em toda chamada, e qualquer proxy ou log que guardasse cabeçalhos o entregaria a quem quisesse forjar um `trade_created` — que faria o chatbot mostrar ao Fornecedor uma oferta que não existe. Com HMAC o price-cd manda só `sha256=HMAC(segredo, "<timestamp>.<corpo>")`; quem recebe refaz a conta. Ganha-se também integridade do corpo e proteção contra reenvio (o timestamp é assinado; quem recebe recusa o velho). O custo é do lado de quem recebe: assinar o **corpo bruto** e comparar em tempo constante — o README traz a função de referência. É o modelo de GitHub e Stripe. Combinado com o dono do chatbot antes de implementar (o receptor ainda não existia).

## A URL vem do pedido: allowlist

Sem lista, quem mandasse `webhook_url: http://redis:6379/` faria o price-cd, que está dentro da rede interna, chamar o que quisesse (SSRF). `WEBHOOK_ALLOWED_HOSTS` lista os hosts aceitos (igualdade exata, sem sufixo; a porta não conta). Conferido no pedido (400) e de novo no envio — o pedido sobrevive a deploys, e a lista pode ter mudado. Redirect nunca é seguido: levaria a um host que a lista não viu. Vazio, nenhum webhook é aceito; com algum host, `WEBHOOK_SIGNING_SECRET` (≥ 32 caracteres) é obrigatório, em qualquer ambiente.

## A rota do Estoque é escolhida por `currency`; o webhook exige `currency`

Quem precisa de moeda é o `/api/trades`; o aviso é independente. Mas só o `/api/trades` devolve o uuid que o `trade_created` informa — por isso `webhook_url` exige `currency`. Sem os campos novos, nada muda. `currency` exige `steam_id` SteamID64: é a regra do Estoque, conferida aqui para virar 400 na hora e não um `failed` minutos depois. Os campos novos sem token são 400, não o demo de sempre: quem os manda espera Trade e aviso, e um `200` demo seria uma resposta que ninguém lê.

## Um resultado por `request_uuid`

`request_uuid` é o `jobId` nas duas filas: a BullMQ ignora um segundo `add` com o mesmo id enquanto o primeiro existe (7 dias concluído, 30 falho). Só isso tornaria silencioso um reenvio legítimo — o chatbot reenvia pedidos ao subir (ADR 0003 dele) —, então o `EnqueueResearchGamesUseCase` olha antes:

| O primeiro pedido está | O reenvio |
|---|---|
| na fila ou rodando | não faz nada: o primeiro vai avisar |
| concluído | reentrega o resultado guardado, com as tentativas zeradas, sem pesquisar — pesquisar de novo poderia criar outra Trade. Sem resultado guardado e com `webhook_url` no reenvio, responde 400: um `202` prometeria um aviso que nunca sai |
| falho | apaga o registro e o aviso `failed` e roda de novo: quase sempre nada foi criado. Se o aviso não puder ser apagado (entrega em andamento), o pedido recebe erro e nada roda, senão o resultado novo seria ignorado |
| desconhecido (expirou) | roda |

**Alternativas:** `409` para pedido já visto (o chatbot teria de tratar mais um caso, e perderia o resultado se o webhook tivesse se perdido); sempre pesquisar de novo (Trade duplicada enquanto o Estoque não é idempotente).

## O `failed` não vaza o erro interno

`failure.message` é uma frase fixa por `kind`. O texto do erro (Cloudflare, URL do Estoque, corpo do 422) fica no log e no `failedReason` do job: o resultado sai do price-cd para outro sistema, que pode mostrá-lo ao Fornecedor. `scrape_failed` é o tópico que não pôde ser lido; `pricing_failed` é falha em que repetir às cegas não é seguro nem útil (pesquisa, 422, `201` sem uuid legível); `stock_unavailable` é o Estoque sem responder como deveria (503, timeout, outro erro).

## O `failed` sai da fila, não do runner

Só a fila sabe que um pedido falhou de vez, e nem toda falha passa pelo runner: um job acima do limite de travamentos (OOM repetido) ou com payload ilegível nunca chega lá, e o chatbot ficaria sem resposta depois do `202`. Por isso o `run` só propaga, e o adapter chama `reportFailure` no evento `failed` do worker. A classificação continua na Application; a fila só diz quando.

- **Cobertura:** o evento dispara nos três casos. Passado o limite, o script de travados não marca o job como falho: grava a falha adiada (`defa`) e o devolve à espera, e o worker, ao pegá-lo, o falha sem chamar o processador, pelo mesmo `handleFailed` (conferido no fonte da BullMQ 5.81 e num teste contra Redis real). Por isso não foi preciso `QueueEvents`, que custaria mais uma conexão.
- **Ordem:** o evento sai depois do `moveToFailed`, então um reenvio motivado pelo aviso encontra `failed` e roda de novo. Antes o aviso saía com o job `active`, e um reenvio rápido via `pending` e era engolido.
- **Uma origem só:** nada a deduplicar entre runner e fila. O `run` nunca monta um `failed`: até a Trade criada sem uuid num pedido com webhook (pedido montado à mão) vira erro que propaga.
- **Payload ilegível:** o alvo é lido à parte e campo a campo (`readResearchFailureTarget`), sem exigir o resto do pedido. Sem `requestUuid` legível, vale o id do job, que o `enqueue` fez igual a ele.
- **Custo:** o aviso agora é guardado depois de o job falhar. Para não perdê-lo numa reinicialização do Redis, o `notify` tenta de novo por ~15s (`NOTIFY_RETRY_DELAYS_MS`), acima do teto de 5s da reconexão do produtor; repetir é seguro pelo `jobId`. O desligamento espera o aviso em andamento por até 10s, depois de fechar o worker e antes de o produtor do webhook fechar. Ainda se perde com processo morto nesse intervalo ou Redis fora por mais que isso: fica no log, e sobra o alarme do chatbot. Antes era o inverso: o aviso existia e o job podia não ter falhado.
- **Corrida inversa:** um reenvio que chegue depois de o job falhar e antes de o aviso ser guardado apaga um aviso que ainda não existe e roda de novo; o `failed` atrasado ocupa então o `jobId`, e o resultado da segunda execução é ignorado. Exige reenviar em milissegundos sem ter recebido aviso nenhum, então não ganhou código; quem pediu reenvia de novo depois do `failed` e recebe o resultado da execução nova.
- **Reenvio dentro do handler do webhook:** a entrega ainda está em andamento, o `forget` do aviso lança, e quem reenviou recebe erro em vez de um `202` vazio. Precisa repetir depois de responder.

## Desligamento não é resultado

Fechar o browser **não** derruba a pesquisa: o `gotoWithRetry` engole o erro e cada jogo restante vira falha de catálogo. Sem cuidado, o job já devolvido à fila (ADR 0009) terminaria "com sucesso" e criaria uma Trade com a lista pela metade, e rodaria de novo no boot. O worker passa ao runner um `AbortSignal` e o aborta **antes** de devolver o job; o `CreateResearchTrade` confere o sinal logo depois de pesquisar e lança `ResearchCancelledError` sem chamar o Estoque. Essa falha vira `DelayedError` no adapter, que a BullMQ não trata como falha: o job não passa pelo aviso de `failed`. A Application vê só `{ aborted: boolean }`, não o tipo da plataforma.

## Falha do catálogo não é "nada passou"

`no_trade` é uma resposta definitiva: o pedido fica `completed` e os reenvios só a reentregam. Por isso a porta `PriceFetcher` devolve também quem o catálogo não pôde responder. Se nenhum jogo passou e ao menos um não foi respondido, o pedido falha (`pricing_failed`) e pode rodar de novo; o que já foi pesquisado está no cache. Com falha parcial e algum jogo aprovado, a Trade nasce com o que deu certo: perder uma lista de 50 jogos por um timeout custaria mais que a Trade menor, e quem ficou de fora vai para o log.

## Pesquisa a partir do link: mesma fila, mesmo resultado

`POST /api/games/research/from-topic` recebe o link do tópico em vez da lista. O job é o mesmo, com uma etapa antes: o `RunResearchJobUseCase` lê o `.have` e segue como um pedido com `gameNames`. A raspagem fica **dentro do job**, não na requisição, porque ela abre um navegador e pode esperar um desafio da Cloudflare; a rota só valida e responde `202`, e a falha chega como `failed` com `kind: scrape_failed`.

- **Formato do job:** a fila guarda `ResearchGamesRequest | TopicResearchRequest`, separados pela presença de `topicUrl`. Sem campo de tipo, porque os jobs já guardados no Redis não o têm.
- **`inactive` ≠ `unreadable`:** o `ListTopic` ganhou `unreadable` (HTTP de erro, página sem `.have`). Antes o HTTP de erro virava `inactive`, e `scrape_failed` nunca apareceria. O Reabastecimento pula os dois, como antes.
- **Tópico inativo é pesquisado:** foi o próprio Fornecedor que mandou o link, então a Lista vale mesmo fechada. O `fetchList` lê o `.have` também do tópico fechado, mantendo o status `inactive`, e o Reabastecimento continua pulando esses. Tópico fechado mantém a Lista na página, com o aviso amarelo (`div.notification.yellow`) no fim. Por isso uma página sem `.have` é sempre `unreadable`, com ou sem aviso: um `no_trade` é definitivo e os reenvios só o repetiriam, e o aviso sozinho não prova que a página é um tópico.
- **Preset `lists`:** o mesmo pipeline do Reabastecimento. A rota não aceita preset nem filtros.
- **Sem demo:** token errado é `401`, por um guard, antes da validação do corpo: quem não tem o token não recebe as regras dos campos. O erro segue o formato do filter global. A rota não tem legado para preservar.
- **O link é validado no Domain** (`parseSteamTradesTopicUrl`): o navegador do price-cd vai abri-lo, e ele vem do corpo da requisição. Compara a origem depois do parser, porque conferir o prefixo aceitaria `https://www.steamtrades.com@evil.io/...`. Conferido na requisição e de novo no `ReadTopicGames`, como o webhook: o pedido pode ter vindo pela fila de outra versão.
- **O navegador é por leitura**, fechado antes de a pesquisa de preço começar. A `TrackedListTopicFetcherFactory` é a dona dos que estão abertos e os fecha no desligamento; um fetcher descartado recusa abrir outro.
- **Uma página é o pedido inteiro:** `loadPage` repete timeout e 429 (`gotoResponseWithRetry`), porque aqui uma falha passageira viraria `scrape_failed`.

**Alternativas:** raspar na requisição (o `202` passaria a depender do SteamTrades e da Cloudflare); um job próprio de raspagem que enfileira a pesquisa (dois jobs por pedido, e o `request_uuid` só pode ser `jobId` de um deles).

## Entrega: fila própria, ~24h

A fila `webhooks` fica no mesmo Redis da pesquisa (banco 1). Separada porque o ritmo é outro: sem navegador, concorrência 5, e um aviso esperando o chatbot voltar não segura a próxima pesquisa. 31 tentativas, 30s dobrando até 1h (`backoffStrategy` do Worker — a BullMQ passa `attemptsMade + 1`, conferido no código dela e num teste contra Redis real): a última sai ~24h depois da primeira, o prazo pedido pelo chatbot. Só `2xx` é entregue. O destino que deixou de ser permitido, ou um payload ilegível, desiste na hora (`UnrecoverableError`). Sem `QUEUE_REDIS_URL` (só fora de produção), uma tentativa em memória.

## Janelas conhecidas, todas fechadas pela idempotência do Estoque

- O Estoque cria a Trade e a resposta não chega (timeout): `stock_unavailable`; reenviado, o pedido roda de novo e pode criar outra.
- A Trade é criada e o resultado não pode ser guardado (Redis fora por mais que as tentativas do `notify`): se o Redis voltar a tempo de o job ser marcado falho, quem pediu recebe `pricing_failed` com a Trade já existindo; reenviado, roda de novo. Se ficar fora por mais que o lock do job (30s), a BullMQ nem consegue marcá-lo falho: o lock expira, o job volta como travado e roda de novo **sozinho**, sem reenvio, criando outra Trade.
- O sinal de desligamento chega com o Estoque já sendo chamado: a Trade nasce e o job roda de novo; o segundo aviso é ignorado pelo `jobId`, e o chatbot fica com a primeira Trade.
- O Estoque responde `201` sem `uuid` legível: `pricing_failed`, para não convidar à repetição; reenviado mesmo assim, roda de novo e pode criar outra.

O Estoque receber `request_uuid` como `pricing_request_id` (item 2 do backlog dele) fecha as quatro. Até lá o price-cd não manda o campo, e o critério de aceite do chatbot, um resultado lógico por `request_uuid`, não está garantido nessas janelas. É o item 22 do `docs/IMPROVEMENTS.md`. Paliativo descartado: gravar o `tradeUuid` no job antes de guardar o aviso encurta a janela, mas não fecha.

## Consequences

- Duas variáveis novas: `WEBHOOK_ALLOWED_HOSTS` e `WEBHOOK_SIGNING_SECRET`, no `.env` (não no `docker-compose.yml`: são de configuração, não de topologia). O host do chatbot precisa ser alcançável pelo container do price-cd.
- O contrato do `POST /api/games/research` cresce: três campos e cinco casos de 400, travados em `test/contract/contract-cases.ts`. Sem eles, nada muda.
- `redis-cli -n 1 KEYS 'bull:webhooks:*'` mostra as entregas; o histórico segue a mesma retenção da pesquisa.
- A interface web e a pesquisa de bundle continuam sem aviso de falha (item 4 do `docs/IMPROVEMENTS.md`).
