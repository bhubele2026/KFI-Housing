import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, MapPin } from "lucide-react";

// Minimal hand-rolled shape for the parts of the Google Maps JS SDK we
// actually call into — installing @types/google.maps just for two
// classes is overkill, and the surface area below is small enough that
// keeping it inline is clearer than adding a dev dep.
interface MapsLatLng {
  lat: () => number;
  lng: () => number;
}
interface MapsLatLngBounds {
  extend: (point: { lat: number; lng: number }) => void;
  getCenter: () => MapsLatLng;
}
interface MapsMap {
  setCenter: (p: { lat: number; lng: number } | MapsLatLng) => void;
  setZoom: (z: number) => void;
  fitBounds: (b: MapsLatLngBounds, padding?: number) => void;
}
interface MapsMarker {
  setMap: (m: MapsMap | null) => void;
  addListener: (event: string, cb: () => void) => void;
}
interface MapsGeocoder {
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
interface MapsApi {
  Map: new (
    el: HTMLElement,
    opts: Record<string, unknown>,
  ) => MapsMap;
  Marker: new (opts: {
    position: { lat: number; lng: number };
    map: MapsMap;
    title?: string;
  }) => MapsMarker;
  Geocoder: new () => MapsGeocoder;
  LatLngBounds: new () => MapsLatLngBounds;
}

declare global {
  interface Window {
    google?: { maps?: MapsApi };
    __housingopsMapsLoader?: Promise<void>;
  }
}

export interface MappableProperty {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  customerName?: string;
}

interface PortfolioMapProps {
  /**
   * The properties to plot. Already-filtered upstream — the map honors
   * whatever customer/status/search filters the toolbar applied.
   */
  properties: MappableProperty[];
  /** Called with the property's id when the user clicks a pin. */
  onPinClick: (id: string) => void;
  /**
   * Called with the ids of any properties whose address Google
   * couldn't geocode. The parent uses this to surface those rows in
   * the missing-address side panel so a typo'd address doesn't quietly
   * disappear from the operator's view.
   */
  onUnmappableChange?: (ids: string[]) => void;
  /**
   * Inject the Maps API key for tests. Defaults to the runtime
   * VITE_GOOGLE_MAPS_API_KEY so production code paths use the real key
   * without callers having to thread it through every render.
   */
  apiKey?: string;
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
 * Loads the Google Maps JS SDK exactly once per page. Subsequent calls
 * return the in-flight or already-resolved promise so toggling the map
 * view repeatedly never injects duplicate <script> tags or re-downloads
 * the SDK.
 */
function loadMapsApi(apiKey: string): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps requires a browser environment"));
  }
  if (window.google?.maps?.Geocoder) return Promise.resolve();
  if (window.__housingopsMapsLoader) return window.__housingopsMapsLoader;

  const promise = new Promise<void>((resolve, reject) => {
    const onReady = () => {
      if (window.google?.maps?.Geocoder) resolve();
      else reject(new Error("Google Maps loaded but Geocoder is unavailable"));
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
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&libraries=geocoding&loading=async`;
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
  return promise;
}

// Module-level geocode cache — keyed by the formatted address string.
// Survives re-renders, view-mode toggles, and filter changes so the
// operator doesn't burn fresh quota every time they bounce between the
// table and map. `null` means "we tried and Google had no result".
const geocodeCache = new Map<string, { lat: number; lng: number } | null>();

type LoaderStatus = "idle" | "loading" | "ready" | "error";

export function PortfolioMap({
  properties,
  onPinClick,
  onUnmappableChange,
  apiKey,
}: PortfolioMapProps) {
  const resolvedKey =
    apiKey ?? (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? "";
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapsMap | null>(null);
  const markersRef = useRef<MapsMarker[]>([]);
  const [status, setStatus] = useState<LoaderStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
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
      .then(() => {
        if (cancelled) return;
        if (!mapEl.current) return;
        const maps = window.google!.maps!;
        mapRef.current = new maps.Map(mapEl.current, {
          // Default to a continental US view so the first paint isn't
          // empty ocean while geocoding settles. fitBounds below
          // overrides this once we have at least one pin.
          center: { lat: 39.8283, lng: -98.5795 },
          zoom: 4,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        setStatus("ready");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setErrorMsg(err.message);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedKey]);

  // Geocode any addresses we don't already have cached. Cached hits
  // become available synchronously so the map renders pins on the first
  // paint instead of waiting for round-trips. A property's id maps to
  // `null` when Google has no result — those bubble up to the side
  // panel so they aren't silently dropped.
  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;
    const maps = window.google!.maps!;
    const geocoder = new maps.Geocoder();

    const next = new Map<string, { lat: number; lng: number } | null>();
    const toResolve: { id: string; addr: string }[] = [];
    for (const p of properties) {
      const addr = fullAddress(p);
      if (!addr) {
        next.set(p.id, null);
        continue;
      }
      if (geocodeCache.has(addr)) {
        next.set(p.id, geocodeCache.get(addr) ?? null);
      } else {
        toResolve.push({ id: p.id, addr });
      }
    }
    setCoords(next);

    for (const { id, addr } of toResolve) {
      geocoder.geocode({ address: addr }, (results, geocodeStatus) => {
        if (cancelled) return;
        if (
          geocodeStatus === "OK" &&
          results &&
          results[0]?.geometry?.location
        ) {
          const loc = results[0].geometry.location;
          const point = { lat: loc.lat(), lng: loc.lng() };
          geocodeCache.set(addr, point);
          setCoords((prev) => {
            const m = new Map(prev);
            m.set(id, point);
            return m;
          });
        } else {
          // Cache the negative result too so we don't keep hammering
          // Google for an address that will never resolve.
          geocodeCache.set(addr, null);
          setCoords((prev) => {
            const m = new Map(prev);
            m.set(id, null);
            return m;
          });
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [status, properties]);

  // Sync markers + viewport whenever resolved coords change. We drop
  // every marker and rebuild — properties is small (operators look at
  // ~tens, not thousands), so the simpler "blow away & rebuild" path
  // beats tracking per-id marker diffs.
  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return;
    const maps = window.google!.maps!;

    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = [];

    const bounds = new maps.LatLngBounds();
    let added = 0;
    for (const p of properties) {
      const c = coords.get(p.id);
      if (!c) continue;
      const marker = new maps.Marker({
        position: c,
        map: mapRef.current,
        title: p.name,
      });
      marker.addListener("click", () => onPinClick(p.id));
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
  }, [status, coords, properties, onPinClick]);

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

  if (!resolvedKey) {
    return (
      <Card data-testid="portfolio-map-fallback">
        <CardContent className="p-6">
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Set{" "}
              <code className="font-mono text-[11px] bg-muted px-1 rounded">
                VITE_GOOGLE_MAPS_API_KEY
              </code>{" "}
              to render every property as pins on a single portfolio
              map.
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
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
  );
}
