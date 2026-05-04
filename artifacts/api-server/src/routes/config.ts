import { Router, type IRouter } from "express";
import { GetRuntimeConfigResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// Returns the small set of runtime values the housingops web app reads on
// mount. Currently just the Google Maps Embed API key — exposed deliberately
// so an operator can rotate the key by updating the api-server secret + a
// quick api-server restart, without rebuilding or restarting the web
// workflow.
//
// SECURITY: do NOT add unrelated secrets here. The browser will see whatever
// this endpoint returns. Only values that are already public-by-design
// (e.g. the Google Maps Embed key, which travels in the embed URL anyway)
// belong here.
router.get("/config", (_req, res) => {
  const raw = process.env.GOOGLE_MAPS_API_KEY ?? "";
  const trimmed = raw.trim();
  const data = GetRuntimeConfigResponse.parse({
    googleMapsApiKey: trimmed === "" ? null : trimmed,
  });
  res.json(data);
});

export default router;
