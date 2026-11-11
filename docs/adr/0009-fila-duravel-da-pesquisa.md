# A fila da pesquisa autenticada é durável, em BullMQ sobre o Redis do cache

`POST /api/games/research` autenticado responde `202 queued` e pesquisa em background. A fila era um array em memória (`LimitedConcurrencyScheduler`): um deploy ou um restart com pedidos na fila os descartava em silêncio, depois de quem pediu já ter recebido a confirmação. Para o chatbot, que espera o resultado por webhook (ADR 0010), um pedido perdido é um Supplier esperando até o alarme de 6 horas disparar.

**Decisão:** a pesquisa autenticada passa a ser um job **BullMQ** no **mesmo Redis do cache**, noutro banco lógico, com o servidor reconfigurado para o que a fila exige: AOF ligado e `noeviction`. O pedido é guardado antes do `202`; um pedido interrompido por um desligamento volta para a fila e roda inteiro quando o serviço sobe.

## A porta recebe dado, não uma função

A `BackgroundScheduler` recebe uma closure (`schedule(task: () => Promise<void>)`), e uma closure não sai do processo. A pesquisa ganhou uma porta própria, `ResearchQueue.enqueue(request)`, que recebe o `ResearchGamesRequest`, já só dado (critérios resolvidos, sem dependência). O worker que consome a fila chama o mesmo `ResearchGamesRunner` de antes. O use case de pesquisa não sabe que a fila existe.

`lists` e `suppliers` ficaram na `BackgroundScheduler` em memória neste primeiro passo, e migraram depois pela mesma regra: ver "Reabastecimento e Descoberta" abaixo. A `BackgroundScheduler` saiu da Application; o que sobrou dela é o motor das filas em memória, em `infrastructure/`.

## Um Redis só, com a configuração da fila

O cache (ADR 0008) rodava sem persistência e com `allkeys-lru`. Para a fila, as duas escolhas perdem pedidos: no restart, e por despejo de memória. O servidor passa a ter a configuração da fila: `--appendonly yes --appendfsync everysec` (um restart do Redis perde no máximo ~1s), `noeviction` (cheio, recusa escrita em vez de apagar uma chave) e um volume nomeado para o AOF. O cache fica no banco `0`, a fila no `1`.

O cache convive com isso sem custo. Ele **não precisa de despejo para caber**: toda entrada já é gravada com TTL de 1h e expira sozinha, e o AllKeyShop pesquisa um jogo a cada poucos segundos, então o cache fica em poucos milhares de chaves de ~150 bytes (poucos MB, contra `maxmemory 64mb`). Ir para o disco são poucas escritas por minuto, e o cache passa a sobreviver ao restart do Redis.

`volatile-lru` (despejar só chave com TTL, que pouparia a fila) **não** serve: os locks dos jobs da BullMQ têm TTL, e um lock despejado faz o job parecer travado e rodar de novo — Trade duplicada. É por isso que a BullMQ exige `noeviction` e avisa no boot.

Se o Redis encher mesmo assim, nada se perde: a escrita do cache falha em silêncio (o cache é fail-open) e a pesquisa autenticada responde 500. O dev tem o próprio Redis, com a mesma configuração: um worker de dev na fila de produção consumiria pedidos reais.

**Alternativa considerada: um Redis para cada papel.** Foi a primeira versão deste ADR — isolamento total de memória e nenhum risco de um `FLUSHDB` no banco errado apagar a fila. Descartada por custar um container e um volume a mais para isolar um cache que, medido, ocupa poucos MB. O risco operacional que sobra é o flush: o do cache é `redis-cli -n 0 FLUSHDB` (o `0` é o default do `redis-cli`, então o `FLUSHDB` de antes continua seguro), nunca `FLUSHALL` nem `FLUSHDB` com `-n 1`. As duas variáveis (`REDIS_URL` e `QUEUE_REDIS_URL`) continuam separadas, então voltar a dois servidores é trocar uma URL.

## Sem Redis da fila: memória fora de produção, boot recusado em produção

O cache é fail-open, porque sem ele nada fica errado, só mais lento. A fila não pode seguir a mesma regra: em memória, o `202` volta a ser uma promessa que um deploy quebra, e é exatamente o que este ADR resolve. Por isso `QUEUE_REDIS_URL` é **obrigatória em produção** (o schema do ambiente recusa o boot sem ela). Em dev e teste, ausente é a fila em memória de antes, para mexer numa rota sem subir Redis.

