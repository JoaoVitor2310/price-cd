# Plano de migração para Nest.js

Documento operacional. Descreve como sair do estado atual (Express 5 + composition root
manual) para Nest.js sem congelar a `main` e sem impedir correções urgentes durante a
transição.

Os conceitos do Nest usados aqui — container, providers, tokens, escopos, pipeline de
request, ciclo de vida — estão explicados em **`docs/nest-conceitos.md`**, mapeados a este
código. Este arquivo assume esse vocabulário e trata só da sequência e da estratégia.

Status: **PRs 0 a 6 entregues.** As **cinco** rotas existem nos dois apps e passam na mesma
bateria de contrato. Produção segue no Express. Próximo: PR 7 (agendador de bump).

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
4. **Config validada no boot.** `process.env` era lido em 14 arquivos (27 variáveis
   distintas), inclusive **dentro do `RunListsUseCase`** (`MAX_ACTIVE_LISTS`) — violação de
   camada: o use case não deveria conhecer `process.env`. O `ConfigModule` valida tudo uma
   vez, no boot, e injeta valores tipados. A violação do `RunListsUseCase` foi corrigida no
   PR 5; `grep -rn "process.env" src/application/` hoje devolve só comentários.

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

### O cenário que forçaria a branch longa — descartado no PR 0

Havia um só: precisar trocar o sistema de módulos (ESM → CommonJS), porque os dois entrypoints
não coexistem sob `"type"` diferente no `package.json`. O spike do PR 0 provou Nest 12 rodando
sob `"type": "module"` com as libs do projeto carregadas (ADR 0004), então **a branch longa
está fora**: a coexistência acontece na `main`, como descrito acima. Ver 7.1.

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
| 1 | ✅ Harness de contrato (só Express) | — | — |
| 2 | ✅ Esqueleto Nest + ConfigModule | 0, 1 | `NestFactory`, `@Module`, dynamic module, pipes e filters globais |
| 3 | ✅ Módulo `games`: `/search`, `/search-id-steam` | 2 | `@Controller`, custom providers, injection tokens, `Test.createTestingModule` |
| 4 | ✅ Módulo `games`: `/research` | 3 | `useFactory`, providers com estado, por que **não** usar Guard aqui |
| 5 | ✅ Módulo `lists` | 4 | duas instâncias da mesma classe com tokens distintos, `OnModuleDestroy` |
| 6 | ✅ Módulo `suppliers` + ciclo de vida do browser | 5 | `exports`/`imports` vs provider duplicado, `OnApplicationShutdown` |
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

1. **Nest roda com `"type": "module"` neste projeto?** ✅ **Sim.** `AppModule` com porta
   injetada por `abstract class`, importando `puppeteer-real-browser`, `cheerio` e `zod`,
   responde HTTP 200. ESM fica, strangler na `main`.
2. **`emitDecoratorMetadata` funciona sob Vitest?** ⚠️ **Só com `unplugin-swc`.** Com o
   esbuild padrão do Vitest 3.2.4 os testes falham. Medido também fora do Vitest: `tsc` emite
   (o build de produção está salvo), `tsx` **não** — `npm run dev` migra para
   `node --import @swc-node/register/esm-register`.
3. **Fixar a major do Nest.** ✅ **12.x** (`@nestjs/core` 12.0.1 em 2026-09-03; o plano supunha
   11.x, que já não é a atual). `@nestjs/config` acompanha em 12.0.0.

Saída: `docs/adr/0004-nest-como-camada-de-apresentacao.md` — **escrito**, registrando sistema
de módulos, versão do Nest, toolchain de metadata e a fronteira de camadas da seção 1.

Decide de quebra o `moduleResolution: "node"` (depreciado para ESM), que precisava ser
resolvido aqui de qualquer forma. Aplicado no PR 2.

---

### PR 1 — Harness de testes de contrato ✅ **entregue**

