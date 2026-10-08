import { afterEach, describe, expect, it, vi } from "vitest";
import {
	describeDiagnosis,
	diagnoseFailedNavigation,
	type DiagnosablePage,
} from "@/lib/navigation-diagnostics.js";

const REAL_PAGE = `<html><head><title>Search results</title></head><body>${"x".repeat(2000)}</body></html>`;
const CHALLENGE_PAGE = `<html><head><title>Just a moment...</title></head><body>${"x".repeat(2000)}</body></html>`;
const BLOCKED_PAGE = `<html><head><title>Attention Required! | Cloudflare</title></head><body>${"x".repeat(2000)}</body></html>`;

const makePage = (content: () => Promise<string>, url = "https://example.com/search"): DiagnosablePage =>
	({ content, url: () => url }) as unknown as DiagnosablePage;

afterEach(() => {
	vi.useRealTimers();
});

describe("diagnoseFailedNavigation", () => {
	it("reports real content when the page responds with a normal document", async () => {
		const page = makePage(async () => REAL_PAGE);

		expect(await diagnoseFailedNavigation(page)).toEqual({
			kind: "page",
			state: "ready",
			url: "https://example.com/search",
			title: "Search results",
			htmlLength: REAL_PAGE.length,
		});
	});

	it("recognises a page stuck on a Cloudflare challenge", async () => {
		const diagnosis = await diagnoseFailedNavigation(makePage(async () => CHALLENGE_PAGE));

		expect(diagnosis).toMatchObject({ kind: "page", state: "challenge", title: "Just a moment..." });
	});

	it("recognises a definitive Cloudflare block", async () => {
		const diagnosis = await diagnoseFailedNavigation(makePage(async () => BLOCKED_PAGE));

		expect(diagnosis).toMatchObject({ kind: "page", state: "blocked" });
	});

	it("recognises the empty transitional document", async () => {
		const diagnosis = await diagnoseFailedNavigation(makePage(async () => "<html></html>"));

		expect(diagnosis).toMatchObject({ kind: "page", state: "too-short" });
	});

	it("reports unresponsive instead of hanging when content() never answers", async () => {
		const page = makePage(() => new Promise<string>(() => {}));

		const diagnosis = await diagnoseFailedNavigation(page, 20);

		expect(diagnosis).toEqual({ kind: "unresponsive", waitedMs: 20 });
	});

	it("reports unreadable with the browser's message when content() throws", async () => {
		const page = makePage(async () => {
			throw new Error("Session closed. Most likely the page has been closed.");
		});

		expect(await diagnoseFailedNavigation(page)).toEqual({
			kind: "unreadable",
			error: "Session closed. Most likely the page has been closed.",
		});
	});

	it("never throws, even when the page does not implement content()", async () => {
		const diagnosis = await diagnoseFailedNavigation({} as DiagnosablePage);

		expect(diagnosis.kind).toBe("unreadable");
	});

	it("leaves no timer behind after a successful read", async () => {
		vi.useFakeTimers();

		await diagnoseFailedNavigation(makePage(async () => REAL_PAGE));

		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("describeDiagnosis", () => {
	it("says the browser hung when it did not answer", () => {
		expect(describeDiagnosis({ kind: "unresponsive", waitedMs: 3000 })).toMatch(/Chromium hung/);
	});

	it("says the browser is dead when the read threw", () => {
		const text = describeDiagnosis({ kind: "unreadable", error: "Target closed" });

		expect(text).toContain("Target closed");
		expect(text).toMatch(/Chromium likely dead/);
	});

	it.each([
		["blocked", /blocked by Cloudflare/],
		["challenge", /Cloudflare challenge/],
		["too-short", /empty or transitional/],
		["ready", /site slow rather than blocked/],
	] as const)("translates the %s page state into a plain reading", (state, expected) => {
		const text = describeDiagnosis({ kind: "page", state, url: "https://x.test/", title: "T", htmlLength: 10 });

		expect(text).toMatch(expected);
		expect(text).toContain("https://x.test/");
	});
});
