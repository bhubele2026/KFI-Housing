import { Router, type IRouter } from "express";
import { HealthCheckResponse, GetVersionResponse } from "@workspace/api-zod";
import { APP_VERSION } from "../lib/app-version";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Per-deploy build id the web client polls to detect a republish.
router.get("/version", (_req, res) => {
  const data = GetVersionResponse.parse({ version: APP_VERSION });
  res.json(data);
});

export default router;
