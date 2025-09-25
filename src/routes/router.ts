import uploadFileRoute from "@/routes/upload-file";
import searchGamesRoute from "@/routes/games/search.route";
import { Router } from "express";

const router = Router();

router.use(uploadFileRoute);
router.use("/games", searchGamesRoute);

export default router;