Seção 4. Só Express nesta altura — `nest.contract.test.ts` nasce no PR 3.

Não é opcional e não pode vir depois: a partir do PR 3, cada módulo Nest altera assinatura de
use case compartilhado com o Express. Sem o harness, não há como afirmar que o Express
continua íntegro a cada PR.

O que existe hoje, em `test/contract/`:

| Arquivo | Papel |
|---|---|
| `contract-cases.ts` | 19 casos cobrindo as 5 rotas + `GET /` + 404. O contrato como ele **é**. |
| `api-contract.suite.ts` | `runApiContract(getServer, only?)` — o opt-in por rota |
| `doubles.ts` | dublês dos adaptadores de `infrastructure/` (camada que não migra) |
| `express.contract.test.ts` | a bateria contra o app Express |

A costura dos dublês é `infrastructure/`, não `services/`: é o que permite o mesmo arquivo de
dublês servir ao app Nest no PR 3 sem duplicação, já que `services/` morre no PR 10. O
agendador é inerte de propósito — registra a tarefa e não a executa, que é exatamente o
contrato de um 202. Nada abre browser; a bateria roda em ~800ms.

Validado por mutação: trocar o `202` de `/api/lists/run` por `200` faz falhar 1 caso, o
certo. Um harness que passa com o código quebrado não é portão de nada.

---

### PR 2 — Esqueleto Nest + ConfigModule ✅ **entregue**

Sobe um app Nest que não serve nenhuma rota de negócio. Produção segue no Express; o
Dockerfile não mudou.

| Arquivo | Papel |
|---|---|
| `src/config/env.schema.ts` | schema Zod de todas as 22 variáveis de `process.env`. Fora de `src/nest/` porque descreve o processo, não a apresentação |
| `src/nest/config/config.module.ts` | `ConfigModule.forRoot({ isGlobal, cache, validate })` |
| `src/nest/common/zod-validation.pipe.ts` | `schema.parse` no `transform`, deixando o `ZodError` subir |
| `src/nest/common/all-exceptions.filter.ts` | o `try/catch` dos 5 controllers, num arquivo só |
| `src/nest/health/health.controller.ts` | `GET /api/health`, a prova de que a DI resolve |
| `src/nest/app.module.ts` | composition root; filter via `APP_FILTER` |
| `src/main.ts` | entrypoint, irmão de `server.ts`; `PORT_NEST=5557` |

**Toolchain (ADR 0004 aplicado):** `experimentalDecorators` + `emitDecoratorMetadata` no
`tsconfig.json`, `moduleResolution` de `"node"` para `"bundler"`, `.swcrc` novo e
`unplugin-swc` no `vitest.config.ts`. Scripts `dev:nest` (via `@swc-node/register`, não `tsx`)
e `start:nest`. O `npm run dev` do Express segue no `tsx`: ele não tem decorator, não precisa
de SWC — só troca no PR 10.

**Validação no boot, não no primeiro request.** Duas variáveis inválidas derrubam o processo
listando as duas de uma vez. É ganho real sobre o Express, onde
`Number(process.env.X) || default` engole `"abc"` como default em silêncio.

**O que é obrigatório:** quase nada. Exigir variável muda comportamento, e a maioria dos
fluxos é degradável de propósito — `/api/games/research` sem `INTERNAL_SECRET` responde em
modo demo, que é contrato coberto em `test/contract/`. Só `STEAMTRADES_SESSION`,
`SISTEMA_ESTOQUE_URL` e `EXTERNAL_SECRET` são exigidos, e apenas sob `NODE_ENV=production`.
Em dev e teste o app sobe com `.env` vazio.

#### Desvios do plano original, e por quê

**Não há `APP_PIPE`.** O plano previa registrar o `ZodValidationPipe` globalmente, mas ele
recebe o schema no construtor — cada rota valida contra um schema diferente. Ele é aplicado
por parâmetro (`@Body(new ZodValidationPipe(gameSearchSchema))`). Pipe global só faria sentido
se existisse validação válida para toda rota.

