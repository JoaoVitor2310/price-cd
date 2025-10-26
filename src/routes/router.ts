import { Router } from "express";
import searchGamesRoute from "@/routes/games/search.route.js";
import uploadFileRoute from "@/routes/games/search-file.route.js";

const router = Router();

router.use(uploadFileRoute);
router.use("/games", searchGamesRoute);

export default router;
