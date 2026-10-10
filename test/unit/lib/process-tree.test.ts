import { beforeEach, describe, expect, it, vi } from "vitest";

const { readdir, readFile } = vi.hoisted(() => ({
	readdir: vi.fn(),
	readFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ readdir, readFile }));

const {
	collectDescendants,
	descendantsOf,
	findPidByDebugPort,
	killProcessTree,
	readProcessTable,
} = await import("@/lib/process-tree.js");

/** `/proc/<pid>/stat`: `pid (comm) state ppid ...` */
const stat = (pid: number, comm: string, ppid: number) =>
	`${pid} (${comm}) S ${ppid} ${pid} 0 0 -1 4194560 1234 0 0`;

const procfs = (table: Record<number, { comm: string; ppid: number }>) => {
	readdir.mockResolvedValue([
		...Object.keys(table),
		"self",
		"meminfo",
		"1234abc",
	]);
	readFile.mockImplementation(async (path: string) => {
		const pid = Number(path.split("/")[2]);
		const entry = table[pid];
		if (!entry) throw new Error("ENOENT");
		return stat(pid, entry.comm, entry.ppid);
	});
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("readProcessTable", () => {
	it("reads pid/ppid pairs and ignores non-numeric entries", async () => {
		procfs({
			1: { comm: "init", ppid: 0 },
			10: { comm: "node", ppid: 1 },
			20: { comm: "chrome", ppid: 10 },
		});

		const table = await readProcessTable();

		expect(table.sort((a, b) => a.pid - b.pid)).toEqual([
			{ pid: 1, ppid: 0 },
			{ pid: 10, ppid: 1 },
			{ pid: 20, ppid: 10 },
		]);
	});

	it("parses the ppid even when the process name has spaces and parens", async () => {
		// O nome do Chromium vem entre parênteses e contém espaços — parsear
		// por índice de espaço a partir do começo devolveria o campo errado.
		procfs({ 42: { comm: "chrome (renderer) x", ppid: 7 } });

		expect(await readProcessTable()).toEqual([{ pid: 42, ppid: 7 }]);
	});

	it("skips processes that die mid-scan instead of failing", async () => {
		readdir.mockResolvedValue(["10", "20"]);
		readFile.mockImplementation(async (path: string) => {
			if (path.includes("/20/")) throw new Error("ESRCH");
			return stat(10, "node", 1);
		});

		expect(await readProcessTable()).toEqual([{ pid: 10, ppid: 1 }]);
	});

	it("returns an empty table where there is no procfs", async () => {
		readdir.mockRejectedValue(new Error("ENOENT"));

		expect(await readProcessTable()).toEqual([]);
	});
});

describe("collectDescendants", () => {
	const table = [
		{ pid: 1, ppid: 0 },
		{ pid: 10, ppid: 1 }, // node
		{ pid: 20, ppid: 10 }, // chrome (browser process)
		{ pid: 30, ppid: 20 }, // renderer
		{ pid: 31, ppid: 20 }, // gpu process
		{ pid: 40, ppid: 30 }, // subframe renderer
		{ pid: 99, ppid: 1 }, // processo alheio
	];

	it("returns the whole subtree, deepest first, without the root", () => {
		const descendants = collectDescendants(20, table);

		// Nível mais profundo primeiro (40), depois os filhos diretos.
		expect(descendants).toEqual([40, 31, 30]);
		expect(descendants).not.toContain(20);
		expect(descendants).not.toContain(99);
	});

	it("returns nothing for a leaf process", () => {
		expect(collectDescendants(40, table)).toEqual([]);
	});

	it("terminates on a corrupted table with a cycle", () => {
		const cyclic = [
			{ pid: 2, ppid: 3 },
			{ pid: 3, ppid: 2 },
		];

		expect(collectDescendants(2, cyclic)).toEqual([3]);
	});
});

describe("killProcessTree", () => {
	it("signals every descendant before the root", async () => {
		procfs({
			20: { comm: "chrome", ppid: 10 },
			30: { comm: "renderer", ppid: 20 },
			40: { comm: "subframe", ppid: 30 },
		});

		const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

		const targets = await killProcessTree(20, "SIGTERM");

		expect(targets).toEqual([40, 30, 20]);
		expect(kill.mock.calls).toEqual([
			[40, "SIGTERM"],
			[30, "SIGTERM"],
			[20, "SIGTERM"],
		]);

		kill.mockRestore();
	});

	it("keeps going when a process is already gone", async () => {
		procfs({ 20: { comm: "chrome", ppid: 10 }, 30: { comm: "r", ppid: 20 } });

		const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
			if (pid === 30)
				throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
			return true;
		});

		await expect(killProcessTree(20, "SIGKILL")).resolves.toEqual([30, 20]);
		expect(kill).toHaveBeenCalledWith(20, "SIGKILL");

		kill.mockRestore();
	});
});

