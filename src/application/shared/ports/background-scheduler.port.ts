/**
 * Porta para agendar execução em background no mesmo processo.
 * Genérica por natureza — usada por qualquer subdomínio que precise responder
 * ao cliente antes de terminar um trabalho longo (scraping, importação).
 * (infra simples: setImmediate ou fila com concorrência limitada)
 */
export interface BackgroundScheduler {
	schedule(task: () => Promise<void>): void;
}
