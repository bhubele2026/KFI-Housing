import { Router, type IRouter } from "express";
import { ImportDataBody } from "@workspace/api-zod";
import { replaceAllData } from "../lib/seed";

const router: IRouter = Router();

router.post("/import", async (req, res): Promise<void> => {
  const body = ImportDataBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  await replaceAllData(body.data);
  res.json({ status: "ok" });
});

export default router;
