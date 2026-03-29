import type { Request, Response } from "express";
import { ZodError } from "zod";
// import { writeGameAnalysisToFile } from "@/services/create-download.service.js";
import { vipListRequestSchema, type VipListRequest } from "@/schemas/list.schema.js";
import { enqueueRunListsService } from "@/services/lists/enqueue-run-lists.service.js";

export class RunListsController {
	async run(req: Request, res: Response): Promise<void> {
		try {
			const validatedRequest: VipListRequest = vipListRequestSchema.parse(req.body);

			await enqueueRunListsService(validatedRequest);

			res.status(202).json({ success: true, status: "queued" });

      return;
		} catch (error) {
			if (error instanceof ZodError) {
				const errorMessage = error.issues
					.map((issue) => issue.message)
					.join(", ");
				console.error("❌ [ERROR] Invalid body:", errorMessage);
				res.status(400).json({
					success: false,
					data: `Erro no corpo da requisição: ${errorMessage}`,
				});
				return;
			}

			if (error instanceof Error) {
				console.error("❌ [ERROR] Internal server error:", error);
				res.status(500).json({
					success: false,
					error: "Internal server error.",
					details: error.message,
				});
				return;
			}

			res.status(500).json({
				success: false,
				error: "Internal server error.",
				details: "Unknown error",
			});
			return;
		}
	}
}

const runListsController = new RunListsController();
export const runLists = runListsController.run.bind(runListsController);
