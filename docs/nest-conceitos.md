# Conceitos do Nest.js, mapeados a este código

Guia de referência: cada conceito do Nest explicado pelo problema que ele resolve **neste
projeto**, com a armadilha correspondente. Não substitui a documentação oficial — substitui
o tutorial genérico de blog, que ensina o Nest com um CRUD e não com um scraper que segura
processos de Chromium.

O plano de migração está em `docs/NEST.md`; a decisão e seus trade-offs, em
`docs/adr/0004-nest-como-camada-de-apresentacao.md`.

Enquanto a migração corre, este arquivo é escrito no futuro do pretérito ("vai ser").
Conforme cada PR fecha, a seção correspondente é reescrita no presente, descrevendo o que
o código faz — é documentação viva, não anotação de estudo.

---

## 1. O modelo mental: container, módulo, provider

O Nest é, no essencial, **um container de injeção de dependências com um roteador HTTP em
volta**. Tudo o mais é conveniência construída sobre isso.

O container mantém um **grafo de dependências**. Você declara *o que existe* (providers) e
*quem precisa de quê* (parâmetros de construtor); o container descobre a ordem de construção,
instancia uma vez, e entrega a mesma instância a todo mundo que pedir.

É exatamente o que `src/services/` faz hoje, à mão:

```ts
// src/services/games/research-games.service.ts — hoje
let _scheduler: BackgroundScheduler | undefined;
function getScheduler(): BackgroundScheduler {
  if (!_scheduler) _scheduler = new LimitedConcurrencyScheduler(1);
  return _scheduler;
}
```

Esse padrão — singleton preguiçoso com variável de módulo — se repete em
`research-games.service.ts`, `enqueue-run-lists.service.ts` e `find-new-suppliers.factory.ts`.
Funciona, mas: a ordem de construção é implícita (depende de quem importa primeiro), não há
ponto único para desligar nada, e testar exige `vi.mock` no módulo inteiro.

Três blocos, e a divisão de trabalho entre eles:

| Bloco | O que é | Neste projeto |
|---|---|---|
| **Provider** | Qualquer coisa que o container sabe construir e entregar | Adapters de `infrastructure/`, use cases de `application/`, filas, sessões de browser |
| **Módulo** | Uma caixa que agrupa providers e declara o que importa e o que exporta | `GamesModule`, `ListsModule`, `SuppliersModule`, `BrowserModule` |
| **Controller** | Provider especial que o roteador conhece: mapeia HTTP → método | Substitui `src/routes/` + `src/controllers/` |

---

## 2. `@Injectable()` — o que ele realmente faz

Não é "registrar no container". Registrar é papel do array `providers` do módulo.

`@Injectable()` faz **uma** coisa: marca a classe para que o TypeScript emita
`design:paramtypes` — a lista de tipos dos parâmetros do construtor — como metadata em
runtime. Sem pelo menos um decorator na classe, o TS não emite nada, e o container não tem
como saber o que injetar.

Consequências práticas:

- Uma classe sem dependências no construtor **não precisa** de `@Injectable()` para ser
  provider. Mas coloque mesmo assim: no dia em que ela ganhar uma dependência, ninguém vai
  lembrar do porquê da omissão.
- Isso depende de `emitDecoratorMetadata: true` no `tsconfig.json` **e** de um transform que
  preserve metadata. O esbuild do Vitest não preserva — daí o risco 7.2 do `NEST.md`.

---

## 3. Providers e tokens: o problema que o TypeScript cria

**Interface de TypeScript não existe em runtime.** Ela some na compilação. Então isto é
impossível:

```ts
constructor(private readonly fetcher: PopularityFetcher) {}  // ❌ o container não sabe o que é isso
```

Esse é o atrito central entre Nest e arquitetura hexagonal, e todo projeto que usa portas
esbarra nele. Existem três saídas, e **o PR 3 precisa escolher uma e seguir até o fim**:

### A) Token explícito (`Symbol` ou `string`)

