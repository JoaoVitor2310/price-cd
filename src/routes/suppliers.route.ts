import { Router } from "express";
import { findNewSuppliers } from "@/controllers/suppliers/find-new-suppliers.controller.js";

const router = Router();

router.post("/find-new", findNewSuppliers);

export default router;
