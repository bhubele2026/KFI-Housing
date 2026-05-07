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
import { normalizePropertyRow } from "../lib/db-row-normalizers";

const router: IRouter = Router();

router.get("/properties", async (_req, res): Promise<void> => {
  const rows = await db.select().from(propertiesTable).orderBy(propertiesTable.id);
  // Normalize each row at the DB ↔ API boundary (Task #365) so legacy
  // values — blank or unknown `paymentMethod`, off-list `status` /
  // `rentFrequency` — are coerced to canonical shape before
  // `ListPropertiesResponse.parse` sees them. One bad row used to 500
  // the entire list and blank the Customers / Properties pages.
  res.json(ListPropertiesResponse.parse(rows.map((r) => normalizePropertyRow(r))));
});

/**
 * One-shot backfill for properties saved before Task #152 added
 * server-side geocoding. Walks every row, geocodes any whose
 * `lat`/`lng` is null but whose composed address is non-blank, and
 * persists the resolved coordinates with `coordsVerified=false` (same
 * trust treatment as auto-geocoded saves — operators can still verify
 * a pin from the property detail page).
 *
 * Idempotent: rows that already have coords are skipped, and rows the
 * geocoder can't resolve (typo'd address, ZERO_RESULTS, no API key)
 * are left as-is so they keep surfacing in the missing-address side
 * panel and a future re-run can pick them up if the address is fixed.
 *
 * Once this has run on a workspace, the front-end live-geocode
 * fallback in `portfolio-map.tsx` becomes a dev-only safety net — no
 * production tab needs to call the JS Geocoder anymore because every
 * mappable row already carries persisted coords.
 *
 * Response body:
 *   - `scanned`: total rows examined
 *   - `updated`: rows whose null coords got resolved this run
 *   - `alreadyHadCoords`: skipped because lat/lng were already set
 *   - `noAddress`: skipped because every address field was blank
 *   - `stillMissing`: had an address but the geocoder returned no
 *     result; these stay null so a follow-up run after a typo fix
 *     can pick them up
 */
router.post("/properties/backfill-coords", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(propertiesTable)
    .orderBy(propertiesTable.id);
  const geocoder = getGeocoder();
  let scanned = 0;
  let updated = 0;
  let alreadyHadCoords = 0;
  let noAddress = 0;
  let stillMissing = 0;
  for (const row of rows) {
    scanned++;
    if (typeof row.lat === "number" && typeof row.lng === "number") {
      alreadyHadCoords++;
      continue;
    }
    const addr = formatPropertyAddress(row);
    if (!addr) {
      noAddress++;
      continue;
    }
    const point = await geocoder.geocode(addr);
    if (!point) {
      stillMissing++;
      continue;
    }
    await db
      .update(propertiesTable)
      .set({ lat: point.lat, lng: point.lng, coordsVerified: false })
      .where(eq(propertiesTable.id, row.id))
      .returning();
    updated++;
  }
  res.json({ scanned, updated, alreadyHadCoords, noAddress, stillMissing });
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
/**
 * Outcome of a save-time geocode. Surfaced on the POST/PATCH response
 * (Task #228) so the front-end can show a non-blocking warning toast
 * when an address couldn't be located — operators previously only
 * discovered the failure days later via the missing-address side
 * panel. Not persisted: this is a per-request signal, not a column.
 *   - `ok`: coords resolved (geocoder hit OR explicit lat/lng honored)
 *   - `no_result`: a non-blank address was geocoded but Google had
 *     nothing; the row still saved with null coords
 *   - `skipped`: no geocode round-trip happened (blank address, or a
 *     PATCH body that didn't touch any address field)
 */
type GeocodeStatus = "ok" | "no_result" | "skipped";

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
): Promise<{
  lat: number | null;
  lng: number | null;
  status: GeocodeStatus;
}> {
  if (
    explicitOverride &&
    typeof fields.lat === "number" &&
    typeof fields.lng === "number"
  ) {
    return { lat: fields.lat, lng: fields.lng, status: "ok" };
  }
  const addr = formatPropertyAddress(fields);
  if (!addr) return { lat: null, lng: null, status: "skipped" };
  const point: GeoPoint | null = await getGeocoder().geocode(addr);
  if (!point) return { lat: null, lng: null, status: "no_result" };
  return { ...point, status: "ok" };
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
  // Trust whatever the client says about verification when it ships
  // explicit coords (e.g. an import that already vetted them); auto-
  // geocoded pins always start as unverified so the UI can flag them.
  const coordsVerified =
    explicitOverride && typeof body.data.coordsVerified === "boolean"
      ? body.data.coordsVerified
      : false;
  const [row] = await db
    .insert(propertiesTable)
    .values({
      ...body.data,
      lat: coords.lat,
      lng: coords.lng,
      coordsVerified,
    })
    .returning();
  // Surface the geocode outcome alongside the persisted row (Task #228)
  // so the front-end can pop a non-blocking warning toast on `no_result`.
  // Field is documented in openapi as transient (not stored, never
  // returned by GET /properties).
  res
    .status(201)
    .json({ ...UpdatePropertyResponse.parse(row), geocodeStatus: coords.status });
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

  let updateValues: typeof body.data & {
    lat?: number | null;
    lng?: number | null;
    coordsVerified?: boolean;
  } = body.data;
  // Default outcome (Task #228): no geocode round-trip happened. Gets
  // overwritten in the address-touched branch below.
  let geocodeStatus: GeocodeStatus = explicitCoords ? "ok" : "skipped";

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
    // leave a stale pin pointing at the previous address. Auto-
    // resolved coords always start unverified — a manual verification
    // only applies to the address it was made against, so an address
    // change resets the badge regardless of what the body said.
    const coords = await resolveCoordsForSave(merged, false);
    updateValues = {
      ...body.data,
      lat: coords.lat,
      lng: coords.lng,
      coordsVerified: false,
    };
    geocodeStatus = coords.status;
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

  res.json({ ...UpdatePropertyResponse.parse(row), geocodeStatus });
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
