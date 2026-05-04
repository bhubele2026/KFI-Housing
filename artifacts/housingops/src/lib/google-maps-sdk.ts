// Shared Google Maps JS SDK loader, type shims, and geocode cache used by
// every Maps surface in the app (the portfolio map and the per-property
// Location card). Hoisting these out of `portfolio-map.tsx` is what
// keeps the two surfaces from each loading their own `<script>` tag,
// duplicating geocoder traffic, or fighting over the rotated-key
// detection — they share one SDK script, one `loadedApiKey` tracker,
// and one in-session geocode cache.

// Minimal hand-rolled shape for the parts of the Google Maps JS SDK we
// actually call into — installing @types/google.maps just for a handful
// of classes is overkill, and the surface area below is small enough
// that keeping it inline is clearer than adding a dev dep.
export interface MapsLatLng {
  lat: () => number;
  lng: () => number;
}
export interface MapsLatLngBounds {
  extend: (point: { lat: number; lng: number }) => void;
  getCenter: () => MapsLatLng;
}
export interface MapsMap {
  setCenter: (p: { lat: number; lng: number } | MapsLatLng) => void;
  setZoom: (z: number) => void;
  fitBounds: (b: MapsLatLngBounds, padding?: number) => void;
  addListener: (event: string, cb: () => void) => void;
}
// AdvancedMarkerElement is a custom HTMLElement, so DOM-style
// addEventListener is the right way to subscribe to its events. Google
// also still exposes the legacy `addListener` MVCObject method, but the
// DOM API works for both `gmp-click` (the marker's own event) and
// native pointer events like `mouseover` that bubble out of the pin.
export interface MapsAdvancedMarkerElement {
  // `map = null` removes the marker from the map. Property assignment
  // replaces the old `setMap(null)` API on google.maps.Marker.
  map: MapsMap | null;
  addEventListener: (event: string, cb: () => void) => void;
}
export interface MapsInfoWindow {
  setContent: (content: string | HTMLElement) => void;
  open: (
    opts:
      | { map: MapsMap; anchor: MapsAdvancedMarkerElement }
      | MapsMap,
    anchor?: MapsAdvancedMarkerElement,
  ) => void;
  close: () => void;
  addListener: (event: string, cb: () => void) => void;
}
export interface MapsGeocoder {
  geocode: (
    req: { address: string },
    cb: (
      results:
        | Array<{ geometry?: { location?: MapsLatLng } }>
        | null,
      status: string,
    ) => void,
  ) => void;
}
export interface MapsMarkerLibrary {
  // Per Google's docs, `gmpClickable: true` is required for the
  // `gmp-click` event to fire — without it the marker is purely
  // decorative. We always pass it so the pins behave like buttons.
  AdvancedMarkerElement: new (opts: {
    position: { lat: number; lng: number };
    map: MapsMap;
    title?: string;
    gmpClickable?: boolean;
  }) => MapsAdvancedMarkerElement;
}
export interface MapsApi {
  Map: new (
    el: HTMLElement,
    opts: Record<string, unknown>,
  ) => MapsMap;
  Geocoder: new () => MapsGeocoder;
  LatLngBounds: new () => MapsLatLngBounds;
  InfoWindow: new (opts?: {
    content?: string | HTMLElement;
    maxWidth?: number;
    ariaLabel?: string;
  }) => MapsInfoWindow;
  // Loaded by adding `libraries=marker` to the loader URL — see
  // `loadMapsApi` below.
  marker: MapsMarkerLibrary;
}

declare global {
  interface Window {
    google?: { maps?: MapsApi };
    __housingopsMapsLoader?: Promise<void>;
  }
}

// Tracks the API key the currently-loaded SDK script was initialized
// with. The Google Maps JS SDK binds the API key in its `<script>`
// URL at load time — every subsequent call into the SDK (geocoding,
// tile requests, etc.) is auth'd against that key, regardless of any
// fresher key we've since fetched from `/api/config`. So when the
// runtime config refetch lands a *different* key, we tear down the
// existing script + globals so the next `loadMapsApi` call re-loads
// the SDK against the new key. Without this, a rotated key would only
// take effect on hard refresh — the operator would have to ask every
// open tab to reload, defeating much of the no-rebuild rotation flow.
let loadedApiKey: string | null = null;

/**
 * Loads the Google Maps JS SDK once per page, or re-loads it when the
 * effective API key has changed since the last load (key rotation).
 * Subsequent calls with the same key return the in-flight or
 * already-resolved promise so toggling the map view repeatedly never
 * injects duplicate <script> tags or re-downloads the SDK.
 *
 * The resolved value reports whether this load was triggered by a key
 * rotation (`rotated: true`) versus the very first load in this tab
 * (`rotated: false`). Callers use that flag to surface a one-time toast
 * confirming the rotated key actually took effect, while staying silent
 * on fresh tabs where no rotation has occurred yet.
 */
