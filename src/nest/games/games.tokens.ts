/**
 * Tokens de injeção próprios do módulo `games`.
 *
 * `BackgroundScheduler` continua sendo `interface` (não vira token) de
 * propósito: existem **duas filas** no sistema, com concorrências diferentes —
 * a da pesquisa manual (1, fixa) e a do fluxo `lists` (`RUN_LISTS_CONCURRENCY`).
 * Um token único para a porta faria as duas colidirem no PR 5. Cada fila ganha
 * o seu, e o token vive aqui, na camada de apresentação, para que
 * `application/` não precise conhecer o conceito.
 */
export const RESEARCH_SCHEDULER = Symbol("RESEARCH_SCHEDULER");

/** O runner que a fila executa: pesquisa completa + criação de Trade. */
export const RESEARCH_RUNNER = Symbol("RESEARCH_RUNNER");