```ts
// application/games/ports/game-search.ports.ts
export const POPULARITY_FETCHER = Symbol("PopularityFetcher");
export interface PopularityFetcher { fetch(names: string[], min: number): Promise<FoundGames[]>; }

// application/games/search-games.use-case.ts
@Injectable()
export class SearchGamesUseCase {
  constructor(@Inject(POPULARITY_FETCHER) private readonly popularityFetcher: PopularityFetcher) {}
}

// nest/games/games.module.ts
providers: [{ provide: POPULARITY_FETCHER, useClass: SteamChartsPopularityFetcher }]
```

Explícito e à prova de falha de metadata. Custo: `application/` importa `@nestjs/common`.

### B) Porta como classe abstrata — **recomendada**

Uma classe abstrata **existe em runtime** (é um valor), então serve de token sozinha:

```ts
// application/games/ports/game-search.ports.ts — sem nada do Nest
export abstract class PopularityFetcher {
  abstract fetch(names: string[], min: number): Promise<FoundGames[]>;
}

// application/games/search-games.use-case.ts
@Injectable()
export class SearchGamesUseCase {
  constructor(private readonly popularityFetcher: PopularityFetcher) {}  // ✅ sem @Inject
}

// nest/games/games.module.ts
providers: [{ provide: PopularityFetcher, useClass: SteamChartsPopularityFetcher }]
```

Os adapters continuam usando `implements PopularityFetcher` — em TypeScript, `implements`
sobre classe abstrata é só contrato de tipo, não herança. Nenhum comportamento muda.

Custo: as portas deixam de ser `interface` e viram `abstract class`. Ganho: `@Inject` some, e
a porta continua **100% framework-free** — classe abstrata é TypeScript puro. Depende de
metadata funcionando (risco 7.2); se falhar, o fallback é A.

### C) `useFactory` para tudo

```ts
// use case sem decorator nenhum — application/ intocado
providers: [{
  provide: SearchGamesUseCase,
  useFactory: (p: PopularityFetcher, pr: PriceFetcher) => new SearchGamesUseCase(p, pr),
  inject: [POPULARITY_FETCHER, PRICE_FETCHER],
}]
```

Fronteira perfeita: `application/` não importa nada do Nest, nem `@Injectable()`. Custo: cada
use case ganha ~5 linhas de wiring manual, e você reimplementa parte do que o container faria.

### Os quatro tipos de provider

| Forma | Quando usar | Exemplo aqui |
|---|---|---|
| `useClass` | O container constrói e injeta as dependências | `{ provide: PriceFetcher, useClass: AllKeyShopPriceFetcher }` |
| `useValue` | Valor pronto — config, constante, dublê em teste | `{ provide: MAX_ACTIVE_LISTS, useValue: 3 }` |
| `useFactory` | Construção precisa de lógica ou de outro provider | `HttpGameTradeImporter`, que precisa de URL e secret do config |
| `useExisting` | Apelido para um provider já registrado | Duas portas atendidas pelo mesmo adapter |

`useFactory` aceita função `async` — útil se algum dia a construção precisar de I/O. Cuidado:
isso **atrasa o boot** até a promise resolver. Não é onde abrir um Chromium.

---

## 4. Módulos: `imports`, `providers`, `exports`

```ts
@Module({
  imports:     [BrowserModule],        // o que EU consumo de outros módulos
  controllers: [SuppliersController],  // rotas HTTP deste módulo
  providers:   [FindNewSuppliersUseCase, …],  // o que EU construo
  exports:     [FindNewSuppliersUseCase],     // o que ofereço a quem me importar
})
export class SuppliersModule {}
```

Regra: um provider só é visível dentro do módulo que o declara, **a menos que** seja
exportado — e quem quer usá-lo precisa importar o módulo.

### ⚠️ A armadilha que custa memória aqui

**Declarar o mesmo provider em `providers` de dois módulos cria duas instâncias.**

