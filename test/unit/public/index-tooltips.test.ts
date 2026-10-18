import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as cheerio from "cheerio";
import { beforeEach, describe, expect, it } from "vitest";

const html = readFileSync(
	new URL("../../../public/index.html", import.meta.url),
	"utf8",
);
const $ = cheerio.load(html);

type FakeElement = {
	value: string;
	textContent: string;
	checked: boolean;
	disabled: boolean;
	hidden: boolean;
	className: string;
	innerHTML: string;
	style: Record<string, string>;
	scrollIntoView: () => void;
	querySelector: () => FakeElement;
	focus: () => void;
};

type Page = {
	element: (id: string) => FakeElement;
	updateTooltips: () => void;
	syncLookupPopularity: () => void;
	applyPreset: (name: string) => void;
	submitGames: () => Promise<void>;
	researchBodies: Array<Record<string, unknown>>;
};

const PRESETS = {
	default: {
		popularity: {
			upToThreshold: 30,
			aboveThreshold: 100,
			priceThresholdEuro: 5,
		},
		lookupPopularity: true,
		minPrice: 0.5,
		checkGamivoOffer: true,
	},
	"bundle-research": {
		popularity: { upToThreshold: 0, aboveThreshold: 0, priceThresholdEuro: 5 },
		lookupPopularity: true,
		minPrice: 0,
		checkGamivoOffer: false,
	},
	"bundle-sync": {
		popularity: { upToThreshold: 0, aboveThreshold: 0, priceThresholdEuro: 5 },
		lookupPopularity: false,
		minPrice: 0,
		checkGamivoOffer: false,
	},
};

/**
 * Executa o script inline da página com um `document` de mentira. Não há jsdom
 * no projeto, e o que importa aqui é a lógica dos campos, não o DOM real.
 */
const loadPage = async (): Promise<Page> => {
	const elements = new Map<string, FakeElement>();
	const element = (id: string): FakeElement => {
		let found = elements.get(id);
		if (!found) {
			// `.value` de um input real é sempre string: atribuir um número o converte.
			let value = "";
			const created: FakeElement = {
				get value() {
					return value;
				},
				set value(next: unknown) {
					value = String(next);
				},
				textContent: "",
				checked: false,
				disabled: false,
				hidden: false,
				className: "",
				innerHTML: "",
				style: {},
				scrollIntoView: () => {},
				querySelector: () => created,
				focus: () => {},
			};
			found = created;
			elements.set(id, found);
		}
		return found;
	};
	const researchBodies: Array<Record<string, unknown>> = [];
	const script = $("script").last().html() ?? "";
	const context = {
		document: {
			getElementById: element,
			querySelector: () => null,
		},
		alert: () => {},
		fetch: async (url: string, init?: { body?: string }) => {
			if (url === "/api/games/presets") {
				return { json: async () => ({ presets: PRESETS }) };
			}
			researchBodies.push(JSON.parse(init?.body ?? "{}"));
			return { ok: false, json: async () => ({ details: "stop here" }) };
		},
	};
	runInNewContext(script, context);
	// `loadPresets` roda no carregamento e é assíncrona.
	await new Promise((resolve) => setTimeout(resolve, 0));
	const page = context as unknown as Omit<Page, "element" | "researchBodies">;
	return {
		element,
		researchBodies,
		updateTooltips: page.updateTooltips,
		syncLookupPopularity: page.syncLookupPopularity,
		applyPreset: page.applyPreset,
		submitGames: page.submitGames,
	};
};

