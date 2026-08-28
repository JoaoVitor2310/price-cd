# Plano de migração para Nest.js

Documento operacional. Descreve como sair do estado atual (Express 5 + composition root
manual) para Nest.js sem congelar a `main` e sem impedir correções urgentes durante a
transição.

Os conceitos do Nest usados aqui — container, providers, tokens, escopos, pipeline de
request, ciclo de vida — estão explicados em **`docs/nest-conceitos.md`**, mapeados a este
código. Este arquivo assume esse vocabulário e trata só da sequência e da estratégia.

Status: **proposto, não iniciado**. Nenhum PR abaixo foi aberto.

---

## 1. Decisão e escopo

**Nest.js assume a camada de apresentação e o composition root.** `domain/` e `application/`
permanecem sem qualquer referência a `@nestjs/*`.

### O que o Nest assume, concretamente

1. **O container de DI substitui `src/services/`.** O diretório inteiro existe só para montar
   dependências: `research-games.service.ts`, `enqueue-run-lists.service.ts` e
   `find-new-suppliers.factory.ts` são singletons preguiçosos escritos à mão
   (`let _scheduler; function getScheduler() { if (!_scheduler) ... }`), o mesmo padrão
   repetido em cada fluxo. O container faz isso por definição, com ordem de construção e
   escopo explícitos.
2. **O ciclo de vida ganha dono.** Hoje `startBumpTopicsScheduler` registra
   `process.once("SIGTERM")` e chama `process.exit(0)` — o que **pula** o encerramento da
   sessão compartilhada do AllKeyShop (`invalidateSharedSession`) e da sessão de suppliers
   (`cleanupSuppliersSession`). Num processo que já derrubou a VPS por Chromium vazado
   (2026-08-24, ver o comentário em `docker-compose.yml`), isso é dívida com consequência
   conhecida. `OnApplicationShutdown` + `app.enableShutdownHooks()` dá um ponto único de
   desligamento ordenado.
3. **Pipes e filters eliminam o boilerplate dos controllers.** Os cinco controllers repetem
   o mesmo `try { schema.parse } catch (ZodError → 400) catch (Error → 500)`.
   `search.controller.ts` e `search-id-steam.controller.ts` são hoje praticamente o mesmo
   arquivo. Um `ZodValidationPipe` e um `AllExceptionsFilter` globais reduzem cada controller
   ao que ele de fato faz.
4. **Config validada no boot.** `process.env` é lido em 14 arquivos (27 variáveis distintas),
   inclusive **dentro do `RunListsUseCase`** (`MAX_ACTIVE_LISTS`) — violação de camada: o use
   case não deveria conhecer `process.env`. O `ConfigModule` valida tudo uma vez, no boot, e
   injeta valores tipados.

### Fronteira inegociável

```
domain/  application/  helpers/     →  NUNCA importam @nestjs/*
infrastructure/  lib/               →  no máximo @Injectable()
nest/  main.ts                      →  apresentação + wiring, ZERO regra de negócio
```

Verificável por `grep` no CI (seção 8). Se essa fronteira for violada uma vez, o que
sobrou de clean architecture no projeto vira decoração.

---

## 2. O que migra e o que não migra

| Camada | LOC | Migra? | Por quê |
|---|---:|---|---|
| `src/domain/` | 349 | **Não** | Funções puras. Não conhecem Node, não conhecem HTTP. Zero linhas alteradas. |
| `src/helpers/` | 283 | **Não** | Idem. `clear-string.ts` é o coração do matching e não é tocado. |
| `src/application/` | 814 | **Assinatura apenas** | Portas saem de `execute(input)` e vão para o construtor. Nenhuma regra muda. |
| `src/infrastructure/` | 1.418 | **1 decorator por classe** | Adapters já são classes que implementam portas. Ganham `@Injectable()`. |
| `src/lib/` | 891 | **Parcial** | `puppeteer-browser.ts` tem singletons de módulo que viram providers (PR 6). O resto (`process-tree`, `dispose`, `fetch-with-retry`) fica como está. |
| `src/schemas/` | 91 | **Não** | Zod continua sendo a validação; muda só quem chama (`ZodValidationPipe`). |
| `src/routes/` | 53 | **Some** | Vira roteamento por decorator. |
| `src/controllers/` | 222 | **Reescrito** | 5 arquivos, magros. |
| `src/services/` | 294 | **Some** | É exatamente o que o container substitui. |