**`setGlobalPrefix` e `useStaticAssets` vieram do PR 8.** O plano os listava lá, e o PR 2
pedia `GET /health`. Entregou-se `/api/health`, porque sem o prefixo o app Nest não tem as
mesmas URLs do Express e a bateria de contrato do PR 3 não teria onde bater. É antecipação
deliberada; o PR 8 fica com o `SERVER_TIMEOUT_MS` e o resto da paridade.

**`cache: true` no ConfigModule** não estava no plano. Entrou porque o ambiente é validado no
boot e reler `process.env` a cada acesso contradiria isso. Tem consequência de teste: o app
Nest não enxerga mutação de `process.env` feita depois do boot — por isso o harness ganhou
`withEnv` por app em vez de mutar o ambiente direto.

**O filter global não cobre o contrato inteiro.** As rotas não respondem erro no mesmo
formato (`test/contract/contract-cases.ts`): duas usam `{ error, details }`, duas usam a
mensagem em `data`, com prefixos diferentes e uma delas em português. Um filter global só tem
um default — aqui é `{ error: "Validation failed", details }`, que cobre 2 das 4. As outras
duas precisam de tratamento próprio nos PRs 4 e 5, porque mudar o formato delas **é mudança de
contrato** e o plano proíbe isso durante a migração. A bateria de contrato falha se alguém
esquecer.

---

### PR 3 — Módulo `games`: `/search` e `/search-id-steam` ✅ **entregue**

> **Obrigatório neste PR:** estas duas rotas respondem 500 como
> `{ error: "Internal server error", message: "Failed to analyze games" }` — sem ponto final e
> com `message`, não `details`. O `AllExceptionsFilter` global responde o outro formato. Declare
> o formato legado com `@UseFilters(...)` no controller. A bateria de contrato já cobre os três
> formatos de 500 e falha se isso for esquecido.
>
> **Também obrigatório:** o `nest.contract.test.ts` precisa fornecer um `withEnv` que reconstrua
> o módulo de teste — o Nest congela o ambiente no boot, então mutar `process.env` não funciona
> do lado dele.

Fluxos síncronos, sem fila e sem auth. É onde a receita é validada antes de aplicá-la aos
fluxos difíceis.

Receita, aplicada igual nos PRs 3 a 6:

1. **As portas ganham um token de injeção.** Interface de TypeScript não existe em runtime,
   então não dá para injetar por tipo — é o atrito central entre Nest e arquitetura
   hexagonal. `nest-conceitos.md` §3 detalha as três saídas; a recomendada é **porta como
   `abstract class`**, que serve de token sozinha e mantém `application/` sem importar nada
   do Nest. **A decisão já está tomada: opção B**, registrada no ADR 0004 e resumida em
   `nest-conceitos.md` §3. Fallback para a opção A só se a metadata quebrar (risco 7.2), e só
   nos use cases afetados.
2. Os adapters de `infrastructure/` ganham `@Injectable()` e são registrados como
   `{ provide: PopularityFetcher, useClass: SteamChartsPopularityFetcher }`.
3. **O use case muda de assinatura**: as portas saem do objeto de entrada de `execute()` e vão
   para o construtor.

   ```ts
   // antes — dependência misturada com dado de entrada
   await useCase.execute({ gameNames, minPopularity, checkGamivoOffer,
                           popularityFetcher, priceFetcher });

   // depois — SEM @Injectable(): application/ não importa @nestjs/*
   class SearchGamesUseCase {
     constructor(
       private readonly popularityFetcher: PopularityFetcher,
       private readonly priceFetcher: PriceFetcher,
     ) {}
     async execute(input: { gameNames: string[]; minPopularity: number; checkGamivoOffer: boolean }) { … }
   }
   ```

   > **Correção do plano (PR 3).** Esta receita mostrava `@Injectable()` sobre o use case, o
   > que contradiz a fronteira do ADR 0004 — `application/` **nunca** importa `@nestjs/*`.
   > A combinação correta são duas decisões separadas:
   >
   > | O quê | Como | Onde |
   > |---|---|---|
   > | Token da porta | `abstract class` (opção B) | `application/**/ports/` |
   > | Registro do adapter | `useClass` + `@Injectable()` | `infrastructure/` |
   > | Registro do use case | `useFactory` + `inject` | declarado no módulo Nest |
   >
   > Sem decorator o TypeScript não emite `design:paramtypes`, então o container não descobre
   > o construtor sozinho — a lista `inject` é essa informação, escrita à mão. É o custo de
   > manter a camada limpa, e é uma linha por use case.

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