Com a URL configurada e o Redis fora do ar, o pedido é **recusado com 500** na hora, e o `GET /api/health` mostra `queue: "down"`, ainda com status 200: demo, `respond`, `lists` e a Descoberta continuam funcionando. Recusar é melhor que aceitar sem guardar. Um detalhe medido: o `add` da BullMQ **espera** a conexão ficar pronta mesmo com a fila offline do ioredis desligada, e a requisição ficaria pendurada até o Redis voltar. O adapter confere o estado da conexão antes de chamar o `add`, e põe um teto de 5s nele.

## Parada ordenada: o job em andamento volta para a fila

Uma pesquisa leva minutos, e o Docker espera `stop_grace_period` (agora 90s) entre o SIGTERM e o SIGKILL. O `worker.close()` da BullMQ **espera o job terminar**; não serve. O que o adapter faz:

1. No `beforeApplicationShutdown`, que o Nest roda em todos os providers antes de qualquer `onApplicationShutdown` (onde o `BrowserShutdown` fecha o Chromium), o job ativo é devolvido com `moveToDelayed(agora)`. Ele volta para a fila **sem consumir tentativa**.
2. O worker fecha com `close(true)`, sem esperar o processador.
3. O processador segue até o browser fechar e falha. Durante o desligamento, essa falha vira `DelayedError`, que diz à BullMQ para não marcar o job como falho.

Se a devolução falhar (Redis fora no desligamento) ou o processo morrer sem desligar (OOM, SIGKILL), o lock do job expira e o próximo worker o recupera como *stalled*. É mais lento (até ~1 minuto depois do boot) e chega ao mesmo resultado. `maxStalledCount: 2`: um job que derruba o processo duas vezes falha, em vez de entrar em loop.

## Sem nova tentativa automática

`attempts` fica em 1. Repetir uma pesquisa que falhou depois de chamar o Sistema Estoque pode criar uma segunda Trade, e o Estoque ainda não tem idempotência (item 2 do backlog dele). A interrupção por deploy não conta como tentativa (passo 1 acima). Quando o `request_uuid` virar chave de idempotência no Estoque, retry passa a ser seguro e pode ser ligado.

**Janela conhecida:** se o SIGTERM chega enquanto a chamada ao Estoque está em voo e ela termina com sucesso depois de o job ter sido devolvido, o job roda de novo e cria outra Trade. O adapter loga um aviso quando isso acontece. A mesma idempotência fecha essa janela.

## O que a retomada reaproveita

O job volta **inteiro**: não há marcação de progresso dentro dele. O que evita refazer o trabalho é o cache de preço, gravado jogo a jogo (ADR 0008). Na execução seguinte do mesmo pedido:

- **SteamCharts:** consultado de novo para todos os jogos. É `fetch` em lotes paralelos, sem navegador, e não é cacheado.
- **AllKeyShop:** o que já tinha resultado definitivo (preço ou "não tem") vem do cache, se a retomada acontecer dentro do TTL de 1h. O navegador só abre para o que faltava e para o que tinha falhado de forma transitória. Na prática, continua de onde parou.
- **Trade:** só é criada no fim, então a retomada nunca deixa Trade pela metade.

Marcar o progresso no job (`job.updateProgress` com os jogos já pesquisados) foi descartado: duplicaria o cache, só serviria à pesquisa, e o cache já beneficia qualquer fluxo e qualquer pedido que repita o jogo.

## Onde cada parte mora

Tudo em `infrastructure/background/` — a Application só conhece a porta `ResearchQueue` e o tipo `ResearchGamesRequest` —, um arquivo por motivo de mudança:

- `bullmq-research-queue.ts`: o que a fila tem de pesquisa (enfileirar, o job como pedido de pesquisa, o aviso de `failed`, estado para o health).
- `resumable-bullmq-worker.ts`: o consumo de job longo com desligamento ordenado — o sinal abortado, a devolução do job ativo, a tradução em `DelayedError`, a espera do que ainda está sendo guardado. Não sabe o que o job é.
- `bullmq-connection-log.ts`: o log de queda e volta do Redis, uma linha por queda.
- `research-job-payload.ts`: o formato **persistido** do job. Não fica em `src/schemas/`, que é o contrato HTTP: este é o formato de armazenamento, lido pelo worker.
- `bullmq-clients.ts`: a visão estreita da BullMQ que os testes substituem por dublês.
- `bullmq-connections.ts`: as conexões ioredis, a reconexão com teto e o fechamento delas junto com a `Queue` (`closeQueueAndConnections`).
- `src/lib/with-timeout.ts`: o teto de tempo de uma promessa, que o Node não tem pronto (`AbortSignal.timeout()` só serve a quem aceita `signal`).

