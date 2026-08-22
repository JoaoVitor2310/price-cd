import { rejectsResellers } from "@/domain/suppliers/reseller-rejection.js";
import { isWantingTf2Keys, refusesKeyCurrencyBroadly } from "@/domain/suppliers/tf2-key-matching.js";

/** Texto de um tópico já quebrado em linhas, por seção. */
export type TopicSections = {
    /** Linhas da seção `.have` — os jogos ofertados, e ocasionalmente recados do dono. */
    haveLines: readonly string[];
    /** Linhas da seção `.want` — o que o dono aceita como pagamento. */
    wantLines: readonly string[];
};

/**
 * Vetos: frases que desqualificam o tópico inteiro, independente de ele pedir TF2 Keys em
 * outra linha. São aplicadas às DUAS seções porque o dono escreve o recado onde der — a
 * recusa a revendedor costuma aparecer no meio da lista de jogos (`.have`), não no `.want`.
 *
 * A assimetria é proposital: a aceitação basta UMA linha afirmar, mas o veto basta UMA linha
 * negar. Quem pede TF2 Keys e num outro ponto diz que não negocia com revendedor não é um
 * fornecedor pela metade — é um não.
 */
const TOPIC_VETOES: readonly ((line: string) => boolean)[] = [
    rejectsResellers,
    refusesKeyCurrencyBroadly,
];

/**
 * Decide se o dono do tópico aceitaria TF2 Keys DO CARCADEALS — que é revendedor. Não é a
 * mesma pergunta que "o texto menciona TF2": mencionar é condição necessária, não suficiente.
 */
export function acceptsTf2KeysFromUs({ haveLines, wantLines }: TopicSections): boolean {
    if (!wantLines.some(isWantingTf2Keys)) return false;

    return ![...haveLines, ...wantLines].some((line) => TOPIC_VETOES.some((veto) => veto(line)));
}