### PR 4 — Módulo `games`: `/research` ✅ **entregue**

Três coisas novas de uma vez.

- **Autenticação sem Guard.** Token ausente ou errado significa *modo demo com 200*, não 401.
  Guard que retorna `false` rejeita com 403 e mudaria o contrato. A checagem ficou em
  `GamesController.isAuthenticated()`, lendo `INTERNAL_SECRET` do `ConfigService`. Coberto por
  caso de contrato **e** por teste de módulo, os dois nomeando o 403 que **não** deve acontecer.
- **Fila como provider.** `LimitedConcurrencyScheduler(1)` entra como `useValue` sob o token
  `RESEARCH_SCHEDULER`. Token próprio, e não a porta `BackgroundScheduler`: existem duas filas
  com concorrências diferentes, e um token único para a porta faria elas colidirem no PR 5.
- **`useFactory` para dependência configurada.** `HttpGameTradeImporter` é construído a partir
  do `ConfigService`, mas de forma **preguiçosa** (`LazyGameTradeImporter`). A primeira versão
  construía no boot, e isso quebrou paridade: o Express sobe sem `SISTEMA_ESTOQUE_URL` e serve
  `/research` em modo demo, enquanto o Nest morria no boot. A checagem acontece no caminho
  autenticado, dentro da requisição — depois de enfileirado não há mais ninguém para receber o
  erro, que é a razão de o `assertTradeImporterConfigured()` do Express existir.

#### Duas descobertas que mudaram código fora do previsto

**O `.env` vencia `process.env` no `ConfigService`.** Com `INTERNAL_SECRET` exportado no
ambiente e outro valor no arquivo `.env`, o `ConfigService` devolvia o **do arquivo** — default
do `@nestjs/config`. Isso inverte a precedência que o resto do sistema assume: no
`docker-compose.yml` o bloco `environment:` existe justamente para mandar mais que o
`env_file:`. Um `.env` esquecido dentro da imagem sobrescreveria a configuração do deploy em
silêncio. Corrigido com `ignoreEnvFile: true` + `dotenv.config()` no `main.ts` (que não
sobrescreve variável já definida), e travado em
`test/integration/nest/config-precedence.test.ts`.

**O app Nest não subia sem o Sistema Estoque.** Encontrado pelo CI, não pelos testes locais:
o `.env` da máquina de desenvolvimento escondia o problema. Além do `LazyGameTradeImporter`,
nasceu `test/integration/nest/boot-without-inventory.test.ts`, que sobe o app com as variáveis
apagadas e cobra as três propriedades: o app sobe, o demo responde 200, e o caminho autenticado
falha **dentro da requisição** com 500, não em background.

Lição que se repete: **teste que lê o ambiente tem entrada escondida.** Os arquivos de
contrato do Nest agora forçam as variáveis no `beforeAll`, como o do Express já fazia desde o
PR 1.

**O modo demo passou a exigir o Sistema Estoque.** Ao mover `tradeImporter` para o construtor,
o caminho demo passou a construir o importer real — que lança se faltar `SISTEMA_ESTOQUE_URL`.
Regressão real: o demo existe para mostrar preços **sem** integração. Resolvido com
`NoopGameTradeImporter` (null object) e um teste que roda com as variáveis apagadas. Nenhum
caso de contrato pegaria isso, porque a bateria configura o ambiente.

