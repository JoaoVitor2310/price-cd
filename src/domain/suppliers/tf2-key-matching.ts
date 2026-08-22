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

/**
 * A negação é avaliada por ORAÇÃO, não pela linha inteira, e só conta quando aparece ANTES da
 * menção a TF2. Diferente da recusa a revendedor (ver `reseller-rejection.ts`), aqui não dá
 * para usar uma janela de palavras: "TF2" convive o tempo todo com negações que não são sobre
 * ele — "no lowball offers, TF2 keys only" e "TF2 keys - no paypal" aceitam TF2 Keys, e uma
 * janela cega os descartaria, fazendo perder fornecedor bom em silêncio. Cortar em pontuação
 * isola cada oferta ("no paypal" / "TF2 keys"), e exigir que a negação preceda o TF2 impede que
 * uma recusa a OUTRO meio de pagamento, escrita depois, contamine a menção legítima.
 *
 * O preço dessa precisão é uma recusa escrita sem pontuação e sem "no" adjacente
 * ("no paypal TF2 keys ok") ser lida como aceitação — erro que só custa uma pesquisa de preço,
 * enquanto o erro oposto custaria o fornecedor.
 */
const CLAUSE_SEPARATOR = /[,;.!?|/\n]+|\s[-–—]\s/;
/**
 * Além da negação explícita, relutância conta como recusa: "I rarely accept TF2 keys" é
 * gramaticalmente afirmativo, mas na prática é um "não" — abordar quem só aceita de vez em
 * quando gasta pesquisa de preço e comentário para quase sempre ouvir não.
 */
const NEGATION =
    /\b(?:no|not|nope|never|dont|don't|doesn't|isn't|aren't|wont|won't|rarely|seldom|hardly|barely)\b/i;

/**
 * Recusas que se bastam sozinhas como oração inteira e, por isso, só podem se referir ao que
 * veio antes: "TF2 keys? not interested". Ficam de fora tanto o "no" solto (em "TF2 keys,
 * paypal? no" a recusa é do paypal, não do TF2) quanto qualquer recusa com complemento
 * ("no paypal", "not interested in gift links") — essas falam de outro meio de pagamento e
 * não devem contaminar a menção legítima a TF2.
 */
const BARE_REFUSAL = /^(?:not interested|not accepting|no thanks?|no thank you|nope)$/i;

function clauseAcceptsTf2Keys(clause: string): boolean {
    const match = TF2_MATCH.exec(clause);
    if (!match) return false;
    return !NEGATION.test(clause.slice(0, match.index));
}

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
    const clauses = text
        .split(CLAUSE_SEPARATOR)
        .map((clause) => clause.trim())
        .filter(Boolean);

    const acceptingIndex = clauses.findIndex(clauseAcceptsTf2Keys);
    if (acceptingIndex === -1) return false;

    return !clauses.slice(acceptingIndex + 1).some((clause) => BARE_REFUSAL.test(clause));
}
