import * as z from "zod";

export const enqueueRunListSchema = z.strictObject({
  steam_id: z.string().min(1, { message: "steam_id is required" }),
  checkGamivoOffer: z.boolean().default(true),
});

export type SupplierListRequest = z.infer<typeof enqueueRunListSchema>;
