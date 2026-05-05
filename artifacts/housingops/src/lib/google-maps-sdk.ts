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
//
// Failure entries (`null` values) AND dismissals are additionally
// persisted to `localStorage` so the sidebar badge and the Properties
// rollup survive a page refresh / browser restart — see
// `FAILURE_STORAGE_KEY` and `writePersistedFailures` below. Without
// that persistence, an operator who reloads the tab loses every
// recorded failure until some Maps surface re-issues the bad geocode,
// silently re-hitting Google billing on every visit. Successful
// coordinates remain in-memory only — they're already cached on the
// property record itself, and we don't want stale lat/lng to outlive
// an address edit.
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

// Addresses the operator has explicitly acknowledged via the
// "Dismiss" affordance on the Properties page rollup. Lives at module
// scope alongside `geocodeCache` so it shares the same in-session
// lifetime — survives view-mode toggles, page navigation, and
// re-mounts of the rollup, but resets on a hard refresh just like
// the cache itself. Kept separate from `geocodeCache` (rather than
// stamping a "dismissed" flag on each entry) so a fresh `null` for
// the same address — landing from any subsequent geocode attempt —
// can undismiss it without us having to reach back into per-entry
// state. See `notifyGeocodeFailureListeners` for the undismiss path.
const dismissedFailures = new Set<string>();

// localStorage key used to persist failures + dismissals across page
// reloads. Lives at module scope (not inside the helpers) so tests can
// import the constant if they need to seed storage directly. Scoped
// per browser-origin by definition of localStorage; not shared across
// users since the entire app data store is local-only too.
const FAILURE_STORAGE_KEY = "housingops:geocode-failures";

interface PersistedFailures {
  failures: string[];
  // Only addresses that ALSO appear in `failures` — we never persist
  // dismissals for addresses we haven't recorded a failure for, since
  // an orphan dismissal can't be observed (the rollup only renders
  // rows that match the failure set in the first place).
  dismissed: string[];
}

function readPersistedFailures(): PersistedFailures {
  if (typeof window === "undefined") return { failures: [], dismissed: [] };
  try {
    const raw = window.localStorage.getItem(FAILURE_STORAGE_KEY);
    if (!raw) return { failures: [], dismissed: [] };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const failures = Array.isArray(parsed.failures)
      ? parsed.failures.filter(
          (s): s is string => typeof s === "string" && s.length > 0,
        )
      : [];
    const dismissed = Array.isArray(parsed.dismissed)
      ? parsed.dismissed.filter(
          (s): s is string => typeof s === "string" && s.length > 0,
        )
      : [];
    return { failures, dismissed };
  } catch {
    // Corrupt JSON, quota errors, private mode, etc. — treat as empty
    // so a bad storage entry never blocks the SDK from booting.
    return { failures: [], dismissed: [] };
  }
}

function writePersistedFailures(): void {
  if (typeof window === "undefined") return;
  try {
    const failures: string[] = [];
    for (const [addr, point] of geocodeCache) {
      if (point === null) failures.push(addr);
    }
    if (failures.length === 0 && dismissedFailures.size === 0) {
      // Empty state — drop the key entirely so storage doesn't carry
      // stale entries forever after the operator clears every failure.
      window.localStorage.removeItem(FAILURE_STORAGE_KEY);
      return;
    }
    const payload: PersistedFailures = {
      failures,
      // Filter dismissals down to addresses that are still failing.
      // A dismissal whose underlying failure has been cleared (the
      // address now resolves successfully, or was wiped via reset)
      // can never resurface — persisting it would just leak storage.
      dismissed: failures.filter((a) => dismissedFailures.has(a)),
    };
    window.localStorage.setItem(FAILURE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota errors / disabled storage / private mode — silently ignore;
    // persistence is best-effort and the in-memory cache still works.
  }
}

// Hydrate the in-memory caches from localStorage on first module load.
// This runs ONCE per page — before any subscriber attaches — so the
// very first call to `getGeocodeFailures()` already sees failures
// recorded in a previous session, and the sidebar badge / rollup show
// the right count immediately on reload without waiting for a Maps
// surface to re-trigger them. Listener notification is intentionally
// skipped here: there are no listeners yet, and `useGeocodeFailures`
// reads the snapshot synchronously in its `useState` initializer so
// the hydrated set is picked up on first render anyway.
function hydrateGeocodeFailuresFromStorage(): void {
  if (typeof window === "undefined") return;
  const { failures, dismissed } = readPersistedFailures();
  for (const addr of failures) {
    // Don't clobber a fresher entry that may have been primed before
    // hydration ran (e.g. a test priming the cache before this fires)
    // — only fill in addresses we don't already know about.
    if (!geocodeCache.has(addr)) geocodeCache.set(addr, null);
  }
  for (const addr of dismissed) {
    dismissedFailures.add(addr);
  }
}
hydrateGeocodeFailuresFromStorage();

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
    // A dismissed address is one the operator has already triaged
    // ("rural lot, brand-new build, P.O. box, etc."). Exclude it
    // from the snapshot so the rollup row vanishes for the rest of
    // the session — but a future fresh failure for the same address
    // will undismiss it (see `primeGeocodeCache` / `resolveGeocode`).
    if (point === null && !dismissedFailures.has(addr)) out.add(addr);
  }
  return out;
}

