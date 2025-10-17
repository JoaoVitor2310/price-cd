import { Router } from "express";
import { searchGames } from "@/controllers/games/search.controller";

const router = Router();
router.post("/search", searchGames);

export default router;