#### Mudança de modelagem: `demo` virou dado

Antes, modo demo era inferido de `tradeImporter === undefined` — a dependência fazendo papel
de flag. Quem esquecesse de passar o importer criava um modo demo silencioso em vez de um erro.
Agora `ResearchGamesInput.demo` é booleano explícito e o importer é sempre injetado.

---

### PR 4.5 — Extrair o motor de precificação ✅ **entregue**

Não estava no plano original. Entrou porque o backlog registrava um gatilho explícito para
isto (item já removido do `IMPROVEMENTS.md`, porque este PR o resolveu) — *"se a migração Nest for reescrever essa fiação, fazer certo sai mais barato do
que portar o boilerplate"* — e ele disparou no PR 3.

**PR próprio, e não junto do PR 5, de propósito.** Refactor e migração não se misturam: se a
bateria de contrato ficar vermelha num PR que faz as duas coisas, não dá para saber qual
quebrou. Este não toca uma linha de `nest/` — é mudança pura no núcleo compartilhado, provada
pelo harness rodando contra o Express.

**O problema, objetivamente.** `SearchGamesUseCase` era ao mesmo tempo o caso de uso do
endpoint `/api/games/search` e o motor de precificação de `lists` e `suppliers`. A prova não
era estética: a porta `GameSearcher` devolvia `GameAnalysisResult`, que carrega um `summary`
com contagens e tempo de processamento existentes só para a resposta HTTP — e **nenhum dos
dois consumidores lia esse campo**. O contrato compartilhado tinha a forma da apresentação de
um terceiro.

**O que mudou:**

```
PriceGames  (application/games/price-games.ts)   ← nomes → jogos precificados
     ├── SearchGamesUseCase        envolve com summary + timing (só o endpoint)
     ├── ResearchGamesUseCase      mapeia para GameTradeInput
     ├── RunListsUseCase           usa direto
     └── FindNewSuppliersUseCase   usa direto
```

A porta `GameSearcher` passou a devolver `FoundGames[]`. O `summary` saiu do contrato
compartilhado e ficou onde serve.

**A camada de aplicação ganhou estrutura no mesmo PR**, porque o layout plano fazia o motor
parecer um use case:

```
application/<módulo>/
├── use-cases/    # objetivo completo de um ator: alguém dispara
├── services/     # colaborador reutilizável: ninguém dispara sozinho
└── ports/
```

`PriceGames` é um Application Service no sentido de DDD, e agora isso é visível pelo diretório.
O sufixo `.service.ts` segue proibido **enquanto `src/services/` existir** — o nome convidaria
a colocar o arquivo junto do composition root que o container está substituindo. Quando aquele
diretório morrer no PR 10, o sufixo fica livre. Ver `nest-conceitos.md` §9.

Aplicado a `games`, `lists`, `suppliers` e `bump` de uma vez, e espelhado em `test/unit/`: os
PRs 5 e 6 ficam migração pura, sem carregar reorganização junto.

Efeito colateral: `SearchGamesUseCase` e `ResearchGamesUseCase` deixaram de duplicar o mesmo
pipeline de cinco passos.

---

### PR 5 — Módulo `lists` ✅ **entregue**

- **Duas instâncias da mesma classe, tokens distintos.** `LISTS_SCHEDULER` usa
  `RUN_LISTS_CONCURRENCY`; `RESEARCH_SCHEDULER` usa 1 fixo. As filas são separadas para que
  uma execução longa de listas não trave uma pesquisa manual — registrar as duas sob o mesmo
  token entregaria a mesma instância para os dois fluxos, e a regressão seria silenciosa.
  Coberto por teste que afirma `listsQueue !== researchQueue`.