Isso é a coisa mais importante deste documento para este projeto. Se `SharedBrowserSession`
aparecer em `providers` do `GamesModule` **e** do `SuppliersModule`, o container constrói
duas — dois gerenciadores de Chromium, num container com `mem_limit: 2g` que já foi ao chão
por vazamento de browser em 2026-08-24.

O sintoma é traiçoeiro: tudo funciona, os testes passam, e o consumo de memória dobra em
produção sem erro nenhum no log.

```ts
// ❌ duas instâncias
@Module({ providers: [SharedBrowserSession] })  export class GamesModule {}
@Module({ providers: [SharedBrowserSession] })  export class SuppliersModule {}

// ✅ uma instância
@Module({ providers: [SharedBrowserSession], exports: [SharedBrowserSession] })
export class BrowserModule {}
@Module({ imports: [BrowserModule] })  export class GamesModule {}
@Module({ imports: [BrowserModule] })  export class SuppliersModule {}
```

Vale para tudo que tem estado: sessões de browser, filas, caches. Está no checklist do
critério de conclusão (`NEST.md` §8).

### `@Global()`

Marca um módulo cujos exports ficam disponíveis em toda a aplicação sem `imports`. Conveniente
para config, veneno para o resto: torna o grafo de dependências invisível. Aqui, só o
`ConfigModule` (via `isGlobal: true`).

### Dynamic modules — `forRoot()` / `registerAsync()`

Módulo comum é estático. Quando um módulo precisa ser **configurado** por quem o importa, ele
expõe um método estático que devolve a definição do módulo:

```ts
ConfigModule.forRoot({ isGlobal: true, validate })
ScheduleModule.forRoot()
```

Convenção de nomes da comunidade: `forRoot()` para configuração global e única (uma vez no
`AppModule`), `register()` para configuração por módulo consumidor, e o sufixo `Async` quando
a configuração depende de outro provider (`forRootAsync({ inject: [ConfigService], useFactory })`).

### Dependência circular

Se `A` importa `B` e `B` importa `A`, o container trava e você precisa de
`forwardRef(() => B)`. Funciona, mas **é sintoma, não solução**: quase sempre significa que
há um terceiro conceito querendo nascer. Com a estrutura em camadas deste projeto
(domain → application → infrastructure → apresentação), um ciclo entre módulos é sinal de que
algo foi parar na camada errada.

---

## 5. Escopos

| Escopo | Quantas instâncias | Uso |
|---|---|---|
| `DEFAULT` (singleton) | Uma por aplicação | **Tudo aqui.** |
| `Scope.REQUEST` | Uma por requisição | Nenhum caso neste projeto |
| `Scope.TRANSIENT` | Uma por consumidor | Nenhum caso neste projeto |

Escopo default é singleton, e é o certo aqui: os fetchers, as filas e as sessões de browser
são compartilhados por desenho. `AllKeyShopPriceFetcher` por request seria catastrófico — o
scraping do AllKeyShop depende de uma sessão de browser compartilhada e serializada.

**A armadilha do request scope: ele sobe pela cadeia.** Se um provider é request-scoped, todo
provider que depende dele também vira request-scoped, e assim por diante até o controller.
Um `LoggerService` request-scoped inocente pode transformar meia aplicação em instâncias
por requisição — inclusive coisas que seguram processo de Chromium.

Se um dia for preciso correlacionar logs por requisição, a saída barata é `AsyncLocalStorage`
do Node, não request scope.

---

## 6. O pipeline de request

A ordem importa e é fixa:

```
requisição
   → middleware        (nível Express; configurado em configure(consumer))
   → guards            (autorização: retorna true/false)
   → interceptors      (antes do handler)
   → pipes             (validação e transformação do input)
   → HANDLER           (método do controller)
   → interceptors      (depois do handler; transformam a resposta)
   → exception filters (se algo lançou em qualquer ponto acima)
resposta
```

### Pipes — o que substitui o `schema.parse` dos controllers

Pipe transforma e/ou valida o argumento antes de o handler recebê-lo:

```ts
@Post("search")
async search(@Body(new ZodValidationPipe(fileContentSchema)) body: FileContent) { … }
```

