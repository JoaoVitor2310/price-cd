/**
 * Tokens do módulo `suppliers`. A fila não tem token: a porta
 * `SupplierDiscoveryQueue` é `abstract class` e serve de token.
 */

/** O runner que a fila executa: injeta o cookie, varre, e limpa no `finally`. */
export const SUPPLIERS_RUNNER = Symbol("SUPPLIERS_RUNNER");

/** Steam IDs a nunca abordar, vindos de `USER_TO_IGNORE`. */
export const IGNORED_STEAM_IDS = Symbol("IGNORED_STEAM_IDS");
