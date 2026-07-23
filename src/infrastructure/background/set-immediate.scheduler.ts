import type { BackgroundScheduler } from "@/application/shared/ports/background-scheduler.port.js";

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
