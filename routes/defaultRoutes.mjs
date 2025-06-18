import express from "express";

import { protect } from "../controllers/v1/authBasicController.mjs";

import { generateKpiData, generateCdrData } from "../controllers/v1/dataGenController.mjs";

import notAllowedMethodController from "../controllers/v1/notAllowedMethodController.mjs";

const router = express.Router();

router.route("/generateKpiData").post(protect, generateKpiData).all(notAllowedMethodController);
router.route("/generateCdrData").post(protect, generateCdrData).all(notAllowedMethodController);

export default router;