**Total realmente reescrito: ~570 linhas de 4.451.** Todo o resto ou não muda ou muda
mecanicamente. Esse número é o que sustenta a estratégia da seção 3: como o núcleo é
compartilhado, os dois apps coexistem no mesmo repositório sem duplicar regra de negócio.

Testes (427 asserções, três grupos):
- `test/unit/domain/`, `test/unit/helpers/`, `test/unit/lib/` — **inalterados**.
- `test/unit/application/` e `test/unit/infrastructure/` — muda só a construção do objeto sob
  teste; asserções intactas.
- `test/integration/routes/` — reescritos, de `vi.mock` no módulo de infraestrutura para
  `Test.createTestingModule().overrideProvider()`. São 4 arquivos, e o resultado é melhor:
  substituição de dependência pelo container, em vez de mock de módulo.

---

## 3. Estratégia: Strangler Fig dentro da `main`

### O padrão

O nome vem da figueira-mata-pau: ela germina nos galhos da árvore hospedeira, cresce
envolvendo o tronco e só quando já se sustenta sozinha é que a hospedeira morre — e a
figueira fica com a forma exata dela. Aplicado a software (Martin Fowler, 2004): em vez de
reescrever o sistema e trocar tudo num "big bang", você constrói o novo **ao lado** do
antigo, migra um pedaço de cada vez, e mantém os dois vivos até o novo cobrir 100% do
comportamento. A troca final é uma mudança de roteamento, não um deploy de reescrita.

Os três elementos que fazem o padrão funcionar:

1. **Um ponto de desvio** — algo que decide qual implementação atende cada chamada. Aqui é o
   entrypoint do processo (`server.ts` vs `main.ts`), selecionado por env var no cutover.
2. **Coexistência real** — o novo roda de verdade, testado, não é protótipo em branch.
3. **Um critério objetivo de "o novo cobre o antigo"** — sem isso o padrão vira dois sistemas
   pela metade. Aqui é o harness de contrato (seção 4).

A alternativa clássica é a branch longa de migração, e ela é uma armadilha conhecida:
começa como "duas semanas", vira três meses de `git merge main` semanal, com conflito
crescente exatamente nos arquivos que a migração mais mexe. Quando surge um bug em
produção, você corrige na `main` e reza para que o merge seguinte não desfaça.

### Aplicação neste repositório

```
src/
├── server.ts              # entrypoint Express — o que roda em produção HOJE
├── app.ts                 #   (intocado até o cutover)
├── routes/  controllers/  services/
│
├── main.ts                # entrypoint Nest — NOVO, cresce PR a PR
├── nest/
│   ├── app.module.ts
│   ├── common/            # ZodValidationPipe, AllExceptionsFilter
│   ├── config/            # ConfigModule + schema Zod do ambiente
│   ├── games/             # games.module.ts + controllers
│   ├── lists/
│   ├── suppliers/
│   ├── bump/
│   └── browser/           # providers de sessão de Chromium (PR 6)
│
└── domain/  application/  infrastructure/  lib/  helpers/  schemas/
    ↑ NÚCLEO COMPARTILHADO — os dois entrypoints importam daqui.
      Nenhuma regra de negócio é duplicada. Nunca.
```

Produção continua no Express até o PR 9. A `main` está sempre deployável.

### Por que isso resolve o problema do hotfix

Um bug em produção durante a migração cai em um de dois lugares:

- **No núcleo compartilhado** — o caso comum: matching de nome, parser do AllKeyShop,
  desafio da Cloudflare, cleanup de browser. Você corrige na `main` com o fluxo de sempre, e
  a correção vale para os dois apps automaticamente, porque é literalmente o mesmo arquivo.
  Custo da migração: **zero**.
- **Na apresentação** — status code, shape de resposta, auth do controller. Você corrige o
  Express e espelha no controller Nest. O teste de contrato da seção 4 **quebra o CI** se
  esquecer.

