# Price CD — Análise da Base de Código

## O que o projeto faz

Serviço Node.js que automatiza a pesquisa de preço e popularidade de jogos para revendedores. Recebe um arquivo `.txt` onde a primeira linha é o **mínimo de popularidade** e as linhas seguintes são **nomes de jogos** (um por linha). O sistema:

1. Busca cada jogo no SteamCharts para obter o pico de jogadores em 24h (popularidade).
2. Filtra jogos abaixo do mínimo de popularidade.
3. Pesquisa o melhor preço no AllKeyShop para os jogos qualificados.
4. Retorna um `.txt` formatado para colar direto em planilha.

Há também um fluxo assíncrono ("lists") que aceita um Steam ID, rastreia as listas de trade do usuário no SteamTrades, extrai os jogos e roda o mesmo pipeline com popularidade mínima fixa de 30.

## Papel do Claude neste projeto

Atue sempre como arquiteto de software sênior com conhecimento profundo de Node e clean architecture.
- Questione decisões quando houver práticas consolidadas no mercado que apontem em outra direção
- Proponha soluções que o Node oferece, sempre respeitando as camadas de clean architecture
- Explique o raciocínio antes de implementar — nunca apenas execute sem contextualizar
- Quando o Node oferecer algo relevante, apresente o que ele resolve, onde vive nas camadas e qual o custo de usá-lo
- Todo código novo deve respeitar a separação de camadas: `Domain → Application → Infrastructure → Apresentação`. Nunca coloque lógica de negócio fora do Domain ou Application, nunca deixe o Domain conhecer o Node, nunca deixe um Use Case conhecer HTTP
- Ao sugerir onde um novo arquivo deve viver, justifique com base na camada correta da arquitetura
- Sempre gerar testes para cada alteração feita no projeto e só aceitar depois de executar os testes e passarem todos.

### Idioma no código

**Todo código é em inglês** — nomes de `describe`/`it`, identificadores, mensagens de erro, strings de asserção, dados de fixture. Português fica **exclusivamente** em comentários explicativos e na documentação `.md`.

Única exceção: string que reproduz literalmente uma saída de produção (ex.: a mensagem `"Erro no corpo da requisição: ..."` que `run-lists.controller.ts` devolve hoje). Nesse caso o português é o contrato, não escolha — e merece comentário dizendo isso.

### Commits

`git commit` é feito única e exclusivamente pelo usuário — Claude nunca deve rodar `git commit` (nem `git push`) neste repositório, sob nenhuma circunstância, mesmo que peçam explicitamente para "commitar" no meio de uma tarefa. O trabalho do Claude termina em deixar o working tree pronto: código, testes passando, documentação viva atualizada. Se achar que a mudança está pronta pra virar commit, diga isso e pare — quem decide a mensagem e o momento do commit é o usuário.

### Documentação viva

Toda documentação `.md` do projeto é **viva**: deve ser atualizada na mesma alteração que a tornou desatualizada, nunca "depois". Documentação errada é pior que documentação ausente — ela é lida como verdade, entra no contexto e propaga o erro. Ao mexer no código, verifique se algum destes arquivos passou a mentir e corrija junto:

| Arquivo | O que guarda | Atualize quando |
|---|---|---|
| `CONTEXT.md` | Glossário do domínio (só termos, sem detalhe de implementação) | Um termo do negócio nasce, muda de significado ou é aposentado |
| `docs/adr/` | Decisões arquiteturais difíceis de reverter | Uma decisão com trade-off real é tomada |
| `docs/IMPROVEMENTS.md` | Backlog de dívida técnica — **só o que falta fazer** | Uma dívida é descoberta ou muda de prioridade. Item resolvido é **removido do arquivo**, não marcado como feito: o backlog não é histórico (para isso existe o git log). Ao remover, renumere os itens seguintes e corrija quem os referenciava por número |
| `docs/wiki/` | Visão de alto nível para leitura não-técnica | Um fluxo, parâmetro ou comportamento visível ao negócio muda |
| `README.md` | Visão geral do projeto + contrato dos endpoints (rota, request, response) | Um endpoint nasce, muda de status code, request ou response |

Quando código e documentação divergirem, **o código é a verdade**: corrija o `.md` e avise explicitamente o que estava errado, em vez de silenciosamente reescrever.

