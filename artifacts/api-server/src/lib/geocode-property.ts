import { logger } from "./logger";

/**
 * Minimal address shape the server-side geocoder needs. Matches the
 * subset of fields on `propertiesTable` that participate in the
 * "where is this property?" string we hand to Google.
 */
export interface PropertyAddressFields {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Server-side geocoder. Returns the resolved coordinate, or `null`
 * when the address is blank or Google has no result. Implementations
 * must NOT throw for the "no results" case — that's a normal outcome
 * the property routes translate into a `lat: null, lng: null`
 * persisted row so the front-end's missing-address side panel surfaces
 * the typo instead of the request failing outright.
 */
export interface Geocoder {
  geocode(address: string): Promise<GeoPoint | null>;
}

/**
 * Joins the four address fields into a single string suitable for the
 * Google Geocoding API. Mirrors `fullAddress` in
 * `housingops/src/components/portfolio-map.tsx` so a property the
 * front-end would have geocoded against `"123 Main St, Austin, TX
 * 78701"` gets the same string from the server. Returns `""` when
 * every field is blank — callers treat that as "skip the round trip,
 * persist null coords".
 */
export function formatPropertyAddress(p: PropertyAddressFields): string {
  const street = (p.address ?? "").trim();
  const cityStateZip = [
    (p.city ?? "").trim(),
    [(p.state ?? "").trim(), (p.zip ?? "").trim()].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  return [street, cityStateZip].filter(Boolean).join(", ");
}

/**
 * Reads the Google Maps API key from the environment with the same
 * canonical-then-legacy fallback the `/api/config` route uses (Task
 * #187). Returning `null` means no usable key is configured — the
 * geocoder treats that as a soft failure (persist `null` coords) so
 * an api-server with no key still accepts property creates and the
 * front-end live-geocode fallback covers the map view.
 */
function readGoogleMapsApiKey(): string | null {
  const trim = (raw: string | undefined): string | null => {
    const v = (raw ?? "").trim();
    return v === "" ? null : v;
  };
  return (
    trim(process.env.GOOGLE_MAPS_API_KEY) ??
    trim(process.env.VITE_GOOGLE_MAPS_API_KEY)
  );
}

/**
 * Production Geocoder built on top of the public Google Geocoding
 * REST API. Re-reads the API key on every call so a rotated
 * `GOOGLE_MAPS_API_KEY` lands on the very next save without an
 * api-server restart (matches the rotation story for `/api/config`).
 *
 * Failure modes — all of these resolve to `null`, never throw:
 *   * No API key configured.
 *   * Google returns `ZERO_RESULTS` for the address.
 *   * The HTTP request fails or returns a non-2xx response.
 *   * The request takes longer than `timeoutMs` (default 5s) — we
 *     don't want a slow geocode to block a property create from
 *     returning to the operator.
 *
 * Each soft failure is logged at `warn` level with the request id (if
 * present in the calling context) so an operator can correlate a
 * `lat: null` row with the geocoder warning, but the route still
 * returns `201` / `200` so the property persists.
 */
class GoogleHttpGeocoder implements Geocoder {
  private readonly timeoutMs: number;
  constructor(opts: { timeoutMs?: number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 5_000;
  }

  async geocode(address: string): Promise<GeoPoint | null> {
    const trimmed = address.trim();
    if (!trimmed) return null;
    const key = readGoogleMapsApiKey();
    if (!key) {
      logger.warn(
        { address: trimmed },
        "geocoder: GOOGLE_MAPS_API_KEY not configured; persisting null coords",
      );
      return null;
    }
    const url =
      "https://maps.googleapis.com/maps/api/geocode/json" +
      `?address=${encodeURIComponent(trimmed)}` +
      `&key=${encodeURIComponent(key)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        logger.warn(
          { address: trimmed, status: res.status },
          "geocoder: Google responded non-2xx; persisting null coords",
        );
        return null;
      }
      const body = (await res.json()) as {
        status?: string;
        results?: Array<{
          geometry?: { location?: { lat?: number; lng?: number } };
        }>;
        error_message?: string;
      };
      if (body.status === "ZERO_RESULTS") {
        logger.warn(
          { address: trimmed },
          "geocoder: Google returned ZERO_RESULTS; persisting null coords",
        );
        return null;
      }
      if (body.status !== "OK") {
        logger.warn(
          {
            address: trimmed,
            status: body.status,
            error: body.error_message,
          },
          "geocoder: Google returned non-OK status; persisting null coords",
        );
        return null;
      }
      const loc = body.results?.[0]?.geometry?.location;
      if (
        !loc ||
        typeof loc.lat !== "number" ||
        typeof loc.lng !== "number"
      ) {
        logger.warn(
          { address: trimmed },
          "geocoder: Google response missing lat/lng; persisting null coords",
        );
        return null;
      }
      return { lat: loc.lat, lng: loc.lng };
    } catch (err) {
      logger.warn(
        { address: trimmed, err: (err as Error).message },
        "geocoder: request failed; persisting null coords",
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

let activeGeocoder: Geocoder = new GoogleHttpGeocoder();

/**
 * Returns the currently-active geocoder. Routes call this on every
 * request rather than capturing the instance at module load so test
 * injection via {@link __setGeocoderForTest} takes effect immediately.
 */
export function getGeocoder(): Geocoder {
  return activeGeocoder;
}

/**
 * Test escape hatch. Vitest tests swap in a deterministic geocoder
 * (in-memory address → coord map) so they don't depend on the network
 * or a real Google API key. Pass `null` to restore the production
 * HTTP geocoder.
 */
export function __setGeocoderForTest(g: Geocoder | null): void {
  activeGeocoder = g ?? new GoogleHttpGeocoder();
}
