import { Router } from "express";
import { researchGames } from "@/controllers/games/research-games.controller.js";

const router = Router();

router.post("/research", researchGames);

export default router;
