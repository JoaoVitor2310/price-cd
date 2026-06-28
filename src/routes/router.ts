import { Router } from "express";
import searchGamesRoute from "@/routes/games/search.route.js";
import researchGamesRoute from "@/routes/games/research-games.route.js";
import searchIdSteamRoute from "@/routes/games/search-id-steam.route.js";
import runListRoute from "@/routes/list/run-list.route.js";
import suppliersRoute from "@/routes/suppliers.route.js";

const router = Router();

router.use("/games", researchGamesRoute);
router.use("/games", searchGamesRoute);
router.use("/games", searchIdSteamRoute);
router.use("/lists", runListRoute);
router.use("/suppliers", suppliersRoute);

export default router;
