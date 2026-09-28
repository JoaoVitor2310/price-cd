/**
 * Setup da suíte, executado ANTES de qualquer módulo de teste ser importado.
 *
 * É o único lugar de onde dá para desligar o agendador de bump, e o motivo é
 * uma armadilha do `@nestjs/config` documentada em
 * `src/nest/config/config.module.ts`: `ConfigModule.forRoot()` valida o
 * ambiente quando o **arquivo é importado**, não quando o módulo é
 * instanciado. Uma variável que tem default no schema — como esta — fica
 * congelada com o valor daquele instante, e nenhum `process.env.X = ...` dentro
 * de `beforeAll` a muda mais.
 *
 * Era exatamente esse o bug: quatro arquivos de teste setavam
 * `BUMP_SCHEDULER_ENABLED = "false"` num `beforeAll`/`beforeEach`, depois do
 * `import { AppModule }` no topo — sem efeito nenhum. O primeiro tick do bump
 * rodava em todos eles e só não abriu Chromium porque `initializeBrowser()`
 * recusa rodar sob `VITEST`. O que aparecia era um `ERROR [BumpScheduler]` no
 * meio da saída da suíte, lido como ruído.
 *
 * `setupFiles` roda antes do grafo de imports do arquivo de teste, então aqui a
 * atribuição chega em tempo.
 */
process.env.BUMP_SCHEDULER_ENABLED = "false";
