import { Router, type IRouter } from "express";
import { GetRuntimeConfigResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// Returns the small set of runtime values the housingops web app reads on
// mount: the Google Maps Embed API key (used by the property-detail
// Location card and the portfolio map) and the portfolio map's branded
// Map ID (custom palette + reduced POI clutter, configured in the team's
// Google Cloud Console). Both are exposed deliberately so an operator can
// rotate them by updating the api-server secret + a quick api-server
// restart, without rebuilding or restarting the web workflow.
//
// SECURITY: do NOT add unrelated secrets here. The browser will see whatever
// this endpoint returns. Only values that are already public-by-design
// (e.g. the Google Maps Embed key, which travels in the embed URL anyway,
// and the Map ID, which is referenced from the loaded JS SDK) belong here.
router.get("/config", (_req, res) => {
  const trim = (raw: string | undefined): string | null => {
    const v = (raw ?? "").trim();
    return v === "" ? null : v;
  };
  const data = GetRuntimeConfigResponse.parse({
    googleMapsApiKey: trim(process.env.GOOGLE_MAPS_API_KEY),
    googleMapsMapId: trim(process.env.GOOGLE_MAPS_MAP_ID),
  });
  res.json(data);
});

export default router;
