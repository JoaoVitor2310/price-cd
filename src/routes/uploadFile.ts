import { Router } from "express";
import multer from "multer";
import { uploadFile } from "../controllers/fileController.js";

const upload = multer({ dest: "../uploads/" }); // Configura o middleware do multer
const router = Router();
// @ts-expect-error
router.post("/upload", upload.single("fileToUpload"), uploadFile);

export default router;