Sem branch longa, não há merge para dar errado.

### O preço, e o que fazer com ele

A `main` carrega por algumas semanas um app que ninguém usa. Não é código morto — o CI o
exercita a cada PR — mas é peso. A mitigação é ritmo: os PRs 2 a 8 devem sair em sequência
próxima, e o cutover (PR 9) não deve esperar "mais um refinamento". Meia migração parada na
`main` é o único desfecho ruim possível aqui.

### O cenário que forçaria a branch longa

Um só: se o PR 0 concluir que é preciso trocar o sistema de módulos (ESM → CommonJS). Os dois
entrypoints não coexistem sob `"type"` diferente no `package.json`. Nesse caso a branch
`nest` recebe apenas os PRs 2+, o PR 1 (harness) vai direto para a `main`, e a branch faz
`git merge main` **a cada merge na main**, não em cadência de calendário. Como ela não toca
`domain/`, `application/`, `infrastructure/` nem `lib/`, o conflito fica restrito a
`package.json` e `tsconfig.json`. Ver 7.1.

---

## 4. O portão objetivo: testes de contrato parametrizados

"Pronto para cutover" precisa de uma definição que não dependa de opinião. A definição é:
**uma bateria de testes HTTP que roda contra os dois apps e passa igual nos dois.**

O harness (PR 1) é um arquivo só:

```ts
// test/contract/api-contract.suite.ts
export function runApiContract(getServer: () => Server, only?: string[]) {
  describe.each(CONTRACT_CASES.filter(c => !only || only.includes(c.route)))(
    "$method $route — $name",
    ({ method, route, body, headers, expectStatus, expectBody }) => {
      it("responde conforme o contrato", async () => {
        const res = await request(getServer())[method](route).set(headers ?? {}).send(body);
        expect(res.status).toBe(expectStatus);
        expect(res.body).toMatchObject(expectBody);
      });
    },
  );
}
```

E dois arquivos que o consomem:

```ts
// test/contract/express.contract.test.ts
runApiContract(() => expressApp);

// test/contract/nest.contract.test.ts  — a lista `only` cresce a cada PR de módulo
runApiContract(() => nestApp.getHttpServer(), ["/api/games/search"]);
```

Propriedades que fazem esse harness valer o esforço:

- **Opt-in por rota.** O Nest só é cobrado pelas rotas cujo módulo já foi entregue. Nada de
  CI vermelho durante a migração.
- **Um caso de teste, dois apps.** Impossível corrigir um e esquecer o outro.
- **É o critério de pronto.** Quando a lista `only` cobre todas as rotas do Express, a
  paridade está provada.
- **É o que permite mudar assinatura de use case com segurança.** Como os PRs de módulo
  alteram código compartilhado (seção 5), o harness é o que prova que o Express continua
  respondendo igual. Por isso ele vem **antes** de qualquer linha de Nest.
- **Sobrevive ao cutover.** Depois que o Express morre, continua sendo a suíte de contrato
  da API.

Os casos vêm da tabela de endpoints do `README.md` e devem incluir os caminhos tortos, não
só o feliz: body inválido → 400 com a mensagem do Zod; `internal_secret` errado em
`/api/games/research` → 200 demo em vez de 202; body vazio; e o formato exato de
`{ success, data }` vs `{ success, error, details }`, que hoje **não é uniforme entre os
controllers** e precisa ser congelado como está. Uniformizar durante a migração impede
distinguir "diferença é bug do Nest" de "diferença é melhoria intencional" — se for
uniformizar, é um PR separado, antes ou depois, nunca durante.

---

## 5. Sequência de PRs