### Puppeteer — referência

Sempre consulte a documentação mais recente antes de implementar qualquer alteração:
**https://pptr.dev/guides/getting-started**

---

## Contexto do negócio

A empresa é a **CarcaDeals** — vende keys de jogos para o consumidor final, comprando mais barato de fornecedores que compram bundles(Humble, Fanatical, Green Man Gaming) diretamente ou conseguem vários jogos através de giveaways ou contato com desenvolvedores.

Esse sistema é um projeto que apenas dá suporte ao sistema princial **Sistema-estoque** — onde fica armazenado todas as keys com os dados necessário(key, jogo, preço de compra, venda, lucro, data, etc).

---

---

## Arquitetura

> **Migração em andamento.** O projeto está sendo migrado para Nest.js pelo padrão Strangler
> Fig: dois entrypoints coexistem sobre um núcleo compartilhado até o cutover. Produção roda
> o Express. Plano em `docs/NEST.md`, conceitos em `docs/nest-conceitos.md`, decisão em
> `docs/adr/0004-nest-como-camada-de-apresentacao.md`.
>
> A fronteira de camadas é inegociável: `domain/`, `application/` e `helpers/` **nunca**
> importam `@nestjs/*`; `infrastructure/` e `lib/` no máximo `@Injectable()`; regra de
> negócio nunca vive em `nest/`.
>
> Consequência prática no wiring: portas são `abstract class` (existem em runtime, então
> servem de token de injeção sem decorator); adapters de `infrastructure/` são registrados
> com `useClass` e podem ter `@Injectable()`; **use cases de `application/` são registrados
> com `useFactory` + `inject`**, porque sem decorator o TypeScript não emite
> `design:paramtypes` e o container não descobre o construtor sozinho.

```
src/
├── server.ts              # Entrypoint Express (produção hoje)
├── main.ts                # Entrypoint Nest (PORT_NEST, não serve rota de negócio ainda)
├── app.ts                 # Express setup, rotas, static files
├── config/                # Schema Zod do ambiente — compartilhado pelos dois apps
├── nest/                  # Apresentação Nest: módulos, filter, pipe. ZERO regra de negócio
├── routes/                # Roteamento HTTP (thin wrappers)
├── controllers/           # Parse de request, validação, formatação de response
├── schemas/               # Schemas Zod + helpers de parse
├── services/              # Orquestração ("application services")
│   └── lists/             # Services específicos do fluxo lists
├── application/<módulo>/  # Camada de aplicação, um diretório por subdomínio
│   ├── use-cases/         # Objetivo completo de um ator (alguém dispara)
│   ├── services/          # Application Service: colaborador reutilizável entre use cases
│   └── ports/             # Interfaces de dependência (inversão de dependência)
├── domain/lists/          # Entidades de domínio (ListTopic)
├── infrastructure/        # Implementações concretas das portas
│   ├── background/        # Schedulers
│   ├── http/              # HTTP callback poster (native fetch)
│   └── lists/             # SteamTrades fetcher + formatador de resultado
├── lib/                   # Utilidades compartilhadas (puppeteer factory, dispose)
├── helpers/               # Funções puras de transformação de string + constantes
└── types/                 # Definições de tipos TypeScript
```

A palavra "service" tem o sentido de DDD/clean architecture — colaborador que orquestra portas e domínio, como `application/games/services/price-games.ts`. **Não** o dos tutoriais de Nest (regra + banco), nem o do `src/services/` legado, que é composition root manual e desaparece no PR 10. Ver `docs/nest-conceitos.md` §9.

Segue uma arquitetura hexagonal leve: o subdomínio `lists` tem interfaces de porta explícitas (`ListTopicFetcher`, `BackgroundScheduler`, `RunListsCallbackPoster`, `ListResultFormatter`, `RunListsRunner`) que são injetadas no use case via factory functions, permitindo testabilidade isolada.

---

## Tecnologias e Padrões

