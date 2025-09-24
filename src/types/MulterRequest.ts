import type { Request } from "express";

export interface MulterRequest extends Request {
	file?: Express.Multer.File; // Para upload único
	files?:
		| Express.Multer.File[]
		| { [fieldname: string]: Express.Multer.File[] }; // Caso suporte múltiplos arquivos
}
