import * as z from "zod";



export const vipListRequestSchema = z.strictObject({
  id_steam: z.string().min(1, { message: "id_steam é obrigatório" }),
  callback_url: z.string().url({ message: "callback_url deve ser uma URL válida" }),
});

export type VipListRequest = z.infer<typeof vipListRequestSchema>;