- `bullmq-job-queue.ts`: a fila dos jobs longos sem nada de pesquisa — o Reabastecimento e a Descoberta —, com `lists-run-job-payload.ts` e `supplier-discovery-job-payload.ts` como formato persistido de cada um.

`resumable-bullmq-worker.ts`, `bullmq-connection-log.ts`, `bullmq-clients.ts` e `bullmq-connections.ts` não falam de pesquisa: são o que a fila da pesquisa e a `BullmqJobQueue` compartilham. A fila de webhooks (ADR 0010) usa o log de conexão e o fechamento, mas não o `ResumableBullmqWorker`: entregar leva segundos, e o desligamento dela espera a entrega em vez de devolvê-la.

## Registro das execuções

Jobs concluídos ficam 7 dias e falhos 30 dias no Redis, com o motivo da falha (`failedReason`). A retenção é por idade, não por contagem, para que uma rajada de pedidos não apague o histórico. Consultar é pelo painel das filas em `/api/admin/queues` (ADR 0011: Bull Board, somente leitura — um *retry* pelo painel duplicaria a Trade) ou com `redis-cli` no banco 1.

## Por que BullMQ 5 e não 6

A 6 saiu em julho de 2026 e passou de 40 patches em três meses. No build ESM dela, passar opções de conexão depende de carregar o `ioredis` com `require`, que não existe em ESM. Só funcionaria entregando um cliente pronto, pelo caminho de adaptação de clientes, que é justamente o mais novo da biblioteca. A 5.81 é a linha madura, com o `ioredis` como dependência direta. A migração para a 6 fica para quando ela estabilizar; o Dependabot vai propor.

## Por que não as alternativas

- **RabbitMQ:** mais um broker para operar, para um processo só que é produtor e consumidor ao mesmo tempo. Reavaliar se outro sistema passar a publicar pesquisas direto na fila.
- **Fila no Sistema Estoque (tabela + polling):** o Estoque tem banco, mas a fila guarda o pedido do price-cd, critérios de pesquisa incluídos. Seria detalhe de execução do price-cd vazando para o sistema principal.
- **Persistir a fila em memória num arquivo:** reinventaria lock, retry e recuperação de job travado.
- **`@nestjs/bullmq`:** acopla o worker a decorators do Nest. Aqui o adapter vive em `infrastructure/` e implementa uma porta da Application, como o resto.

## Reabastecimento e Descoberta

`POST /api/lists/run` e `POST /api/suppliers/find-new` tinham o mesmo problema: um `202` que um deploy desfazia. Cada um ganhou uma porta que recebe dado (`ListsRunQueue`, `SupplierDiscoveryQueue`) e uma fila BullMQ própria no banco 1 (`lists`, `suppliers`), separadas para uma execução longa de uma não segurar as outras.

