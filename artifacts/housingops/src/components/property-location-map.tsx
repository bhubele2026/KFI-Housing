import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  MapPin,
  Navigation,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  getMapsKeyConsoleUrl,
  useGoogleMapsKeyError,
} from "@/hooks/use-google-maps-key-error";
import {
  useRuntimeConfigQuery,
  useRuntimeConfigRefreshStale,
  useRuntimeConfigStream,
  useRecheckGoogleMapsKey,
} from "@/hooks/use-runtime-config";
import { useToast } from "@/hooks/use-toast";
import { RuntimeConfigStaleWarning } from "@/components/runtime-config-stale-warning";
import {
  getCachedGeocode,
  loadMapsApi,
  primeGeocodeCache,
  resolveGeocode,
  type MapsAdvancedMarkerElement,
  type MapsMap,
} from "@/lib/google-maps-sdk";

// NOTE (rebase Task #195 onto Tasks #196/#197): the iframe-only
// MAPS_KEY_TROUBLESHOOTING_TEXT constant that lived here is gone
// along with the iframe itself. The JS SDK rewrite has no iframe
// `error` event to listen for — local script-load failures surface
// via `loaderError` (see the SDK-load effect below) and Google's
// rejected-key codes still land on the shared `useGoogleMapsKeyError`
// store (populated by `gm_authFailure` from `loadMapsApi`, by other
// surfaces' postMessage handlers, etc). The "single canonical home
// for the error state" intent from Task #197 is preserved by
// `isMapError` further down, which now gates on BOTH the shared
// store code AND the local `loaderError` so every failure source
// renders through one panel.

interface PropertyLocationMapProps {
  address: string;
  city: string;
  state: string;
  zip: string;
  /**
   * Inject the Maps API key for tests so they don't have to stand up a
   * fake `/api/config` endpoint. When provided, the component skips the
   * runtime config fetch entirely and uses this value directly:
   *   - `undefined` (default) — fetch the key from the api-server
   *     `/api/config` endpoint via react-query
   *   - `"some-key"`          — render the SDK map branch with this key
   *   - `""` / `null`         — render the friendly fallback branch
   *
   * Production code paths leave this `undefined` so an operator can
   * rotate the key on the api-server side without rebuilding the web
   * bundle (Task #154).
   */
  apiKey?: string | null;
  /**
   * Branded Google Map ID. Mirrors `PortfolioMap`'s `mapId` prop —
   * supplying a value here skips the runtime config field for `mapId`
   * specifically (tests inject a fixed value to assert the SDK Map was
   * built with the expected ID), but does NOT by itself trigger or
   * skip the `/api/config` fetch (that decision still depends solely
   * on `apiKey`). Production leaves this `undefined` so the value is
   * read from `/api/config.googleMapsMapId`, which can be rotated by
   * setting `GOOGLE_MAPS_MAP_ID` on the api-server.
   */
  mapId?: string | null;
  /**
   * Stored coordinates for the property. When both are numbers the
   * component skips the geocoder round-trip and renders the pin
   * synchronously on first paint — same fast-path the portfolio map
   * uses. Production callers wire these from the property record so
   * coordinates resolved on a previous mount are reused immediately.
   */
  lat?: number | null;
  lng?: number | null;
  /**
   * Called once per address whenever the live geocoder resolves a
   * fresh point that this caller did not pre-supply. Used by the
   * property-detail page to persist the resolved coords back onto the
   * Property record so the next mount renders the pin without hitting
   * Google again. Mirrors `PortfolioMap.onGeocoded`'s contract.
   */
  onGeocoded?: (point: { lat: number; lng: number }) => void;
  /**
   * Whether the persisted lat/lng has been operator-confirmed. Drives
   * the trust badge below the map: `true` shows a "Verified location"
   * chip; `false` (the default for auto-geocoded pins) shows an
   * "Approximate location" chip alongside the "Mark as verified" and
   * "Re-geocode" actions. `undefined` is treated as `false` so legacy
   * rows (created before this column existed) surface the same
   * unverified affordances.
   */
  coordsVerified?: boolean;
  /**
   * Called when the operator clicks "Mark as verified". The parent
   * persists `coordsVerified: true` onto the property record so the
   * badge sticks across reloads.
   */
  onMarkVerified?: () => void;
  /**
   * Called when the operator clicks "Re-geocode". The parent re-runs
   * the server-side geocode by re-PATCHing the address fields, which
   * also resets `coordsVerified` to `false` for the freshly-resolved
   * coords.
   */
  onRegeocode?: () => void;
}