| # | PR | Depende de | Conceitos Nest introduzidos |
|---:|---|---|---|
| 0 | Spike + ADR 0004 | — | decorators, `reflect-metadata`, `emitDecoratorMetadata` |
| 1 | Harness de contrato (só Express) | — | — |
| 2 | Esqueleto Nest + ConfigModule | 0, 1 | `NestFactory`, `@Module`, dynamic module, pipes e filters globais |
| 3 | Módulo `games`: `/search`, `/search-id-steam` | 2 | `@Controller`, custom providers, injection tokens, `Test.createTestingModule` |
| 4 | Módulo `games`: `/research` | 3 | `useFactory`, providers com estado, por que **não** usar Guard aqui |
| 5 | Módulo `lists` | 4 | duas instâncias da mesma classe com tokens distintos, `OnModuleDestroy` |
| 6 | Módulo `suppliers` + ciclo de vida do browser | 5 | `exports`/`imports` vs provider duplicado, `OnApplicationShutdown` |
| 7 | Agendador de bump | 6 | `@nestjs/schedule`, `OnApplicationBootstrap` |
| 8 | Paridade de infraestrutura HTTP | 3–7 | `useStaticAssets`, `setGlobalPrefix` |
| 9 | Cutover | 8 | — |
| 10 | Remoção do Express | 9 estável | — |

Todo PR é individualmente reversível e deixa a `main` deployável. Nenhum quebra produção
antes do 9.

**Sobre granularidade:** num projeto solo, o PR não existe para revisão de terceiro — existe
para dar ponto de rollback e para forçar um marco de aprendizado por vez. Os PRs 3, 4 e 5
podem sair no mesmo dia se o PR 2 estiver bem feito. O que **não** deve ser agrupado é o PR 6
(ciclo de vida do Chromium, onde mora o risco de OOM) nem o PR 9 (cutover).

---

### PR 0 — Spike e ADR

**Não produz código de produção.** Produz uma decisão registrada. Protótipo descartável, fora
do repo ou em branch descartada.

Responder, com critério de aceite executável:

1. **Nest roda com `"type": "module"` neste projeto?** Aceite: um `AppModule` com um provider
   injetado por token de interface, importando `puppeteer-real-browser`, `cheerio` e `zod`,
   sobe e responde. Passou → ESM fica, strangler na `main`. Não passou de forma limpa →
   CommonJS, e a seção 3 vira o cenário da branch longa.
2. **`emitDecoratorMetadata` funciona sob Vitest?** O Vitest usa esbuild por padrão, que não
   emite metadata de decorator. Testar `unplugin-swc` no `vitest.config.ts`. Aceite: um teste
   com `Test.createTestingModule` resolve um provider injetado por classe.
3. **Fixar a major do Nest** (hoje 11.x — confirmar no npm antes de começar).

Saída: `docs/adr/0004-nest-como-camada-de-apresentacao.md`, no formato dos ADRs existentes
(decisão + `## Consequences`), registrando sistema de módulos, versão do Nest e a fronteira
de camadas da seção 1.

Resolve de quebra o item 6 do `docs/IMPROVEMENTS.md` (`moduleResolution: "node"`, depreciado
para ESM), que precisa ser decidido aqui de qualquer forma.

---

### PR 1 — Harness de testes de contrato

Seção 4. Só Express nesta altura — `nest.contract.test.ts` nasce no PR 3.

Não é opcional e não pode vir depois: a partir do PR 3, cada módulo Nest altera assinatura de
use case compartilhado com o Express. Sem o harness, não há como afirmar que o Express
continua íntegro a cada PR.

---

### PR 2 — Esqueleto Nest + ConfigModule

Sobe um app Nest que não serve nenhuma rota de negócio.

- `src/main.ts` — `NestFactory.create<NestExpressApplication>(AppModule)`,
  `app.enableShutdownHooks()`, `setTimeout` equivalente ao `SERVER_TIMEOUT_MS` atual, porta
  vinda do config com **default diferente do Express** (`PORT_NEST=5557`) para que os dois
  subam em dev sem colidir.
- `src/config/env.schema.ts` — schema Zod sobre `process.env`, cobrindo o que já está
  catalogado no `.env.example`. Vive **fora** de `src/nest/` porque o Express também pode
  consumi-lo.
- `src/nest/config/config.module.ts` — `ConfigModule.forRoot({ isGlobal: true, validate })`
  apontando para esse schema. Falha no boot com mensagem clara se faltar variável
  obrigatória, em vez de estourar no primeiro request.