| Tecnologia | Uso |
|---|---|
| Node.js 22 + TypeScript 5 | Runtime e linguagem |
| Express 5 | HTTP server |
| Zod 4 | Validação de input (body e conteúdo do arquivo) |
| Native fetch (Node 22) | HTTP client (callback posts, integração com Sistema Estoque) |
| Cheerio | Parse HTML via seletores jQuery-like |
| Puppeteer Real Browser | Automação Chromium com bypass de anti-bot |
| puppeteer-extra-plugin-stealth | Esconde fingerprint do Puppeteer |
| puppeteer-extra-plugin-adblocker | Bloqueia ads para reduzir ruído e acelerar scraping |
| Biome | Linter + formatter (substitui ESLint + Prettier) |
| Nest.js 12 | Camada de apresentação do app novo (`src/main.ts`), em migração |
| tsx / tsc-alias | Execução em dev do Express e resolução de aliases no build |
| SWC | Transform dos testes (`unplugin-swc`) e do `dev:nest`. **Obrigatório**: o esbuild do Vitest e o `tsx` não emitem `design:paramtypes`, e sem essa metadata o Nest injeta `undefined` sem erro no boot — ver ADR 0004 |
| Xvfb (Docker) | Display virtual para Chromium headed em containers Linux |

### Padrões de Concorrência

- **SteamCharts**: `Promise.all` em batches de 50 jogos (paralelo dentro do batch, sequencial entre batches).
- **AllKeyShop**: Estritamente sequencial por jogo (uma única página do navegador navegada por vez).
- **SteamTrades**: Serializado via promise chain global (`steamTradesGate`) para evitar rate limit.
- **Background jobs**: `LimitedConcurrencyScheduler` — filas in-process independentes por fluxo, para que uma execução longa não trave a outra:
  - `lists` (`POST /api/lists/run`): concorrência configurável via `RUN_LISTS_CONCURRENCY` (default 1).
  - `research` (`POST /api/games/research` autenticado): concorrência fixa em 1 — o scraping do AllKeyShop já é serializado pelo browser compartilhado.

### Rate Limit e Retry

- `fetchWithRetry`: Respeita header `Retry-After` em 429; backoff exponencial com `baseDelay` de 5s; máx 3 tentativas.
- `gotoWithRetry`: Retry em `TimeoutError` ou HTTP 429 no Puppeteer; 3 tentativas.
- `STEAMTRADES_PAGE_DELAY_MS` env opcional para throttling entre page loads.
- `CloudflareChallengeSolver` (`src/lib/puppeteer-cloudflare.ts`): o `page.goto` resolve no `domcontentloaded` da interstitial da Cloudflare (HTTP 403 + `cf-mitigated: challenge`) enquanto o solver do `turnstile: true` ainda trabalha — o helper faz polling do HTML até o desafio sair. Bloqueio definitivo (1020/WAF) falha na hora, sem esperar; ambos os casos lançam `CloudflareChallengeError`, nunca resultado vazio. Timeout via `CLOUDFLARE_CHALLENGE_TIMEOUT_MS` (default 45s). Em falha, o erro carrega `details` (leituras, URLs distintas, se o HTML mudou, título) — `htmlChanged: false` aponta JS do desafio parado; várias URLs apontam redirect loop. `CLOUDFLARE_DEBUG_DIR` grava HTML + screenshot do estado final. Só aceita como resolvida a página após 2 leituras consecutivas não-desafio com ao menos 1024 chars — descarta o documento vazio do redirect de saída sem exigir HTML idêntico (página viva muda a cada leitura). `PageSnapshot` concentra o conhecimento de "como a Cloudflare se parece no HTML" e classifica cada leitura em `blocked | challenge | too-short | ready`; os marcadores precisam ser exclusivos da interstitial (`challenge-platform` **não** serve, a Cloudflare injeta esse script em páginas normais). Erro de browser morto propaga na hora, sem consumir o timeout.

### Normalização de Nomes

O módulo `clear-string.ts` é a camada central de normalização usada em todo matching:
- Converte algarismos romanos (`IV` → `4`)
- Expande números-K (`10k` → `10000`)
- Remove palavras de edição (`Definitive Edition`, `GOTY`, `Deluxe`, `Bundle`, etc.)
- Remove tags de região (`ROW`, `EU`, `Global`)
- Remove keywords de DLC (`DLC`, `expansion`, `season pass`)
- Strip de pontuação especial (`™`, `:`, `®`, `!`, `?`, `'`, etc.)
- `hasEdition` retorna um `Set` de palavras de edição encontradas, usado para comparação simétrica evitando falsos matches entre variantes de edição.