describe("descendantsOf", () => {
	it("reads the live table and collects the subtree", async () => {
		procfs({
			10: { comm: "node", ppid: 1 },
			20: { comm: "chrome", ppid: 10 },
			30: { comm: "renderer", ppid: 20 },
		});

		expect(await descendantsOf(10)).toEqual([30, 20]);
	});
});

/** `/proc/<pid>/cmdline`: argumentos separados por NUL. */
const cmdlines = (table: Record<number, string[] | "gone">) => {
	readdir.mockResolvedValue([...Object.keys(table), "self"]);
	readFile.mockImplementation(async (path: string) => {
		const pid = Number(path.split("/")[2]);
		const args = table[pid];
		if (!args || args === "gone") throw new Error("ENOENT");
		return `${args.join("\0")}\0`;
	});
};

describe("findPidByDebugPort", () => {
	const main = ["/usr/lib/chromium/chromium", "--remote-debugging-port=46611"];

	it("finds the main Chromium process listening on the port", async () => {
		cmdlines({ 10: ["node", "dist/main.js"], 30: main });

		expect(await findPidByDebugPort(46611)).toBe(30);
	});

	it("ignores renderers, which inherit the port flag but carry --type=", async () => {
		cmdlines({
			30: main,
			111: [...main, "--type=renderer"],
			112: [...main, "--type=gpu-process"],
		});

		expect(await findPidByDebugPort(46611)).toBe(30);
	});

	it("matches the whole argument, so 4661 never matches 46611", async () => {
		cmdlines({ 30: main });

		expect(await findPidByDebugPort(4661)).toBeUndefined();
		expect(await findPidByDebugPort(466110)).toBeUndefined();
	});

	it("tells apart two browsers by their ports", async () => {
		cmdlines({
			30: ["chromium", "--remote-debugging-port=46611"],
			2113: ["chromium", "--remote-debugging-port=36879"],
		});

		expect(await findPidByDebugPort(36879)).toBe(2113);
	});

	it("picks the lowest pid when a wrapper and Chromium both carry the flag", async () => {
		// Wrapper que não faz exec: pai (20) e filho (30) sem --type=. O pai contém o filho
		// na árvore, então é o pid que alcança os dois.
		cmdlines({ 20: ["/bin/sh", "chromium", ...main.slice(1)], 30: main });

		expect(await findPidByDebugPort(46611)).toBe(20);
	});

	// As duas ordens são necessárias: com só uma, "o último que terminou vence" (o bug
	// original) ou "o primeiro vence" acertaria por coincidência.
	it.each([20, 30])(
		"does not depend on which /proc read finishes first (pid %i answers last)",
		async (slowPid) => {
			readdir.mockResolvedValue(["30", "20"]);
			readFile.mockImplementation(async (path: string) => {
				const pid = Number(path.split("/")[2]);
				if (pid === slowPid) await new Promise((resolve) => setTimeout(resolve, 20));
				return `${main.join("\0")}\0`;
			});

			expect(await findPidByDebugPort(46611)).toBe(20);
		},
	);

	it("returns undefined when no process listens on the port", async () => {
		cmdlines({ 10: ["node", "dist/main.js"] });

		expect(await findPidByDebugPort(46611)).toBeUndefined();
	});

	it("skips processes that die mid-scan instead of failing", async () => {
		cmdlines({ 20: "gone", 30: main });

		expect(await findPidByDebugPort(46611)).toBe(30);
	});

	it("returns undefined where there is no procfs", async () => {
		readdir.mockRejectedValue(new Error("ENOENT"));

		expect(await findPidByDebugPort(46611)).toBeUndefined();
	});
});
