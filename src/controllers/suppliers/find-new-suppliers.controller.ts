import type { Request, Response } from "express";
import { enqueueFindNewSuppliersService } from "@/services/suppliers/find-new-suppliers.factory.js";

export async function findNewSuppliers(_req: Request, res: Response): Promise<void> {
    try {
        console.log("🚀 [SUPPLIERS] Queuing new suppliers search...");
        await enqueueFindNewSuppliersService();
        res.status(202).json({ success: true, status: "queued" });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("❌ [SUPPLIERS] Error queuing suppliers search:", message);
        res.status(500).json({ error: message });
    }
}
