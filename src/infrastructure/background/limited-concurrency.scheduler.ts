import type { BackgroundScheduler } from "@/application/shared/ports/background-scheduler.port.js";
import { positiveIntFromEnv } from "@/config/env.schema.js";

export class LimitedConcurrencyScheduler implements BackgroundScheduler {
	private readonly queue: Array<() => Promise<void>> = [];
	private running = 0;

	constructor(private readonly concurrency: number) {
		if (!Number.isFinite(concurrency) || concurrency < 1) {
			throw new Error(`Invalid concurrency: ${concurrency}`);
		}
	}

	schedule(task: () => Promise<void>): void {
		this.queue.push(task);
		this.pump();
	}

	private pump(): void {
		while (this.running < this.concurrency) {
			const next = this.queue.shift();
			if (!next) return;

			this.running++;
			Promise.resolve()
				.then(next)
				.catch((err) => {
					// Mantém comportamento do SetImmediateScheduler: erro não derruba o loop.
					console.error("❌ [ERROR] Background task failed:", err);
				})
				.finally(() => {
					this.running--;
					this.pump();
				});
		}
	}
}

export function createLimitedConcurrencySchedulerFromEnv(): BackgroundScheduler {
	// Mesma regra que o schema aplica para o app Nest — uma fonte só, senão os
	// dois apps divergem em valores de borda (foi o caso de `=0`).
	return new LimitedConcurrencyScheduler(
		positiveIntFromEnv(process.env.RUN_LISTS_CONCURRENCY, 1),
	);
}

