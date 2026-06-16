import type { Request, Response } from "express";
import { createFindNewSuppliersRunner } from "@/services/suppliers/find-new-suppliers.factory.js";

export async function findNewSuppliers(_req: Request, res: Response): Promise<void> {
    try {
        console.log("🚀 [SUPPLIERS] Starting new suppliers search...");
        const result = await createFindNewSuppliersRunner().run();
        res.status(200).json({
            message: "New suppliers search completed.",
            ...result,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("❌ [SUPPLIERS] Error during suppliers search:", message);
        res.status(500).json({ error: message });
    }
}
