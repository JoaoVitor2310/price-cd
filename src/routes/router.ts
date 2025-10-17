import { Router } from "express";
import searchGamesRoute from "@/routes/games/search.route";
import uploadFileRoute from "@/routes/upload-file";

const router = Router();

router.use(uploadFileRoute);
router.use("/games", searchGamesRoute);

export default router;
