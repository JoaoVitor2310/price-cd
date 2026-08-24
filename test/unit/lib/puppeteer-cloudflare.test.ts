import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/helpers/utils.js", () => ({
	delay: vi.fn(),
}));

import { delay } from "@/helpers/utils.js";
import {
	type ChallengeAwarePage,
	CloudflareChallengeError,
	CloudflareChallengeSolver,
	PageSnapshot,
	type SolverOptions,
} from "@/lib/puppeteer-cloudflare.js";

const solve = (page: ChallengeAwarePage, options: SolverOptions = {}) =>
	new CloudflareChallengeSolver(page, options).resolve();

const snapshot = (html: string) => new PageSnapshot(html, "https://st.com/x");

const CHALLENGE_HTML =
	'<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><div id="challenge-form"></div></body></html>';
const BLOCK_HTML =
	"<html><head><title>Attention Required! | Cloudflare</title></head><body>Error code: 1020</body></html>";
const FILLER = '<div class="pad">conteúdo de página real</div>'.repeat(40);
/**
 * Página legítima — inclui o beacon `/cdn-cgi/challenge-platform/` que a
 * Cloudflare injeta em páginas normais. Usar esse script como marcador de
 * desafio fazia o helper esperar para sempre numa página já resolvida.
 */
const REAL_HTML = `<html><head><title>Trades by Steam User 123</title><script src="/cdn-cgi/challenge-platform/h/b/scripts/jsd/main.js"></script></head><body><div class="row_trade_name"><h2><a href="/trades/x">Lista</a></h2></div>${FILLER}</body></html>`;
/** Documento vazio que a Cloudflare deixa no ar durante o redirect de saída. */
const TRANSIENT_HTML = "<html><head></head><body></body></html>";

const makePage = (
	contents: Array<string | Error>,
	url: string | string[] = "https://www.steamtrades.com/trades/search?user=1",
): ChallengeAwarePage => {
	let i = 0;
	let urlReads = 0;
	const urls = Array.isArray(url) ? url : [url];
	return {
		content: vi.fn(async () => {
			const next = contents[Math.min(i, contents.length - 1)];
			i += 1;
			if (next instanceof Error) throw next;
			return next;
		}),
		url: () => {
			const value = urls[Math.min(urlReads, urls.length - 1)];
			urlReads += 1;
			return value;
		},
	} as unknown as ChallengeAwarePage;
};

