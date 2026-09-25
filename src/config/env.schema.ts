import * as z from "zod";
import { parseEnvList } from "@/helpers/parse-env-list.js";

/**
 * O contrato do ambiente do price-cd — a única descrição executável de tudo que
 * o processo lê de `process.env`.
 *
 * Vive em `src/config/` (não em `src/nest/`) porque não é detalhe de
 * apresentação: descreve o processo, é consumido pelo `ConfigModule` do Nest
 * hoje e pode ser consumido pelo Express enquanto os dois coexistirem
 * (`docs/NEST.md` §3). Não conhece HTTP nem framework.
 *
 * ## Por que quase nada é obrigatório
 *
 * Exigir variável no boot muda o comportamento do sistema, e a maioria dos
 * fluxos aqui é degradável: `POST /api/games/research` sem `INTERNAL_SECRET`
 * responde em modo demo de propósito, e isso é contrato coberto em
 * `test/contract/`. Então a regra é:
 *
 * - **Sempre:** validar forma (número é número, porta é porta) e aplicar os
 *   mesmos defaults que o código já usa hoje.
 * - **Só em produção** (`NODE_ENV=production`): exigir o que, faltando, faz o
 *   serviço subir inútil — sem sessão do SteamTrades e sem o Sistema Estoque
 *   nenhum fluxo de verdade completa.
 *
 * Em dev e em teste nada é obrigatório: `npm run dev:nest` sobe com `.env`
 * vazio, que é o que permite mexer numa rota sem configurar o mundo.
 */

/**
 * Inteiro em ms/contagem vindo de string, sem default: vazio e ausente viram
 * `undefined` e quem lê decide o fallback (é o caso das variáveis cujo padrão
 * vive dentro de `lib/`, como `BROWSER_CLOSE_TIMEOUT_MS`).
 *
 * `.env.example` deixa quase tudo em branco, e branco significa "usa o default",
 * não "zero". Zero é valor válido — daí `nonNegative`, não `positive`.
 */
/**
 * Converte uma variável de ambiente em inteiro **positivo**, caindo no default
 * quando o valor não serve (ausente, vazio, zero, negativo ou não numérico).
 *
 * Existe exportada porque a regra precisa ser **uma só** para os dois apps. Ela
 * já esteve escrita em três lugares com resultados diferentes:
 *
 * | Entrada | Express (antes) | Nest (antes) |
 * |---|---|---|
 * | `RUN_LISTS_CONCURRENCY=0` | fila com 1 | **derrubava o boot** |
 * | `MAX_ACTIVE_LISTS=0` | 3 Listas | 1 Lista |
 *
 * Zero é entrada sem sentido para os dois casos — fila com concorrência zero
 * não processa nada, e zero Listas ativas não reabastece ninguém. Cair no
 * default preserva o comportamento do Express, que é o que roda em produção.
 */