- **`MAX_ACTIVE_LISTS` saiu de dentro do use case.** Era
  `Number(process.env.MAX_ACTIVE_LISTS) || 3` dentro de `RunListsUseCase`. Agora vem do
  `ConfigService` por token. `grep -rn "process.env" src/application/` devolve só comentários.
- **Divergência do plano, deliberada.** A spec dizia "mantenha como está" sobre o
  `Disposable`. O use case passou a receber uma **fábrica** em vez da instância — sem isso
  ele não teria como criar um fetcher por execução com as dependências no construtor. O
  padrão de dispose por execução, que era o ponto do item, está preservado.
- **`Disposable` continua por execução.** `FetchListTopic` é dona de uma sessão de browser e
  é descartada no `finally`. Por isso o use case recebe uma **fábrica**
  (`ListTopicFetcherFactory`), não a instância: um provider singleton faria execuções
  concorrentes compartilharem a mesma sessão, e a primeira a terminar fecharia o browser das
  outras. `OnModuleDestroy` é para o que vive enquanto o app vive — não é o caso aqui.
- **`GamesModule` ganhou `exports`.** `lists` importa o módulo para usar `PriceGames` e
  `GameTradeImporter`. Redeclarar esses providers em `ListsModule` criaria instâncias
  separadas — a armadilha do §4 de `nest-conceitos.md`, que aqui significaria dois
  gerenciadores de sessão de browser no mesmo container.

#### Armadilha encontrada: `ConfigModule` resolve a configuração uma vez por processo

`ConfigModule.forRoot(...)` é avaliado quando o arquivo é **importado**, não a cada
instanciação. Medido: uma variável que existia no ambiente na hora do import fica congelada
com aquele valor; uma que não existia cai para leitura direta de `process.env` e acompanha
mudanças — dois comportamentos diferentes no mesmo `ConfigService`.

Em produção é invisível (o app sobe uma vez). Em teste significa que **reconstruir o módulo
com outro ambiente não muda o valor**. Um teste que tentava provar
`MAX_ACTIVE_LISTS=7` reconstruindo o módulo falhava por esse motivo, não por bug de wiring.

Consequência para quem escrever teste daqui pra frente: prove o mapeamento ambiente → valor
no schema (`test/unit/config/env.schema.test.ts`) e o wiring separado. Não tente as duas
coisas reconstruindo o módulo. Documentado no docblock de `config.module.ts`.

---

### PR 6 — Módulo `suppliers` + ciclo de vida do browser ✅ **entregue**

O PR de maior risco, e o que conserta um bug de produção.

**Estado global encapsulado.** `getSharedSession`, `invalidateSharedSession`,
`enqueueWithBrowser`, `getSuppliersSession` e `cleanupSuppliersSession` eram estado mutável de
módulo — singleton por acidente de import, sem dono. Viraram `SharedBrowserSession` e
`SuppliersBrowserSession`, providers do `BrowserModule`, que os **exporta**. Comportamento
idêntico: geração, reciclagem por idade, health check e fila continuam como estavam, agora
cobertos por 9 testes próprios.

**O bug de shutdown, corrigido nos dois apps.** `startBumpTopicsScheduler` era o único handler
de `SIGTERM` e chamava `process.exit(0)` — o processo morria antes de as sessões do AllKeyShop
e de fornecedores serem fechadas, e os Chromium delas ficavam órfãos (OOM de 2026-08-24). Agora:

| App | Quem desliga |
|---|---|
| Express | um handler só, em `src/server.ts`, fechando os **três** donos de browser |
| Nest | `BrowserShutdown` via `OnApplicationShutdown` |

O agendador devolve uma função de desligamento e não registra sinal nenhum — quem conhece o
processo inteiro é o entrypoint.

