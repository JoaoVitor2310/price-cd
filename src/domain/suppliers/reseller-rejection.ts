/**
 * Fonte única das frases que indicam recusa explícita a negociar com revendedores.
 *
 * Alguns donos de Lista aceitam TF2 Keys, mas só de jogadores comuns — escrevem algo como
 * "No reseller offers" (normalmente na seção `.have`, junto dos jogos, mas também aparece no
 * `.want`). Como o CarcaDeals *é* um revendedor, esses tópicos são inelegíveis mesmo passando
 * no filtro de moeda: comentar neles queima reputação e gasta tempo de pesquisa de preço à toa.
 *
 * Os padrões são deliberadamente tolerantes a palavras intercaladas ("no offers from resellers",
 * "not interested in resellers") porque o texto é livre e curto — o risco de falso positivo é
 * baixo perto do custo de abordar quem já disse que não quer. Novas variações encontradas no
 * campo devem ser adicionadas aqui, não espalhadas pelo scraper.
 */
const RESELLER = "resell(?:er|ers|ing)?";

const REJECTION_PATTERNS: readonly RegExp[] = [
    /** "no resellers", "no reseller offers", "not for resellers", "not interested in resellers" */
    new RegExp(`\\bno(?:t)?\\b(?:\\s+\\w+){0,3}\\s+${RESELLER}\\b`, "i"),
    /** "resellers not welcome", "reseller offers are not accepted" */
    new RegExp(`\\b${RESELLER}\\b(?:\\s+\\w+){0,3}\\s+not\\b`, "i"),
];

/** Confere se um texto (uma linha de `.have` ou `.want`) recusa explicitamente revendedores. */
export function rejectsResellers(text: string): boolean {
    return REJECTION_PATTERNS.some((pattern) => pattern.test(text));
}
