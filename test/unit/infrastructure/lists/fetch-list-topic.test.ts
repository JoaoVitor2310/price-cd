import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock é hoisted: as fns precisam nascer em vi.hoisted para existirem antes.
const { initializeBrowser, cleanupBrowser } = vi.hoisted(() => ({
	initializeBrowser: vi.fn(),
	cleanupBrowser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/puppeteer-browser.js", () => ({
	initializeBrowser,
	cleanupBrowser,
}));

vi.mock("@/helpers/utils.js", () => ({
	delay: vi.fn().mockResolvedValue(undefined),
}));

import { FetchListTopic } from "@/infrastructure/lists/fetch-list-topic.js";
import { CloudflareChallengeError } from "@/lib/puppeteer-cloudflare.js";

const CHALLENGE_HTML =
	'<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><div id="challenge-form"></div></body></html>';
const BLOCK_HTML =
	"<html><head><title>Attention Required! | Cloudflare</title></head><body>Error code: 1020</body></html>";

/** O helper exige HTML de tamanho realista para descartar o doc transitório. */
const FILLER = '<div class="pad">markup de página real</div>'.repeat(40);

const listsHtml = `
<html><body>
	<div class="row_trade_name"><h2><a href="trades/aaa/lista-1">Lista 1</a></h2></div>
	<div class="row_trade_name"><h2><svg class="svg-inline--fa fa-lock fa-w-14 red"></svg><a href="trades/bbb/lista-2">Lista 2</a></h2></div>
	${FILLER}
</body></html>`;

const topicHtml = `
<html><body><div class="have">Hades
Celeste
</div>${FILLER}</body></html>`;

/**
 * Simula o comportamento real: `goto` resolve no domcontentloaded da
 * interstitial (403), e `content()` só devolve o HTML real depois que o
 * solver do turnstile termina.
 */
const makePage = (opts: { status: number; contents: string[] }) => {
	let i = 0;
	return {
		goto: vi.fn().mockResolvedValue({
			status: () => opts.status,
			headers: () => ({}),
		}),
		content: vi.fn(async () => {
			const html = opts.contents[Math.min(i, opts.contents.length - 1)];
			i += 1;
			return html;
		}),
		url: () => "https://www.steamtrades.com/trades/search?user=1",
	};
};

const useFakePage = (page: ReturnType<typeof makePage>) => {
	initializeBrowser.mockResolvedValue({ browser: { id: "b" }, page });
};

beforeEach(() => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
	vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	initializeBrowser.mockReset();
	cleanupBrowser.mockClear();
});

describe("FetchListTopic.fetchUserLists", () => {
	it("extracts only active lists when the page loads directly", async () => {
		useFakePage(makePage({ status: 200, contents: [listsHtml] }));

		const topics = await new FetchListTopic().fetchUserLists(
			"76561198246395906",
		);

		expect(topics).toHaveLength(1);
		expect(topics[0].url).toBe(
			"https://www.steamtrades.com/trades/aaa/lista-1",
		);
		expect(topics[0].status).toBe("active");
	});

	it("waits out the Cloudflare challenge instead of returning an empty list on 403", async () => {
		// Este era o bug: 403 + interstitial faziam o fetcher retornar [].
		useFakePage(
			makePage({
				status: 403,
				contents: [CHALLENGE_HTML, CHALLENGE_HTML, listsHtml],
			}),
		);

		const topics = await new FetchListTopic().fetchUserLists(
			"76561198246395906",
		);

		expect(topics).toHaveLength(1);
		expect(topics[0].url).toBe(
			"https://www.steamtrades.com/trades/aaa/lista-1",
		);
	});

	it("distinguishes a non-matching selector from a supplier with no active list in the log", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		// Página válida, mas nenhum tópico: seletor não achou nada.
		useFakePage(
			makePage({
				status: 200,
				contents: [
					`<html><head><title>SteamTrades</title></head><body>${FILLER}</body></html>`,
				],
			}),
		);
		await new FetchListTopic().fetchUserLists("1");

		const message = String(warn.mock.calls.at(-1)?.[0]);
		expect(message).toContain("0 tópico(s) na página");
		expect(message).toContain("SteamTrades");
	});

	it("throws CloudflareChallengeError on a permanent block instead of masking it as an empty list", async () => {
		useFakePage(makePage({ status: 403, contents: [BLOCK_HTML] }));

		await expect(
			new FetchListTopic().fetchUserLists("76561198246395906"),
		).rejects.toBeInstanceOf(CloudflareChallengeError);
	});

	it("returns an empty list on a real HTTP error that is not a challenge", async () => {
		useFakePage(
			makePage({ status: 500, contents: ["<html><body>oops</body></html>"] }),
		);

		await expect(
			new FetchListTopic().fetchUserLists("76561198246395906"),
		).resolves.toEqual([]);
	});
});

describe("FetchListTopic.fetchList", () => {
	it("extracts the games from div.have", async () => {
		useFakePage(makePage({ status: 200, contents: [topicHtml] }));

		const topic = await new FetchListTopic().fetchList(
			"https://www.steamtrades.com/trades/aaa/lista-1",
		);

		expect(topic.status).toBe("active");
		expect(topic.gameNames).toContain("Hades");
		expect(topic.gameNames).toContain("Celeste");
	});

	it("waits out the challenge before deciding the topic is inactive", async () => {
		useFakePage(
			makePage({ status: 403, contents: [CHALLENGE_HTML, topicHtml] }),
		);

		const topic = await new FetchListTopic().fetchList(
			"https://www.steamtrades.com/trades/aaa/lista-1",
		);

		expect(topic.status).toBe("active");
		expect(topic.gameNames).toContain("Hades");
	});

	it("does not mark a topic inactive when Cloudflare blocks — it throws", async () => {
		useFakePage(makePage({ status: 403, contents: [BLOCK_HTML] }));

		await expect(
			new FetchListTopic().fetchList(
				"https://www.steamtrades.com/trades/aaa/lista-1",
			),
		).rejects.toBeInstanceOf(CloudflareChallengeError);
	});
});

describe("FetchListTopic.dispose", () => {
	it("closes the reused browser exactly once", async () => {
		useFakePage(makePage({ status: 200, contents: [listsHtml] }));
		const fetcher = new FetchListTopic();

		await fetcher.fetchUserLists("1");
		await fetcher.dispose();
		await fetcher.dispose();

		expect(cleanupBrowser).toHaveBeenCalledTimes(1);
		expect(initializeBrowser).toHaveBeenCalledTimes(1);
	});
});
