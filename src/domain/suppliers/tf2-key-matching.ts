import { acceptsPayment } from "@/domain/suppliers/payment-clauses.js";

/**
 * Fonte única das variações textuais que indicam aceitação de TF2 Keys — usada tanto para
 * filtrar a busca do SteamTrades (`have=`) quanto para confirmar via regex o texto real do
 * `.want` de cada tópico. Existem duas variações porque o site faz busca por substring exata:
 * buscar só "TF2" não encontra quem escreveu "Team Fortress 2" por extenso, e vice-versa.
 * "Team Fortress 2" (sem "Key") casa com ambos "Team Fortress 2" e "Team Fortress 2 Key".
 *
 * TF2 Keys é UMA das Moedas de oferta da Descoberta de Fornecedores — as outras (PayPal, euro,
 * dólar) vivem em `money-matching.ts`, e quem escolhe entre elas é `supplier-eligibility.ts`.
 * TF2 tem precedência: é a moeda em que o Sistema Estoque lança o custo.
 */
const TF2_KEY_PHRASES = ["TF2", "Team Fortress 2"] as const;

/** Termos de busca a percorrer na listagem do SteamTrades (um a um, via `have=<termo>`). */
export const TF2_SEARCH_TERMS: readonly string[] = TF2_KEY_PHRASES;

const TF2_MATCH = new RegExp(TF2_KEY_PHRASES.join("|"), "i");

/**
 * Recusa a UMA moeda-key generalizada para as demais: "No CSGO Keys or similar". TF2 Key é
 * justamente "similar" a CSGO Key — as duas são moeda de key de jogo — então essa frase
 * inclui a gente mesmo sem citar TF2.
 *
 * O generalizador é obrigatório: "No CSGO Keys" sozinho NÃO recusa TF2 Keys — é alguém que
 * quer TF2 e não quer CSGO, e vetar isso perderia fornecedor bom. E como a frase pode não
 * citar TF2 nenhuma vez, ela não é alcançável por `isWantingTf2Keys` (que exige a menção):
 * é um veto de tópico, aplicado em `supplier-eligibility.ts`.
 */
const BROAD_KEY_REFUSAL =
    /\bno\b[^.\n]*\bkeys?\b[^.\n]*\bor\s+(?:anything\s+)?(?:similar|equivalent|alike|the\s+like)\b/i;

/** Confere se um texto recusa moeda-key em bloco (ex.: "No CSGO Keys or similar"). */
export function refusesKeyCurrencyBroadly(text: string): boolean {
    return BROAD_KEY_REFUSAL.test(text);
}

/** Confere se um texto (ex.: uma linha da seção `.want` de um tópico) indica aceitação de TF2 Keys. */
export function isWantingTf2Keys(text: string): boolean {
    return acceptsPayment(text, TF2_MATCH);
}