O `ZodValidationPipe` deste projeto tem ~15 linhas e relança o `ZodError`, deixando a
formatação do 400 para o filter — assim, um `ZodError` lançado fora de um pipe (dentro de um
use case, por exemplo) produz exatamente a mesma resposta. Zod continua sendo a validação do
projeto; `class-validator` (o default dos tutoriais) não entra.

### Exception filters — o que substitui o `try/catch` triplicado

Um filter global captura o que subiu e traduz para resposta HTTP. Um arquivo elimina o bloco
repetido nos cinco controllers atuais:

```ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // ZodError      → 400 com as mensagens concatenadas (formato de hoje, preservado)
    // HttpException → passa adiante
    // resto         → 500
  }
}
```

⚠️ Exceções lançadas em **middleware** não passam pelos filters do Nest — caem no tratamento
de erro do Express. Trate ali mesmo, se um dia houver middleware.

### `useGlobalPipes()` vs `APP_PIPE`

```ts
app.useGlobalPipes(new ZodValidationPipe(schema));                    // ❌ não injeta nada
providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }]       // ✅ participa do container
```

O primeiro instancia fora do contexto do módulo — a instância não pode receber dependências.
O segundo registra como provider e ganha DI. Mesmo raciocínio para `APP_FILTER`,
`APP_GUARD` e `APP_INTERCEPTOR`. Como o filter aqui vai querer logar (e um dia notificar, via
o `AlertNotifier` do item 4 do `IMPROVEMENTS.md`), use a segunda forma desde o PR 2.

### Guards — e por que `/api/games/research` não usa um

Guard responde uma pergunta binária: *esta requisição pode seguir?* `false` → 403, fim.

O contrato de `/api/games/research` não é assim. Token ausente ou errado significa **modo demo
com 200**, não rejeição:

```ts
// src/controllers/games/research-games.controller.ts — hoje
if (isAuthenticated(internal_secret)) { await enqueue(...); res.status(202)... }
const games = await demo(request);  res.status(200)...
```

Um Guard que retorna `false` para token errado mudaria o contrato público e quebraria o
harness de contrato. Se quiser usar o conceito mesmo assim, o caminho honesto é um Guard que
**sempre** retorna `true` e apenas anota `request.isAuthenticated` — decisão de gosto, não de
arquitetura, e o `NEST.md` PR 4 registra qual foi escolhida.

Esse é o tipo de coisa que vale ter visto: nem todo endpoint com token é "autorização".

### Interceptors — não usados hoje

Envolvem o handler e podem transformar a resposta ou o erro (padrão AOP: logging, cache,
timeout, mapeamento de resposta). Nenhum caso agora. Candidatos futuros: log de duração dos
scrapings, ou um envelope `{ success, data }` uniforme — que hoje é montado à mão em cada
controller e **não é consistente entre eles**.

---

## 7. Ciclo de vida — a parte que mais importa neste projeto

O container também sabe **destruir**. Num app que segura processos de Chromium, isso deixa de
ser detalhe: é a diferença entre um `docker compose restart` limpo e um vazamento.

```
NestFactory.create()
   → construção do grafo
   → onModuleInit            (módulo pronto; dependências resolvidas)
   → onApplicationBootstrap  (aplicação inteira pronta, já escutando)
   … app rodando …
   → SIGTERM / SIGINT  (só se enableShutdownHooks() foi chamado)
   → onModuleDestroy
   → beforeApplicationShutdown
   → onApplicationShutdown   (recebe o sinal recebido)
   → processo encerra
```

Escolha do hook de inicialização: `OnModuleInit` para preparar o próprio módulo;
`OnApplicationBootstrap` para o que só faz sentido com o app inteiro de pé — como disparar o
primeiro tick do bump scheduler.

`app.enableShutdownHooks()` é **opt-in** (registra listeners de sinal, e o Nest deixa isso a
cargo de quem quer). Sem ele, `onApplicationShutdown` nunca roda. Chamar no `main.ts`.

