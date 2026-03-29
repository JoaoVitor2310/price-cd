import { Router } from "express";
import { runLists } from "@/controllers/lists/run-lists.controller.js";

const router = Router();
router.post("/run", runLists);

export default router;
