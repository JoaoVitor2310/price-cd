/**
 * Uma seção da Lista, tal como o Fornecedor a escreveu no `.have`.
 * `platform: null` são as linhas antes de qualquer cabeçalho — o caso comum,
 * em que a Lista inteira é de keys da Steam e ninguém declara plataforma.
 */
export type PlatformSection = {
	platform: string | null;
	games: string[];
};

/**
 * O texto do `.have` de um tópico do SteamTrades, quebrado por plataforma.
 *
 * Fornecedores que misturam plataformas separam a Lista com um cabeçalho
 * (`GOG:`) e listam os jogos daquela loja abaixo dele. O price-cd só sabe
 * precificar keys da Steam: pesquisar um jogo de outra loja no AllKeyShop
 * devolve o preço do produto errado, então essas seções são descartadas.
 */
export class HaveListing {
	/**
	 * Plataformas que o price-cd ainda não sabe precificar. Ver `docs/IMPROVEMENTS.md`.
	 *
	 * Cada entrada é comparada como PALAVRA INTEIRA contra o rótulo do cabeçalho,
	 * nunca como substring: `"ea"` está dentro de `"st(ea)m"`, e um match por
	 * substring descartaria em silêncio toda seção Steam declarada.
	 * Entrada com espaço (`"ea app"`) casa a sequência de palavras.
	 */
	static readonly UNPRICEABLE_PLATFORMS: readonly string[] = [
		"gog",
		// Candidatas, desligadas até aparecer caso real. Ligar uma exige
		// confirmar que o rótulo é mesmo o que os Fornecedores escrevem —
		// e que o jogo daquela seção não some sem ninguém perceber.
		// "epic",
		// "origin",
		// "uplay",
		// "ubisoft",
		// "ubisoft connect",
		// "ea",        ⚠️ só é seguro porque o match é por palavra:
		// "ea app",       com substring, "ea" casaria dentro de "st(ea)m".
		// "ea play",
		// "ea desktop",
	];

	/**
	 * Cabeçalho é uma linha que é SÓ um rótulo terminado em dois-pontos.
	 * Nome de jogo com dois-pontos ("XCOM: Chimera Squad") tem texto depois
	 * e por isso não casa — é a diferença que separa seção de jogo.
	 */
	private static readonly SECTION_HEADER = /^([^:]{1,40}):$/;

	private constructor(readonly sections: readonly PlatformSection[]) {}

	static parse(rawText: string): HaveListing {
		const sections: PlatformSection[] = [];
		let current: PlatformSection = { platform: null, games: [] };
		sections.push(current);

		for (const rawLine of rawText.split("\n")) {
			const line = rawLine.trim();
			if (!line) continue;

			const header = line.match(HaveListing.SECTION_HEADER);
			if (header) {
				current = { platform: header[1].trim(), games: [] };
				sections.push(current);
				continue;
			}

			current.games.push(line);
		}

		return new HaveListing(
			sections.filter((section) => section.games.length > 0),
		);
	}

	/** Os jogos que o price-cd sabe precificar hoje. */
	get priceableGames(): string[] {
		return this.sections
			.filter((section) => !HaveListing.isUnpriceable(section.platform))
			.flatMap((section) => section.games);
	}

	/** Seções descartadas, para o chamador conseguir logar o que ignorou. */
	get skippedSections(): PlatformSection[] {
		return this.sections.filter((section) =>
			HaveListing.isUnpriceable(section.platform),
		);
	}

	private static isUnpriceable(platform: string | null): boolean {
		if (platform === null) return false;
		const words = HaveListing.toWords(platform);
		return HaveListing.UNPRICEABLE_PLATFORMS.some((unpriceable) =>
			words.includes(` ${HaveListing.toWords(unpriceable).trim()} `),
		);
	}

	/**
	 * Reduz o rótulo a palavras minúsculas cercadas por espaço (` gog keys `),
	 * para que `includes` case palavra inteira em vez de pedaço de palavra.
	 * Pontuação e acentuação viram separador: `EA-App` e `EA App` são o mesmo.
	 */
	private static toWords(label: string): string {
		return ` ${label
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, " ")
			.trim()} `;
	}
}
