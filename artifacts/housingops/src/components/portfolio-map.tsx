import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, ExternalLink, MapPin, RefreshCw } from "lucide-react";
import {
  getMapsKeyConsoleUrl,
  useGoogleMapsKeyError,
} from "@/hooks/use-google-maps-key-error";
import {
  useRecheckGoogleMapsKey,
  useRuntimeConfigQuery,
  useRuntimeConfigRefreshStale,
  useRuntimeConfigStream,
} from "@/hooks/use-runtime-config";
import { useToast } from "@/hooks/use-toast";
import { RuntimeConfigStaleWarning } from "@/components/runtime-config-stale-warning";
import {
  getCachedGeocode,
  loadMapsApi,
  primeGeocodeCache,
  resolveGeocode,
  __resetGoogleMapsSdkForTest,
  type MapsAdvancedMarkerElement,
  type MapsInfoWindow,
  type MapsMap,
} from "@/lib/google-maps-sdk";

export interface MappableProperty {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  customerName?: string;
  /**
   * Bed counts for the info bubble. Optional so callers that haven't
   * wired bed data through (e.g. lightweight previews) keep working —
   * the bubble simply omits the missing fields when these are absent.
   */
  totalBeds?: number;
  occupied?: number;
  vacant?: number;
  /**
   * Persisted coordinates from a previous geocode. When present the
   * map uses them on the very first paint and skips the live geocode
   * round-trip entirely. When absent (`null` or `undefined`) the map
   * falls back to live geocoding and reports the result back via
   * {@link PortfolioMapProps.onGeocoded} so the parent can persist it.
   */
  lat?: number | null;
  lng?: number | null;
}

interface PortfolioMapProps {
  /**
   * The properties to plot. Already-filtered upstream — the map honors
   * whatever customer/status/search filters the toolbar applied.
   */
  properties: MappableProperty[];
  /**
   * Called with the property's id when the operator commits to opening
   * the property — i.e. clicks "View details" inside the pin's info
   * bubble. Hovering or clicking the pin itself only opens the bubble;
   * navigation is one explicit click further so operators can scan the
   * map without losing their place.
   */
  onPinClick: (id: string) => void;
  /**
   * Called with the ids of any properties whose address Google
   * couldn't geocode. The parent uses this to surface those rows in
   * the missing-address side panel so a typo'd address doesn't quietly
   * disappear from the operator's view.
   */
  onUnmappableChange?: (ids: string[]) => void;
  /**
   * Called once per property when the live geocoder resolves a fresh
   * coordinate (i.e. the property arrived without stored lat/lng). The
   * parent uses this to persist the coordinate back onto the property
   * so future loads can render the pin instantly without another
   * round-trip. Not called for properties whose coordinates were
   * already supplied via {@link MappableProperty.lat}/{@link
   * MappableProperty.lng}.
   */
  onGeocoded?: (id: string, coords: { lat: number; lng: number }) => void;
  /**
   * Inject the Maps API key for tests so they don't have to stand up a
   * fake `/api/config` endpoint. When provided, the component skips the
   * runtime config fetch entirely and uses this value directly:
   *   - `undefined` (default) — fetch the key from the api-server
   *     `/api/config` endpoint via react-query
   *   - `"some-key"`          — render the map with this key
   *   - `""` / `null`         — render the friendly fallback branch
   *
   * Production code paths leave this `undefined` so an operator can
   * rotate the key on the api-server side (set `GOOGLE_MAPS_API_KEY`
   * + restart api-server) without rebuilding the web bundle.
   */
  apiKey?: string | null;
  /**
   * Override the Google Cloud Map ID for tests. When `apiKey` is left
   * `undefined` the component fetches both the API key and the Map ID
   * together from `/api/config`, so production code paths leave this
   * `undefined` as well — operators rotate the Map ID by setting
   * `GOOGLE_MAPS_MAP_ID` on the api-server and restarting it.
   *
   * The Map ID points at a HousingOps-branded vector map style
   * configured in the team's Google Cloud Console (custom palette +
   * reduced POI clutter). When neither this prop nor the runtime
   * config provides one, the map falls back to Google's built-in
   * `DEMO_MAP_ID` so a fresh dev workspace still renders pins —
   * AdvancedMarkerElement requires *some* Map ID to render at all.
   */
  mapId?: string | null;
}