export function positiveIntFromEnv(
	raw: string | undefined,
	fallback: number,
): number {
	const parsed = Number(raw?.trim());
	return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

/** Inteiro positivo com default, aplicando a mesma regra dentro do schema. */
const positiveIntWithDefault = (fallback: number) =>
	z
		.string()
		.trim()
		.optional()
		.transform((value) => positiveIntFromEnv(value, fallback));

const nonNegativeInt = (label: string) =>
	z
		.string()
		.trim()
		.optional()
		.transform((value, ctx) => {
			if (value === undefined || value === "") return undefined;

			const parsed = Number(value);
			if (!Number.isInteger(parsed) || parsed < 0) {
				ctx.addIssue({
					code: "custom",
					message: `${label} must be an integer of 0 or greater (got "${value}")`,
				});
				return z.NEVER;
			}
			return parsed;
		});

/** Inteiro com default explícito, para as variáveis cujo padrão é do processo. */
const nonNegativeIntWithDefault = (label: string, fallback: number) =>
	nonNegativeInt(label).transform((value) => value ?? fallback);

/** String que, se presente, não pode ser só espaço. */
const optionalNonEmpty = (label: string) =>
	z
		.string()
		.trim()
		.min(1, { message: `${label} cannot be empty` })
		.optional();

/** `"true"` liga; qualquer outra coisa (inclusive ausente) desliga. */
const optionalFlag = z
	.string()
	.trim()
	.optional()
	.transform((value) => value === "true");

const baseEnvSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.optional()
		.default("development"),

	// ── Servidor ──────────────────────────────────────────────────────────────
	/** Porta do app Express, o que serve produção hoje. */
	PORT: nonNegativeIntWithDefault("PORT", 5555),
	/**
	 * Porta do app Nest. Default diferente do Express de propósito: durante a
	 * coexistência os dois sobem em dev ao mesmo tempo e não podem colidir.
	 */
	PORT_NEST: nonNegativeIntWithDefault("PORT_NEST", 5557),
	SERVER_TIMEOUT_MS: nonNegativeIntWithDefault("SERVER_TIMEOUT_MS", 10 * 60 * 1000),

	// ── Puppeteer e Chromium ──────────────────────────────────────────────────
	TIMEOUT: nonNegativeInt("TIMEOUT"),
	BROWSER_CLOSE_TIMEOUT_MS: nonNegativeInt("BROWSER_CLOSE_TIMEOUT_MS"),
	BROWSER_KILL_GRACE_MS: nonNegativeInt("BROWSER_KILL_GRACE_MS"),
	BROWSER_SESSION_MAX_AGE_MS: nonNegativeInt("BROWSER_SESSION_MAX_AGE_MS"),
	CLOUDFLARE_CHALLENGE_TIMEOUT_MS: nonNegativeInt(
		"CLOUDFLARE_CHALLENGE_TIMEOUT_MS",
	),
	CLOUDFLARE_DEBUG_DIR: optionalNonEmpty("CLOUDFLARE_DEBUG_DIR"),
	/** `true` quando o Xvfb é iniciado por fora (Docker via `xvfb-run`). */
	USE_EXTERNAL_XVFB: optionalFlag,
	DOCKER: optionalFlag,

	// ── Autenticação e integrações ────────────────────────────────────────────
	STEAMTRADES_SESSION: optionalNonEmpty("STEAMTRADES_SESSION"),
	/** Ausente → `/api/games/research` só responde em modo demo. Nunca obrigatório. */
	INTERNAL_SECRET: optionalNonEmpty("INTERNAL_SECRET"),
	EXTERNAL_SECRET: optionalNonEmpty("EXTERNAL_SECRET"),
	SISTEMA_ESTOQUE_URL: z
		.string()
		.trim()
		.url({ message: "SISTEMA_ESTOQUE_URL must be a valid URL" })
		.optional(),
	API_KEY_GAMIVO: optionalNonEmpty("API_KEY_GAMIVO"),

	// ── SteamTrades ───────────────────────────────────────────────────────────
	STEAM_ID: optionalNonEmpty("STEAM_ID"),
	/**
	 * Liga o agendador de bump do app Nest. Default: **ligado**.
	 *
	 * Existe por um risco de negócio, não de desempenho: se o app Express e o
	 * Nest agendarem bump ao mesmo tempo, são **dois processos comentando no
	 * SteamTrades com a mesma conta** — caminho conhecido para ban. Enquanto os
	 * dois coexistem (até o PR 9), quem subir os dois em dev precisa desligar um
	 * com `BUMP_SCHEDULER_ENABLED=false`.
	 *
	 * O default é ligado de propósito: se fosse desligado, o cutover do PR 9
	 * passaria e o bump simplesmente pararia de acontecer em produção, sem erro
	 * nenhum. Perder a função em silêncio é pior que o risco em dev, onde a
	 * pessoa vê os dois logs subindo.
	 *
	 * Aceita **só** `"true"` ou `"false"`, e rejeita o resto no boot. Um
	 * `value !== "false"` faria `0`, `no`, `off` e `FALSE` significarem
	 * **ligado** — generoso demais para um interruptor cujo erro é ban de conta.
	 */
	BUMP_SCHEDULER_ENABLED: z
		.enum(["true", "false"], {
			message: 'BUMP_SCHEDULER_ENABLED must be exactly "true" or "false"',
		})
		.optional()
		.default("true")
		.transform((value) => value === "true"),
	/** Steam IDs a nunca abordar, separados por vírgula. */
	/**
	 * Steam IDs a nunca abordar.
	 *
	 * Usa o **mesmo** `parseEnvList` do app Express: ele separa por vírgula,
	 * ponto e vírgula OU quebra de linha, e remove duplicatas. Uma versão própria
	 * aqui, que só separava por vírgula, fazia `USER_TO_IGNORE="id1;id2"` virar um
	 * único ID literal — o Nest ignoraria ninguém e comentaria em anúncios que o
	 * Express nunca abordaria.
	 */
	USER_TO_IGNORE: z
		.string()
		.optional()
		.transform((value) => parseEnvList(value)),

	STEAMTRADES_PAGE_DELAY_MS: nonNegativeInt("STEAMTRADES_PAGE_DELAY_MS"),

	// ── Agendamento e concorrência ────────────────────────────────────────────
	RUN_LISTS_CONCURRENCY: positiveIntWithDefault(1),
	MAX_ACTIVE_LISTS: positiveIntWithDefault(3),
	NEW_SUPPLIERS_INTERVAL_HOURS: nonNegativeIntWithDefault("NEW_SUPPLIERS_INTERVAL_HOURS", 24),
});

/** O que, faltando em produção, faz o serviço subir sem poder fazer nada. */
const REQUIRED_IN_PRODUCTION = [
	"STEAMTRADES_SESSION",
	"SISTEMA_ESTOQUE_URL",
	"EXTERNAL_SECRET",
] as const;

export const envSchema = baseEnvSchema.superRefine((env, ctx) => {
	if (env.NODE_ENV !== "production") return;

	for (const key of REQUIRED_IN_PRODUCTION) {
		if (env[key] === undefined) {
			ctx.addIssue({
				code: "custom",
				path: [key],
				message: `${key} is required when NODE_ENV=production`,
			});
		}
	}
});

export type Env = z.infer<typeof envSchema>;

/**
 * Valida o ambiente e devolve a versão tipada.
 *
 * Passado ao `ConfigModule.forRoot({ validate })`: o Nest chama isto no boot, e
 * uma variável malformada derruba o processo com a lista de tudo que está
 * errado — em vez de estourar no primeiro request, horas depois do deploy.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
	const result = envSchema.safeParse(raw);

	if (!result.success) {
		const problems = result.error.issues
			.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
			.join("\n");
		throw new Error(`Invalid environment configuration:\n${problems}`);
	}

	return result.data;
}
