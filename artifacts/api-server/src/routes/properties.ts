import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, propertiesTable } from "@workspace/db";
import {
  ListPropertiesResponse,
  CreatePropertyBody,
  UpdatePropertyParams,
  UpdatePropertyBody,
  UpdatePropertyResponse,
  DeletePropertyParams,
} from "@workspace/api-zod";
import {
  formatPropertyAddress,
  getGeocoder,
  type GeoPoint,
} from "../lib/geocode-property";

const router: IRouter = Router();

router.get("/properties", async (_req, res): Promise<void> => {
  const rows = await db.select().from(propertiesTable).orderBy(propertiesTable.id);
  res.json(ListPropertiesResponse.parse(rows));
});

/**
 * Resolves the lat/lng to persist for a freshly-created or
 * address-edited property. Geocoding happens here, server-side, so
 * the very first viewer of the portfolio map (or anyone reloading the
 * page) gets pins instantly without a Google round-trip — the only
 * round-trip per address now happens once, on save (Task #152).
 *
 * Precedence:
 *   1. Explicit `lat`/`lng` from the request body win — this keeps
 *      the front-end's existing safety-net live-geocode path
 *      idempotent (it `PATCH`es the resolved coords back, and we
 *      should not re-geocode and clobber them with a different
 *      result), and lets ops back-fill known coordinates by hand.
 *   2. A blank composed address persists as `null` — there's nothing
 *      to geocode and a blank-address row should remain in the
 *      "missing address" side panel until edited.
 *   3. Otherwise we ask the active geocoder. A `null` result
 *      (ZERO_RESULTS, no API key, request failure, …) persists as
 *      `null` so the address-typo cases bubble up to the same
 *      missing-address side panel that already handles unmappable
 *      rows. The save itself never fails because of geocoding.
 */
async function resolveCoordsForSave(
  fields: {
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    lat?: number | null;
    lng?: number | null;
  },
  explicitOverride: boolean,
): Promise<{ lat: number | null; lng: number | null }> {
  if (
    explicitOverride &&
    typeof fields.lat === "number" &&
    typeof fields.lng === "number"
  ) {
    return { lat: fields.lat, lng: fields.lng };
  }
  const addr = formatPropertyAddress(fields);
  if (!addr) return { lat: null, lng: null };
  const point: GeoPoint | null = await getGeocoder().geocode(addr);
  if (!point) return { lat: null, lng: null };
  return point;
}

router.post("/properties", async (req, res): Promise<void> => {
  const body = CreatePropertyBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  // Geocode at save time. The front-end caller almost never sends
  // `lat`/`lng` on create (they aren't part of the property form), so
  // this is the path that backfills coords for every new property.
  const explicitOverride =
    typeof body.data.lat === "number" && typeof body.data.lng === "number";
  const coords = await resolveCoordsForSave(body.data, explicitOverride);
  const [row] = await db
    .insert(propertiesTable)
    .values({ ...body.data, lat: coords.lat, lng: coords.lng })
    .returning();
  res.status(201).json(UpdatePropertyResponse.parse(row));
});

router.patch("/properties/:id", async (req, res): Promise<void> => {
  const params = UpdatePropertyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdatePropertyBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  // Decide whether this PATCH needs to (re-)geocode. We re-geocode
  // when any of the four address fields is in the body — even if it's
  // unchanged from the persisted value, because callers shouldn't have
  // to diff before sending. A body that touches no address field at
  // all (e.g. an `onGeocoded` writeback that only sets lat/lng, a
  // ratings edit, a status flip) skips the geocode entirely so we
  // don't burn a Google call on every unrelated edit.
  const addressFieldKeys = ["address", "city", "state", "zip"] as const;
  const addressTouched = addressFieldKeys.some((k) => k in body.data);
  const explicitCoords =
    typeof body.data.lat === "number" && typeof body.data.lng === "number";

  let updateValues: typeof body.data & { lat?: number | null; lng?: number | null } =
    body.data;

  if (addressTouched && !explicitCoords) {
    // Need the persisted row so we can compose the *resulting*
    // address (body fields override, missing fields fall through to
    // the stored values) and geocode that.
    const [existing] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    const merged = {
      address: body.data.address ?? existing.address,
      city: body.data.city ?? existing.city,
      state: body.data.state ?? existing.state,
      zip: body.data.zip ?? existing.zip,
    };
    // Re-geocode and overwrite lat/lng on the update — including
    // clearing them to `null` on failure so a typo'd edit doesn't
    // leave a stale pin pointing at the previous address.
    const coords = await resolveCoordsForSave(merged, false);
    updateValues = { ...body.data, lat: coords.lat, lng: coords.lng };
  }

  const [row] = await db
    .update(propertiesTable)
    .set(updateValues)
    .where(eq(propertiesTable.id, params.data.id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Property not found" });
    return;
  }

  res.json(UpdatePropertyResponse.parse(row));
});

router.delete("/properties/:id", async (req, res): Promise<void> => {
  const params = DeletePropertyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(propertiesTable).where(eq(propertiesTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
