/**
 * O banco Redis de cada teste de fila contra Redis real, a partir de
 * `QUEUE_REDIS_TEST_URL`. Os testes fazem `FLUSHDB` no banco deles, e o Vitest
 * roda os arquivos em paralelo: cada arquivo pega um `offset` próprio (pesquisa
 * 0, webhook 1, `BullmqJobQueue` 2, painel 3) para um não apagar os jobs do outro.
 *
 * Nunca devolve os bancos que o app usa — 0 é o cache de preço, 1 são as filas
 * (ADR 0009) —, mesmo que alguém aponte a variável para o Redis do dev: um
 * `FLUSHDB` ali apagaria o cache ou as filas de verdade. Conta para longe deles
 * (para cima quando para baixo cairia neles), e recusa o banco base reservado.
 */
const RESERVED_DBS = new Set([0, 1]);
const MAX_DB = 15;

export const queueTestUrl = (offset: number): string | undefined => {
	const base = process.env.QUEUE_REDIS_TEST_URL;
	if (!base) return undefined;

	const parsed = new URL(base);
	const baseDb = Number(parsed.pathname.slice(1) || 0);
	if (RESERVED_DBS.has(baseDb)) {
		throw new Error(
			`QUEUE_REDIS_TEST_URL points at database ${baseDb}, which the app uses — the queue tests FLUSHDB their database. Use a spare one, like /15.`,
		);
	}

	const below = baseDb - offset;
	const db = below >= 2 ? below : baseDb + offset;
	if (RESERVED_DBS.has(db) || db > MAX_DB) {
		throw new Error(
			`No spare Redis database ${offset} away from ${baseDb} for the queue tests.`,
		);
	}
	parsed.pathname = `/${db}`;
	return parsed.toString();
};
