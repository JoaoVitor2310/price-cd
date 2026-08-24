import { beforeEach, describe, expect, it, vi } from "vitest";

const { readdir, readFile } = vi.hoisted(() => ({
	readdir: vi.fn(),
	readFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ readdir, readFile }));

const { collectDescendants, descendantsOf, killProcessTree, readProcessTable } =
	await import("@/lib/process-tree.js");

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
