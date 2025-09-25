import { uploadFile } from "@/controllers/file-controller";
import { Router } from "express";

const router = Router();

router.use(uploadFile);

export default router;