### Tratamento de Erros

- Controllers Express tratam `ZodError` (400) separado de `Error` genérico (500). No app Nest isso é um arquivo só, `src/nest/common/all-exceptions.filter.ts`, registrado via `APP_FILTER` (provider do container, não `useGlobalFilters`, para poder injetar dependências).
- O formato de erro **não é uniforme entre as rotas** e está congelado assim de propósito durante a migração: `test/contract/contract-cases.ts` trava o contrato como ele é, para que qualquer diferença do app Nest seja bug, não melhoria acidental. Uniformizar é PR próprio, antes ou depois — nunca durante.
- Funções de service retornam `null` em falhas individuais de jogo (não fatais), permitindo que o batch continue.
- **Desligamento ordenado:** existem três donos de Chromium — o browser persistente do bump, a sessão do AllKeyShop e a da Descoberta de Fornecedores. Cada app tem **um** ponto de desligamento: `src/server.ts` no Express, que fecha os três, e `BrowserShutdown` (`OnApplicationShutdown`) no Nest, que hoje fecha dois — o bump ainda não foi migrado. A ordem é fixa: parar de aceitar requisição **antes** de fechar browser, senão uma requisição em voo abre um Chromium depois do cleanup. Nenhum outro módulo registra handler de sinal — o agendador de bump fazia isso e chamava `process.exit(0)`, matando o processo antes de as outras duas sessões fecharem. As sessões vivem em `src/infrastructure/browser/`, com instância única por processo (`sessions.ts`); o `BrowserModule` as registra com `useValue` para que o container não crie uma segunda.
- **Ciclo de vida do Chromium** (`src/lib/puppeteer-browser.ts` + `src/lib/process-tree.ts`): quem abre um browser é responsável por fechá-lo — nenhum caminho de erro pode zerar a referência sem encerrar o processo. `cleanupBrowser` fecha as páginas, faz `browser.close()` com timeout (`BROWSER_CLOSE_TIMEOUT_MS`, default 15s) e **só depois** parte para sinal: SIGTERM em toda a árvore de processos, janela de graça (`BROWSER_KILL_GRACE_MS`, default 3s), SIGKILL nos sobreviventes. A ordem não é negociável — o `close()` via CDP é o único caminho que derruba renderers, GPU process e zygote; matar o processo principal antes órfã a árvore (foi o que derrubou a VPS por OOM em 2026-08-24). Por isso a árvore é fotografada com `descendantsOf` **antes** do close: depois que o pai morre, os filhos são reparentados para o `init` e viram irrastreáveis. `cleanupBrowser` nunca lança. Derrubar a árvore é só metade do trabalho: os netos do Chromium morrem já reparentados para o PID 1, e o Node não colhe órfãos (o libuv só dá `waitpid` nos filhos que ele mesmo criou). Por isso os serviços do `docker-compose.yml` rodam com `init: true` — sem ele os zumbis enchem o `pids_limit` até todo `fork()` falhar com `Cannot fork` (produção, 2026-09-18). Ver `docs/adr/0005-container-precisa-de-init-para-colher-zumbis.md`.
- `invalidateSharedSession()` é assíncrona e **fecha** a sessão antes de zerar as referências; o call site (`searchAllKeyShop`) precisa dar `await` antes do rethrow. `getSharedSession` limpa a sessão morta no `catch` do health check e recicla a sessão por idade (`BROWSER_SESSION_MAX_AGE_MS`, default 30min; `0` desliga).
- `FetchListTopic` implementa o padrão `Disposable` (`src/lib/dispose.ts`); `RunListsUseCase` chama `disposeIfPresent(fetcher)` em bloco `finally`.

---

## Problemas Identificados

Dívida técnica e melhorias rastreadas em `docs/IMPROVEMENTS.md`.

---

## Agent skills

### Issue tracker

Issues são rastreados no GitHub Issues (`JoaoVitor2310/price-cd`), via CLI `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Vocabulário padrão: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Layout single-context — `CONTEXT.md` + `docs/adr/` na raiz do repo, criados sob demanda. See `docs/agents/domain.md`.
