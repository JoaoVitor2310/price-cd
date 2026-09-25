/**
 * Tokens de injeção do módulo `lists`.
 *
 * `LISTS_SCHEDULER` existe separado do `RESEARCH_SCHEDULER` por uma razão de
 * comportamento, não de organização: são **duas filas**, com concorrências
 * diferentes e propósitos diferentes.
 *
 * | Fila | Concorrência | Por quê |
 * |---|---|---|
 * | `lists` | `RUN_LISTS_CONCURRENCY` (default 1) | reabastecimento, pode durar minutos |
 * | `research` | 1, fixo | pesquisa manual disparada por um usuário |
 *
 * Elas são separadas para que uma execução longa de listas **não trave** uma
 * pesquisa manual. Registrar as duas sob o mesmo token faria o container
 * entregar a mesma instância para os dois fluxos — e aí uma lista de 200 jogos
 * seguraria a fila de quem está esperando na tela, sem erro nenhum aparecer.
 */
export const LISTS_SCHEDULER = Symbol("LISTS_SCHEDULER");

/** O runner que a fila de listas executa. */
export const LISTS_RUNNER = Symbol("LISTS_RUNNER");

/** `MAX_ACTIVE_LISTS`, resolvido do ambiente e injetado no use case. */
export const MAX_ACTIVE_LISTS = Symbol("MAX_ACTIVE_LISTS");
