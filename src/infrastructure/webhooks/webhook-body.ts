import type { ResearchResult } from "@/application/games/ports/research-result-notifier.port.js";

/**
 * O corpo do webhook, como viaja: `snake_case`, o formato do contrato HTTP (ver
 * README, "Webhook do resultado"). A Application fala `ResearchResult`; a
 * tradução para o fio é daqui.
 */
export type WebhookBody =
	| { request_uuid: string; result: "trade_created"; trade_uuid: string }
	| { request_uuid: string; result: "no_trade" }
	| {
			request_uuid: string;
			result: "failed";
			failure: { kind: string; message: string };
	  };

export const toWebhookBody = (
	requestUuid: string,
	result: ResearchResult,
): WebhookBody => {
	switch (result.result) {
		case "trade_created":
			return {
				request_uuid: requestUuid,
				result: "trade_created",
				trade_uuid: result.tradeUuid,
			};
		case "no_trade":
			return { request_uuid: requestUuid, result: "no_trade" };
		case "failed":
			return {
				request_uuid: requestUuid,
				result: "failed",
				failure: { kind: result.failure.kind, message: result.failure.message },
			};
	}
};
