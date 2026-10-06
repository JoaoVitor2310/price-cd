import type { MoneyCurrency } from "@/domain/suppliers/offer.js";
import { acceptsPayment } from "@/domain/suppliers/payment-clauses.js";

/**
 * Termos de busca (`have=<termo>`) para as Listas que aceitam dinheiro. Mesma razão de
 * `TF2_SEARCH_TERMS`: a busca do SteamTrades é por substring exata, então cada grafia precisa
 * de uma varredura própria — "dolar" não casa "dollar", e "euro" não casa "€".
 *
 * `pp` e `$` são os termos baratos de escrever e caros de varrer: casam muita Lista que não tem
 * nada a ver (qualquer preço em dólar). Quem filtra de verdade é o regex abaixo, depois que o
 * tópico é aberto — a busca só decide quais tópicos valem uma navegação.
 */
export const MONEY_SEARCH_TERMS: readonly string[] = ["paypal", "pp", "euro", "dollar", "dolar", "usdt", "€", "$"];

/**
 * Fronteira de palavra onde o termo é uma palavra: sem ela, `pp` casa "apple" e `euro` casa
 * "europe". `€` e `$` são símbolos, não têm fronteira de palavra.
 *
 * "dolar" é aceito porque é como o termo costuma ser escrito por quem não é falante nativo de
 * inglês; "dollar" é a grafia correta.
 *
 * `usdt` é a stablecoin atrelada ao dólar: quem aceita receber em USDT pensa em dólar, então conta
 * como dólar e a oferta sai em `$`. A sigla `usd` NÃO entra por enquanto — cada termo novo custa até
 * 100 páginas de varredura com a sessão logada do SteamTrades.
 */
const PAYPAL = /\b(?:paypal|pp)\b/i;
const EURO = /\beuros?\b|€/i;
const DOLLAR = /\b(?:dollars?|dolars?|usdt)\b|\$/i;

/**
 * Quais moedas de dinheiro UMA linha da seção `.want` diz aceitar. Reaproveita a regra de
 * negação dos meios de pagamento (`payment-clauses.ts`): "no paypal" não aceita PayPal, e
 * "TF2 keys - no paypal" continua não contando PayPal.
 *
 * PayPal e euro dão `eur`: é a moeda padrão. Dólar dá `usd`.
 */
export function acceptedMoneyCurrencies(text: string): ReadonlySet<MoneyCurrency> {
    const accepted = new Set<MoneyCurrency>();
    if (acceptsPayment(text, DOLLAR)) accepted.add("usd");
    if (acceptsPayment(text, PAYPAL) || acceptsPayment(text, EURO)) accepted.add("eur");
    return accepted;
}