- `src/nest/common/zod-validation.pipe.ts` — ~15 linhas, `schema.parse` no `transform`,
  relançando `ZodError`. Escrito à mão em vez de `nestjs-zod`: é pequeno demais para
  justificar uma dependência acoplada à major do Zod.
- `src/nest/common/all-exceptions.filter.ts` — `ZodError` → 400 com as mensagens
  concatenadas (mesmo formato de hoje), `HttpException` → passa, resto → 500. Este arquivo
  sozinho substitui o `catch` duplicado dos 5 controllers.
- `GET /health` para provar que o app sobe.
- Scripts: `dev:nest`, e `build` cobrindo os dois entrypoints.

Registre pipe e filter via `APP_PIPE`/`APP_FILTER` (providers de `@nestjs/core`), não via
`app.useGlobalPipes()` — a diferença está em `nest-conceitos.md` §6 e importa assim que o
filter precisar injetar algo.

Produção continua no Express. O Dockerfile não muda.

---

### PR 3 — Módulo `games`: `/search` e `/search-id-steam`

Fluxos síncronos, sem fila e sem auth. É onde a receita é validada antes de aplicá-la aos
fluxos difíceis.

Receita, aplicada igual nos PRs 3 a 6:

1. **As portas ganham um token de injeção.** Interface de TypeScript não existe em runtime,
   então não dá para injetar por tipo — é o atrito central entre Nest e arquitetura
   hexagonal. `nest-conceitos.md` §3 detalha as três saídas; a recomendada é **porta como
   `abstract class`**, que serve de token sozinha e mantém `application/` sem importar nada
   do Nest. **Escolha uma no PR 3 e siga até o fim**, registrando no ADR 0004.
2. Os adapters de `infrastructure/` ganham `@Injectable()` e são registrados como
   `{ provide: PopularityFetcher, useClass: SteamChartsPopularityFetcher }`.
3. **O use case muda de assinatura**: as portas saem do objeto de entrada de `execute()` e vão
   para o construtor.

   ```ts
   // antes — dependência misturada com dado de entrada
   await useCase.execute({ gameNames, minPopularity, checkGamivoOffer,
                           popularityFetcher, priceFetcher });

   // depois (opção B: porta como abstract class)
   @Injectable()
   class SearchGamesUseCase {
     constructor(
       private readonly popularityFetcher: PopularityFetcher,
       private readonly priceFetcher: PriceFetcher,
     ) {}
     async execute(input: { gameNames: string[]; minPopularity: number; checkGamivoOffer: boolean }) { … }
   }
   ```

   Isso separa **dependência** de **dado**, que hoje estão no mesmo objeto — e é a mudança
   que faz o container ter o que resolver.

4. **O call site Express é ajustado no mesmo PR** (`src/services/games/*.ts` e
   `src/controllers/games/*.ts` constroem o use case com as dependências). É o imposto do
   strangler, e o harness do PR 1 é a prova de que nada quebrou.
5. Controller Nest: `@Post()`, `@Body(new ZodValidationPipe(schema))`, retorna o objeto — o
   filter global cuida do erro.
6. A rota entra na lista `only` do `nest.contract.test.ts`.
7. Teste de integração com `Test.createTestingModule().overrideProvider(TOKEN).useValue(fake)`.

`search-id-steam` hoje chama `SteamChartsPopularityFetcher` direto do controller, sem use
case. No Nest, injete a porta no controller — não invente um use case só para ter simetria.

---

### PR 4 — Módulo `games`: `/research`

Três coisas novas de uma vez.

- **Autenticação sem Guard.** A tentação é transformar `isAuthenticated()` num `@UseGuards()`.
  **Não faça.** Guard rejeita a requisição quando retorna `false`, e aqui token ausente ou
  errado significa *modo demo com 200*, não 401. Um Guard mudaria o contrato. Mantenha a
  checagem no controller, ou use um Guard que apenas **marca** `request.isAuthenticated` e
  sempre retorna `true` — o segundo é mais elegante e ainda ensina o conceito, mas o primeiro
  é honesto. Ver `nest-conceitos.md` §6.
