import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	HttpWebhookSender,
	WebhookTargetNotAllowedError,
} from "@/infrastructure/webhooks/http-webhook-sender.js";
import { toWebhookBody } from "@/infrastructure/webhooks/webhook-body.js";
import { signWebhook } from "@/infrastructure/webhooks/webhook-signature.js";

const SECRET = "a".repeat(64);
const URL_OK = "http://chatbot:3000/webhooks/price-cd";
const body = toWebhookBody("8c1f", {
	result: "trade_created",
	tradeUuid: "3a9e",
});

function stubFetch(status: number) {
	const fetchMock = vi.fn(async () => new Response(null, { status }));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("toWebhookBody", () => {
	it("puts each result in the wire format, and nothing else", () => {
		expect(
			toWebhookBody("8c1f", { result: "trade_created", tradeUuid: "3a9e" }),
		).toEqual({
			request_uuid: "8c1f",
			result: "trade_created",
			trade_uuid: "3a9e",
		});
		expect(toWebhookBody("8c1f", { result: "no_trade" })).toEqual({
			request_uuid: "8c1f",
			result: "no_trade",
		});
		expect(
			toWebhookBody("8c1f", {
				result: "failed",
				failure: {
					kind: "stock_unavailable",
					message: "Sistema Estoque answered HTTP 503",
				},
			}),
		).toEqual({
			request_uuid: "8c1f",
			result: "failed",
			failure: {
				kind: "stock_unavailable",
				message: "Sistema Estoque answered HTTP 503",
			},
		});
	});
});

describe("signWebhook", () => {
	it("is the HMAC-SHA256 of '<timestamp>.<body>', in hex, prefixed with sha256=", () => {
		const expected = createHmac("sha256", SECRET)
			.update('1762250000.{"a":1}')
			.digest("hex");

		expect(signWebhook(SECRET, "1762250000", '{"a":1}')).toBe(
			`sha256=${expected}`,
		);
	});

	it("changes with any byte of the body or the timestamp", () => {
		const base = signWebhook(SECRET, "1762250000", '{"a":1}');

		expect(signWebhook(SECRET, "1762250000", '{"a":2}')).not.toBe(base);
		expect(signWebhook(SECRET, "1762250001", '{"a":1}')).not.toBe(base);
		expect(signWebhook("b".repeat(64), "1762250000", '{"a":1}')).not.toBe(base);
	});
});

describe("HttpWebhookSender", () => {
	it("signs exactly the bytes it sends, with the timestamp it sends", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
		const fetchMock = stubFetch(204);

		await new HttpWebhookSender(SECRET, ["chatbot"]).send(URL_OK, body);

		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		const headers = init.headers as Record<string, string>;
		expect(url).toBe(URL_OK);
		expect(init.redirect).toBe("manual");
		expect(headers["X-Webhook-Timestamp"]).toBe(
			String(Date.UTC(2026, 10, 4, 12) / 1000),
		);
		// O que quem recebe faz: refaz o HMAC sobre o corpo bruto recebido.
		expect(headers["X-Webhook-Signature"]).toBe(
			signWebhook(SECRET, headers["X-Webhook-Timestamp"], init.body as string),
		);
		expect(JSON.parse(init.body as string)).toEqual(body);
		// O segredo nunca vai na requisição.
		expect(JSON.stringify(init)).not.toContain(SECRET);
	});

	it.each([200, 202, 204])("treats %i as delivered", async (status) => {
		stubFetch(status);

		await expect(
			new HttpWebhookSender(SECRET, ["chatbot"]).send(URL_OK, body),
		).resolves.toBeUndefined();
	});

	it.each([301, 400, 404, 500, 503])(
		"treats %i as not delivered",
		async (status) => {
			stubFetch(status);

			await expect(
				new HttpWebhookSender(SECRET, ["chatbot"]).send(URL_OK, body),
			).rejects.toThrow(`Webhook answered HTTP ${status}`);
		},
	);

	it("checks the allowlist again at send time, and calls nothing outside it", async () => {
		const fetchMock = stubFetch(204);

		await expect(
			new HttpWebhookSender(SECRET, ["other-host"]).send(URL_OK, body),
		).rejects.toBeInstanceOf(WebhookTargetNotAllowedError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("refuses an unreadable URL as not allowed, so the queue gives up instead of retrying", async () => {
		const fetchMock = stubFetch(204);

		const error = await new HttpWebhookSender(SECRET, ["chatbot"])
			.send("not a url", body)
			.catch((e) => e);

		expect(error).toBeInstanceOf(WebhookTargetNotAllowedError);
		expect(error.message).toBe("Webhook host is not allowed: (unreadable URL)");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