- **Uma fila genérica, não três cópias.** As duas não têm o que a da pesquisa tem (pedido repetido por `requestUuid`, aviso de `failed`, estado no health), então são o mesmo `BullmqJobQueue<T>`, parametrizado pelo formato persistido de cada uma. O desligamento ordenado é o do `ResumableBullmqWorker`, o mesmo da pesquisa.
- **Onde parar.** O sinal de cancelamento chega aos use cases de execução, e cada um para antes do efeito que não pode repetir. O Reabastecimento para antes de abrir a sessão do AllKeyShop e antes de criar a Trade. A Descoberta para a cada página, a cada tópico e **antes de pedir a decisão ao Estoque**, porque o Estoque grava `last_commented_at` ao responder `should_comment: true`: perguntar e não comentar perderia o comentário. O `catch` por tópico repassa o cancelamento; sem isso, com o browser fechando, o laço falharia tópico a tópico até o fim.
- **Concorrência.** `lists` usa `RUN_LISTS_CONCURRENCY` como concorrência do worker; por isso o `ResumableBullmqWorker` acompanha vários jobs ativos e devolve todos. `suppliers` é 1.
- **Pedido da Descoberta.** A varredura não tem parâmetro; o job guarda `requestedAt`, que mostra quanto ele esperou.
- **Deduplicação só na Descoberta.** A varredura não tem parâmetro, então um pedido feito com outra esperando ou rodando é o mesmo pedido: a `deduplication` da BullMQ, sem `ttl`, o absorve até o job concluir ou falhar, e quem pediu recebe o mesmo `202`. Sem isso, cliques repetidos empilhariam varreduras com a mesma conta do SteamTrades, agora sobrevivendo ao restart. Um `jobId` fixo não serviria: a BullMQ ignora o `add` enquanto o job existe, inclusive concluído, e seria preciso apagar o registro das execuções. O Reabastecimento não deduplica: dois pedidos são dois fornecedores, ou o mesmo pedido de propósito. A fila em memória (sem `QUEUE_REDIS_URL`, só fora de produção) não deduplica: em dev, cliques repetidos empilham varreduras.
- **Conexões próprias.** Cada fila tem as duas conexões dela: o comando bloqueante do worker de uma não segura o de outra. O health continua pingando só a da pesquisa, que é o mesmo servidor.
- **Contrato.** Com o Redis da fila fora, as duas rotas respondem `500` no formato legado de cada uma, em vez de um `202` para um pedido que não foi guardado.
- **Falha.** Fica registrada no job (30 dias) e no log; ninguém é avisado (item 4 do `docs/IMPROVEMENTS.md`).
- **Janelas conhecidas.** A durabilidade troca "o pedido se perde" por "o pedido roda de novo", e rodar de novo tem custo:
  - **Trade duplicada no Reabastecimento:** o deploy chega com o POST ao Estoque em andamento (a Trade nasce, o job já foi devolvido e roda de novo), ou o processo morre (OOM, SIGKILL) depois da Trade e antes de o job concluir (volta como travado e roda de novo; o limite de 2 travamentos é uma repetição implícita). O mesmo vale para a pesquisa, e só a idempotência do Estoque fecha (item 22 do `docs/IMPROVEMENTS.md`).
  - **Comentário perdido na Descoberta:** o desligamento chega com a consulta ao Estoque em andamento. O Estoque grava `last_commented_at` ao responder `should_comment: true`, o browser fecha antes do comentário, e a reexecução recebe `false`. A verificação antes da consulta só impede perguntar **depois** do sinal; a janela é a duração de uma chamada HTTP, aceita.
  - **Chromium depois do cleanup:** nos dois casos acima o job segue rodando depois de devolvido, e as sessões de browser reabrem o Chromium se alguém pedir uma depois do desligamento (item 11 do `docs/IMPROVEMENTS.md`).

## Revê o ADR 0001 num ponto

O ADR 0008 já permitiu ao price-cd guardar dado derivado e descartável. Um job da fila **não** é descartável, mas também não é estado de negócio: é o pedido em trânsito, que deixa de existir quando a pesquisa termina (o histórico é apagado por idade). O que foi decidido e o que foi ofertado continuam sendo do Sistema Estoque.

## Consequences

- O Redis do cache muda de configuração (AOF, `noeviction`) e ganha um volume (`redis-data`; `redis-dev-data` no dev). Um `docker compose down -v` apaga a fila. O primeiro deploy recria o container do Redis e o cache começa vazio uma vez.
- Limpar o cache continua sendo `FLUSHDB` no banco 0 (o default do `redis-cli`; o README escreve `-n 0` explícito). O que apaga a fila é `FLUSHALL`, ou `FLUSHDB` com `-n 1`.
- O `/api/health` ganha o campo `queue: "up" | "down" | "in-memory"`.
- Sem `QUEUE_REDIS_URL` em produção, o app não sobe. O `docker-compose.yml` já a define.
- `stop_grace_period: 90s` nos dois serviços do app.
- O container de dev sobe o app com `node` direto, não `npm run dev`: o npm não repassa o SIGTERM do `docker stop` (medido: o app morria em 0,2s, sem rodar os hooks).
- A falha de uma execução fica registrada no job. Quem pede com `webhook_url` também é avisado dela: ver ADR 0010, que acrescenta a este a fila `webhooks`, o `request_uuid` como `jobId` (deduplicação do pedido) e o sinal de cancelamento que o worker passa ao runner no desligamento.