/**
 * Joins the four address fields into a single string suitable for
 * geocoding ("123 Main St, Austin, TX 78701"). Returns "" when every
 * field is blank — caller uses that to push the property into the
 * "missing address" side panel.
 */
function fullAddress(p: MappableProperty): string {
  const street = p.address.trim();
  const cityStateZip = [
    p.city.trim(),
    [p.state.trim(), p.zip.trim()].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  return [street, cityStateZip].filter(Boolean).join(", ");
}

/**
 * Builds the DOM node Google Maps will render inside the InfoWindow.
 * Stays plain DOM (not React) because Google Maps owns the bubble's
 * lifecycle — re-mounting a React tree on every open would be wasteful
 * and would make the "View details" click harder to wire up.
 *
 * The `onView` callback is invoked when the operator clicks "View
 * details", at which point the parent navigates to the property page.
 */
function buildInfoBubbleContent(
  p: MappableProperty,
  onView: () => void,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "housingops-map-bubble";
  // Inline a few essentials so the bubble looks consistent even if the
  // host page's stylesheet doesn't reach into Google's shadow DOM.
  root.style.minWidth = "180px";
  root.style.maxWidth = "240px";
  root.style.fontSize = "13px";
  root.style.lineHeight = "1.35";
  root.dataset.testid = `portfolio-map-info-${p.id}`;

  const name = document.createElement("div");
  name.textContent = p.name;
  name.style.fontWeight = "600";
  name.style.fontSize = "14px";
  name.style.marginBottom = "2px";
  name.dataset.testid = `portfolio-map-info-name-${p.id}`;
  root.appendChild(name);

  if (p.customerName) {
    const cust = document.createElement("div");
    cust.textContent = p.customerName;
    cust.style.color = "#6b7280";
    cust.style.marginBottom = "6px";
    cust.dataset.testid = `portfolio-map-info-customer-${p.id}`;
    root.appendChild(cust);
  }

  if (typeof p.totalBeds === "number") {
    const stats = document.createElement("div");
    stats.style.display = "flex";
    stats.style.gap = "10px";
    stats.style.color = "#374151";
    stats.style.marginBottom = "8px";
    stats.style.flexWrap = "wrap";

    const totalSpan = document.createElement("span");
    totalSpan.dataset.testid = `portfolio-map-info-total-${p.id}`;
    totalSpan.innerHTML = `<strong>${p.totalBeds}</strong> bed${p.totalBeds === 1 ? "" : "s"}`;
    stats.appendChild(totalSpan);

    if (typeof p.occupied === "number") {
      const occSpan = document.createElement("span");
      occSpan.dataset.testid = `portfolio-map-info-occupied-${p.id}`;
      occSpan.style.color = "#16a34a";
      occSpan.innerHTML = `<strong>${p.occupied}</strong> occupied`;
      stats.appendChild(occSpan);
    }
    if (typeof p.vacant === "number") {
      const vacSpan = document.createElement("span");
      vacSpan.dataset.testid = `portfolio-map-info-vacant-${p.id}`;
      // Mirror the table cell's color logic: amber when there are open
      // beds, muted when fully occupied, so the two views agree.
      vacSpan.style.color = p.vacant > 0 ? "#d97706" : "#6b7280";
      vacSpan.innerHTML = `<strong>${p.vacant}</strong> vacant`;
      stats.appendChild(vacSpan);
    }
    root.appendChild(stats);
  }

  const link = document.createElement("button");
  link.type = "button";
  link.textContent = "View details →";
  link.dataset.testid = `portfolio-map-info-view-${p.id}`;
  link.style.background = "none";
  link.style.border = "none";
  link.style.padding = "0";
  link.style.color = "#2563eb";
  link.style.fontWeight = "500";
  link.style.cursor = "pointer";
  link.style.fontSize = "13px";
  link.addEventListener("click", (e) => {
    e.preventDefault();
    onView();
  });
  root.appendChild(link);

  return root;
}

// Test-only escape hatch — keeps the module-level caches in the shared
// `lib/google-maps-sdk` module from leaking between Vitest test cases.
// Existing portfolio-map tests already import this name, so it's kept
// as a thin delegating wrapper rather than asking every callsite to
// switch to the new shared name.
export function __resetPortfolioMapCachesForTest(): void {
  __resetGoogleMapsSdkForTest();
}

type LoaderStatus = "idle" | "loading" | "ready" | "error";

export function PortfolioMap({
  properties,
  onPinClick,
  onUnmappableChange,
  onGeocoded,
  apiKey,
  mapId,
}: PortfolioMapProps) {
  // Only hit `/api/config` when the caller didn't pre-supply a key.
  // Tests pass `apiKey` explicitly so they never fire a real fetch;
  // production leaves it `undefined` so we read both the key and the
  // Map ID from the runtime config endpoint and an operator can rotate
  // them without rebuilding the web bundle. `mapId` follows the same
  // convention — supplying it skips the runtime value for that field
  // only, but does NOT by itself trigger or skip the fetch.
  // The shared hook applies the periodic background refetch +
  // refetch-on-window-focus that lets a rotated GOOGLE_MAPS_API_KEY /
  // GOOGLE_MAPS_MAP_ID propagate into open tabs without a hard
  // refresh. Sharing the queryKey with the property-detail Location
  // card means the second consumer to mount gets the cached response
  // instantly and only one periodic poll fires for both.
  const shouldFetchConfig = apiKey === undefined;
  const configQuery = useRuntimeConfigQuery(shouldFetchConfig);
  // Subscribe to the SSE push channel so a rotated key lands within
  // seconds (api-server restart drops the EventSource → browser
  // reconnects → first `config` event delivers the rotated value)
  // instead of waiting up to a full polling interval. Pushes land in
  // the same react-query cache `useRuntimeConfigQuery` reads, so
  // `configQuery.data` / `dataUpdatedAt` just update faster — no
  // separate consumer wiring.
  useRuntimeConfigStream(shouldFetchConfig);

  // Resolve the effective key. Test injection wins; otherwise we use
  // the value from the runtime config endpoint (which can be `null`
  // when the operator hasn't set GOOGLE_MAPS_API_KEY yet).
  const fetchedKey =
    configQuery.data?.googleMapsApiKey == null
      ? ""
      : configQuery.data.googleMapsApiKey;
  const resolvedKey = apiKey === undefined ? fetchedKey : (apiKey ?? "");

  // Prefer (in order): an explicit prop (used by tests), the operator's
  // configured branded Map ID from runtime config, or Google's built-in
  // DEMO_MAP_ID as a last-resort fallback. AdvancedMarkerElement
  // refuses to render without a valid Map ID, so the fallback is what
  // keeps a fresh workspace from showing an empty canvas.
  const fetchedMapId =
    configQuery.data?.googleMapsMapId == null
      ? ""
      : configQuery.data.googleMapsMapId;
  const propMapId = mapId == null ? "" : mapId;
  const resolvedMapId =
    propMapId !== ""
      ? propMapId
      : fetchedMapId !== ""
        ? fetchedMapId
        : "DEMO_MAP_ID";

  // While the runtime config request is in flight we don't yet know
  // whether a key is configured — flashing the "set up your key" copy
  // before the answer arrives would mislead the operator, so render a
  // neutral placeholder instead.
  const isConfigLoading = shouldFetchConfig && configQuery.isPending;
  // The runtime config request itself failed (network error, 5xx, etc.).
  // Without an explicit branch the operator would otherwise see the
  // "set up your key" fallback (because `data` is undefined when the
  // query errors), which sends them chasing the wrong fix. Surface the
  // real cause instead and offer a manual retry.
  const isConfigError = shouldFetchConfig && configQuery.isError;
  // Sustained-failure warning. Fires once the periodic background
  // refetch has been failing for ≥ RUNTIME_CONFIG_STALE_WARNING_MS
  // *after* at least one successful fetch landed in this session, so
  // the operator knows a freshly-rotated GOOGLE_MAPS_API_KEY /
  // GOOGLE_MAPS_MAP_ID may not be reaching this tab. Hidden when the
  // caller pre-supplied an `apiKey` (no fetch happens), and a no-op
  // until the threshold is crossed.
  const isRefreshStale = useRuntimeConfigRefreshStale({
    isError: configQuery.isError,
    isSuccess: configQuery.isSuccess,
    data: configQuery.data,
    // Bridge to the SSE path: every push lands as a `setQueryData`
    // call on the same cache, which bumps `dataUpdatedAt`. Forwarding
    // it lets the stale hook treat a healthy push channel as
    // "refresh is working" even when the polling fallback is failing
    // (otherwise the warning would fire on a tab that's actually
    // getting fresh values via SSE).
    dataUpdatedAt: configQuery.dataUpdatedAt,
  });
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapsMap | null>(null);
  const markersRef = useRef<MapsAdvancedMarkerElement[]>([]);
  // One InfoWindow shared across every marker — Google's API closes any
  // previously-open instance when you call open() on a new anchor, so a
  // single window keeps the UX clean (no two bubbles open at once) and
  // saves on allocations.
  const infoWindowRef = useRef<MapsInfoWindow | null>(null);
  // Latest onPinClick in a ref so the imperative bubble's "View
  // details" button always calls the current callback, even after the
  // parent re-renders — without the ref we'd capture the first
  // callback in a closure and lose subsequent identity changes.
  const onPinClickRef = useRef(onPinClick);
  useEffect(() => {
    onPinClickRef.current = onPinClick;
  }, [onPinClick]);
  // Tracks `${id}::${addr}` pairs we've already reported via
  // `onGeocoded`. Without this, every parent rerender (one per
  // resolved property — see the dedup commentary on `inFlightGeocodes`)
  // would attach another `.then` callback to the same in-flight promise
  // and call `onGeocoded` repeatedly for the same property. Keying by
  // address (not just id) makes sure that *changing* the address later
  // re-arms the report so the new geocode is also persisted.
  const reportedRef = useRef<Set<string>>(new Set());
  // Tracks whether the component is still mounted so async geocoder
  // callbacks scheduled before unmount don't try to setState on a
  // dead tree.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [status, setStatus] = useState<LoaderStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Subscribe to the shared Maps-key-error store. Two independent signals
  // can put this map into a "key rejected" state:
  //   * The JS SDK calling `window.gm_authFailure` after the script
  //     loads but its key is rejected (referrer not allowed, key
  //     expired, project disabled, …). We can't tell which of those
  //     it was — Google's JS API auth-failure callback fires with no
  //     arguments — so we surface the generic JS-API auth-failure
  //     message.
  //   * The Property Location card on the same page (or any other
  //     Maps embed) reporting a specific code via postMessage. The
  //     shared store dedupes these across surfaces so the portfolio
  //     map flips into a clear error panel instead of leaving the
  //     operator staring at a stuck loading spinner or Google's grey
  //     error tile (Task #167).
  const keyError = useGoogleMapsKeyError();
  // Surface a one-time confirmation when a rotated key successfully
  // takes effect — without this, an operator who set a fresh
  // GOOGLE_MAPS_API_KEY on the api-server has to inspect the network
  // tab (or wait for the old key to start failing) to know the swap
  // was actually picked up. The toast fires only on the rotation
  // success path inside the load effect below; it stays silent on the
  // very first load because `loadMapsApi` reports `rotated: false`
  // when there was no previously-loaded key.
  const { toast } = useToast();

  // "Re-check key" affordance for the in-card error panel (Task #181).
  // Re-fetches /api/config and clears the shared key-error store on
  // success so the operator doesn't have to hard-refresh after fixing
  // the key in Google Cloud Console. See the panel's inline comment
  // and `useRecheckGoogleMapsKey`'s docs for the full behaviour.
  const { recheck: recheckKey, isRechecking } = useRecheckGoogleMapsKey();
  const handleRecheckKey = () => {
    void recheckKey();
  };
  // Resolved coordinates by property.id. `null` means the property has
  // an address but Google couldn't geocode it — those rows are surfaced
  // in the side panel alongside truly-blank addresses.
  const [coords, setCoords] = useState<
    Map<string, { lat: number; lng: number } | null>
  >(() => new Map());

  // Load the SDK + initialize the map once. The empty deps list is
  // intentional — re-initializing the map on every prop change would
  // wipe pan/zoom state and create a flicker.
  useEffect(() => {
    if (!resolvedKey) return;
    let cancelled = false;
    setStatus("loading");
    loadMapsApi(resolvedKey)
      .then(({ rotated }) => {
        if (cancelled) return;
        if (!mapEl.current) return;
        const maps = window.google!.maps!;
        mapRef.current = new maps.Map(mapEl.current, {
          // Default to a continental US view so the first paint isn't
          // empty ocean while geocoding settles. fitBounds below
          // overrides this once we have at least one pin.
          center: { lat: 39.8283, lng: -98.5795 },
          zoom: 4,
          // AdvancedMarkerElement requires a Map ID — without one
          // Google falls back to a raster map and logs a warning that
          // the markers will not render. In production this points at
          // a HousingOps-owned Map ID configured in the Google Cloud
          // Console (custom palette + reduced POI clutter that matches
          // the rest of the app), fetched at runtime from the
          // api-server's `/api/config` endpoint so an operator can
          // rotate it (or swap in a fresh branded style) by updating
          // `GOOGLE_MAPS_MAP_ID` and restarting only the api-server —
          // no web rebuild needed. When the runtime config returns
          // `null`, the component falls back to Google's built-in
          // `DEMO_MAP_ID`, which renders an unstyled map but at least
          // lets AdvancedMarkerElement attach pins so a fresh
          // workspace is never blank.
          mapId: resolvedMapId,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        // Clicks on the map background (anywhere that isn't a marker)
        // close the open bubble. Google's "click on map closes the
        // InfoWindow" behavior is documented but version-dependent,
        // so we wire it ourselves for parity with the Escape handler
        // and so the test harness can verify it.
        mapRef.current.addListener("click", () => {
          if (infoWindowRef.current) infoWindowRef.current.close();
        });
        setStatus("ready");
        // Confirm the rotation took effect. `loadMapsApi` only reports
        // `rotated: true` when a previously-loaded key was swapped for
        // a different one and the freshly-loaded SDK has now resolved,
        // so this fires exactly once per successful rotation and stays
        // silent on the first load (when there's no prior key to
        // rotate from). Without this, an operator who rotated
        // GOOGLE_MAPS_API_KEY on the api-server has no in-tab signal
        // that the swap actually landed — they'd have to inspect the
        // network tab or wait for the old key to start failing.
        if (rotated) {
          toast({
            title: "Google Maps key updated",
            description: "Map reloaded against the rotated key.",
          });
        }
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setErrorMsg(err.message);
        setStatus("error");
      });
    return () => {
      cancelled = true;
      // Explicitly tear down the previous map instance + markers +
      // info window before a key rotation (or unmount) so we don't
      // leak the old AdvancedMarkerElement instances and their
      // pin-level event listeners. The next effect run will replace
      // `mapRef.current` with a fresh Map built against the rotated
      // SDK; without this teardown the old map's markers (and the
      // closures held by their `mouseover` / `gmp-click` listeners)
      // would stay reachable through the marker array even though
      // mapRef itself was overwritten — and the shared InfoWindow
      // would still be holding the prior `setContent` HTMLElement.
      // For the rare operator who rotates keys multiple times in a
      // single tab, those leaks compound on every rotation.
      //
      // AdvancedMarkerElement removes itself from a map by setting
      // `map = null`; that's the documented teardown path (the old
      // `setMap(null)` API on google.maps.Marker no longer exists on
      // the advanced marker class).
      for (const m of markersRef.current) {
        m.map = null;
      }
      markersRef.current = [];
      if (infoWindowRef.current) {
        infoWindowRef.current.close();
        infoWindowRef.current = null;
      }
      mapRef.current = null;
    };
  }, [resolvedKey, resolvedMapId]);

  // Geocode any addresses we don't already have cached. Persisted
  // lat/lng coming in on the property object are used directly so the
  // map renders pins on the first paint with zero round-trips. The
  // module-level cache covers the case where the property has no
  // stored coords yet but we already resolved them earlier in the
  // session. A property's id maps to `null` when Google has no
  // result — those bubble up to the side panel so they aren't
  // silently dropped. Properties whose coordinates were freshly
  // resolved by the live geocoder are also reported to
  // `onGeocoded` so the parent can persist them on the server.
  useEffect(() => {
    if (status !== "ready") return;
    // Defensive guard for the brief render between a key-rotation
    // tear-down (loadMapsApi deleted `window.google` so the next load
    // can use the rotated key) and `setStatus("loading")` actually
    // committing — they happen in the same React commit, so this
    // effect can fire one more time with stale `status === "ready"`
    // but no SDK left to call into. Bailing out here lets the
    // load effect's subsequent re-run drive things forward.
    if (!window.google?.maps) return;
    const maps = window.google.maps;
    const geocoder = new maps.Geocoder();

    const next = new Map<string, { lat: number; lng: number } | null>();
    const toResolve: { id: string; addr: string }[] = [];
    for (const p of properties) {
      const addr = fullAddress(p);
      if (!addr) {
        next.set(p.id, null);
        continue;
      }
      // Stored coords win — instant paint, no Google call.
      if (typeof p.lat === "number" && typeof p.lng === "number") {
        next.set(p.id, { lat: p.lat, lng: p.lng });
        // Warm the shared in-session cache too so a sibling surface
        // (the per-property Location card) or another property at the
        // same address avoids an extra round-trip.
        primeGeocodeCache(addr, { lat: p.lat, lng: p.lng });
        // The parent already has these coordinates — make sure we
        // don't somehow re-report them later.
        reportedRef.current.add(`${p.id}::${addr}`);
        continue;
      }
      const cached = getCachedGeocode(addr);
      if (cached !== undefined) {
        next.set(p.id, cached);
      } else {
        toResolve.push({ id: p.id, addr });
      }
    }
    setCoords(next);

    // Wire each pending property to the (possibly already-in-flight)
    // geocode for its address. `resolveGeocode` dedupes at the module
    // level so each unique address is sent to Google at most once per
    // session, regardless of how many times the effect re-runs while
    // the request is pending. The reportedRef guard makes `onGeocoded`
    // one-shot per (id, addr) pair so the parent only persists each
    // resolution once even though re-renders may attach multiple
    // `.then` callbacks to the same promise.
    for (const { id, addr } of toResolve) {
      resolveGeocode(geocoder, addr).then((point) => {
        if (!mountedRef.current) return;
        setCoords((prev) => {
          // Skip the state update if it would be a no-op — the same
          // resolved value may arrive multiple times via attached
          // `.then` callbacks across re-renders.
          const existing = prev.get(id);
          if (
            (existing === null && point === null) ||
            (existing &&
              point &&
              existing.lat === point.lat &&
              existing.lng === point.lng)
          ) {
            return prev;
          }
          const m = new Map(prev);
          m.set(id, point);
          return m;
        });
        if (!point) return;
        const key = `${id}::${addr}`;
        if (reportedRef.current.has(key)) return;
        reportedRef.current.add(key);
        // Tell the parent so it can persist this back onto the
        // property — next time the map mounts we'll skip the
        // round-trip and render the pin synchronously.
        onGeocoded?.(id, point);
      });
    }
  }, [status, properties, onGeocoded]);

  // Sync markers + viewport whenever resolved coords change. We drop
  // every marker and rebuild — properties is small (operators look at
  // ~tens, not thousands), so the simpler "blow away & rebuild" path
  // beats tracking per-id marker diffs.
  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return;
    // Same defensive guard as the geocode effect above — the
    // key-rotation tear-down briefly leaves `window.google` undefined
    // while `setStatus("loading")` is still committing, and we'd
    // otherwise crash trying to construct a fresh InfoWindow /
    // AdvancedMarkerElement off the deleted SDK namespace.
    if (!window.google?.maps) return;
    const maps = window.google.maps;

    // AdvancedMarkerElement removes itself from the map by setting its
    // `map` property to null — there's no `setMap()` method anymore.
    for (const m of markersRef.current) m.map = null;
    markersRef.current = [];

    // Lazily allocate the shared InfoWindow on the first marker render
    // so it inherits the now-loaded `maps` namespace. Re-using it across
    // re-renders preserves Google's open/close lifecycle.
    if (!infoWindowRef.current) {
      infoWindowRef.current = new maps.InfoWindow({
        maxWidth: 260,
        ariaLabel: "Property summary",
      });
    }
    const infoWindow = infoWindowRef.current;

    const bounds = new maps.LatLngBounds();
    let added = 0;
    for (const p of properties) {
      const c = coords.get(p.id);
      if (!c) continue;
      const marker = new maps.marker.AdvancedMarkerElement({
        position: c,
        map: mapRef.current,
        title: p.name,
        // Required for `gmp-click` to fire — without it the marker is
        // a purely decorative overlay and the operator can't open the
        // info bubble at all.
        gmpClickable: true,
      });
      // Hover and click both open the bubble. Operators scanning for
      // clusters use mouseover; click is the keyboard/touch fallback
      // and also matches operators who treat the pin as a button.
      // Navigation now happens via the bubble's "View details" link.
      //
      // AdvancedMarkerElement is itself a custom HTMLElement, so we
      // subscribe with the standard DOM `addEventListener` rather than
      // the legacy `addListener` MVCObject API. `gmp-click` is the
      // marker's purpose-built click event (regular `click` does not
      // fire on advanced markers); `mouseover` bubbles up from the
      // pin's underlying DOM as normal.
      const open = () => {
        if (!mapRef.current) return;
        infoWindow.setContent(
          buildInfoBubbleContent(p, () => onPinClickRef.current(p.id)),
        );
        infoWindow.open({ map: mapRef.current, anchor: marker });
      };
      marker.addEventListener("mouseover", open);
      marker.addEventListener("gmp-click", open);
      markersRef.current.push(marker);
      bounds.extend(c);
      added++;
    }

    if (added === 1) {
      // fitBounds on a single-point bounds zooms to street-level which
      // hides any sense of context. Center + medium zoom reads better.
      mapRef.current.setCenter(bounds.getCenter());
      mapRef.current.setZoom(13);
    } else if (added > 1) {
      mapRef.current.fitBounds(bounds, 64);
    }
  }, [status, coords, properties]);

  // Close the bubble when the operator presses Escape — Google's
  // built-in close affordance is a tiny ✕ that's easy to miss, and the
  // task explicitly calls out Escape as the keyboard escape hatch. Map
  // background clicks are handled by an explicit listener wired in the
  // map-init effect above.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && infoWindowRef.current) {
        infoWindowRef.current.close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Bubble unmappable ids (address present but Google had no result)
  // back to the parent so the side panel can list them. Properties
  // whose address is wholly blank are already handled by the parent —
  // we only report rows that *should* have geocoded but didn't.
  useEffect(() => {
    if (!onUnmappableChange) return;
    const unmappable: string[] = [];
    for (const p of properties) {
      if (!fullAddress(p)) continue;
      // Only consider properties we've actually attempted to resolve;
      // a key that hasn't appeared in `coords` yet is still pending,
      // not failed.
      if (coords.has(p.id) && coords.get(p.id) === null) {
        unmappable.push(p.id);
      }
    }
    onUnmappableChange(unmappable);
  }, [coords, properties, onUnmappableChange]);

  // Sustained-failure banner — rendered above whichever Card branch
  // wins below. The banner itself is a no-op when `isRefreshStale` is
  // false, so we can hoist it above the early returns without each
  // branch having to opt in. Placed outside the Card on purpose: the
  // Card boundary should still represent "this is the map (or its
  // error / placeholder)", and the warning is about the surrounding
  // refresh pipeline, not the map itself (Task #175).
  const staleBanner = (
    <RuntimeConfigStaleWarning isStale={isRefreshStale} />
  );

  // A key has been observed as rejected anywhere on the page in this
  // session — show a dedicated "key rejected" panel here too. Without
  // this branch the portfolio map would either sit at "Loading map…"
  // forever (if `gm_authFailure` fired before the SDK considered itself
  // ready) or render Google's tiny grey error tile inside the canvas
  // with no operator-facing explanation. Render the same tailored copy
  // the toast surfaces so the in-page state matches the notification.
  //
  // This branch is intentionally checked BEFORE `isConfigLoading` /
  // `isConfigError` / the missing-key fallback: a sibling Maps surface
  // (e.g. the per-property Location card) can detect a rejected key
  // via postMessage *while* this component's `/api/config` request is
  // still in flight. If the loading placeholder won that race, the
  // operator would stare at a "Loading map…" spinner indefinitely
  // next to a toast saying the key was rejected, with no in-page
  // explanation. Letting the key-error branch win means the panel
  // shows up the moment any surface knows the key is bad — even if
  // this map's own config fetch hasn't returned yet (Task #176).
  if (keyError.code) {
    // Same per-code Google Cloud Console deep-link the toast uses
    // (Task #173). Surfacing it here too means an operator who
    // dismissed the toast — or arrived at the map after the toast had
    // already fired and timed out — still gets the single-click jump
    // to the right Console page (credentials / quotas / library / …)
    // for the reported code, instead of being told what's wrong with
    // no actionable button (Task #177).
    const consoleUrl = getMapsKeyConsoleUrl(keyError.code);
    return (
      <>
        {staleBanner}
        <Card
          data-testid="portfolio-map-key-error"
          data-error-code={keyError.code}
        >
          <CardContent className="p-6 space-y-3">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span data-testid="portfolio-map-key-error-text">
                {keyError.message}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                asChild
                type="button"
                size="sm"
                variant="outline"
                data-testid="portfolio-map-key-error-console-link"
              >
                <a
                  href={consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open in Google Cloud Console
                </a>
              </Button>
              {/*
                "Re-check key" affordance (Task #181). After fixing the
                key in Google Cloud Console (enabling the API, allow-
                listing this domain, raising the quota, rotating the
                value, …) operators previously had to hard-refresh the
                entire tab to recover. This button re-fetches
                /api/config and clears the shared key-error store on
                success so this card — and every other Maps surface on
                the page — drops out of its rejected branch and re-
                attempts to render. If Google still rejects the key the
                gm_authFailure / postMessage paths repopulate the store
                and the panel + a fresh toast come back, so clicking
                optimistically is safe.

                Caveat: the Google Maps JS SDK only fires
                `gm_authFailure` once per script load, so if the key
                *value* didn't change, the SDK won't re-confirm
                rejection on the next attempt. Recheck remains effective
                because (a) any key rotation forces a fresh script load
                via the `loadedApiKey !== apiKey` guard inside
                `loadMapsApi`, and (b) embed-iframe surfaces (the per-
                property Location card) are unaffected — each iframe is
                a fresh request to Google.
              */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleRecheckKey}
                disabled={isRechecking}
                data-testid="portfolio-map-key-error-recheck"
              >
                <RefreshCw
                  className={
                    isRechecking
                      ? "h-4 w-4 animate-spin"
                      : "h-4 w-4"
                  }
                />
                {isRechecking ? "Re-checking…" : "Re-check key"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  // While the runtime config request is in flight we render a neutral
  // placeholder rather than the "set up your key" copy — we don't yet
  // know whether a key is configured and flashing the warning before
  // the answer arrives would mislead the operator. Mirrors the
  // property-detail Location card's behavior.
  if (isConfigLoading) {
    return (
      <>
        {staleBanner}
        <Card data-testid="portfolio-map-config-loading">
          <CardContent className="p-0 relative">
            <div
              className="aspect-[16/9] w-full rounded-lg overflow-hidden bg-muted flex items-center justify-center text-sm text-muted-foreground"
              aria-busy="true"
            >
              <MapPin className="h-4 w-4 mr-2" />
              Loading map…
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  if (isConfigError) {
    return (
      <>
        {staleBanner}
        <Card data-testid="portfolio-map-config-error">
          <CardContent className="p-6">
            <div className="flex items-start gap-2 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
              <div className="space-y-3 flex-1">
                <p
                  className="text-destructive"
                  data-testid="portfolio-map-config-error-text"
                >
                  Couldn't load the map config from{" "}
                  <code className="font-mono text-[11px] bg-muted px-1 rounded">
                    /api/config
                  </code>
                  . Check the api-server logs and try again.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void configQuery.refetch();
                  }}
                  data-testid="portfolio-map-config-retry"
                >
                  Retry
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  if (!resolvedKey) {
    return (
      <>
        {staleBanner}
        <Card data-testid="portfolio-map-fallback">
          <CardContent className="p-6">
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                A Google Maps API key isn't configured on the api-server
                yet, so the portfolio map is hidden. Set{" "}
                <code className="font-mono text-[11px] bg-muted px-1 rounded">
                  GOOGLE_MAPS_API_KEY
                </code>{" "}
                on the api-server (and restart it) to render every
                property as pins on a single portfolio map.
              </span>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      {staleBanner}
      <Card data-testid="portfolio-map">
        <CardContent className="p-0 relative">
          <div
            ref={mapEl}
            className="aspect-[16/9] w-full rounded-lg overflow-hidden bg-muted"
            data-testid="portfolio-map-canvas"
          />
          {status === "loading" && (
            <div
              className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground pointer-events-none"
              data-testid="portfolio-map-loading"
            >
              <MapPin className="h-4 w-4 mr-2" />
              Loading map…
            </div>
          )}
          {status === "error" && (
            <div
              className="absolute inset-0 flex items-center justify-center text-sm text-destructive p-4 text-center"
              data-testid="portfolio-map-error"
            >
              {errorMsg ?? "Couldn't load the map."}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
