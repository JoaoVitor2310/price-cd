import { Router } from "express";
import multer from "multer";
import { uploadFile } from "@/controllers/file-controller";

const upload = multer({ dest: "../uploads/" }); // Configura o middleware do multer
const router = Router();
router.post("/upload", upload.single("fileToUpload"), uploadFile);

export default router;
