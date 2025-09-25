import { searchGames } from "@/controllers/games/search.controller";
import { Router } from "express";

const router = Router();
router.post("/search", searchGames);

export default router;
