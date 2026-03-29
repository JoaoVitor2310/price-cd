import { Router } from "express";
import searchGamesRoute from "@/routes/games/search.route.js";
import uploadFileRoute from "@/routes/games/search-file.route.js";
import { searchGamesIdSteam } from "@/controllers/games/search-id-steam.controller.js";
import runListRoute from "@/routes/list/run-list.route.js";

const router = Router();

router.use(uploadFileRoute);
router.use("/games", searchGamesRoute);
router.use("/games", searchGamesIdSteam);
router.use("/lists", runListRoute);

export default router;