/**
 * Acknowledge a flagged address so the Properties page rollup hides
 * its row for the rest of the session. Intended for the "Dismiss"
 * affordance: the operator looked at the address (rural lot, brand
 * new build, P.O. box, etc.) and decided no fix is needed, so the
 * row stops cluttering the panel.
 *
 * Dismissals are session-scoped — they share the in-memory lifetime
 * of `geocodeCache`, so they survive view-mode toggles and SPA
 * navigation but reset on hard refresh. Re-flagging the same address
 * (a subsequent geocode attempt landing a fresh `null`) clears the
 * dismissal so genuinely new failures aren't suppressed silently.
 */
export function dismissGeocodeFailure(addr: string): void {
  if (dismissedFailures.has(addr)) return;
  dismissedFailures.add(addr);
  // Persist so a reload doesn't bring the dismissed row back — the
  // operator already triaged it once, and re-flagging the panel on
  // every refresh would defeat the dismiss button's purpose. The
  // dismissal is dropped automatically when the matching failure
  // entry is removed (success, reset, etc.) — see
  // `writePersistedFailures` for that pruning.
  writePersistedFailures();
  // Notify even though the cache itself didn't change — the snapshot
  // shape did, and subscribers (the rollup panel) need the updated
  // set to drop the row from their render.
  notifyGeocodeFailureListeners();
}

/**
 * Wipes every recorded geocode failure (in-memory + persisted) and
 * any dismissals tracking them, then notifies subscribers so the
 * sidebar badge / Properties rollup drop to empty immediately.
 *
 * Intended for the "Reset to sample data" / dev "Reset demo data"
 * flows so a clean demo doesn't carry stale "addresses Google can't
 * pinpoint" badges from a prior session — the operator just reseeded
 * the demo dataset and expects a pristine slate. Successful
 * coordinates in the cache are intentionally left alone: those are
 * keyed by address and remain valid for any address that survives
 * the reset, and they're in-memory only anyway.
 */
