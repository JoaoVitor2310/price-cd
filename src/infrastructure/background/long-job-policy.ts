import type { JobsOptions } from "bullmq";

/**
 * A política das filas de jobs longos — a pesquisa, o Reabastecimento e a
 * Descoberta. Ver `docs/adr/0009-fila-duravel-da-pesquisa.md`. Um lugar só: são a
 * mesma regra, e mudar uma fila sem as outras seria divergência sem motivo.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * O registro das execuções: quanto tempo um job terminado fica no Redis para
 * ser consultado. Por idade, não por contagem — "o que rodou na última semana"
 * é a pergunta, e uma rajada de pedidos não deve apagar o histórico.
 *
 * `attempts` fica no default (1) de propósito: repetir um Reabastecimento que
 * falhou depois de chamar o Estoque cria uma segunda Trade (o callback sem oferta
 * não é idempotente), e repetir uma Descoberta pergunta de novo se comenta. A
 * pesquisa sobrescreve isto com as suas tentativas (`RESEARCH_JOB_OPTIONS`), só
 * para o pedido idempotente. Interrupção por deploy **não** é tentativa — o job
 * volta à fila sem consumir nada (`ResumableBullmqWorker.stop`).
 */
export const LONG_JOB_OPTIONS: JobsOptions = {
	removeOnComplete: { age: (7 * DAY_MS) / 1000 },
	removeOnFail: { age: (30 * DAY_MS) / 1000 },
};

/**
 * Um processo que morre no meio de um job (OOM, SIGKILL) deixa o job "travado";
 * o próximo worker o recoloca na fila. Depois de 2 travamentos, o job falha em
 * vez de entrar em loop derrubando o processo de novo: a BullMQ grava a falha no
 * job e o worker a aplica ao pegá-lo, sem chamar o processador.
 *
 * É uma repetição implícita: um job que já tinha criado a Trade antes de o
 * processo morrer roda de novo (ADR 0009, janelas conhecidas).
 */
export const LONG_JOB_MAX_STALLED_COUNT = 2;

/**
 * Teto de cada comando que quem está na requisição espera — guardar o pedido, e
 * na pesquisa também ler e apagar o job do pedido repetido —, com a conexão
 * pronta. É rede de segurança, não o caminho comum: o Redis fora é recusado
 * antes, pelo `isConnected`, porque o comando da BullMQ esperaria a conexão.
 */
export const LONG_JOB_COMMAND_TIMEOUT_MS = 5000;
