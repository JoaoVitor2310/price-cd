/**
 * A promessa, ou uma rejeição se ela não se resolver em `ms`.
 *
 * O Node não tem isso pronto: `AbortSignal.timeout()` só serve para quem aceita
 * um `signal`, e quem chama aqui (a BullMQ, um `ping` do ioredis) não aceita. A
 * promessa original **não é cancelada** — ela segue rodando e o resultado tardio
 * é descartado. Quem usa precisa aceitar isso (ver o `enqueue` da fila).
 *
 * Diferente dos dois `Promise.race` de `puppeteer-browser.ts` e
 * `navigation-diagnostics.ts`: aqueles classificam o desfecho em vez de rejeitar,
 * porque quem chama decide o que fazer com cada caso.
 */
export const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
	new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`timed out after ${ms}ms`)),
			ms,
		);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
