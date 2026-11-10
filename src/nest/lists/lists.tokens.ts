/** Tokens de injeção do módulo `lists`. A fila não tem token: a porta
 * `ListsRunQueue` é `abstract class` e serve de token. */

/** O runner que a fila de listas executa. */
export const LISTS_RUNNER = Symbol("LISTS_RUNNER");

/** `MAX_ACTIVE_LISTS`, resolvido do ambiente e injetado no use case. */
export const MAX_ACTIVE_LISTS = Symbol("MAX_ACTIVE_LISTS");