function formatAddressLines(
  address: string,
  city: string,
  state: string,
  zip: string,
): { street: string; cityStateZip: string; full: string } {
  const street = address.trim();
  const cityPart = city.trim();
  const statePart = state.trim();
  const zipPart = zip.trim();
  const cityStateZip = [
    cityPart,
    [statePart, zipPart].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  const full = [street, cityStateZip].filter(Boolean).join(", ");
  return { street, cityStateZip, full };
}

type LoaderStatus = "idle" | "loading" | "ready" | "error";

export function PropertyLocationMap({
  address,
  city,
  state,
  zip,
  apiKey,
  mapId,
  lat,
  lng,
  onGeocoded,
  coordsVerified,
  onMarkVerified,
  onRegeocode,
}: PropertyLocationMapProps) {
  const { street, cityStateZip, full } = formatAddressLines(
    address,
    city,
    state,
    zip,
  );

  const hasAnyAddress = full.length > 0;

  // Only hit the network when the caller didn't pre-supply a key. Tests
  // pass `apiKey` explicitly so they never fire a real fetch; production
  // leaves it undefined so we read the key from `/api/config`. We also
  // skip the fetch when there's no address to render — the empty state
  // owns the card in that case and the key wouldn't be used anyway.
  //
  // The shared hook applies the periodic background refetch +
  // refetch-on-window-focus that lets a rotated GOOGLE_MAPS_API_KEY /
  // GOOGLE_MAPS_MAP_ID propagate into open tabs without a hard
  // refresh. Sharing the queryKey with the portfolio map means the
  // second consumer to mount gets the cached response instantly and
  // one periodic poll covers both.
  const shouldFetchConfig = apiKey === undefined && hasAnyAddress;
  const configQuery = useRuntimeConfigQuery(shouldFetchConfig);
  // Subscribe to the SSE push channel so a rotated key lands within
  // seconds of the api-server restart instead of waiting up to a full
  // polling interval. Pushes land in the same react-query cache the
  // polling hook reads, so `configQuery.data` updates faster.
  useRuntimeConfigStream(shouldFetchConfig);

  // Subscribe to the shared Google Maps key-error store so a code
  // observed *anywhere else on the page* — the portfolio map's
  // `gm_authFailure` callback, an embed iframe on a sibling card, or
  // this card's own SDK load failing auth — flips this card into its
  // dedicated key-rejected branch even before our `/api/config` request
  // has had a chance to return. Without this subscription, an operator
  // could be staring at our "Loading map…" placeholder indefinitely
  // while a toast on the same page already said the key was rejected
  // (Task #178).
  const sharedKeyError = useGoogleMapsKeyError();

  // "Re-check key" affordance for the in-card error panel. An operator
  // who fixed their Maps key in Google Cloud Console clicks this and
  // we re-fetch /api/config + clear the shared key-error store so the
  // card drops out of the rejected branch and re-attempts the SDK
  // mount against the (now possibly fixed) key — without a hard
  // refresh. Local SDK error state (`loaderError`) is reset alongside
  // the shared store so the map gets a fresh attempt even when the
  // resolved key value didn't change.
  const { recheck, isRechecking } = useRecheckGoogleMapsKey();
  const [loaderError, setLoaderError] = useState<string | null>(null);
  // Bumping this counter forces the SDK-load effect to re-run even
  // when none of its other deps changed, so an operator who fixed a
  // local SDK load failure (script blocked, transient network error)
  // can recover via the in-card Re-check button without needing a key
  // rotation to flip `resolvedKey`.
  const [loadAttempt, setLoadAttempt] = useState(0);
  const handleRecheck = () => {
    setLoaderError(null);
    setLoadAttempt((n) => n + 1);
    void recheck();
  };

  // Empty state owns the card before we touch anything Maps-related —
  // no SDK load, no /api/config fetch, no geocode. Returning early
  // keeps the rest of the component free to assume `full` is non-empty.
  if (!hasAnyAddress) {
    return (
      <Card data-testid="card-property-location">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Location
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground"
            data-testid="property-location-empty"
          >
            <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Add an address to see this property on a map.
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

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
  // refuses to render the pin without a valid Map ID, so the fallback
  // is what keeps a fresh workspace from showing an empty canvas.
  // Mirrors `PortfolioMap`'s resolution exactly so both surfaces use
  // the same branded style for an operator's deployment.
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

  // While the config request is in flight we render a neutral
  // placeholder instead of the "set up your key" copy — we don't yet
  // know whether a key is configured, and flashing the scary warning
  // before the answer arrives would mislead the operator.
  const isConfigLoading = shouldFetchConfig && configQuery.isPending;
  // The runtime config request itself failed (network error, 5xx,
  // etc.). Without an explicit branch the operator would otherwise see
  // the "set up your key" fallback (because `data` is undefined when
  // the query errors), which sends them chasing the wrong fix. Surface
  // the real cause and offer a manual retry.
  const isConfigError = shouldFetchConfig && configQuery.isError;
  // Sustained-failure warning. Fires once the periodic background
  // refetch has been failing for ≥ RUNTIME_CONFIG_STALE_WARNING_MS
  // *after* at least one successful fetch landed in this session, so
  // the operator knows a freshly-rotated GOOGLE_MAPS_API_KEY may not
  // be reaching this tab. Hidden when the caller pre-supplied an
  // `apiKey` (no fetch happens), and a no-op until the threshold is
  // crossed.
  const isRefreshStale = useRuntimeConfigRefreshStale({
    isError: configQuery.isError,
    isSuccess: configQuery.isSuccess,
    data: configQuery.data,
    dataUpdatedAt: configQuery.dataUpdatedAt,
  });

  const encoded = encodeURIComponent(full);
  const searchUrl = `https://www.google.com/maps/search/?api=1&query=${encoded}`;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;

  // ---------------------------------------------------------------
  // SDK / map / marker lifecycle
  //
  // Mirrors the structure used by `portfolio-map.tsx` so both
  // surfaces share the exact same loader, geocode cache, and
  // rotation behavior — see `lib/google-maps-sdk.ts` for the
  // shared state.
  // ---------------------------------------------------------------
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapsMap | null>(null);
  const markerRef = useRef<MapsAdvancedMarkerElement | null>(null);
  const reportedRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const onGeocodedRef = useRef(onGeocoded);
  useEffect(() => {
    onGeocodedRef.current = onGeocoded;
  }, [onGeocoded]);

  const [status, setStatus] = useState<LoaderStatus>("idle");
  // Resolved coordinate for *this* property's address. `undefined`
  // means we haven't tried yet (or the SDK isn't ready), `null` means
  // Google had no result, and an object is the live point. Stored
  // coords from the parent prime this synchronously below so a
  // re-mount with persisted lat/lng renders the pin on first paint.
  const [point, setPoint] = useState<
    { lat: number; lng: number } | null | undefined
  >(() => {
    if (typeof lat === "number" && typeof lng === "number") {
      return { lat, lng };
    }
    return undefined;
  });

  // Surface a one-time confirmation when a rotated key takes effect.
  // Same contract as the portfolio map — silent on the very first
  // load, fires exactly once per successful rotation.
  const { toast } = useToast();

  // Decide whether to attempt the SDK load: we need a key, and the
  // shared key-error store must not already be flagged (otherwise we'd
  // load the script just to have `gm_authFailure` reject it again).
  const canMountMap = resolvedKey !== "" && sharedKeyError.code === null;

  // Load the SDK + create the Map once we have a key + Map ID. The
  // effect re-runs on key/mapId rotation; the cleanup tears the map +
  // marker down so the next run rebuilds against the rotated SDK
  // (loadMapsApi deletes `window.google` when it detects a rotation).
  useEffect(() => {
    if (!canMountMap) return;
    let cancelled = false;
    setStatus("loading");
    setLoaderError(null);
    loadMapsApi(resolvedKey)
      .then(({ rotated }) => {
        if (cancelled) return;
        if (!mapEl.current) return;
        const maps = window.google!.maps!;
        mapRef.current = new maps.Map(mapEl.current, {
          // Center on the resolved point if we already have it
          // (stored coords or warm cache); otherwise fall back to a
          // continental US view so the first paint isn't empty
          // ocean. `setCenter` below repositions once the geocoder
          // resolves.
          center:
            point && point.lat !== undefined
              ? { lat: point.lat, lng: point.lng }
              : { lat: 39.8283, lng: -98.5795 },
          zoom: point ? 15 : 4,
          // AdvancedMarkerElement requires a valid Map ID — without
          // one Google falls back to a raster map and silently
          // refuses to attach the marker, which is exactly the
          // failure mode we're migrating away from. Resolves to the
          // operator's branded ID from `/api/config` in production
          // (set via `GOOGLE_MAPS_MAP_ID`) and to `"DEMO_MAP_ID"`
          // on a fresh workspace where no Map ID has been
          // configured yet.
          mapId: resolvedMapId,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        setStatus("ready");
        if (rotated) {
          toast({
            title: "Google Maps key updated",
            description: "Map reloaded against the rotated key.",
          });
        }
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setLoaderError(err.message);
        setStatus("error");
      });
    return () => {
      cancelled = true;
      // Tear down marker + map before the next run rebuilds against
      // the (possibly rotated) SDK so we don't leak the prior
      // AdvancedMarkerElement or its DOM listeners. Mirrors the
      // teardown in portfolio-map.tsx.
      if (markerRef.current) {
        markerRef.current.map = null;
        markerRef.current = null;
      }
      mapRef.current = null;
    };
    // We intentionally do NOT depend on `point` here — re-creating
    // the Map every time the geocode resolves would wipe pan/zoom
    // and create a flicker. The marker-sync effect below handles
    // re-centering when coords land. `loadAttempt` is included so
    // the in-card Re-check button can force a re-run after a local
    // SDK load failure even when the key + Map ID didn't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canMountMap, resolvedKey, resolvedMapId, loadAttempt]);

  // Geocode this property's address once the SDK is ready. Stored
  // coords from the parent skip the network entirely. The shared
  // module-level cache covers the case where another surface (the
  // portfolio map, or a previous mount) already resolved this same
  // address in the session.
  useEffect(() => {
    if (status !== "ready") return;
    if (!window.google?.maps) return;
    // Stored coords win — instantly resolves point to the supplied
    // value (also covers the address-change case where a parent edit
    // swaps in new stored coords without a remount). The functional
    // setState bails out when the value is unchanged so this is a
    // no-op in the common steady-state, but flips the marker to the
    // new coords if the operator's edit was for a different lat/lng.
    // We also warm the shared cache so the portfolio map or another
    // Location card at the same address skips the round-trip.
    if (typeof lat === "number" && typeof lng === "number") {
      primeGeocodeCache(full, { lat, lng });
      setPoint((prev) => {
        if (prev && prev.lat === lat && prev.lng === lng) return prev;
        return { lat, lng };
      });
      return;
    }
    const cached = getCachedGeocode(full);
    if (cached !== undefined) {
      setPoint(cached);
      return;
    }
    // Clear any stale pin (e.g. the previous address's coords carried
    // over when an operator edited the address fields while the card
    // was mounted) before the live geocoder resolves. Without this,
    // the marker sits at the wrong location until the new geocode
    // returns. `setPoint(undefined)` is a no-op when point was
    // already undefined (Object.is bailout), so the very first run
    // doesn't churn.
    setPoint(undefined);
    const geocoder = new window.google.maps.Geocoder();
    resolveGeocode(geocoder, full).then((resolved) => {
      if (!mountedRef.current) return;
      setPoint(resolved);
      if (!resolved) return;
      // One-shot per (address) — `reportedRef` keeps `onGeocoded` from
      // firing for the same address on every re-render that re-runs
      // this effect (parent state updates, prop identity churn, …).
      // Address changes naturally re-arm the report by failing the
      // equality check below.
      if (reportedRef.current === full) return;
      reportedRef.current = full;
      onGeocodedRef.current?.(resolved);
    });
  }, [status, full, lat, lng]);

  // Whether the live geocoder definitively returned no result for the
  // current address AND the parent didn't pre-supply stored coords.
  // `point === null` is only ever set after a live geocode attempt
  // (the stored-coords fast-path above writes `{lat,lng}` instead, and
  // the in-flight state is `undefined`), so this captures exactly the
  // "we asked Google, Google had nothing, and we have no fallback"
  // case the operator needs an explanation for. The `hasStoredCoords`
  // guard is belt-and-suspenders: the geocoder isn't even invoked
  // when stored coords exist, but a hypothetical regression that
  // somehow flipped `point` to null while stored coords were present
  // would still hide the banner — the address can't be a "couldn't
  // pinpoint" failure if we have a known-good lat/lng for it.
  const hasStoredCoords =
    typeof lat === "number" && typeof lng === "number";
  const showCouldNotPinpoint = !hasStoredCoords && point === null;

  // Sync the marker + viewport whenever resolved coords change. We
  // drop the previous marker and recreate — there's only ever at most
  // one pin on this card, so the simpler "blow away & rebuild" path
  // is fine and mirrors the portfolio map's marker-sync structure.
  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return;
    if (!window.google?.maps) return;
    if (markerRef.current) {
      markerRef.current.map = null;
      markerRef.current = null;
    }
    if (!point) return;
    const maps = window.google.maps;
    markerRef.current = new maps.marker.AdvancedMarkerElement({
      position: { lat: point.lat, lng: point.lng },
      map: mapRef.current,
      title: full,
      // Decorative: this card has no per-pin click handler — the
      // overlay anchor below handles "open in Google Maps". Setting
      // `gmpClickable: false` (the default) keeps the pin from
      // intercepting pointer events that the overlay should handle.
    });
    mapRef.current.setCenter({ lat: point.lat, lng: point.lng });
    mapRef.current.setZoom(15);
  }, [status, point, full]);

  // ---------------------------------------------------------------
  // Branch order matters: the key-rejected branch is checked BEFORE
  // `isConfigLoading` so a code reported anywhere on the page (e.g.
  // the portfolio map's `gm_authFailure`, or a sibling Maps surface)
  // flips this card out of the spinner *immediately* — without this
  // ordering an operator could be staring at our placeholder
  // indefinitely while a toast on the same page already said the
  // key was rejected, with no in-page explanation (Task #178).
  // ---------------------------------------------------------------
  // The dedicated error panel must own the card whenever EITHER
  // signal trips:
  //   * `effectiveErrorCode` — a key-rejection code observed via the
  //     shared store (this card's gm_authFailure path, the portfolio
  //     map, a sibling embed iframe's postMessage, …). Drives the
  //     Console deep-link below.
  //   * `loaderError` — a local SDK script-load failure (network
  //     blocked, CSP rejected the script tag, …). Without this
  //     gating, an SDK load that throws would leave the card stuck
  //     in the canvas branch with the inner "Loading map…" overlay
  //     forever, and the operator would have no in-card explanation
  //     of why no map is appearing.
  // The Re-check button below clears both signals + bumps
  // `loadAttempt` so a recovered SDK load can re-attempt without a
  // tab refresh.
  const effectiveErrorCode = sharedKeyError.code;
  const isMapError = effectiveErrorCode !== null || loaderError !== null;
  const errorMessage = sharedKeyError.message ?? loaderError ?? "";

  return (
    <Card data-testid="card-property-location">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="h-4 w-4" />
          Location
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/*
          Sustained-failure warning. Lives at the top of CardContent
          (rather than above the Card) so it stays visually inside
          the Location card the operator is already looking at —
          there's no other "Location"-shaped affordance on the
          property-detail page for the warning to dock against. The
          component is a no-op while `isRefreshStale` is false, so
          rendering it unconditionally costs nothing (Task #175).
        */}
        <RuntimeConfigStaleWarning isStale={isRefreshStale} />
        {/*
          Two-column layout at `lg`: the map (or any of the
          fallback / error / loading panels) sits in the left
          column, and the address + Directions link sit in the
          right column, vertically centered next to it. Below `lg`
          the layout collapses back to the original stacked look —
          panel on top, address + Directions row underneath — so
          mobile and tablet aren't affected. The whole Location
          card used to stretch the full page width while the map
          itself was capped at `max-w-md`, leaving a large blank
          area to the right of the map; this wrapper lets the
          address + Directions block fill that space so the card
          feels intentional instead of half-finished (Task #209).
        */}
        <div className="space-y-2 lg:space-y-0 lg:flex lg:items-center lg:gap-6">
          {/*
            Left column is sized to the map (`max-w-md`) rather than
            half the card, so on very wide desktops the address
            column sits flush to the right of the map instead of
            leaving a gap inside the left half. Fallback / config-
            error / loading panels live in the same slot, so they
            adopt the same width — a deliberate trade-off so the
            address + Directions block can absorb the rest of the
            card width and the panels don't sprawl into an empty
            half-card on their own.
          */}
          <div className="lg:flex-none lg:w-full lg:max-w-md space-y-2">
        {isMapError ? (
          // Single canonical home for the failure state — every
          // render path that detects a map error (the JS SDK's
          // `gm_authFailure` callback, an embed-iframe code reported
          // elsewhere on the page, the local SDK script-load
          // failure) lands here. Any future tweaks to the error
          // panel belong in this branch.
          //
          // Checked BEFORE `isConfigLoading` so a code reported
          // anywhere on the page (e.g. the portfolio map's
          // `gm_authFailure`, or a sibling embed iframe's
          // postMessage) flips this card out of the "Loading map…"
          // placeholder *immediately* — even if our own
          // `/api/config` request is still in flight. Without this
          // ordering an operator could be staring at our placeholder
          // indefinitely while a toast on the same page already said
          // the key was rejected, with no in-page explanation
          // (Task #178). Task #197 carved this single canonical
          // branch out of the previous iframe implementation; the
          // contract carried forward into the JS SDK rewrite.
          <div
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-2"
            data-testid="property-location-map-error"
            data-error-code={effectiveErrorCode ?? ""}
          >
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span data-testid="property-location-map-error-text">
                {errorMessage}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <a
                href={searchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                data-testid="property-location-map-error-link"
              >
                <ExternalLink className="h-4 w-4" />
                Open in Google Maps
              </a>
              {/*
                Per-code Google Cloud Console deep-link the toast and
                portfolio map's key-error panel also surface (Task
                #173). Operators who dismissed the toast — or arrived
                at this card after the toast already timed out —
                still get the single-click jump to the right Console
                page (credentials / quotas / library / …) for whatever
                code Google reported. Falls back to the credentials
                list when the code is unrecognized so the link is
                never dead.
              */}
              {effectiveErrorCode !== null && (
                <a
                  href={getMapsKeyConsoleUrl(effectiveErrorCode)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  data-testid="property-location-map-error-console-link"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open in Google Cloud Console
                </a>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleRecheck}
              disabled={isRechecking}
              data-testid="property-location-map-error-recheck"
            >
              <RefreshCw
                className={
                  isRechecking ? "h-4 w-4 animate-spin" : "h-4 w-4"
                }
              />
              {isRechecking ? "Re-checking…" : "Re-check key"}
            </Button>
          </div>
        ) : isConfigLoading ? (
          <div
            className="rounded-lg border bg-muted/30 aspect-[5/2] w-full max-w-md flex items-center justify-center text-xs text-muted-foreground"
            data-testid="property-location-map-loading"
            aria-busy="true"
          >
            <span className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Loading map…
            </span>
          </div>
        ) : isConfigError ? (
          <div
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3"
            data-testid="property-location-map-config-error"
          >
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span data-testid="property-location-map-config-error-text">
                Couldn't load the map config from{" "}
                <code className="font-mono text-[11px] bg-background/60 px-1 rounded">
                  /api/config
                </code>
                . Check the api-server logs and try again.
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void configQuery.refetch();
              }}
              data-testid="property-location-map-config-retry"
            >
              Retry
            </Button>
          </div>
        ) : resolvedKey ? (
          <div className="space-y-2">
            <div className="relative rounded-lg overflow-hidden border bg-muted w-full max-w-md">
              <div
                ref={mapEl}
                className="aspect-[5/2] w-full"
                data-testid="property-location-map-canvas"
                data-map-id={resolvedMapId}
              />
              {/*
                "Open in Google Maps" overlay — sits on top of the map
                canvas as a small chip in the upper-right corner. The
                JS SDK owns pointer events on the canvas itself, so
                wrapping the entire map in an anchor (the way the
                iframe version did) wouldn't reliably surface as a
                click. A dedicated overlay link is unambiguous, keeps
                pan/zoom interactions inside the map working, and
                gives the operator a one-click jump to Google Maps
                for the property's address.
              */}
              <a
                href={searchUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${full} in Google Maps`}
                className="absolute top-2 right-2 rounded-md bg-background/90 backdrop-blur px-2 py-1 text-xs font-medium shadow-sm border flex items-center gap-1 hover:bg-background"
                data-testid="property-location-map-link"
              >
                <ExternalLink className="h-3 w-3" />
                Open in Google Maps
              </a>
              {status !== "ready" && (
                <div
                  className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground pointer-events-none"
                  data-testid="property-location-map-canvas-loading"
                >
                  <MapPin className="h-4 w-4 mr-2" />
                  Loading map…
                </div>
              )}
              {/*
                Geocoder said "no result" for this address and the
                parent didn't pre-supply stored coords, so the canvas
                above has no pin to show. Without an explanation the
                operator would be staring at a blank continental-US
                view with no hint about why the pin is missing —
                surface the same kind of in-card warning the portfolio
                map gives when geocoding repeatedly fails, but pointed
                at this property's specific address (Task #198).
                Positioned at the bottom so it doesn't cover the
                "Open in Google Maps" overlay link in the top-right
                corner, which remains the operator's escape hatch.
              */}
              {showCouldNotPinpoint && (
                <div
                  className="absolute left-2 right-2 bottom-2 rounded-md border border-amber-500/40 bg-amber-50/95 dark:bg-amber-950/90 dark:border-amber-500/30 px-2 py-1.5 text-xs text-amber-900 dark:text-amber-100 flex items-start gap-1.5 shadow-sm"
                  data-testid="property-location-map-stale-warning"
                  role="status"
                >
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    Couldn't pinpoint this address — verify the
                    street/city/zip.
                  </span>
                </div>
              )}
            </div>
            {/*
              Task #196 removed the always-visible "Seeing a Google
              error?" companion line that used to sit next to a
              healthy map — it confused operators by shouting that
              the key was rejected next to a perfectly rendered
              embed. That contract carries forward into the JS SDK
              rewrite: the success branch above stays clean and the
              dedicated error panel (gated by `isMapError`) owns
              every failure surface — `gm_authFailure` from
              `loadMapsApi`, codes reported by sibling surfaces via
              the shared key-error store, and local SDK script-load
              failures via `loaderError`. (Task #197.)
            */}

          </div>
        ) : (
          <div
            className="rounded-lg border border-dashed bg-muted/30 p-4 space-y-2"
            data-testid="property-location-fallback"
          >
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                A Google Maps API key isn't configured on the server yet, so
                the embedded preview is hidden. You can still open this
                address in Google Maps below.
              </span>
            </div>
            <a
              href={searchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              data-testid="property-location-fallback-link"
            >
              <ExternalLink className="h-4 w-4" />
              Open in Google Maps
            </a>
          </div>
        )}

          </div>
          {/*
            Right column at `lg`: address + Directions link,
            vertically centered next to the map by the parent
            wrapper's `lg:items-center`. Below `lg` this collapses
            back into the original "row at sm+, stacked at xs"
            layout so mobile and tablet aren't affected. At `lg`
            we switch to a vertical stack with the address on top
            and the Directions link below, left-aligned with the
            address — that fills the previously-blank right side
            of the card without making the address jump to the
            far edge (Task #209).
          */}
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between lg:flex-col lg:items-start lg:justify-center gap-3 lg:flex-1 lg:min-w-0">
            <div className="text-sm" data-testid="property-location-address">
              {street && <p className="font-medium">{street}</p>}
              {cityStateZip && (
                <p className="text-muted-foreground">{cityStateZip}</p>
              )}
            </div>
            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              data-testid="property-location-directions-link"
            >
              <Navigation className="h-4 w-4" />
              Directions
            </a>
            {/*
              Trust badge + per-pin actions. Surfaces whether the
              persisted coordinates are operator-confirmed or were
              auto-resolved by the server-side geocoder. Auto-resolved
              pins can drift over time as Google updates its index, so
              we offer two affordances right next to the badge:
                * "Mark as verified" — locks in the current lat/lng so
                  the badge flips to "Verified" and the portfolio map
                  bubble stops surfacing the "Approximate location"
                  warning.
                * "Re-geocode" — re-runs the server-side geocode for
                  the current address so an operator can refresh a
                  stale pin without editing the address fields. Resets
                  the badge back to "Approximate" because the freshly-
                  resolved coords haven't been verified yet.
              Hidden when the address is blank — the early-return
              empty-state branch above owns that case.
            */}
            {(onMarkVerified || onRegeocode) && (
              <div
                className="flex flex-wrap items-center gap-2 text-xs"
                data-testid="property-location-trust-row"
              >
                {coordsVerified ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-500/30"
                    data-testid="property-location-trust-badge"
                    data-trust="verified"
                    title="An operator confirmed this pin pinpoints the property."
                  >
                    <ShieldCheck className="h-3 w-3" />
                    Verified location
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-50 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-500/30"
                    data-testid="property-location-trust-badge"
                    data-trust="approximate"
                    title="Pin auto-located from the address. Verify it or re-run the geocoder if it looks off."
                  >
                    <AlertCircle className="h-3 w-3" />
                    Approximate location
                  </span>
                )}
                {!coordsVerified && onMarkVerified && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs"
                    onClick={onMarkVerified}
                    data-testid="property-location-mark-verified"
                  >
                    Mark as verified
                  </Button>
                )}
                {onRegeocode && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={onRegeocode}
                    data-testid="property-location-regeocode"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Re-geocode
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
