import { errorMessage } from "@/lib/error-message.js";

/**
 * O log de queda e volta do Redis de uma fila BullMQ: avisa **uma vez** por
 * queda e uma vez na volta, em vez de uma linha por comando que falha.
 *
 * Começa em `unknown`: antes da primeira conexão, um ping ou um `add` falham só
 * porque ela ainda não saiu, e isso não é queda — só um erro de **conexão** avisa
 * nesse estado. Sem isso, o primeiro health do boot logava "ping failed" seguido
 * de "responding again".
 *
 * Cada fila tem as suas frases: o que muda para quem lê o log é a consequência
 * (pedido recusado, webhook esperando).
 */

export type ConnectionLogMessages = {
	/** Na primeira conexão. Ausente, a primeira conexão é silenciosa. */
	connected?: string;
	back: string;
	down: (operation: string, reason: string) => string;
};

export class BullmqConnectionLog {
	private state: "unknown" | "up" | "down" = "unknown";

	constructor(private readonly messages: ConnectionLogMessages) {}

	up(): void {
		if (this.state === "up") return;
		const previous = this.state;
		this.state = "up";
		const message =
			previous === "unknown" ? this.messages.connected : this.messages.back;
		if (message !== undefined) console.log(message);
	}

	down(operation: string, error: unknown): void {
		if (this.state === "down") return;
		if (this.state === "unknown" && operation !== "connection") return;
		this.state = "down";
		console.warn(this.messages.down(operation, errorMessage(error)));
	}
}