export function clearGeocodeFailures(): void {
  let changed = false;
  // Walk a snapshot of the entries — mutating the Map while
  // iterating its own iterator works in modern engines, but a
  // snapshot is clearer and matches the rest of the codebase's
  // style around modifying collections during iteration.
  for (const [addr, point] of [...geocodeCache]) {
    if (point === null) {
      geocodeCache.delete(addr);
      changed = true;
    }
  }
  if (dismissedFailures.size > 0) {
    dismissedFailures.clear();
    changed = true;
  }
  // Always rewrite storage so that even a no-op (cache was already
  // empty) leaves storage in a coherent state — covers the case
  // where storage was somehow ahead of memory (e.g. a prior write
  // succeeded but the in-memory state was reset by a test helper).
  writePersistedFailures();
  if (changed) notifyGeocodeFailureListeners();
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
  const previous = geocodeCache.get(addr);
  const isNewFailure = point === null && previous !== null;
  // Stored-coords / successful resolution overwriting a previously
  // recorded failure — the address has been "fixed" (either by an
  // edit upstream that supplied stored coords, or by a re-attempt
  // landing a real result for what used to fail). The failure
  // snapshot lost an entry, so subscribers need to be told and the
  // persisted set must drop the address so a reload doesn't
  // resurrect the bad entry.
  const successOverridingFailure = point !== null && previous === null;
  geocodeCache.set(addr, point);
  if (isNewFailure) {
    // Re-flagging an address that the operator previously dismissed
    // brings the row back: a fresh failure is genuinely new
    // information ("Google rejected this again"), so the dismissal
    // shouldn't suppress it. Clearing here covers the case where the
    // cache lost its prior entry between dismissal and re-flag (e.g.
    // a __resetGoogleMapsSdkForTest in tests, or a manual cache
    // invalidation we may add later).
    dismissedFailures.delete(addr);
    writePersistedFailures();
    notifyGeocodeFailureListeners();
  } else if (successOverridingFailure) {
    // Drop any dismissal that was tracking the now-fixed failure so
    // `writePersistedFailures` (which prunes orphan dismissals) ends
    // up with a coherent storage shape, and so a future failure for
    // the same address surfaces as a fresh row rather than a
    // pre-suppressed one.
    dismissedFailures.delete(addr);
    writePersistedFailures();
    notifyGeocodeFailureListeners();
  }
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
        // Snapshot the previous value before we overwrite — used
        // below to detect a success landing on top of a previously
        // recorded failure (rare in steady state since the early
        // `geocodeCache.has(addr)` guard usually short-circuits, but
        // possible if a hydration-only `null` was waiting for this
        // address to be re-attempted).
        const previous = geocodeCache.get(addr);
        geocodeCache.set(addr, point);
        inFlightGeocodes.delete(addr);
        // Surface a fresh `null` to subscribers (the Properties page's
        // "addresses Google can't pinpoint" rollup) so the panel grows
        // live as new failures land — both from this surface and from
        // a per-property Location card sharing the same module-level
        // cache. A re-attempted geocode that lands `null` also clears
        // any prior dismissal for this address — see the matching
        // comment in `primeGeocodeCache` above. Persisting on failure
        // keeps the badge honest across page reloads.
        if (point === null) {
          dismissedFailures.delete(addr);
          writePersistedFailures();
          notifyGeocodeFailureListeners();
        } else if (previous === null) {
          // Success on top of an existing failure — drop the address
          // from the persisted failure set (so reload doesn't
          // resurrect it) and notify the rollup that the entry is
          // gone. See `primeGeocodeCache` for the same path on the
          // synchronous-write side.
          dismissedFailures.delete(addr);
          writePersistedFailures();
          notifyGeocodeFailureListeners();
        }
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
  // Dismissals share the cache's in-session lifetime in production —
  // reset them between tests for the same reason we reset the cache,
  // so a dismissal in one test doesn't suppress a failure in the next.
  dismissedFailures.clear();
  loadedApiKey = null;
  // Wipe persisted failures too. Without this, a test that primed a
  // failure (which now writes to localStorage) would leak storage
  // into the next test — and tests that import the SDK module after
  // the leak would re-hydrate the stale failure on first read. Tests
  // can still seed storage explicitly after this reset and call
  // `__hydrateGeocodeFailuresFromStorageForTest` to simulate a fresh
  // page load.
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(FAILURE_STORAGE_KEY);
    } catch {
      // Ignore — storage may be disabled in the test environment.
    }
  }
}

// Test-only helper that re-runs the on-load hydration logic. Lets a
// test seed `localStorage` with a known failure set and then assert
// that a "fresh page load" rebuilds the in-memory caches from it —
// the production hydration only fires once per module import, so
// tests need this to exercise the read path repeatedly.
export function __hydrateGeocodeFailuresFromStorageForTest(): void {
  hydrateGeocodeFailuresFromStorage();
  // Notify any subscribers attached BEFORE the hydration ran so they
  // pick up the rebuilt set. Production hydration runs at module
  // load (before any subscriber exists) so it doesn't need to
  // notify, but a test that re-hydrates after mounting components
  // does — the rollup / sidebar badge are listening already.
  notifyGeocodeFailureListeners();
}

// Test-only constant — exported under a `__` prefix so consumers know
// it isn't part of the production API. Tests use it to assert on or
// seed the persisted failure set without duplicating the key string.
export const __FAILURE_STORAGE_KEY_FOR_TEST = FAILURE_STORAGE_KEY;
