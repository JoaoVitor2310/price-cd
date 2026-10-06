import { acceptedMoneyCurrencies, MONEY_SEARCH_TERMS } from "@/domain/suppliers/money-matching.js";
import type { OfferCurrency } from "@/domain/suppliers/offer.js";
import { rejectsResellers } from "@/domain/suppliers/reseller-rejection.js";
import {
    isWantingTf2Keys,
    refusesKeyCurrencyBroadly,
    TF2_SEARCH_TERMS,
} from "@/domain/suppliers/tf2-key-matching.js";

/**
 * Tudo que a Descoberta de Fornecedores busca no SteamTrades, na ordem: primeiro quem aceita TF2
 * Keys, depois quem aceita dinheiro. A ordem não muda o resultado (as Listas coletadas são
 * deduplicadas por código), só quando cada uma aparece nos logs.
 */
export const SUPPLIER_SEARCH_TERMS: readonly string[] = [...TF2_SEARCH_TERMS, ...MONEY_SEARCH_TERMS];

/** Texto de um tópico já quebrado em linhas, por seção. */
export type TopicSections = {
    /** Linhas da seção `.have` — os jogos ofertados, e ocasionalmente recados do dono. */
    haveLines: readonly string[];
    /** Linhas da seção `.want` — o que o dono aceita como pagamento. */
    wantLines: readonly string[];
};

/**
 * Decide em que moeda o CarcaDeals propõe pagar este Fornecedor, ou `null` se a Lista não
 * aceita nenhuma que a gente ofereça. Não é a mesma pergunta que "o texto menciona TF2": mencionar
 * é condição necessária, não suficiente.
 *
 * Precedência, da mais para a menos preferida:
 * 1. **TF2 Keys** — é a moeda em que o Sistema Estoque lança o custo; dinheiro é conversão.
 * 2. **Dólar** — se a Lista cita dólar, o Fornecedor pensa em dólar: oferecer euro seria
 *    obrigá-lo a converter. Vale mesmo quando a Lista cita PayPal ou euro junto.
 * 3. **Euro** — o padrão do dinheiro. PayPal também cai aqui.
 */
export function offerCurrencyFor({ haveLines, wantLines }: TopicSections): OfferCurrency | null {
    const allLines = [...haveLines, ...wantLines];

    // Vetos: frases que desqualificam o tópico inteiro, independente do que ele aceita em outra
    // linha. São aplicadas às DUAS seções porque o dono escreve o recado onde der — a recusa a
    // revendedor costuma aparecer no meio da lista de jogos (`.have`), não no `.want`.
    //
    // A assimetria é proposital: a aceitação basta UMA linha afirmar, mas o veto basta UMA linha
    // negar. Quem pede TF2 Keys e num outro ponto diz que não negocia com revendedor não é um
    // fornecedor pela metade — é um não.
    if (allLines.some(rejectsResellers)) return null;

    // Recusar moeda-key em bloco ("No CSGO Keys or similar") inclui a TF2 Key, mas não inclui
    // dinheiro: quem diz isso ainda pode aceitar PayPal. Por isso este veto só derruba a
    // oferta em TF2, e o tópico segue para a checagem de dinheiro.
    const acceptsTf2 = wantLines.some(isWantingTf2Keys) && !allLines.some(refusesKeyCurrencyBroadly);
    if (acceptsTf2) return "tf2";

    const acceptedMoney = new Set(wantLines.flatMap((line) => [...acceptedMoneyCurrencies(line)]));
    if (acceptedMoney.has("usd")) return "usd";
    if (acceptedMoney.has("eur")) return "eur";

    return null;
}