beforeEach(() => {
	vi.useFakeTimers();
	// `delay` mockado precisa mover o relógio, senão o deadline nunca chega.
	vi.mocked(delay).mockImplementation(async (ms: number) => {
		vi.advanceTimersByTime(ms);
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.mocked(delay).mockReset();
});

describe("PageSnapshot.isChallenge", () => {
	it("recognizes the 'Just a moment...' interstitial", () => {
		expect(snapshot(CHALLENGE_HTML).isChallenge).toBe(true);
	});

	it("does not flag legitimate SteamTrades HTML as a challenge", () => {
		expect(snapshot(REAL_HTML).isChallenge).toBe(false);
	});

	it("does not confuse the challenge-platform beacon on a normal page with a challenge", () => {
		// A Cloudflare injeta esse script em páginas comuns; tratá-lo como
		// marcador travava o helper numa página já resolvida até o timeout.
		expect(
			snapshot(
				'<script src="/cdn-cgi/challenge-platform/h/b/scripts/jsd/main.js"></script>',
			).isChallenge,
		).toBe(false);
	});

	it("recognizes the interstitial by the _cf_chl_opt object", () => {
		expect(
			snapshot("<script>window._cf_chl_opt={cvId:'3'}</script>").isChallenge,
		).toBe(true);
	});
});

describe("PageSnapshot.state", () => {
	it("classifies each situation into a single state", () => {
		expect(snapshot(BLOCK_HTML).state()).toBe("blocked");
		expect(snapshot(CHALLENGE_HTML).state()).toBe("challenge");
		expect(snapshot(TRANSIENT_HTML).state()).toBe("too-short");
		expect(snapshot(REAL_HTML).state()).toBe("ready");
	});

	it("block takes precedence over challenge", () => {
		expect(snapshot(BLOCK_HTML + CHALLENGE_HTML).state()).toBe("blocked");
	});

	it("respects the minimum length it is given", () => {
		expect(snapshot("<html><body>oi</body></html>").state(4)).toBe("ready");
	});

	it("exposes the title and the unreadable read", () => {
		expect(snapshot(CHALLENGE_HTML).title).toBe("Just a moment...");
		expect(PageSnapshot.unreadable("https://st.com/x").isEmpty).toBe(true);
		expect(snapshot(REAL_HTML).isEmpty).toBe(false);
	});
});

describe("PageSnapshot.isBlocked", () => {
	it("recognizes a permanent block by error code 1020", () => {
		expect(snapshot(BLOCK_HTML).isBlocked).toBe(true);
	});

	it("does not confuse an in-flight challenge with a block", () => {
		expect(snapshot(CHALLENGE_HTML).isBlocked).toBe(false);
	});
});

describe("CloudflareChallengeSolver.defaultTimeoutMs", () => {
	afterEach(() => {
		process.env.CLOUDFLARE_CHALLENGE_TIMEOUT_MS = undefined;
	});

	it("defaults to 45s", () => {
		process.env.CLOUDFLARE_CHALLENGE_TIMEOUT_MS = "";
		expect(CloudflareChallengeSolver.defaultTimeoutMs()).toBe(45_000);
	});

	it("honors the env var when it is a positive number", () => {
		process.env.CLOUDFLARE_CHALLENGE_TIMEOUT_MS = "9000";
		expect(CloudflareChallengeSolver.defaultTimeoutMs()).toBe(9_000);
	});

	it("ignores invalid values", () => {
		process.env.CLOUDFLARE_CHALLENGE_TIMEOUT_MS = "-1";
		expect(CloudflareChallengeSolver.defaultTimeoutMs()).toBe(45_000);
	});
});

describe("CloudflareChallengeSolver.resolve", () => {
	it("returns the HTML as soon as the page settles", async () => {
		const page = makePage([REAL_HTML]);

		await expect(solve(page, { timeoutMs: 5_000 })).resolves.toBe(REAL_HTML);
		// Duas leituras idênticas: uma para ler, outra para confirmar estabilidade.
		expect(delay).toHaveBeenCalledTimes(1);
	});

	it("ignores the empty transient document from the exit redirect", async () => {
		// Este era o bug: o doc vazio não casa com marcador de desafio e era
		// devolvido como "resolvido", levando a zero listas em silêncio.
		const page = makePage([
			CHALLENGE_HTML,
			TRANSIENT_HTML,
			TRANSIENT_HTML,
			REAL_HTML,
			REAL_HTML,
		]);

		await expect(
			solve(page, {
				timeoutMs: 5_000,
				pollIntervalMs: 10,
			}),
		).resolves.toBe(REAL_HTML);
	});

	it("waits for the solver and returns the resolved HTML", async () => {
		const page = makePage([CHALLENGE_HTML, CHALLENGE_HTML, REAL_HTML]);

		const html = await solve(page, {
			timeoutMs: 5_000,
			pollIntervalMs: 100,
		});

		expect(html).toBe(REAL_HTML);
		expect(delay).toHaveBeenCalledWith(100);
	});

	it("tolerates the execution context dying during the redirect", async () => {
		const page = makePage([
			CHALLENGE_HTML,
			new Error("Execution context was destroyed"),
			REAL_HTML,
		]);

		await expect(
			solve(page, {
				timeoutMs: 5_000,
				pollIntervalMs: 100,
			}),
		).resolves.toBe(REAL_HTML);
	});

	it("propagates a dead-browser error instead of burning the whole timeout", async () => {
		const page = makePage([
			new Error("Protocol error (Runtime.callFunctionOn): Target closed"),
		]);

		await expect(solve(page, { timeoutMs: 30_000 })).rejects.toThrow(
			/target closed/i,
		);
		expect(delay).not.toHaveBeenCalled();
	});

	it("fails immediately on a permanent block, without waiting", async () => {
		const page = makePage([BLOCK_HTML]);

		await expect(
			solve(page, {
				timeoutMs: 30_000,
				pollIntervalMs: 100,
			}),
		).rejects.toMatchObject({
			name: "CloudflareChallengeError",
			reason: "blocked",
		});
		expect(delay).not.toHaveBeenCalled();
	});

	it("distinguishes frozen HTML from moving HTML in the diagnostics", async () => {
		const frozen = makePage([CHALLENGE_HTML]);
		const frozenError = await solve(frozen, {
			timeoutMs: 1_000,
			pollIntervalMs: 250,
		}).catch((e) => e);

		expect(frozenError.details.htmlChanged).toBe(false);
		expect(frozenError.details.lastTitle).toBe("Just a moment...");
		expect(frozenError.details.attempts).toBeGreaterThan(1);

		const moving = makePage([
			CHALLENGE_HTML,
			CHALLENGE_HTML.replace("Just a moment...", "Um momento..."),
		]);
		const movingError = await solve(moving, {
			timeoutMs: 1_000,
			pollIntervalMs: 250,
		}).catch((e) => e);

		expect(movingError.details.htmlChanged).toBe(true);
	});

	it("records distinct URLs to expose a redirect loop", async () => {
		const page = makePage(
			[CHALLENGE_HTML],
			[
				"https://st.com/a",
				"https://st.com/b",
				"https://st.com/b",
				"https://st.com/c",
			],
		);

		const error = await solve(page, {
			timeoutMs: 1_000,
			pollIntervalMs: 250,
		}).catch((e) => e);

		expect(error.details.urls).toEqual([
			"https://st.com/a",
			"https://st.com/b",
			"https://st.com/c",
		]);
	});

	it("summarizes the diagnostics in the error message", async () => {
		const page = makePage([CHALLENGE_HTML]);

		const error = await solve(page, {
			timeoutMs: 1_000,
			pollIntervalMs: 250,
		}).catch((e) => e);

		expect(error.message).toContain("HTML estático");
		expect(error.message).toContain("Just a moment...");
		expect(error.message).toMatch(/\d+ leituras/);
	});

	it("also attaches diagnostics to the permanent-block error", async () => {
		const page = makePage([BLOCK_HTML]);

		const error = await solve(page, {
			timeoutMs: 1_000,
		}).catch((e) => e);

		expect(error.reason).toBe("blocked");
		expect(error.details.attempts).toBe(1);
	});

	it("logs periodic progress during long waits", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const page = makePage([CHALLENGE_HTML]);

		await solve(page, {
			timeoutMs: 3_000,
			pollIntervalMs: 500,
			progressIntervalMs: 1_000,
		}).catch(() => {});

		expect(warn).toHaveBeenCalled();
		expect(
			warn.mock.calls.some(([msg]) => String(msg).includes("no desafio")),
		).toBe(true);
		warn.mockRestore();
	});

	it("throws with reason 'timeout' when the challenge never clears", async () => {
		const page = makePage([CHALLENGE_HTML]);

		const error = await solve(page, {
			timeoutMs: 1_000,
			pollIntervalMs: 250,
		}).catch((e) => e);

		expect(error).toBeInstanceOf(CloudflareChallengeError);
		expect(error.reason).toBe("timeout");
		expect(error.url).toContain("steamtrades.com");
	});
});
