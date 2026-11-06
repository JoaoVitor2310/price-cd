import { describe, expect, it } from "vitest";
import { isAllowedWebhookTarget } from "@/application/games/webhook-target.js";

const ALLOWED = ["chatbot", "chatbot.carcadeals.com"];

describe("isAllowedWebhookTarget", () => {
	it.each([
		"http://chatbot:3000/webhooks/price-cd",
		"https://chatbot.carcadeals.com/webhooks/price-cd",
		"https://CHATBOT.carcadeals.com/hook",
	])("accepts %s", (url) => {
		expect(isAllowedWebhookTarget(url, ALLOWED)).toBe(true);
	});

	it.each([
		["a host outside the list", "http://redis:6379/"],
		["a suffix trick", "https://chatbot.carcadeals.com.evil.io/hook"],
		[
			"a subdomain of an allowed host",
			"https://api.chatbot.carcadeals.com/hook",
		],
		["credentials in the URL", "https://user:pass@chatbot.carcadeals.com/hook"],
		["another protocol", "ftp://chatbot/hook"],
		["something that is not a URL", "chatbot"],
	])("refuses %s", (_label, url) => {
		expect(isAllowedWebhookTarget(url, ALLOWED)).toBe(false);
	});

	it("refuses everything when the list is empty", () => {
		expect(isAllowedWebhookTarget("http://chatbot:3000/", [])).toBe(false);
	});
});