describe("index.html field tooltips", () => {
	it("orders the criteria fields: minimum price, price threshold, then popularity", () => {
		const ids = $("input[id]")
			.map((_, node) => $(node).attr("id"))
			.get();
		const order = [
			"minPrice",
			"priceThreshold",
			"popularityUpTo",
			"popularityAbove",
		].map((id) => ids.indexOf(id));

		expect(order.every((index) => index >= 0)).toBe(true);
		expect(order).toEqual([...order].sort((a, b) => a - b));
	});

	it("gives minimum price and price threshold a full-width row each", () => {
		for (const id of ["minPrice", "priceThreshold"]) {
			const group = $(`#${id}`).closest(".fg");
			expect(group.parent().hasClass("two-col")).toBe(false);
		}
	});

	it("keeps both popularity fields side by side", () => {
		const above = $("#popularityAbove").closest(".two-col");
		expect(above.find("#popularityUpTo")).toHaveLength(1);
	});

	it.each(["minPrice", "priceThreshold", "popularityUpTo", "popularityAbove"])(
		"wires a tooltip to %s that screen readers can reach",
		(id) => {
			const row = $(`#${id}`).closest(".fg").find(".fl-row");
			const trigger = row.find("button.tip");
			const tooltipId = trigger.attr("aria-describedby");

			// type=button: dentro do form, o padrão seria submit.
			expect(trigger.attr("type")).toBe("button");
			expect(tooltipId).toBeTruthy();
			expect(row.find(`#${tooltipId}`).attr("role")).toBe("tooltip");
			expect(row.find("label").attr("for")).toBe(id);
		},
	);

	it("puts the popularity lookup between the price fields and the popularity minimums", () => {
		const ids = $("input[id]")
			.map((_, node) => $(node).attr("id"))
			.get();

		expect($("#lookupPopularity").attr("type")).toBe("checkbox");
		expect(ids.indexOf("lookupPopularity")).toBeGreaterThan(
			ids.indexOf("priceThreshold"),
		);
		expect(ids.indexOf("lookupPopularity")).toBeLessThan(
			ids.indexOf("popularityUpTo"),
		);
	});

	it("wires a tooltip to the lookup checkbox", () => {
		const row = $("#lookupPopularity").closest(".fl-row");
		const tooltipId = row.find("button.tip").attr("aria-describedby");

		expect(tooltipId).toBeTruthy();
		expect(row.find(`#${tooltipId}`).attr("role")).toBe("tooltip");
		expect(row.find("label").attr("for")).toBe("lookupPopularity");
		expect($(`#${tooltipId}`).text()).toContain("only gathers the number");
	});

	it("labels both popularity minimums as discard-only, not as a lookup switch", () => {
		for (const id of ["popularityUpTo", "popularityAbove"]) {
			const label = $(`label[for="${id}"]`).text();
			expect(label).toContain("discard below");
		}
	});

	it("starts with the lookup on, matching the default preset", () => {
		expect($("#lookupPopularity").attr("checked")).toBeDefined();
		expect($("#lookupPopularityHint").attr("hidden")).toBeDefined();
	});

	it("has static explanations for the two price fields", () => {
		expect($("#minPriceTip").text()).toContain("above this value");
		expect($("#priceThresholdTip").text()).toContain("including exactly");
	});
});

describe("updateTooltips", () => {
	let page: Page;

	beforeEach(async () => {
		page = await loadPage();
	});

	it("falls back to generic wording when the threshold is empty", () => {
		// O carregamento dos presets já preencheu o limite com o do preset padrão.
		page.element("priceThreshold").value = "";
		page.updateTooltips();

		expect(page.element("popularityUpToTip").textContent).toContain(
			"priced up to the price threshold (inclusive)",
		);
		expect(page.element("popularityAboveTip").textContent).toContain(
			"priced above the price threshold",
		);
	});

	it("quotes the typed threshold in both popularity tooltips", () => {
		page.element("priceThreshold").value = "5";
		page.updateTooltips();

		expect(page.element("popularityUpToTip").textContent).toContain(
			"priced up to €5 (including exactly €5)",
		);
		expect(page.element("popularityAboveTip").textContent).toContain(
			"priced above €5",
		);
	});

	it("accepts a decimal comma like the form does", () => {
		page.element("priceThreshold").value = "2,5";
		page.updateTooltips();

		expect(page.element("popularityAboveTip").textContent).toContain(
			"priced above €2.5",
		);
	});

	it("does not print NaN for an invalid threshold", () => {
		page.element("priceThreshold").value = "abc";
		page.updateTooltips();

		const text = page.element("popularityUpToTip").textContent;
		expect(text).not.toContain("NaN");
		expect(text).toContain("the price threshold");
	});
});

describe("tooltip wording for the popularity minimums", () => {
	it("says they only cut and that 0 discards nobody", async () => {
		const page = await loadPage();
		page.element("priceThreshold").value = "5";
		page.updateTooltips();

		for (const id of ["popularityUpToTip", "popularityAboveTip"]) {
			const text = page.element(id).textContent;
			expect(text).toContain("below this value");
			expect(text).toContain("0 discards nobody");
		}
	});
});