- **Fila como provider.** `LimitedConcurrencyScheduler` vira provider com estado, escopo
  singleton (default). Concorrência fixa em 1 aqui.
- **`useFactory` para dependência configurada.** `HttpGameTradeImporter` precisa de
  `SISTEMA_ESTOQUE_URL` e `EXTERNAL_SECRET`:
  `{ provide: TRADE_IMPORTER, useFactory: (cfg) => new HttpGameTradeImporter(cfg.url, cfg.secret), inject: [ConfigService] }`.
  Preserve o comportamento de `assertTradeImporterConfigured()`: hoje ele falha ainda no ciclo
  do request, porque depois de enfileirado não há mais ninguém para receber o erro. Com a
  validação do PR 2 no boot, o app nem sobe mal configurado — melhor ainda, mas mantenha a
  checagem.

---

### PR 5 — Módulo `lists`

- **Duas instâncias da mesma classe, tokens distintos.** `lists` usa concorrência
  configurável (`RUN_LISTS_CONCURRENCY`), `research` usa 1 fixo. São dois providers
  `LimitedConcurrencyScheduler` com tokens diferentes (`LISTS_SCHEDULER`,
  `RESEARCH_SCHEDULER`) — e o motivo de as filas serem separadas (uma execução longa de
  listas não pode travar uma pesquisa manual) precisa continuar verdadeiro depois da
  migração. Um erro de wiring aqui vira regressão de comportamento silenciosa.
- **`MAX_ACTIVE_LISTS` sai de dentro do use case.** Passa a ser injetado, corrigindo a
  violação de camada apontada na seção 1.
- **`Disposable` encontra `OnModuleDestroy`.** `FetchListTopic` implementa o `Disposable` do
  projeto (`src/lib/dispose.ts`) e o `RunListsUseCase` chama `disposeIfPresent` no `finally`.
  Isso é dispose **por execução**, não por ciclo de vida do módulo — mantenha como está e não
  confunda os dois. `OnModuleDestroy` é para o que vive enquanto o app vive.

---

### PR 6 — Módulo `suppliers` + ciclo de vida do browser

O PR de maior risco. Deixar por último não é acidente: é o fluxo mais acoplado
(injeta cookie do SteamTrades antes de qualquer navegação, compartilha uma sessão entre
paginator, scraper e poster, limpa no `finally`) e é onde mora o histórico de OOM.

**Encapsular o estado global de `src/lib/puppeteer-browser.ts`.** Hoje `getSharedSession`,
`invalidateSharedSession`, `enqueueWithBrowser`, `getSuppliersSession` e
`cleanupSuppliersSession` são estado mutável de módulo — singleton por acidente de import,
sem dono e sem desligamento coordenado. Viram duas classes com ciclo de vida explícito
(`SharedBrowserSession`, `SuppliersBrowserSession`), providers de um `BrowserModule` que os
**exporta**.

⚠️ **A armadilha que custa memória:** se `SharedBrowserSession` for listado em `providers` de
dois módulos, o Nest cria **duas instâncias** — dois gerenciadores de Chromium, dentro de um
container com `mem_limit: 2g`. O jeito correto é declarar no `BrowserModule`, exportar de lá,
e os outros módulos fazerem `imports: [BrowserModule]`. Detalhe em `nest-conceitos.md` §4.

**Corrigir o bug de shutdown.** Os handlers manuais de `SIGTERM`/`SIGINT` do bump scheduler
são removidos; cada sessão implementa `OnApplicationShutdown` e o `enableShutdownHooks()` do
PR 2 coordena. Verificar à mão com `ps` que nenhum processo Chromium sobrevive a um `SIGTERM`.

Para não quebrar os 30+ call sites de uma vez, as funções exportadas hoje podem virar fachadas
finas sobre a instância do container durante este PR, e sumir no PR 10.

---

### PR 7 — Agendador de bump

`startBumpTopicsScheduler` vira provider com `@Interval()` do `@nestjs/schedule`
(`ScheduleModule.forRoot()` no `AppModule`). O guard `running` vira campo do provider. O
`process.once("SIGTERM")` + `process.exit(0)` é **removido** — o PR 6 já deu o caminho certo.

