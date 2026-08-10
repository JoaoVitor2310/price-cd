/**
 * Fonte única das variações textuais que indicam aceitação de TF2 Keys — usada tanto para
 * filtrar a busca do SteamTrades (`have=`) quanto para confirmar via regex o texto real do
 * `.want` de cada tópico. Existem duas variações porque o site faz busca por substring exata:
 * buscar só "TF2" não encontra quem escreveu "Team Fortress 2" por extenso, e vice-versa.
 * "Team Fortress 2" (sem "Key") casa com ambos "Team Fortress 2" e "Team Fortress 2 Key".
 *
 * TF2 Keys é a ÚNICA moeda que a Descoberta de Fornecedores aceita hoje — o filtro de busca,
 * o regex de confirmação e o `GameSearcher`/`ProfitabilityChecker` downstream (que convertem
 * preço em euro para preço em TF2 Keys) assumem isso. Se outra moeda for aceita no futuro,
 * este módulo deixa de ser "a" fonte de verdade de moeda aceita e passa a ser só a fonte de
 * verdade de uma delas — os pontos que hoje hardcodam TF2 precisarão virar parâmetro.
 */
const TF2_KEY_PHRASES = ["TF2", "Team Fortress 2"] as const;

/** Termos de busca a percorrer na listagem do SteamTrades (um a um, via `have=<termo>`). */
export const TF2_SEARCH_TERMS: readonly string[] = TF2_KEY_PHRASES;

const TF2_MATCH = new RegExp(TF2_KEY_PHRASES.join("|"), "i");
const TF2_NEGATED = new RegExp(`\\bno\\s+(${TF2_KEY_PHRASES.join("|")})`, "i");

/** Confere se um texto (ex.: uma linha da seção `.want` de um tópico) indica aceitação de TF2 Keys. */
export function isWantingTf2Keys(text: string): boolean {
    return TF2_MATCH.test(text) && !TF2_NEGATED.test(text);
}
