import type { BackgroundScheduler } from "@/application/lists/ports/list-run.ports.js";

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
	const raw = process.env.RUN_LISTS_CONCURRENCY?.trim();
	const parsed = raw ? Number(raw) : NaN;
	const concurrency = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
	return new LimitedConcurrencyScheduler(concurrency);
}

