import { Router } from 'express';
import { uploadFile } from '../controllers/fileController.js';
import multer from 'multer';

const upload = multer({ dest: '../uploads/' }); // Configura o middleware do multer
const router = Router();
// @ts-ignore
router.post('/upload', upload.single('fileToUpload'), uploadFile);

export default router;