describe("syncLookupPopularity", () => {
	let page: Page;

	beforeEach(async () => {
		page = await loadPage();
	});

	it("locks the checkbox on and explains why when a minimum is above 0", () => {
		page.element("lookupPopularity").checked = false;
		page.element("popularityUpTo").value = "30";
		page.syncLookupPopularity();

		expect(page.element("lookupPopularity").checked).toBe(true);
		expect(page.element("lookupPopularity").disabled).toBe(true);
		expect(page.element("lookupPopularityHint").hidden).toBe(false);
	});

	it("reacts to the minimum for prices above the threshold too", () => {
		page.element("popularityAbove").value = "100";
		page.syncLookupPopularity();

		expect(page.element("lookupPopularity").disabled).toBe(true);
	});

	it("frees the checkbox when both minimums are typed as 0, keeping its current state", () => {
		page.element("popularityUpTo").value = "0";
		page.element("popularityAbove").value = "0";
		page.element("lookupPopularity").checked = false;
		page.syncLookupPopularity();

		expect(page.element("lookupPopularity").disabled).toBe(false);
		expect(page.element("lookupPopularity").checked).toBe(false);
		expect(page.element("lookupPopularityHint").hidden).toBe(true);
	});

	it("does not remember an earlier unchecked box once a minimum above 0 forced it on", () => {
		// Documentado de propósito: voltar a 0 libera a caixa, mas não a desmarca.
		page.element("popularityUpTo").value = "0";
		page.element("popularityAbove").value = "0";
		page.element("lookupPopularity").checked = false;
		page.element("popularityUpTo").value = "5";
		page.syncLookupPopularity();
		page.element("popularityUpTo").value = "0";
		page.syncLookupPopularity();

		expect(page.element("lookupPopularity").disabled).toBe(false);
		expect(page.element("lookupPopularity").checked).toBe(true);
	});

	it("ignores a minimum that is not a number", () => {
		// Preset sem corte: o campo vazio cai em 0, então só o "abc" estaria em jogo.
		page.element("internalSecret").value = "token";
		page.element("preset").value = "bundle-sync";
		page.element("popularityUpTo").value = "abc";
		page.element("popularityAbove").value = "";
		page.syncLookupPopularity();

		expect(page.element("lookupPopularity").disabled).toBe(false);
	});

	describe("an empty minimum field", () => {
		// O servidor completa o campo vazio com o tier do preset; a caixa tem que
		// enxergar o mesmo valor, senão mostra "desligado" e a consulta acontece.
		it("counts as the tier of the active preset: locked when that tier is above 0", () => {
			page.applyPreset("default");
			page.element("popularityUpTo").value = "";
			page.element("popularityAbove").value = "";
			page.syncLookupPopularity();

			expect(page.element("lookupPopularity").checked).toBe(true);
			expect(page.element("lookupPopularity").disabled).toBe(true);
		});

		it("counts as the tier of the active preset: free when that tier is 0", () => {
			page.element("internalSecret").value = "token";
			page.element("preset").value = "bundle-sync";
			page.element("popularityUpTo").value = "";
			page.element("popularityAbove").value = "";
			page.syncLookupPopularity();

			expect(page.element("lookupPopularity").disabled).toBe(false);
		});

		it("is beaten by a typed 0: the user overrides the preset tier", () => {
			page.applyPreset("default");
			page.element("popularityUpTo").value = "0";
			page.element("popularityAbove").value = "0";
			page.syncLookupPopularity();

			expect(page.element("lookupPopularity").disabled).toBe(false);
		});

		it("falls back to the default preset without a token, whatever the hidden select says", () => {
			// Sem token o select fica oculto e a requisição não manda `preset`.
			page.element("internalSecret").value = "";
			page.element("preset").value = "bundle-sync";
			page.element("popularityUpTo").value = "";
			page.element("popularityAbove").value = "";
			page.syncLookupPopularity();

			expect(page.element("lookupPopularity").disabled).toBe(true);
		});

		it("does not lock when the presets could not be loaded: the page cannot know the tier", () => {
			page.element("internalSecret").value = "token";
			page.element("preset").value = "preset-that-does-not-exist";
			page.element("popularityUpTo").value = "";
			page.element("popularityAbove").value = "";
			page.syncLookupPopularity();

			expect(page.element("lookupPopularity").disabled).toBe(false);
		});
	});
});

describe("preset select", () => {
	it("offers the presets people run by hand and hides bundle-sync", async () => {
		// `bundle-sync` é só da chamada do Sistema Estoque; a API e `GET /presets`
		// continuam expondo, a tela é que não oferece.
		const page = await loadPage();
		const options = page.element("preset").innerHTML;

		expect(options).toContain('value="default"');
		expect(options).toContain('value="bundle-research"');
		expect(options).not.toContain("bundle-sync");
	});

	it("still starts on the default preset", async () => {
		const page = await loadPage();

		expect(page.element("preset").value).toBe("default");
		expect(page.element("minPrice").value).toBe("0.5");
	});
});

describe("applyPreset and the lookup", () => {
	let page: Page;

	beforeEach(async () => {
		page = await loadPage();
	});

	it("takes the lookup from the preset: on for default, locked because its minimums are above 0", () => {
		page.applyPreset("default");

		expect(page.element("lookupPopularity").checked).toBe(true);
		expect(page.element("lookupPopularity").disabled).toBe(true);
	});

	it("turns the lookup off and unlocks it for a preset that skips SteamCharts", () => {
		page.applyPreset("bundle-sync");

		expect(page.element("lookupPopularity").checked).toBe(false);
		expect(page.element("lookupPopularity").disabled).toBe(false);
	});
});

describe("submitGames", () => {
	it("sends lookupPopularity with the other criteria", async () => {
		const page = await loadPage();
		page.applyPreset("bundle-sync");
		page.element("gamesList").value = "Half-Life\nPortal 2";
		page.element("lookupPopularity").checked = true;

		await page.submitGames();

		expect(page.researchBodies).toHaveLength(1);
		expect(page.researchBodies[0]).toMatchObject({
			gameNames: ["Half-Life", "Portal 2"],
			lookupPopularity: true,
			popularity: { upToThreshold: 0, aboveThreshold: 0 },
		});
	});

	it("sends false when the box is unchecked", async () => {
		const page = await loadPage();
		page.applyPreset("bundle-sync");
		page.element("gamesList").value = "Half-Life";

		await page.submitGames();

		expect(page.researchBodies[0]).toMatchObject({ lookupPopularity: false });
	});
});
