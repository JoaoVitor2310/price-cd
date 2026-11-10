/**
 * Tokens de injeção próprios do módulo `games`.
 *
 * A fila da pesquisa não tem token aqui: a porta `ResearchQueue` é uma
 * `abstract class` e serve de token (ADR 0009), como `ListsRunQueue` e
 * `SupplierDiscoveryQueue` nos módulos deles.
 */

/** O runner que a fila executa: pesquisa completa + criação de Trade. */
export const RESEARCH_RUNNER = Symbol("RESEARCH_RUNNER");