### O que isso conserta aqui

Hoje, `src/infrastructure/background/bump-topics-scheduler.ts`:

```ts
const shutdown = async () => {
  await disposeIfPresent(bumper);
  process.exit(0);          // ⚠️ mata o processo aqui
};
process.once("SIGTERM", () => void shutdown());
```

Esse é o **único** handler de sinal do processo, e o `process.exit(0)` corta o desligamento
antes de qualquer outra coisa rodar — a sessão compartilhada do AllKeyShop
(`invalidateSharedSession`) e a de suppliers (`cleanupSuppliersSession`) nunca são fechadas
num SIGTERM. Considerando que `cleanupBrowser` (`src/lib/puppeteer-browser.ts`) foi escrito
justamente para derrubar a árvore de processos na ordem certa — `close()` via CDP primeiro,
sinal depois —, deixá-lo sem ser chamado no desligamento é desperdiçar a correção.

Com o container: cada sessão implementa `OnApplicationShutdown`, o handler manual some, e o
Nest chama todas.

**Não confie na ordem de destruição entre módulos.** Se A precisa morrer antes de B, torne
isso explícito — B injeta A e fecha na sequência que quer, ou um único provider coordena.

### Ciclo de vida do container ≠ dispose por execução

`FetchListTopic` implementa o `Disposable` do projeto (`src/lib/dispose.ts`) e é descartado
no `finally` do `RunListsUseCase`, uma vez **por execução**. Isso não é `OnModuleDestroy`, que
roda uma vez por vida do app. Os dois coexistem e resolvem problemas diferentes — confundi-los
significa ou vazar browser por execução, ou fechar o browser errado no meio de um scraping.

---

## 8. Testes: `Test.createTestingModule`

O container também monta o grafo em teste, e você troca qualquer nó:

```ts
const moduleRef = await Test.createTestingModule({ imports: [GamesModule] })
  .overrideProvider(PopularityFetcher).useValue({ fetch: mockPopularityFetch })
  .overrideProvider(PriceFetcher).useValue({ fetch: mockPriceFetch })
  .compile();

const app = moduleRef.createNestApplication();
await app.init();
await request(app.getHttpServer()).post("/api/games/search").send(body).expect(200);
```

Compare com o que os testes de integração fazem hoje:

```ts
vi.mock("@/infrastructure/games/steam-charts-popularity-fetcher.js", () => ({
  SteamChartsPopularityFetcher: vi.fn().mockImplementation(() => ({ fetch: mockPopularityFetch })),
}));
```

O `vi.mock` intercepta o **sistema de módulos** — precisa do caminho exato do arquivo, do
`vi.hoisted` para ordem de avaliação, e quebra quando o arquivo é renomeado. O
`overrideProvider` substitui um **nó do grafo**: é a mesma troca que o desenho de portas e
adapters já prometia, agora sem depender do bundler.

Isso vale só para os 4 arquivos de `test/integration/routes/`. Os testes de `domain/`,
`helpers/` e `lib/` não mudam — são funções puras e classes construídas à mão, e continuam
sendo o jeito certo de testá-las. **Não instancie o container para testar
`clear-string.ts`.**

---

## 9. Colisão de vocabulário: "service"

Nos tutoriais de Nest, `*.service.ts` é onde mora a regra de negócio: o controller chama
`UsersService`, que fala com o banco.

**Aqui não.** Regra de negócio vive em `src/domain/` (funções puras) e `src/application/`
(use cases). E `src/services/` neste repositório é outra coisa ainda: é o composition root
manual — exatamente o que o container substitui.

Convenção adotada na migração, para não haver ambiguidade:

| Nome | Onde | O que contém |
|---|---|---|
| `*.use-case.ts` | `application/` | Orquestração de domínio e portas. Continua sendo o nome. |
| `*.controller.ts` | `nest/<módulo>/` | Só HTTP: parse, chamada ao use case, resposta. |
| `*.module.ts` | `nest/<módulo>/` | Só wiring. |
| `*.service.ts` | — | **Não usar.** O diretório `src/services/` desaparece no PR 10. |

