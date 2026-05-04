import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PropertyLocationMap } from "./property-location-map";
import { __resetGoogleMapsSdkForTest } from "@/lib/google-maps-sdk";
import {
  reportGoogleMapsKeyError,
  __resetGoogleMapsKeyErrorForTest,
} from "@/hooks/use-google-maps-key-error";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Pin down the render branches of the property-detail Location card,
// migrated in Task #195 from the Maps Embed v1 iframe onto the JS Maps
// SDK + AdvancedMarkerElement so it can use the operator's branded
// `googleMapsMapId` from `/api/config`. The core branches (empty,
// loading, fallback, config-error, key-rejected, recheck) are still
// here from the iframe era; what's new is the canvas branch — a real
// `google.maps.Map` is constructed against a fake SDK installed below,
// and the tests assert on map options (`mapId`), the marker library,
// and the geocoded pin position rather than on iframe `src`.

// Capture every `toast(...)` invocation so the rotation-confirmation
// path can be asserted on without standing up the real <Toaster /> tree.
type ToastCall = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: string;
};
const toastCalls: ToastCall[] = [];
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toasts: [],
    toast: (arg: ToastCall) => {
      toastCalls.push(arg);
      return { id: "x", dismiss: () => {}, update: () => {} };
    },
    dismiss: () => {},
  }),
}));

// ---------------------------------------------------------------------------
// Hand-rolled Google Maps SDK shim — mirrors the one in portfolio-map.test
// ---------------------------------------------------------------------------
interface FakeMarker {
  position: { lat: number; lng: number };
  title?: string;
  gmpClickable?: boolean;
  map: unknown | null;
}

interface FakeMapState {
  options: Record<string, unknown>;
  centerSets: Array<{ lat: number; lng: number }>;
  zoomSets: number[];
  listeners: Map<string, Array<() => void>>;
}

interface PendingGeocode {
  addr: string;
  cb: (
    results:
      | Array<{
          geometry: { location: { lat: () => number; lng: () => number } };
        }>
      | null,
    status: string,
  ) => void;
}

const mapsState: {
  map: FakeMapState | null;
  markers: FakeMarker[];
  pendingGeocodes: PendingGeocode[];
} = {
  map: null,
  markers: [],
  pendingGeocodes: [],
};

function installFakeGoogleMaps() {
  class FakeMap {
    options: Record<string, unknown>;
    centerSets: Array<{ lat: number; lng: number }> = [];
    zoomSets: number[] = [];
    listeners = new Map<string, Array<() => void>>();
    constructor(_el: HTMLElement, options: Record<string, unknown>) {
      this.options = options;
      mapsState.map = this as unknown as FakeMapState;
    }
    setCenter(p: { lat: number; lng: number }) {
      this.centerSets.push(p);
    }
    setZoom(z: number) {
      this.zoomSets.push(z);
    }
    fitBounds() {}
    addListener(event: string, cb: () => void) {
      const cur = this.listeners.get(event) ?? [];
      cur.push(cb);
      this.listeners.set(event, cur);
    }
  }
  class FakeAdvancedMarkerElement {
    position: { lat: number; lng: number };
    title?: string;
    gmpClickable?: boolean;
    private _map: unknown | null = null;
    constructor(opts: {
      position: { lat: number; lng: number };
      map: unknown;
      title?: string;
      gmpClickable?: boolean;
    }) {
      this.position = opts.position;
      this.title = opts.title;
      this.gmpClickable = opts.gmpClickable;
      this._map = opts.map ?? null;
      mapsState.markers.push(this as unknown as FakeMarker);
    }
    get map() {
      return this._map;
    }
    set map(m: unknown | null) {
      this._map = m;
      if (m === null) {
        const idx = mapsState.markers.indexOf(this as unknown as FakeMarker);
        if (idx !== -1) mapsState.markers.splice(idx, 1);
      }
    }
    addEventListener() {}
  }
  class FakeInfoWindow {
    setContent() {}
    open() {}
    close() {}
    addListener() {}
  }
  class FakeGeocoder {
    geocode(req: { address: string }, cb: PendingGeocode["cb"]) {
      mapsState.pendingGeocodes.push({ addr: req.address, cb });
    }
  }
  class FakeBounds {
    extend() {}
    getCenter() {
      return { lat: () => 0, lng: () => 0 };
    }
  }

  const w = window as unknown as {
    google?: { maps?: unknown };
    __housingopsMapsLoader?: Promise<void>;
  };
  w.google = {
    maps: {
      Map: FakeMap,
      marker: { AdvancedMarkerElement: FakeAdvancedMarkerElement },
      Geocoder: FakeGeocoder,
      LatLngBounds: FakeBounds,
      InfoWindow: FakeInfoWindow,
    },
  };
  // Bypass the real script-tag loader by priming the in-flight loader
  // promise to a resolved one. `loadMapsApi` short-circuits on the
  // ready-class check before this anyway, but priming both keeps the
  // tests robust to either internal path.
  w.__housingopsMapsLoader = Promise.resolve();
}

