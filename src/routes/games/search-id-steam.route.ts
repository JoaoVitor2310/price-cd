import { Router } from "express";
import { searchGamesIdSteam } from "@/controllers/games/search-id-steam.controller.js";

const router = Router();
router.post("/search-id-steam", searchGamesIdSteam);

export default router;
