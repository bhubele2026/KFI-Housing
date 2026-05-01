import { Router, type IRouter } from "express";
import { resetToSampleData } from "../lib/seed";

const router: IRouter = Router();

router.post("/reset", async (_req, res): Promise<void> => {
  await resetToSampleData();
  res.json({ status: "ok" });
});

export default router;
