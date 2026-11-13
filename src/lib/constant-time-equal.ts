import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compara dois segredos em tempo constante, para o tempo da resposta não dizer
 * quantos caracteres acertaram. `===` para na primeira diferença.
 *
 * Sobre o SHA-256 de cada lado: `timingSafeEqual` exige buffers do mesmo
 * tamanho, e comparar os digests não vaza o tamanho do segredo.
 */
export const constantTimeEqual = (given: string, expected: string): boolean =>
	timingSafeEqual(digest(given), digest(expected));

const digest = (value: string): Buffer =>
	createHash("sha256").update(value, "utf8").digest();