Se o bump precisar rodar no boot antes do primeiro intervalo, use `OnApplicationBootstrap`
(app já ouvindo), não `OnModuleInit` (grafo ainda subindo).

`find-new-suppliers-scheduler.ts` **não migra**: a chamada já está comentada em
`src/server.ts:11` e o item 3 do `docs/IMPROVEMENTS.md` pede a remoção. Este é o PR para
apagá-lo. Não porte código morto para a arquitetura nova.

---

### PR 8 — Paridade de infraestrutura HTTP

O que não é rota mas é comportamento observável:

- `express.static(public/)` → `app.useStaticAssets()` do `NestExpressApplication`.
- `GET /` com o texto do LinkedIn.
- `server.setTimeout(SERVER_TIMEOUT_MS)`.
- `app.setGlobalPrefix("api")` no lugar do `router.use("/api", ...)`.
- Item 12 do `docs/IMPROVEMENTS.md` resolvido de graça: `search-id-steam.route.ts` é montado
  de forma incorreta hoje; com decorators o problema deixa de existir.

Ao final deste PR, `nest.contract.test.ts` roda **sem `only`**. É o marco de paridade.

---

### PR 9 — Cutover

PR pequeno, desenhado para ser revertido em um comando:

- `docker/start.sh`: `exec node dist/main.js` em vez de `dist/server.js`, **atrás de**
  `APP_ENTRYPOINT=nest|express` — default `express` no merge, virado para `nest` na VPS
  depois de observar.
- Rollback = mudar a env e reiniciar o container. Sem rebuild, sem revert de commit.
- Manter por 1–2 semanas.

⚠️ **Não subir os dois apps simultaneamente em produção.** O container tem `mem_limit: 2g` e
`pids_limit: 512` justamente por causa do incidente de 2026-08-24; dois processos Node com
Chromium próprio dentro desse teto é convite para repetir o OOM. Comparação lado a lado
acontece no CI (harness do PR 1) e em dev — nunca na VPS.

---

### PR 10 — Remoção do Express

Depois do período de observação: apagar `src/server.ts`, `src/app.ts`, `src/routes/`,
`src/controllers/`, `src/services/`, `test/integration/routes/` e
`test/contract/express.contract.test.ts`; remover as fachadas de `puppeteer-browser.ts`;
tirar `express` e `@types/express` das dependências diretas (`@nestjs/platform-express`
continua usando Express por baixo — ver `nest-conceitos.md` §10); atualizar `README.md`,
`CLAUDE.md`, `docs/wiki/` e apagar este arquivo.

---

## 6. Protocolo de hotfix durante a migração

1. **Corrija na `main`, sempre.** O fluxo de hotfix não muda em nada em relação a hoje.
2. **Todo hotfix vem com teste.** Se o bug é de comportamento HTTP, o teste vai em
   `CONTRACT_CASES` — e aí passa a cobrar os dois apps automaticamente.
3. **Hotfix em `domain`/`application`/`infrastructure`/`lib`:** acabou. O Nest herda a
   correção porque é o mesmo arquivo.
4. **Hotfix em `src/controllers/`:** espelhe no controller Nest *se ele já existir*. O CI
   acusa se esquecer. Se o módulo Nest daquela rota ainda não nasceu, nada a fazer — quando
   nascer, o caso de contrato já vai estar lá cobrando.
5. **Deploy:** inalterado. `main` → CI → deploy da VPS, com o Express no comando até o PR 9.

---

## 7. Riscos e decisões abertas

### 7.1 ESM vs CommonJS — o único risco de virar buraco

O projeto é `"type": "module"`, `"module": "ESNext"`, `"moduleResolution": "node"` (já
depreciado — item 6 do IMPROVEMENTS), com aliases `@/*` resolvidos por `tsc-alias` e imports
com extensão `.js` explícita. O Nest é historicamente CommonJS-first: o CLI scaffolda CJS e a
maior parte da documentação assume CJS.

Nada no `src/` usa recurso exclusivo de ESM (não há top-level await nem `import.meta` —
verificado), então a troca é *possível*; mas ela obriga a mexer em todos os imports e mata o
strangler na `main`. Decisão do PR 0, por critério executável, não por opinião.

