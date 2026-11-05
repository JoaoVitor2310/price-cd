/**
 * Tokens de injeção próprios do módulo `games`.
 *
 * A fila da pesquisa não tem token aqui: a porta `ResearchQueue` é uma
 * `abstract class` e serve de token (ADR 0009). `lists` e `suppliers` ainda usam
 * a `BackgroundScheduler`, que é `interface` — por isso cada fila deles tem um
 * token próprio no módulo de cada um.
 */

/** O runner que a fila executa: pesquisa completa + criação de Trade. */
export const RESEARCH_RUNNER = Symbol("RESEARCH_RUNNER");
