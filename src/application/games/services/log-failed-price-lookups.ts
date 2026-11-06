/**
 * Um jogo que falhou no catálogo some da Trade sem ser descartado por regra
 * nenhuma; sem isto, a Trade parcial não deixa rastro de que era parcial.
 */
export const logFailedPriceLookups = (failed: string[]): void => {
	if (failed.length === 0) return;
	console.warn(
		`⚠️ [INFO] ${failed.length} game(s) could not be priced and were left out: ${failed.join(", ")}`,
	);
};
