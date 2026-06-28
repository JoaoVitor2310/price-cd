import * as z from "zod";



export const vipListRequestSchema = z.strictObject({
  id_steam: z.string().min(1, { message: "id_steam is required" }),
  callback_url: z.string().url({ message: "callback_url must be a valid URL" }),
  checkGamivoOffer: z.boolean().default(true),
});

export type VipListRequest = z.infer<typeof vipListRequestSchema>;