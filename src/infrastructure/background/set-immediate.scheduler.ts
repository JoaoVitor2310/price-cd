import type { BackgroundScheduler } from "@/application/lists/ports/list-run.ports.js";

/**
 * Agendador baseado em setImmediate.
 */
export class SetImmediateScheduler implements BackgroundScheduler {
	schedule(task: () => Promise<void>): void {
		setImmediate(() => {
			void task();
		});
	}
}

export const createSetImmediateScheduler = (): BackgroundScheduler =>
	new SetImmediateScheduler();