**A ordem é fixa: parar de aceitar requisição ANTES de fechar browser.** Ao contrário, uma
requisição que chegasse durante o teardown chamaria `getSharedSession()` e abriria um Chromium
**depois** do `invalidate()` — recriando o vazamento que este código existe para evitar. Há
ainda um teto de 30s: `server.close()` só devolve quando toda conexão morre, e com keep-alive
isso levaria os 10 minutos do `SERVER_TIMEOUT_MS`, tempo suficiente para o Docker mandar
SIGKILL e matar o Node antes dos browsers.

⚠️ **Verificação pendente.** O plano pede confirmar com `ps` que nenhum Chromium sobrevive a um
`SIGTERM`. O que foi verificado aqui é mais fraco: o hook dispara e o processo encerra — a
máquina de desenvolvimento não tem Chrome instalado, então nenhum browser chega a subir. **A
checagem com `ps` precisa ser feita no container**, antes do cutover do PR 9:
`docker compose up -d`, disparar um `/api/games/search`, `docker stop`, e conferir com
`ps aux | grep chrom` que a árvore sumiu.

**`useValue`, não `useClass`.** As instâncias vêm de `infrastructure/browser/sessions.ts`, as
mesmas que as fachadas usam. Se o container criasse as suas próprias, existiriam **dois**
gerenciadores de Chromium num container com `mem_limit: 2g`. Há teste afirmando que dois
grafos de módulo distintos resolvem a **mesma** instância.

#### Desvio do plano, deliberado

A spec dizia "cada sessão implementa `OnApplicationShutdown`". As sessões **não** implementam:
o hook vive num provider separado, `BrowserShutdown`. O motivo é a fronteira de camadas — as
sessões moram em `infrastructure/`, e implementar a interface obrigaria a importar
`@nestjs/common` para algo além de `@Injectable()`, que é o teto que o ADR 0004 permite ali.
O `BrowserShutdown` fica em `nest/`, onde conhecer o Nest é o trabalho.

#### Dois erros meus, e o que os pegou

**Import circular.** Pus os singletons em `lib/puppeteer-browser.ts`, que as classes de sessão
importam — ciclo fechado. O sintoma foi `SharedBrowserSession is not a constructor`, dependendo
da ordem de carga dos módulos. Resolvido movendo os singletons para
`infrastructure/browser/sessions.ts`: `lib/` volta a ser a folha que só sabe abrir e fechar um
Chromium. É também o lugar certo — gerência de sessão é infraestrutura.

**Repeti o erro do PR 4.** O `ProfitabilityChecker` era construído no boot e derrubava o app
quando faltava `SISTEMA_ESTOQUE_URL` — exatamente o que o `GameTradeImporter` fazia antes.
Quem pegou foi o `boot-without-inventory.test.ts`, escrito no PR 4 justamente para isso.
Resolvido com `LazyProfitabilityChecker`, e o controller passou a checar as três variáveis no
ciclo da requisição, como o Express faz.

---

### PR 7 — Agendador de bump

`startBumpTopicsScheduler` vira provider com `@Interval()` do `@nestjs/schedule`
(`ScheduleModule.forRoot()` no `AppModule`). O guard `running` vira campo do provider. O
`process.once("SIGTERM")` + `process.exit(0)` é **removido** — o PR 6 já deu o caminho certo.

Se o bump precisar rodar no boot antes do primeiro intervalo, use `OnApplicationBootstrap`
(app já ouvindo), não `OnModuleInit` (grafo ainda subindo).

`find-new-suppliers-scheduler.ts` **não migra** — e já foi apagado no PR 6, junto com a
chamada comentada em `src/server.ts`, quando o entrypoint foi reescrito para o desligamento
ordenado. O item correspondente saiu do `IMPROVEMENTS.md`. Não porte código morto para a
arquitetura nova.

---

### PR 8 — Paridade de infraestrutura HTTP

O que não é rota mas é comportamento observável:

