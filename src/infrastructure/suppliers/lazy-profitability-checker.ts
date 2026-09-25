import type {
	GamePriceInput,
	ProfitabilityChecker,
	ProspectResult,
	SupplierInput,
} from "@/application/suppliers/ports/profitability-checker.port.js";

/**
 * Adia a construção do `HttpProfitabilityChecker` até o primeiro uso.
 *
 * Mesmo motivo do `LazyGameTradeImporter`: construir no boot derruba o app
 * inteiro quando falta `SISTEMA_ESTOQUE_URL`, enquanto o Express sobe e continua
 * servindo as rotas que não dependem do Sistema Estoque. A checagem acontece no
 * ciclo da requisição, antes de enfileirar — onde ainda existe alguém para
 * receber o erro.
 */
export class LazyProfitabilityChecker implements ProfitabilityChecker {
	private instance: ProfitabilityChecker | undefined;

	constructor(private readonly build: () => ProfitabilityChecker) {}

	async evaluate(
		supplier: SupplierInput,
		games: GamePriceInput[],
	): Promise<ProspectResult> {
		if (!this.instance) this.instance = this.build();
		return this.instance.evaluate(supplier, games);
	}
}
