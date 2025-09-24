// src/routes/index.ts
import { Router } from "express";
import uploadFile from "./upload-file.js";

const router = Router();

router.use(uploadFile); // Adiciona a rota de atualização de ofertas
// router.use(priceResearcherRoute); // Adiciona a rota de buscador de preços
// router.use(whenToSellRoute); // Adiciona a rota de quando vender

export default router;
