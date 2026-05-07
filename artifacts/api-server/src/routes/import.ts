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
  await replaceAllData({
    ...body.data,
    // Older clients (pre task #321) won't include this field; treat
    // missing as an empty array so the importer never crashes on a
    // legacy backup that has nothing to restore.
    roomNightLogs: body.data.roomNightLogs ?? [],
    // Older clients (pre task #497) won't include this field; treat
    // missing as an empty array.
    otherCosts: body.data.otherCosts ?? [],
  });
  res.json({ status: "ok" });
});

export default router;