Se em algum PR aparecer um `*.service.ts` com um `if` de regra de negócio dentro, a migração
saiu do trilho: aquilo é um use case em `application/`.

---

## 10. O que o Nest oferece e este projeto não vai usar

Saber o que ficou de fora, e por quê, vale tanto quanto saber o que entrou.

| Recurso | Por que não |
|---|---|
| TypeORM / Prisma / Mongoose | `docs/adr/0001` — o price-cd é stateless por decisão. Estado vive no Sistema Estoque, consultado por porta. |
| `class-validator` / `class-transformer` | Zod já é o padrão do projeto, com schemas prontos em `src/schemas/`. Uma linguagem de validação basta. |
| GraphQL | A API são 5 endpoints REST consumidos por um sistema só. |
| Microservices / transports | Um processo, um container. |
| CQRS module | Não há separação leitura/escrita a fazer num scraper sem banco. |
| Guards para autenticação | O contrato do modo demo exige 200 com token errado. Ver §6. |
| Interceptors | Nenhum caso hoje. Candidatos futuros em §6. |
| Fastify adapter | O Express platform é o que preserva paridade de comportamento durante o strangler. Trocar depois, se houver motivo medido — não há. |
| BullMQ (`@nestjs/bullmq`) | A fila in-process resolve hoje. Vira candidato se os itens 4 e 5 do `IMPROVEMENTS.md` exigirem sobreviver a restart — e aí o `BackgroundScheduler` já é uma porta, então troca-se o adapter. |

A última linha é o argumento de que a arquitetura atual estava certa: adotar Nest não obriga
a adotar o ecossistema inteiro.

---

## 11. Checklist de armadilhas

- [ ] Provider com estado declarado em `providers` de dois módulos → **duas instâncias**. Use
      um módulo dono + `exports`/`imports`. (§4 — o de maior custo aqui.)
- [ ] Interface de TS como token de injeção → não existe em runtime. (§3)
- [ ] `emitDecoratorMetadata` sem transform que o preserve → o container não resolve nada. (§2)
- [ ] `useGlobalPipes`/`useGlobalFilters` quando o pipe ou filter precisa injetar → use
      `APP_PIPE`/`APP_FILTER`. (§6)
- [ ] `Scope.REQUEST` num provider fundo → contamina a cadeia inteira para cima. (§5)
- [ ] Esquecer `app.enableShutdownHooks()` → `onApplicationShutdown` nunca roda, Chromium
      sobrevive ao SIGTERM. (§7)
- [ ] Depender da ordem de destruição entre módulos → torne explícita. (§7)
- [ ] Guard para autenticação que deveria ser opcional → muda o contrato público. (§6)
- [ ] `*.service.ts` com regra de negócio → é use case, vai para `application/`. (§9)
- [ ] `forwardRef` para resolver ciclo → sintoma de coisa na camada errada. (§4)
- [ ] Subir container do Nest para testar função pura → teste direto. (§8)

---

## 12. Leitura

Documentação oficial — https://docs.nestjs.com — nesta ordem, que é a de utilidade para esta
migração e não a do índice do site:

1. **Modules**, **Providers**, **Custom providers** — o núcleo. §1 a §4 daqui.
2. **Injection scopes** — curto, e evita o erro de §5.
3. **Pipes**, **Exception filters** — o que substitui o boilerplate dos controllers.
4. **Lifecycle events** — a parte que mais importa neste projeto.
5. **Testing** — `Test.createTestingModule` e `overrideProvider`.
6. **Configuration** (`@nestjs/config`), **Task scheduling** (`@nestjs/schedule`) — sob demanda,
   nos PRs 2 e 7.
7. **Guards**, **Interceptors**, **Middleware** — leia para conhecer; aqui, para saber por que
   não estão sendo usados.

Sobre o padrão de migração: Martin Fowler, *StranglerFigApplication* (2004) —
https://martinfowler.com/bliki/StranglerFigApplication.html
