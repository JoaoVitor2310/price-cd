/**
 * Lê uma variável de ambiente que carrega uma LISTA de valores.
 *
 * Variável de ambiente é sempre string — não existe array de verdade em `.env`. A convenção
 * usada aqui é a mesma de Docker/Kubernetes e da maioria das libs Node: valores separados por
 * vírgula (`A,B,C`). JSON (`["A","B"]`) foi descartado de propósito: o dotenv não parseia,
 * aspas dentro do `.env` viram escape hell, e um JSON malformado quebraria o boot com um erro
 * de sintaxe que não diz qual variável está errada.
 *
 * Tolerante por design, porque quem edita `.env` edita no braço e em produção: aceita quebra de
 * linha e ponto e vírgula como separador, ignora espaço em volta, descarta entradas vazias
 * (vírgula sobrando no fim é o erro de digitação mais comum) e remove duplicatas.
 *
 * Um único valor sem vírgula continua válido — é só uma lista de um elemento.
 */
export function parseEnvList(raw: string | undefined): string[] {
    if (!raw) return [];

    const values = raw
        .split(/[,;\n]/)
        .map((value) => value.trim())
        .filter(Boolean);

    return [...new Set(values)];
}
