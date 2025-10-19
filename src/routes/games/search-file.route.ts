import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { uploadFile } from "@/controllers/games/search-file-controller";

const upload = multer({
	dest: path.resolve(process.cwd(), "uploads"),
	limits: {
		fileSize: 1024 * 1024 * 1, // 1M
		files: 1,
	},
	fileFilter: (_req, file, cb) => {
		if (file.mimetype !== "text/plain") {
			cb(new Error("Only text/plain files are allowed"));
		}
		cb(null, true);
	},
});

const router = Router();

router.post("/upload", upload.single("fileToUpload"), uploadFile);

export default router;
