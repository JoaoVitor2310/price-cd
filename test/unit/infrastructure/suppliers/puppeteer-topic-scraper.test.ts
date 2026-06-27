import { describe, it, expect } from "vitest";
import { extractTopicData } from "@/infrastructure/suppliers/puppeteer-topic-scraper.js";

describe("extractTopicData", () => {
    it("detects an inactive topic", () => {
        const html = '<div class="notification yellow">Inactive</div>';
        expect(extractTopicData(html).isInactive).toBe(true);
    });

    it("detects an active topic", () => {
        expect(extractTopicData("<div>Normal topic</div>").isInactive).toBe(false);
    });

    it("extracts steamId from the first comment_inner (topic owner)", () => {
        const html = `
            <div class="comment_inner">
                <a href="/user/76561198043813028" class="author_name">yasarumit</a>
            </div>`;
        expect(extractTopicData(html).steamId).toBe("76561198043813028");
    });

    it("returns empty steamId when no comment_inner is present", () => {
        expect(extractTopicData("<div>no author</div>").steamId).toBe("");
    });

    it("does not pick a commenter's steamId — only reads the first comment_inner", () => {
        const html = `
            <div class="comment_inner">
                <a href="/user/76561198000000001" class="author_name">TopicOwner</a>
            </div>
            <div class="comment_inner">
                <a href="/user/76561198000000002" class="author_name">Commenter</a>
            </div>`;
        expect(extractTopicData(html).steamId).toBe("76561198000000001");
    });

    it("extracts game names from the .have section", () => {
        const html = '<div class="have">Half-Life\nPortal\nCSGO</div>';
        expect(extractTopicData(html).games).toEqual(["Half-Life", "Portal", "CSGO"]);
    });

    it("returns empty games array when .have section is absent", () => {
        expect(extractTopicData("<div>no have section</div>").games).toEqual([]);
    });
});
