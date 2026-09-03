import { describe, expect, it } from "vitest";
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
		expect(extractTopicData(html).games).toEqual([
			"Half-Life",
			"Portal",
			"CSGO",
		]);
	});

	it("skips games listed under a GOG header", () => {
		const html =
			'<div class="have">Half-Life\n\nGOG:\n\nRight and Down\nXCOM: Chimera Squad</div>';
		expect(extractTopicData(html).games).toEqual(["Half-Life"]);
	});

	it("prices nothing from a listing that is entirely GOG", () => {
		// HTML real de https://www.steamtrades.com/trade/wGVYD — o `.have` vem
		// como markdown renderizado (<p>, <hr>, <ul><li>), não como texto solto.
		const html = `<div class="have"><div class="markdown"><p>LEGACY GAMES:</p>
<hr>
<p>GOG:</p>
<ul>
<li>Mystic Academy: Escape Room</li>
<li>XCOM: Chimera Squad </li>
<li>Right and Down</li>
<li>Hiveswap Friendsim</li>
<li>Space Grunts 2</li>
<li>Pyramids and Aliens: Escape Room</li>
<li>Zoria: Age of Shattering</li>
</ul></div></div>`;

		// Antes do HaveListing, os 7 jogos eram pesquisados como se fossem
		// Steam, e "LEGACY GAMES:"/"GOG:" viravam nomes de jogo.
		expect(extractTopicData(html).games).toEqual([]);
	});

	it("still applies the reseller veto to lines inside a skipped section", () => {
		// O recado do dono pode estar dentro da seção GOG: filtrar os jogos não
		// pode cegar o veto, senão um tópico vetado passaria a qualificar.
		const html = `
            <div class="have">Half-Life\n\nGOG:\n\nNo resellers please</div>
            <div class="want">TF2 Keys</div>`;
		expect(extractTopicData(html).wantsTf2Key).toBe(false);
	});

	it("returns empty games array when .have section is absent", () => {
		expect(extractTopicData("<div>no have section</div>").games).toEqual([]);
	});

	describe("wantsTf2Key", () => {
		it("returns true when .want contains TF2", () => {
			const html = '<div class="want">TF2 keys</div>';
			expect(extractTopicData(html).wantsTf2Key).toBe(true);
		});

		it("returns true when .want contains TF2 in lowercase (case-insensitive)", () => {
			const html = '<div class="want">tf2</div>';
			expect(extractTopicData(html).wantsTf2Key).toBe(true);
		});

		it("returns true when .want contains Team Fortress 2 Key", () => {
			const html = '<div class="want">Team Fortress 2 Key</div>';
			expect(extractTopicData(html).wantsTf2Key).toBe(true);
		});

		it("returns false when .want contains no TF2", () => {
			const html = '<div class="want">no TF2</div>';
			expect(extractTopicData(html).wantsTf2Key).toBe(false);
		});

		it("returns false when .want contains no tf2 (case-insensitive negation)", () => {
			const html = '<div class="want">no tf2</div>';
			expect(extractTopicData(html).wantsTf2Key).toBe(false);
		});

		it("returns false when .want contains no Team Fortress 2 Key", () => {
			const html = '<div class="want">no Team Fortress 2 Key</div>';
			expect(extractTopicData(html).wantsTf2Key).toBe(false);
		});

		it("returns false when .want has no TF2 mention", () => {
			const html = '<div class="want">CS2 skins\nDota 2 items</div>';
			expect(extractTopicData(html).wantsTf2Key).toBe(false);
		});

		it("returns false when .want section is absent", () => {
			expect(extractTopicData("<div>no want section</div>").wantsTf2Key).toBe(
				false,
			);
		});

		it("returns false when .have rejects resellers even though .want asks for TF2", () => {
			const html = `
                <div class="have">Half-Life\nNo reseller offers</div>
                <div class="want">TF2 keys</div>`;
			expect(extractTopicData(html).wantsTf2Key).toBe(false);
		});

		it("returns false when .want itself rejects resellers", () => {
			const html = '<div class="want">TF2 keys\nNot for resellers</div>';
			expect(extractTopicData(html).wantsTf2Key).toBe(false);
		});

		it("still lists the games of a topic that rejects resellers", () => {
			const html = `
                <div class="have">Half-Life\nNo reseller offers</div>
                <div class="want">TF2 keys</div>`;
			expect(extractTopicData(html).games).toEqual([
				"Half-Life",
				"No reseller offers",
			]);
		});

		it("returns false when .want says it is not interested in TF2 keys", () => {
			const html = '<div class="want">not interested in TF2 keys</div>';
			expect(extractTopicData(html).wantsTf2Key).toBe(false);
		});

		it("stays true when .want refuses another payment method alongside TF2", () => {
			const html = '<div class="want">TF2 keys - no paypal</div>';
			expect(extractTopicData(html).wantsTf2Key).toBe(true);
		});

		it("returns false when .want says it doesn't want tf2", () => {
			const html = '<div class="want">I don\'t want tf2</div>';
			expect(extractTopicData(html).wantsTf2Key).toBe(false);
		});

		it("returns false when .want only rarely accepts TF2 keys", () => {
			const html = '<div class="want">I rarely accept TF2 keys</div>';
			expect(extractTopicData(html).wantsTf2Key).toBe(false);
		});

		it("returns false when another .want line refuses key currency broadly", () => {
			const html = '<div class="want">TF2 keys\nNo CSGO Keys or similar</div>';
			expect(extractTopicData(html).wantsTf2Key).toBe(false);
		});

		it("stays true when .want refuses one other key currency without generalizing", () => {
			const html = '<div class="want">TF2 keys\nNo CSGO Keys</div>';
			expect(extractTopicData(html).wantsTf2Key).toBe(true);
		});

		it("stays true when .have mentions resellers without rejecting them", () => {
			const html = `
                <div class="have">Half-Life\nReseller friendly</div>
                <div class="want">TF2 keys</div>`;
			expect(extractTopicData(html).wantsTf2Key).toBe(true);
		});
	});
});
