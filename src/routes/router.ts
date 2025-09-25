import uploadFileRoute from "@/routes/upload-file";
import { Router } from "express";

const router = Router();

router.use(uploadFileRoute);

export default router;