- `express.static(public/)` → `app.useStaticAssets()` do `NestExpressApplication`.
- `GET /` servindo `public/index.html` — **não** o texto do LinkedIn. O
  `app.use(express.static(publicDir))` vem antes do `app.get("/")` em `src/app.ts`, então o
  estático vence e o handler de autoria é inalcançável (item 15 do IMPROVEMENTS). A ordem
  `useStaticAssets` vs rota precisa dar o mesmo resultado.
- `server.setTimeout(SERVER_TIMEOUT_MS)`.
- `app.setGlobalPrefix("api")` no lugar do `router.use("/api", ...)`.
- `search-id-steam.route.ts` deixa de existir como arquivo de rota — vira um `@Post()` no
  `GamesController`, junto de `/search`.

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

O projeto era `"type": "module"`, `"module": "ESNext"`, `"moduleResolution": "node"` (já
depreciado), com aliases `@/*` resolvidos por `tsc-alias` e imports
com extensão `.js` explícita. O Nest é historicamente CommonJS-first: o CLI scaffolda CJS e a
maior parte da documentação assume CJS.

**Resolvido no PR 0: ESM fica.** O spike subiu Nest 12 sob `"type": "module"` com
`puppeteer-real-browser`, `cheerio` e `zod` no mesmo processo e respondeu 200 — nenhum atrito
de interop apareceu. `moduleResolution` passou a `"bundler"` no PR 2. Ver ADR 0004.

### 7.2 Metadata de decorator no Vitest

**Resolvido no PR 0: `unplugin-swc` é obrigatório**, no Vitest e no runtime de dev. O que o
spike mediu:

| Ferramenta | Emite `design:paramtypes`? |
|---|---|
| `tsc` (`npm run build`) | sim |
| `tsx` (`npm run dev` hoje) | **não** |
| Vitest 3.2.4 com esbuild | **não** |
| Vitest + `unplugin-swc` | sim |
| `node --import @swc-node/register/esm-register` | sim |

O que faz disso uma armadilha, e não um erro de configuração comum: **sem metadata o Nest não
falha no boot.** Ele injeta `undefined` e a aplicação sobe; o estouro vem só na chamada da
rota, como 500 genérico. Pior, um teste que resolve o provider pelo token passa mesmo assim —
só asserção HTTP de ponta a ponta, ou leitura direta de `Reflect.getMetadata`, detecta. O PR 2
deve trazer os dois formatos de teste.

### 7.3 Estado global de módulo remanescente

Além do browser (PR 6), existe o `steamTradesGate` em
`src/infrastructure/lists/fetch-list-topic.ts` — promise chain global que serializa o acesso
ao SteamTrades. Enquanto os dois apps nunca rodam no mesmo processo, o singleton de módulo
continua correto para ambos. Migrar para provider depois do cutover, se incomodar.

### 7.4 Suíte de testes instável

O item **15** do `docs/IMPROVEMENTS.md` registra timeouts aleatórios do Vitest em WSL2 por
contenção de worker. Durante a migração isso é veneno: uma falha de timeout vai parecer
regressão do Nest. **Resolver antes do PR 3**, ou o sinal do harness de contrato fica ruidoso
justamente quando ele mais importa.

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
| `docs/IMPROVEMENTS.md` | PRs 2, 5, 7 | Fechar o item 12 (suíte instável); abrir o que o harness revelar. Item feito sai do arquivo — o backlog só guarda o que falta |
| `CLAUDE.md` | PRs 2, 9, 10 | Seções "Arquitetura" e "Tecnologias e Padrões" |
| `README.md` | PRs 8, 9, 10 | Stack, árvore de diretórios, Getting Started |
| `docs/wiki/` | PR 9 | Só se algum comportamento visível ao negócio mudar — não deveria mudar |
| `CONTEXT.md` | — | Nenhum termo de domínio muda. Migração de framework não toca o glossário. |

**Este arquivo é temporário.** Ele descreve uma transição; quando o PR 10 fechar, ele é
apagado. O que sobrevive é o ADR 0004 (por que Nest) e `docs/nest-conceitos.md` (por que o
código está fiado assim).