export function loadMapsApi(apiKey: string): Promise<{ rotated: boolean }> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps requires a browser environment"));
  }
  // Detect a rotated key. If the SDK was previously loaded with a
  // different key, blow away the old <script> + globals so the next
  // load below uses the rotated value. The component's load effect
  // re-runs on `resolvedKey` change, so it'll then create a fresh
  // `google.maps.Map` against the freshly-loaded SDK. We snapshot the
  // detection result so the caller can react (e.g. toast confirming
  // the rotation took effect) once the new SDK is actually ready —
  // checking `loadedApiKey` again at resolve time would race against
  // a third rotation that lands while this one is in flight.
  const isRotation = loadedApiKey !== null && loadedApiKey !== apiKey;
  if (isRotation) {
    const stale = document.querySelector<HTMLScriptElement>(
      'script[data-housingops-maps]',
    );
    if (stale) stale.remove();
    // Drop the SDK namespace so the readiness check below doesn't
    // short-circuit against the old build. The `delete` operator is
    // the safe cross-browser way to detach the property — assigning
    // `undefined` would leave a `google` shape with `maps` missing,
    // which is fine in practice but reads less clearly.
    delete (window as { google?: unknown }).google;
    delete window.__housingopsMapsLoader;
    loadedApiKey = null;
  }
  // The marker library piggy-backs on the script's `load` event when
  // we list it in `libraries=` (see below), so checking for
  // `AdvancedMarkerElement` is sufficient to know the SDK is fully
  // ready for both the Geocoder and the new marker class.
  if (window.google?.maps?.marker?.AdvancedMarkerElement) {
    loadedApiKey = apiKey;
    return Promise.resolve({ rotated: isRotation });
  }
  if (window.__housingopsMapsLoader) {
    return window.__housingopsMapsLoader.then(() => ({ rotated: isRotation }));
  }

  const promise = new Promise<void>((resolve, reject) => {
    const onReady = () => {
      if (
        window.google?.maps?.Geocoder &&
        window.google?.maps?.marker?.AdvancedMarkerElement
      ) {
        // Stamp the key the SDK was loaded with so a subsequent
        // rotation can detect that the script needs to be reloaded.
        loadedApiKey = apiKey;
        resolve();
      } else {
        reject(
          new Error(
            "Google Maps loaded but required classes are unavailable",
          ),
        );
      }
    };
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-housingops-maps]',
    );
    if (existing) {
      existing.addEventListener("load", onReady);
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load Google Maps")),
      );
      return;
    }
    const s = document.createElement("script");
    // Intentionally omit `loading=async`: Google's async loader requires
    // every class (including Geocoder and AdvancedMarkerElement) to be
    // pulled in via `await google.maps.importLibrary(...)`, but the rest
    // of this component reaches for `google.maps.Geocoder` /
    // `marker.AdvancedMarkerElement` / `LatLngBounds` synchronously
    // right after script load. Sync loading + an explicit
    // `libraries=marker` parameter keeps that contract — when the
    // <script> `load` event fires, all classes (including the marker
    // library) are bound on `window.google.maps`.
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&libraries=marker`;
    s.async = true;
    s.defer = true;
    s.dataset.housingopsMaps = "1";
    s.addEventListener("load", onReady);
    s.addEventListener("error", () =>
      reject(new Error("Failed to load Google Maps")),
    );
    document.head.appendChild(s);
  });
  window.__housingopsMapsLoader = promise;
  return promise.then(() => ({ rotated: isRotation }));
}

// Module-level geocode cache — keyed by the formatted address string.
// Survives re-renders, view-mode toggles, and filter changes so the
// operator doesn't burn fresh quota every time they bounce between the
// table, map, and per-property Location card. `null` means "we tried
// and Google had no result".
const geocodeCache = new Map<string, { lat: number; lng: number } | null>();

// Subscribers notified whenever the cache grows a *failure* entry
// (`null` value). Used by the Properties page's "addresses Google can't
// pinpoint" rollup so it picks up failures observed by *any* Maps
// surface — the portfolio map, a per-property Location card mounted on
// the property-detail page, etc. — without each surface having to push
// into a parallel store. Successes don't emit because the rollup only
// cares about the failure set, and skipping the redundant emit keeps
// noise out of subscribers' renders.
type GeocodeFailureListener = (failures: ReadonlySet<string>) => void;
const geocodeFailureListeners = new Set<GeocodeFailureListener>();

function notifyGeocodeFailureListeners(): void {
  if (geocodeFailureListeners.size === 0) return;
  // Snapshot once and hand the same Set to every listener — the
  // returned Set is documented as read-only, and reusing the
  // reference lets React's `useState` bail out of redundant renders
  // when the failure set hasn't actually changed identity.
  const snapshot = computeFailureSnapshot();
  for (const l of geocodeFailureListeners) l(snapshot);
}

function computeFailureSnapshot(): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [addr, point] of geocodeCache) {
    if (point === null) out.add(addr);
  }
  return out;
}

/**
 * Returns a snapshot of every address Google has definitively rejected
 * this session (cached as `null`). Stable enough to read on render —
 * each call walks the cache, but the cache stays small (one entry per
 * unique address the operator has actually viewed). React consumers
 * should pair this with `subscribeGeocodeFailures` so they re-render as
 * new failures land.
 */
export function getGeocodeFailures(): ReadonlySet<string> {
  return computeFailureSnapshot();
}

/**
 * Subscribe to geocode-failure changes. The listener fires every time a
 * fresh `null` entry is added to the cache (whether by `resolveGeocode`
 * receiving an empty result from Google or by `primeGeocodeCache` being
 * passed `null` directly). Returns an unsubscribe function suitable for
 * direct return from a `useEffect` cleanup.
 */
export function subscribeGeocodeFailures(
  listener: GeocodeFailureListener,
): () => void {
  geocodeFailureListeners.add(listener);
  return () => {
    geocodeFailureListeners.delete(listener);
  };
}

/**
 * Joins the four address fields into the canonical string used as the
 * geocode cache key (e.g. "123 Main St, Austin, TX 78701"). Both the
 * portfolio map and the per-property Location card produce identical
 * strings via this helper, so downstream consumers (the "fix these
 * addresses" rollup, tests priming the cache directly) can match a
 * property to its cache entry by computing the same string. Returns ""
 * when every field is blank — callers use that to decide a property
 * doesn't have an address worth geocoding at all.
 */
export function formatGeocodeAddress(parts: {
  address: string;
  city: string;
  state: string;
  zip: string;
}): string {
  const street = parts.address.trim();
  const cityStateZip = [
    parts.city.trim(),
    [parts.state.trim(), parts.zip.trim()].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  return [street, cityStateZip].filter(Boolean).join(", ");
}

// In-flight geocode requests — also module-level. Without this, an
// effect re-running on every parent rerender (which happens after each
// `onGeocoded` writes back coordinates and the property list updates)
// would re-issue Google calls for every still-pending address before
// their first response lands. Storing the in-flight promise lets every
// re-render attach to the *same* request rather than spawning a new one,
// capping total Google calls at exactly one per unique address per
// session. Entries are deleted as soon as the promise settles so the
// resolved value lives only in `geocodeCache`.
const inFlightGeocodes = new Map<
  string,
  Promise<{ lat: number; lng: number } | null>
>();

/** Synchronous read of the cache — returns `undefined` when absent. */
export function getCachedGeocode(
  addr: string,
): { lat: number; lng: number } | null | undefined {
  return geocodeCache.get(addr);
}

/** Synchronous write — used to warm the cache with stored coords. */
export function primeGeocodeCache(
  addr: string,
  point: { lat: number; lng: number } | null,
): void {
  // A pre-existing `null` doesn't constitute a *new* failure — only
  // notify when this write actually adds (or upgrades) a failure
  // entry, so subscribers don't see redundant updates when stored
  // coords prime the cache for an already-failed lookup.
  const isNewFailure =
    point === null && geocodeCache.get(addr) !== null;
  geocodeCache.set(addr, point);
  if (isNewFailure) notifyGeocodeFailureListeners();
}

/**
 * Resolves an address through Google, deduping concurrent requests for
 * the same address across renders and component instances. Returns the
 * cached value synchronously when available so callers don't even pay
 * the microtask cost on a hit. `null` means "Google has no result".
 */
export function resolveGeocode(
  geocoder: MapsGeocoder,
  addr: string,
): Promise<{ lat: number; lng: number } | null> {
  if (geocodeCache.has(addr)) {
    return Promise.resolve(geocodeCache.get(addr) ?? null);
  }
  const existing = inFlightGeocodes.get(addr);
  if (existing) return existing;
  const promise = new Promise<{ lat: number; lng: number } | null>(
    (resolve) => {
      geocoder.geocode({ address: addr }, (results, geocodeStatus) => {
        const point =
          geocodeStatus === "OK" && results && results[0]?.geometry?.location
            ? {
                lat: results[0].geometry.location.lat(),
                lng: results[0].geometry.location.lng(),
              }
            : null;
        geocodeCache.set(addr, point);
        inFlightGeocodes.delete(addr);
        // Surface a fresh `null` to subscribers (the Properties page's
        // "addresses Google can't pinpoint" rollup) so the panel grows
        // live as new failures land — both from this surface and from
        // a per-property Location card sharing the same module-level
        // cache. Successes don't need to emit because the rollup only
        // tracks failures.
        if (point === null) notifyGeocodeFailureListeners();
        resolve(point);
      });
    },
  );
  inFlightGeocodes.set(addr, promise);
  return promise;
}

// Test-only escape hatch — keeps the module-level caches from leaking
// between Vitest test cases. Not exported through any production import
// site; lives here so tests don't need to dig at private internals.
// Also clears the rotated-key tracker so a test that loads the SDK with
// key "A" doesn't trick the next test (which may not call into the SDK
// at all) into thinking a rotation already happened. Failure listeners
// are intentionally NOT cleared — production subscribers attach via
// React effects and detach on unmount, and tests that mount the
// Properties page will register their own listener that cleanup tears
// down between cases.
export function __resetGoogleMapsSdkForTest(): void {
  geocodeCache.clear();
  inFlightGeocodes.clear();
  loadedApiKey = null;
}
