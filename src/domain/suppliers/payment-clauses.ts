/**
 * Decide se um texto livre (uma linha da seção `.want`) indica que o dono da Lista ACEITA um
 * meio de pagamento — TF2 Keys, PayPal, euro, dólar. A pergunta é a mesma para todos, então a
 * regra de negação vive aqui, uma vez, e cada meio de pagamento só informa o que o menciona.
 *
 * A negação é avaliada por ORAÇÃO, não pela linha inteira, e só conta quando aparece ANTES da
 * menção. Aqui não dá para usar uma janela de palavras: um meio de pagamento convive o tempo
 * todo com negações que não são sobre ele — "no lowball offers, TF2 keys only" e "TF2 keys - no
 * paypal" aceitam TF2 Keys, e uma janela cega os descartaria, fazendo perder fornecedor bom em
 * silêncio. Cortar em pontuação isola cada oferta ("no paypal" / "TF2 keys"), e exigir que a
 * negação preceda a menção impede que uma recusa a OUTRO meio de pagamento, escrita depois,
 * contamine a menção legítima.
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
 * não devem contaminar a menção legítima.
 */
const BARE_REFUSAL = /^(?:not interested|not accepting|no thanks?|no thank you|nope)$/i;

function clauseAcceptsPayment(clause: string, mention: RegExp): boolean {
    const match = mention.exec(clause);
    if (!match) return false;
    return !NEGATION.test(clause.slice(0, match.index));
}

/**
 * `mention` reconhece o meio de pagamento no texto. Não pode ter a flag `g`: um `RegExp` global
 * guarda `lastIndex` entre chamadas e faria a mesma linha dar respostas diferentes.
 */
export function acceptsPayment(text: string, mention: RegExp): boolean {
    const clauses = text
        .split(CLAUSE_SEPARATOR)
        .map((clause) => clause.trim())
        .filter(Boolean);

    const acceptingIndex = clauses.findIndex((clause) => clauseAcceptsPayment(clause, mention));
    if (acceptingIndex === -1) return false;

    return !clauses.slice(acceptingIndex + 1).some((clause) => BARE_REFUSAL.test(clause));
}
