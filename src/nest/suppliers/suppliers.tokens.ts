/**
 * Tokens do módulo `suppliers`.
 *
 * Terceira fila do sistema, com token próprio pelo mesmo motivo das outras duas
 * (`lists.tokens.ts`): uma varredura longa do SteamTrades não pode competir por
 * concorrência com o reabastecimento nem com a pesquisa manual. Concorrência 1
 * — o scraping já é serializado por um único browser.
 */
export const SUPPLIERS_SCHEDULER = Symbol("SUPPLIERS_SCHEDULER");

/** O runner que a fila executa: injeta o cookie, varre, e limpa no `finally`. */
export const SUPPLIERS_RUNNER = Symbol("SUPPLIERS_RUNNER");

/** Steam IDs a nunca abordar, vindos de `USER_TO_IGNORE`. */
export const IGNORED_STEAM_IDS = Symbol("IGNORED_STEAM_IDS");
