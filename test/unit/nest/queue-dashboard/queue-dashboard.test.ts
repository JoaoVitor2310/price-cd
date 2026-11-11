import { afterEach, describe, expect, it, vi } from "vitest";
import {
	QueueDashboard,
	queueDashboardSettings,
} from "@/nest/queue-dashboard/queue-dashboard.js";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("queueDashboardSettings", () => {
	const complete = {
		QUEUE_REDIS_URL: "redis://redis:6379/1",
		QUEUE_DASHBOARD_USER: "ops",
		QUEUE_DASHBOARD_PASSWORD: "a-long-enough-password",
	};

	it("turns the dashboard on with the credentials and the durable queue", () => {
		expect(queueDashboardSettings(complete)).toEqual({
			redisUrl: "redis://redis:6379/1",
			user: "ops",
			password: "a-long-enough-password",
		});
	});

	it.each([
		["without credentials", { QUEUE_REDIS_URL: "redis://redis:6379/1" }],
		// Filas em memória: não há o que mostrar.
		["without QUEUE_REDIS_URL", { ...complete, QUEUE_REDIS_URL: undefined }],
	])("leaves it off %s", (_label, env) => {
		expect(queueDashboardSettings(env)).toBeUndefined();
	});
});

describe("QueueDashboard", () => {
	it("mounts nothing when off, so the route is a 404", () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		const app = { use: vi.fn() };

		new QueueDashboard(undefined).mount(app);

		expect(app.use).not.toHaveBeenCalled();
	});

	it("has nothing to close when it was never mounted", async () => {
		await expect(
			new QueueDashboard(undefined).onApplicationShutdown(),
		).resolves.toBeUndefined();
	});
});