function uninstallFakeGoogleMaps() {
  const w = window as unknown as {
    google?: unknown;
    __housingopsMapsLoader?: unknown;
  };
  delete w.google;
  delete w.__housingopsMapsLoader;
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 },
    },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return { Wrapper, client };
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await flush();
  }
}

async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 1000, intervalMs = 5 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, intervalMs));
    });
    try {
      if (predicate()) return;
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  throw new Error(
    `waitFor: predicate did not become true within ${timeoutMs}ms`,
  );
}

describe("PropertyLocationMap", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    toastCalls.length = 0;
    mapsState.map = null;
    mapsState.markers = [];
    mapsState.pendingGeocodes = [];
    installFakeGoogleMaps();
    __resetGoogleMapsSdkForTest();
    __resetGoogleMapsKeyErrorForTest();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      const r = root;
      await act(async () => {
        r.unmount();
      });
      root = null;
    }
    container.remove();
    uninstallFakeGoogleMaps();
    __resetGoogleMapsSdkForTest();
    __resetGoogleMapsKeyErrorForTest();
  });

  async function render(node: React.ReactElement) {
    const { Wrapper } = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(<Wrapper>{node}</Wrapper>);
    });
  }

  function get(testId: string): HTMLElement | null {
    return container.querySelector(
      `[data-testid="${testId}"]`,
    ) as HTMLElement | null;
  }

  // -------------------------------------------------------------------
  // Empty / fallback / loading branches (no SDK involvement)
  // -------------------------------------------------------------------

  it("renders the empty-state card when every address field is blank", async () => {
    await render(
      <PropertyLocationMap address="" city="" state="" zip="" apiKey="k" />,
    );
    const empty = get("property-location-empty");
    expect(empty).not.toBeNull();
    expect(empty!.textContent?.toLowerCase()).toContain("add an address");
    // None of the active branches render alongside the empty state.
    expect(get("property-location-map-canvas")).toBeNull();
    expect(get("property-location-fallback")).toBeNull();
    expect(get("property-location-map-loading")).toBeNull();
    expect(get("property-location-directions-link")).toBeNull();
    expect(get("property-location-address")).toBeNull();
  });

  it("treats whitespace-only address fields as empty", async () => {
    await render(
      <PropertyLocationMap
        address="   "
        city=" "
        state=""
        zip="  "
        apiKey="k"
      />,
    );
    expect(get("property-location-empty")).not.toBeNull();
    expect(get("property-location-map-canvas")).toBeNull();
  });

  it("falls back to a plain 'Open in Google Maps' link with a setup note when no key is configured", async () => {
    await render(
      <PropertyLocationMap
        address="200 Maple Dr"
        city="Dallas"
        state="TX"
        zip="75201"
        apiKey=""
      />,
    );
    expect(get("property-location-map-canvas")).toBeNull();
    expect(get("property-location-map-loading")).toBeNull();

    const fallback = get("property-location-fallback");
    expect(fallback).not.toBeNull();
    // Operator-facing copy must mention the key — but must not name
    // the retired build-time env var.
    expect(fallback!.textContent?.toLowerCase()).toContain(
      "google maps api key",
    );
    expect(fallback!.textContent).not.toContain("VITE_GOOGLE_MAPS_API_KEY");

    const link = get(
      "property-location-fallback-link",
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    const expectedQuery = encodeURIComponent("200 Maple Dr, Dallas, TX 75201");
    expect(link!.href).toBe(
      `https://www.google.com/maps/search/?api=1&query=${expectedQuery}`,
    );
    expect(link!.target).toBe("_blank");
  });

  it("treats an explicit `null` apiKey the same as an empty string", async () => {
    await render(
      <PropertyLocationMap
        address="300 Pine St"
        city="Houston"
        state="TX"
        zip="77001"
        apiKey={null}
      />,
    );
    expect(get("property-location-map-canvas")).toBeNull();
    expect(get("property-location-fallback")).not.toBeNull();
  });

  it("never leaks a literal 'undefined' into the rendered DOM when the key is missing", async () => {
    // Defends against any upstream regression that mis-stringifies a
    // missing key as the bare identifier `undefined` — even if it
    // happened, the component must pick the fallback branch and never
    // emit "key=undefined" anywhere on the page.
    await render(
      <PropertyLocationMap
        address="300 Pine St"
        city="Seattle"
        state="WA"
        zip="98101"
        apiKey=""
      />,
    );
    expect(get("property-location-map-canvas")).toBeNull();
    expect(container.innerHTML).not.toContain("key=undefined");
  });

  // -------------------------------------------------------------------
  // SDK / canvas / map ID branch
  // -------------------------------------------------------------------

  it("mounts the JS SDK Map with the explicit `mapId` prop and a single AdvancedMarkerElement at the geocoded point", async () => {
    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key"
        mapId="my-branded-map-id"
      />,
    );
    // Canvas mounts and exposes the resolved Map ID via a data-attr
    // so a regression that fed the wrong value can be spotted at the
    // DOM layer too.
    const canvas = get("property-location-map-canvas");
    expect(canvas).not.toBeNull();
    expect(canvas!.getAttribute("data-map-id")).toBe("my-branded-map-id");

    await settle();
    // Real `google.maps.Map` was constructed with the same Map ID.
    expect(mapsState.map).not.toBeNull();
    expect(mapsState.map?.options.mapId).toBe("my-branded-map-id");

    // The geocoder was invoked for the formatted address.
    expect(mapsState.pendingGeocodes).toHaveLength(1);
    expect(mapsState.pendingGeocodes[0].addr).toBe(
      "100 Oak Way, Austin, TX 78701",
    );

    // Resolve the geocode and assert a marker was attached at the
    // returned point.
    await act(async () => {
      mapsState.pendingGeocodes[0].cb(
        [
          {
            geometry: {
              location: { lat: () => 30.27, lng: () => -97.74 },
            },
          },
        ],
        "OK",
      );
    });
    await settle();

    expect(mapsState.markers).toHaveLength(1);
    expect(mapsState.markers[0].position).toEqual({
      lat: 30.27,
      lng: -97.74,
    });
    expect(mapsState.markers[0].title).toBe(
      "100 Oak Way, Austin, TX 78701",
    );
    // Map should also be re-centered + zoomed once the pin lands.
    expect(mapsState.map?.centerSets.at(-1)).toEqual({
      lat: 30.27,
      lng: -97.74,
    });
    expect(mapsState.map?.zoomSets.at(-1)).toBe(15);
  });

  it("falls back to Google's built-in DEMO_MAP_ID when no `mapId` prop is given and `/api/config` reports none either", async () => {
    // Without a Map ID, AdvancedMarkerElement silently refuses to
    // attach the pin — so the component MUST always pass *some*
    // value. Mirrors the same fallback in PortfolioMap.
    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key"
      />,
    );
    const canvas = get("property-location-map-canvas");
    expect(canvas).not.toBeNull();
    expect(canvas!.getAttribute("data-map-id")).toBe("DEMO_MAP_ID");

    await settle();
    expect(mapsState.map?.options.mapId).toBe("DEMO_MAP_ID");
  });

  it("uses the `googleMapsMapId` from /api/config when no `mapId` prop is given", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          googleMapsApiKey: "runtime-key",
          googleMapsMapId: "runtime-map-id",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await render(
        <PropertyLocationMap
          address="100 Oak Way"
          city="Austin"
          state="TX"
          zip="78701"
        />,
      );
      await waitFor(() => get("property-location-map-canvas") !== null);
      const canvas = get("property-location-map-canvas");
      expect(canvas!.getAttribute("data-map-id")).toBe("runtime-map-id");
      await settle();
      expect(mapsState.map?.options.mapId).toBe("runtime-map-id");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("renders the pin synchronously from stored `lat`/`lng` and never calls the geocoder", async () => {
    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key"
        mapId="m"
        lat={30.5}
        lng={-97.5}
      />,
    );
    await settle();
    // The fast-path skips the geocoder entirely.
    expect(mapsState.pendingGeocodes).toHaveLength(0);
    // And a marker mounts at exactly the supplied stored coords.
    expect(mapsState.markers).toHaveLength(1);
    expect(mapsState.markers[0].position).toEqual({
      lat: 30.5,
      lng: -97.5,
    });
  });

  it("invokes `onGeocoded` exactly once when the live geocoder resolves a fresh point", async () => {
    const onGeocoded = vi.fn();
    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key"
        mapId="m"
        onGeocoded={onGeocoded}
      />,
    );
    await settle();
    expect(mapsState.pendingGeocodes).toHaveLength(1);
    await act(async () => {
      mapsState.pendingGeocodes[0].cb(
        [
          {
            geometry: {
              location: { lat: () => 1.23, lng: () => 4.56 },
            },
          },
        ],
        "OK",
      );
    });
    await settle();
    expect(onGeocoded).toHaveBeenCalledTimes(1);
    expect(onGeocoded).toHaveBeenCalledWith({ lat: 1.23, lng: 4.56 });
  });

  it("shows the 'Couldn't pinpoint this address' banner when the live geocoder returns no result for an address with no stored coords", async () => {
    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key"
        mapId="m"
      />,
    );
    await settle();
    // No banner before the geocoder has answered — `point` is still
    // `undefined`, not `null`, so the address might still resolve.
    expect(get("property-location-map-stale-warning")).toBeNull();

    // Geocoder returns ZERO_RESULTS / null for this address.
    expect(mapsState.pendingGeocodes).toHaveLength(1);
    await act(async () => {
      mapsState.pendingGeocodes[0].cb(null, "ZERO_RESULTS");
    });
    await settle();

    // Banner now surfaces inside the canvas branch with the
    // operator-facing copy pointing at the address fields.
    const banner = get("property-location-map-stale-warning");
    expect(banner).not.toBeNull();
    const copy = (banner!.textContent ?? "").toLowerCase();
    expect(copy).toContain("couldn't pinpoint this address");
    expect(copy).toContain("street");
    expect(copy).toContain("city");
    expect(copy).toContain("zip");

    // Canvas itself is still rendered (not replaced) so the
    // "Open in Google Maps" overlay anchor remains the operator's
    // escape hatch.
    expect(get("property-location-map-canvas")).not.toBeNull();
    const escape = get(
      "property-location-map-link",
    ) as HTMLAnchorElement | null;
    expect(escape).not.toBeNull();
    const expectedQuery = encodeURIComponent("100 Oak Way, Austin, TX 78701");
    expect(escape!.href).toBe(
      `https://www.google.com/maps/search/?api=1&query=${expectedQuery}`,
    );

    // No marker was attached for the failed geocode.
    expect(mapsState.markers).toHaveLength(0);
  });

  it("does NOT show the 'Couldn't pinpoint this address' banner when stored coords were used (no live geocode happened)", async () => {
    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key"
        mapId="m"
        lat={30.5}
        lng={-97.5}
      />,
    );
    await settle();
    // Stored coords short-circuit the geocoder entirely, so the
    // banner branch must stay hidden — the address can't be a
    // "couldn't pinpoint" failure if we have a known-good lat/lng.
    expect(mapsState.pendingGeocodes).toHaveLength(0);
    expect(get("property-location-map-stale-warning")).toBeNull();
  });

  it("does NOT show the 'Couldn't pinpoint this address' banner when the live geocoder resolves a fresh point", async () => {
    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key"
        mapId="m"
      />,
    );
    await settle();
    expect(mapsState.pendingGeocodes).toHaveLength(1);
    await act(async () => {
      mapsState.pendingGeocodes[0].cb(
        [
          {
            geometry: {
              location: { lat: () => 30.27, lng: () => -97.74 },
            },
          },
        ],
        "OK",
      );
    });
    await settle();
    expect(mapsState.markers).toHaveLength(1);
    expect(get("property-location-map-stale-warning")).toBeNull();
  });

  it("does NOT call `onGeocoded` when stored coords were used (no live geocode happened)", async () => {
    const onGeocoded = vi.fn();
    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key"
        mapId="m"
        lat={1}
        lng={2}
        onGeocoded={onGeocoded}
      />,
    );
    await settle();
    expect(onGeocoded).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // Map overlay link, address footer, directions link
  // -------------------------------------------------------------------

  it("renders the 'Open in Google Maps' overlay anchor on top of the map canvas with the search URL", async () => {
    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key"
        mapId="m"
      />,
    );
    const link = get(
      "property-location-map-link",
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    const expectedQuery = encodeURIComponent("100 Oak Way, Austin, TX 78701");
    expect(link!.href).toBe(
      `https://www.google.com/maps/search/?api=1&query=${expectedQuery}`,
    );
    expect(link!.target).toBe("_blank");
    expect(link!.rel).toContain("noopener");
  });

  it("renders the address footer (street + city/state/zip) and a Directions link to the same address", async () => {
    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key"
        mapId="m"
      />,
    );
    const addr = get("property-location-address");
    expect(addr).not.toBeNull();
    expect(addr!.textContent).toContain("100 Oak Way");
    expect(addr!.textContent).toContain("Austin, TX 78701");

    const dir = get(
      "property-location-directions-link",
    ) as HTMLAnchorElement | null;
    expect(dir).not.toBeNull();
    const expectedQuery = encodeURIComponent("100 Oak Way, Austin, TX 78701");
    expect(dir!.href).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${expectedQuery}`,
    );
  });

  // -------------------------------------------------------------------
  // Key-rejected branch (driven by the shared key-error store)
  // -------------------------------------------------------------------

  it("flips into the key-rejected branch when a sibling Maps surface reports an error code via the shared store", async () => {
    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key"
        mapId="m"
      />,
    );
    expect(get("property-location-map-canvas")).not.toBeNull();
    expect(get("property-location-map-error")).toBeNull();

    await act(async () => {
      reportGoogleMapsKeyError("InvalidKeyMapError");
    });

    // Map canvas yields entirely to the dedicated error surface.
    expect(get("property-location-map-canvas")).toBeNull();
    const panel = get("property-location-map-error");
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute("data-error-code")).toBe(
      "InvalidKeyMapError",
    );
    // Tailored copy from the shared lookup — not a generic line.
    const text = (
      get("property-location-map-error-text")?.textContent ?? ""
    ).toLowerCase();
    expect(text).toContain("invalid");
  });

  it("renders a Console deep-link and the 'Open in Google Maps' escape hatch on the key-rejected panel", async () => {
    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key"
        mapId="m"
      />,
    );
    await act(async () => {
      reportGoogleMapsKeyError("RefererNotAllowedMapError");
    });

    const consoleLink = get(
      "property-location-map-error-console-link",
    ) as HTMLAnchorElement | null;
    expect(consoleLink).not.toBeNull();
    expect(consoleLink!.href).toContain("console.cloud.google.com");
    expect(consoleLink!.target).toBe("_blank");

    const escape = get(
      "property-location-map-error-link",
    ) as HTMLAnchorElement | null;
    expect(escape).not.toBeNull();
    const expectedQuery = encodeURIComponent("100 Oak Way, Austin, TX 78701");
    expect(escape!.href).toBe(
      `https://www.google.com/maps/search/?api=1&query=${expectedQuery}`,
    );
  });

  it("renders the in-card Re-check key button on the error panel", async () => {
    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key"
        mapId="m"
      />,
    );
    await act(async () => {
      reportGoogleMapsKeyError("RefererNotAllowedMapError");
    });
    const recheck = get(
      "property-location-map-error-recheck",
    ) as HTMLButtonElement | null;
    expect(recheck).not.toBeNull();
    expect((recheck!.textContent ?? "").toLowerCase()).toContain("re-check");
    expect(recheck!.tagName).toBe("BUTTON");
  });

  // -------------------------------------------------------------------
  // Runtime-config branches (loading / fallback / error / recovery)
  // -------------------------------------------------------------------

  it("shows the loading placeholder while /api/config is in flight, then mounts the canvas once the key arrives", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await render(
        <PropertyLocationMap
          address="100 Oak Way"
          city="Austin"
          state="TX"
          zip="78701"
        />,
      );
      expect(get("property-location-map-loading")).not.toBeNull();
      expect(get("property-location-map-canvas")).toBeNull();
      expect(get("property-location-fallback")).toBeNull();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const firstCall = fetchMock.mock.calls[0] as unknown as [
        RequestInfo | URL,
        ...unknown[],
      ];
      expect(String(firstCall[0])).toContain("/api/config");

      await act(async () => {
        resolveFetch!(
          new Response(
            JSON.stringify({ googleMapsApiKey: "rotated-key-xyz" }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      });
      await waitFor(() => get("property-location-map-canvas") !== null);
      expect(get("property-location-map-loading")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("renders the fallback (not the loading placeholder) when /api/config reports no key", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ googleMapsApiKey: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await render(
        <PropertyLocationMap
          address="200 Maple Dr"
          city="Dallas"
          state="TX"
          zip="75201"
        />,
      );
      await waitFor(() => get("property-location-fallback") !== null);
      expect(get("property-location-map-loading")).toBeNull();
      expect(get("property-location-map-canvas")).toBeNull();
      const fallback = get("property-location-fallback");
      expect(fallback!.textContent).not.toContain("VITE_GOOGLE_MAPS_API_KEY");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not call /api/config when the address is empty (empty state owns the render)", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      await render(
        <PropertyLocationMap address="" city="" state="" zip="" />,
      );
      // Give react-query a moment in case `enabled: false` were to regress.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(get("property-location-empty")).not.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("renders the explicit config-error branch (with Retry) when /api/config rejects", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await render(
        <PropertyLocationMap
          address="100 Oak Way"
          city="Austin"
          state="TX"
          zip="78701"
        />,
      );
      await waitFor(() => get("property-location-map-config-error") !== null);
      expect(get("property-location-map-loading")).toBeNull();
      expect(get("property-location-fallback")).toBeNull();
      expect(get("property-location-map-canvas")).toBeNull();

      const text = get("property-location-map-config-error-text");
      const copy = text!.textContent ?? "";
      expect(copy).toContain("/api/config");
      expect(copy.toLowerCase()).toContain("api-server");

      const retry = get("property-location-map-config-retry") as
        | HTMLButtonElement
        | null;
      expect(retry).not.toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("recovers into the canvas branch when the operator clicks Retry after a transient /api/config failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            googleMapsApiKey: "recovered-key",
            googleMapsMapId: "recovered-map-id",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await render(
        <PropertyLocationMap
          address="100 Oak Way"
          city="Austin"
          state="TX"
          zip="78701"
        />,
      );
      await waitFor(() => get("property-location-map-config-error") !== null);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const retry = get("property-location-map-config-retry") as
        | HTMLButtonElement
        | null;
      await act(async () => {
        retry!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await waitFor(() => get("property-location-map-canvas") !== null);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(get("property-location-map-config-error")).toBeNull();
      const canvas = get("property-location-map-canvas");
      expect(canvas!.getAttribute("data-map-id")).toBe("recovered-map-id");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("flips into the dedicated error panel (and out of the canvas branch) when the SDK script load itself fails", async () => {
    // Without the local-loader-error gating, an SDK load that
    // rejects (script blocked by CSP, network refused, …) would
    // leave the card stuck in the canvas branch with the inner
    // "Loading map…" overlay forever, and the operator would have
    // no in-card explanation. Simulate the failure by uninstalling
    // the fake SDK + replacing the loader promise with a rejected
    // one *before* the component runs its load effect.
    const w = window as unknown as {
      google?: unknown;
      __housingopsMapsLoader?: Promise<void>;
    };
    delete w.google;
    w.__housingopsMapsLoader = Promise.reject(
      new Error("Failed to load Google Maps script"),
    );
    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key"
        mapId="m"
      />,
    );
    await settle();
    expect(get("property-location-map-canvas")).toBeNull();
    const panel = get("property-location-map-error");
    expect(panel).not.toBeNull();
    // No code attribution — this is a local SDK failure, not a
    // key-rejection from Google. The Console deep-link must NOT
    // render in this case (we'd be guessing which Console page to
    // send the operator to).
    expect(panel!.getAttribute("data-error-code")).toBe("");
    expect(get("property-location-map-error-console-link")).toBeNull();
    // The Re-check button still appears so the operator can recover
    // from a transient script-load failure without a tab refresh.
    expect(get("property-location-map-error-recheck")).not.toBeNull();
    const errorText = get("property-location-map-error-text")?.textContent ?? "";
    expect(errorText).toContain("Failed to load Google Maps script");
  });

  it("moves the pin when the address prop changes mid-mount and the new address resolves to different coords", async () => {
    // Defends against stale-pin carryover when the parent edits the
    // address fields while the card stays mounted (e.g. an inline
    // edit on the property-detail page). Without the in-effect reset
    // of `point`, the marker would sit at the previous address's
    // coordinates until the new geocode returned.
    function Wrapper() {
      const [addr, setAddr] = React.useState("100 Oak Way");
      return (
        <div>
          <button
            type="button"
            data-testid="change-address"
            onClick={() => setAddr("999 New St")}
          />
          <PropertyLocationMap
            address={addr}
            city="Austin"
            state="TX"
            zip="78701"
            apiKey="test-key"
            mapId="m"
          />
        </div>
      );
    }
    await render(<Wrapper />);
    await settle();

    // Resolve the first address.
    expect(mapsState.pendingGeocodes).toHaveLength(1);
    expect(mapsState.pendingGeocodes[0].addr).toBe(
      "100 Oak Way, Austin, TX 78701",
    );
    await act(async () => {
      mapsState.pendingGeocodes[0].cb(
        [
          {
            geometry: {
              location: { lat: () => 1, lng: () => 2 },
            },
          },
        ],
        "OK",
      );
    });
    await settle();
    expect(mapsState.markers).toHaveLength(1);
    expect(mapsState.markers[0].position).toEqual({ lat: 1, lng: 2 });

    // Switch to a different address — the old pin must drop and a
    // fresh geocode must run for the new value.
    const btn = container.querySelector(
      '[data-testid="change-address"]',
    ) as HTMLButtonElement;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    // While the new geocode is pending, no stale marker remains.
    expect(mapsState.markers).toHaveLength(0);
    // And a fresh request was sent for the new address.
    const fresh = mapsState.pendingGeocodes.find(
      (g) => g.addr === "999 New St, Austin, TX 78701",
    );
    expect(fresh).not.toBeUndefined();
    await act(async () => {
      fresh!.cb(
        [
          {
            geometry: {
              location: { lat: () => 9, lng: () => 9 },
            },
          },
        ],
        "OK",
      );
    });
    await settle();
    expect(mapsState.markers).toHaveLength(1);
    expect(mapsState.markers[0].position).toEqual({ lat: 9, lng: 9 });
  });

  it("flips into the key-rejected branch even while /api/config is still in flight (key-error wins over the loading placeholder)", async () => {
    // Regression for Task #178 ported to the SDK era: branch order
    // must check `isMapError` BEFORE `isConfigLoading` so a sibling
    // Maps surface reporting a rejected key while this card's own
    // /api/config request is still in flight does not leave the
    // operator staring at our spinner next to a "key rejected" toast.
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await render(
        <PropertyLocationMap
          address="100 Oak Way"
          city="Austin"
          state="TX"
          zip="78701"
        />,
      );
      expect(get("property-location-map-loading")).not.toBeNull();

      await act(async () => {
        reportGoogleMapsKeyError("InvalidKeyMapError");
      });

      expect(get("property-location-map-loading")).toBeNull();
      const panel = get("property-location-map-error");
      expect(panel).not.toBeNull();
      expect(panel!.getAttribute("data-error-code")).toBe(
        "InvalidKeyMapError",
      );

      // Resolve the in-flight fetch so cleanup doesn't hang. The
      // key-error branch must still win after the config arrives — a
      // fixed key alone shouldn't paper over a sibling-reported
      // rejection.
      await act(async () => {
        resolveFetch!(
          new Response(
            JSON.stringify({ googleMapsApiKey: "live-key" }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      });
      await settle();
      expect(get("property-location-map-error")).not.toBeNull();
      expect(get("property-location-map-canvas")).toBeNull();
      expect(get("property-location-map-loading")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
