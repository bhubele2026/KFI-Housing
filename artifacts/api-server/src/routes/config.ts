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
  // The Google Maps key has been migrated env var names twice in close
  // succession — first `VITE_GOOGLE_MAPS_API_KEY` for the build-time
  // setup (Tasks #143/#147), then `GOOGLE_MAPS_API_KEY` for this
  // runtime `/api/config` setup (Task #154). Each migration left an
  // opportunity for the secret to be set under one name while the code
  // reads the other, and the resulting failure mode was silent — the
  // map page just rendered the dashed "API key isn't configured"
  // fallback with no log line pointing at the real cause.
  //
  // Reading the canonical name first and falling back to the legacy
  // name means a single-character mismatch can never silently kill
  // the map again. DO NOT remove the fallback in a future cleanup
  // without first confirming nothing in the deploy/secrets pipeline
  // is still pinned to the legacy name (Task #187).
  const googleMapsApiKey =
    trim(process.env.GOOGLE_MAPS_API_KEY) ??
    trim(process.env.VITE_GOOGLE_MAPS_API_KEY);
  const data = GetRuntimeConfigResponse.parse({
    googleMapsApiKey,
    googleMapsMapId: trim(process.env.GOOGLE_MAPS_MAP_ID),
  });
  res.json(data);
});

export default router;