### 7.2 Metadata de decorator no Vitest

Sem transform que preserve metadata, `Test.createTestingModule` não resolve providers por
tipo. Mitigação barata se der errado: `@Inject(TOKEN)` explícito em todo provider — mais
verboso, mas independe de metadata, e para portas (interfaces) o token explícito já é
obrigatório de qualquer forma. Provar no PR 0.

### 7.3 Estado global de módulo remanescente

Além do browser (PR 6), existe o `steamTradesGate` em
`src/infrastructure/lists/fetch-list-topic.ts` — promise chain global que serializa o acesso
ao SteamTrades. Enquanto os dois apps nunca rodam no mesmo processo, o singleton de módulo
continua correto para ambos. Migrar para provider depois do cutover, se incomodar.

### 7.4 Suíte de testes instável

O item 16 do `docs/IMPROVEMENTS.md` registra timeouts aleatórios do Vitest em WSL2 por
contenção de worker. Durante a migração isso é veneno: uma falha de timeout vai parecer
regressão do Nest. **Resolver o item 16 antes do PR 3**, ou o sinal do harness de contrato
fica ruidoso justamente quando ele mais importa.

### 7.5 Escopo do container

Default singleton em tudo. `Scope.REQUEST` parece atraente para rastrear requisições, mas
criaria um `AllKeyShopPriceFetcher` novo por request — e o scraping do AllKeyShop depende de
sessão de browser compartilhada. Além disso, escopo de request se propaga para cima em toda a
cadeia de injeção (`nest-conceitos.md` §5). Não use sem caso comprovado.

---

## 8. Critérios de conclusão

Pronto para o cutover quando **todos** forem verdade:

- [ ] `nest.contract.test.ts` roda sem lista `only` e passa — paridade total de rotas.
- [ ] `npm test` verde, com contagem de asserções ≥ a de hoje (427).
- [ ] `grep -rl "@nestjs" src/domain src/application src/helpers` retorna apenas o que o
      ADR 0004 autorizou (nada, na estratégia recomendada; só `@Injectable`/`@Inject` nos use
      cases, nas outras).
- [ ] Nenhuma regra de negócio em `src/nest/`.
- [ ] `SIGTERM` no app Nest encerra as três sessões de Chromium — verificado à mão, com `ps`
      confirmando que nenhum processo sobrevive.
- [ ] Nenhum provider com estado (sessões de browser, filas) declarado em mais de um módulo.
- [ ] O fluxo de suppliers roda de ponta a ponta em dev, contra o SteamTrades real, com o
      mesmo resultado do Express.
- [ ] `README.md`, `CLAUDE.md` e `docs/wiki/` atualizados no PR do cutover.

---

## 9. Documentação viva

Conforme a regra do `CLAUDE.md`, cada PR atualiza o que tornou desatualizado:

| Arquivo | Quando | O quê |
|---|---|---|
| `docs/adr/0004-...` | PR 0 | Decisão, sistema de módulos, fronteira de camadas, estratégia de token de porta |
| `docs/nest-conceitos.md` | PRs 2–7 | Cada conceito passa de "vamos usar" para "está assim, aqui, por isto" |
| `docs/IMPROVEMENTS.md` | PRs 0, 5, 7, 8 | Fechar itens 3, 6, 12; abrir o que o harness revelar |
| `CLAUDE.md` | PRs 2, 9, 10 | Seções "Arquitetura" e "Tecnologias e Padrões" |
| `README.md` | PRs 8, 9, 10 | Stack, árvore de diretórios, Getting Started |
| `docs/wiki/` | PR 9 | Só se algum comportamento visível ao negócio mudar — não deveria mudar |
| `CONTEXT.md` | — | Nenhum termo de domínio muda. Migração de framework não toca o glossário. |

**Este arquivo é temporário.** Ele descreve uma transição; quando o PR 10 fechar, ele é
apagado. O que sobrevive é o ADR 0004 (por que Nest) e `docs/nest-conceitos.md` (por que o
código está fiado assim).
