import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  PortfolioMap,
  __resetPortfolioMapCachesForTest,
  type MappableProperty,
} from "./portfolio-map";
import {
  reportGoogleMapsKeyError,
  __resetGoogleMapsKeyErrorForTest,
  MAPS_AUTH_FAILURE_CODE,
  MAPS_KEY_CONSOLE_URLS,
  getMapsKeyConsoleUrl,
} from "@/hooks/use-google-maps-key-error";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Capture every `toast(...)` invocation triggered by the component so
// the rotation-confirmation tests below can assert on the title /
// description without standing up the real <Toaster /> tree (which
// would also require driving its internal queue + open animations).
// All tests in this file go through the same module-level mock — the
// non-toast tests simply ignore `toastCalls`, which stays empty for
// them because the only place the component fires a toast is the
// rotation success path that requires a previously-loaded key.
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
// Hand-rolled Google Maps SDK shim
// ---------------------------------------------------------------------------
// The Google Maps SDK is faked at window.google so jsdom never has to
// load the real script. We bypass the script-tag loader by also priming
// `window.__housingopsMapsLoader` to a resolved promise.
//
// The fake records the listeners each marker registered so the tests
// can drive marker mouseover/click directly, and exposes the InfoWindow's
// most recent content node + open/close calls so the tests can read
// its rendered contents.
//
// Each test gets a fresh shim and we record every call that would have
// hit Google's geocoder so we can assert dedup.

// AdvancedMarkerElement is a custom HTMLElement; the fake mirrors that
// shape closely enough for our component to drive it. It exposes:
//   • a `map` property (assignment is how AdvancedMarkerElement is
//     added to / removed from a Map — there's no setMap any more), and
//   • `addEventListener`, recorded in `listeners` so tests can fire
//     `gmp-click` and `mouseover` directly without simulating DOM
//     dispatch.
interface FakeMarker {
  position: { lat: number; lng: number };
  title?: string;
  gmpClickable?: boolean;
  map: unknown | null;
  listeners: Map<string, Array<() => void>>;
  addEventListener: (event: string, cb: () => void) => void;
}

interface FakeInfoWindowState {
  content: HTMLElement | string | null;
  isOpen: boolean;
  openCount: number;
  closeCount: number;
  lastAnchor: FakeMarker | null;
}

interface FakeMap {
  listeners: Map<string, Array<() => void>>;
  options: Record<string, unknown>;
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
  map: FakeMap | null;
  markers: FakeMarker[];
  infoWindow: FakeInfoWindowState | null;
  pendingGeocodes: PendingGeocode[];
} = {
  map: null,
  markers: [],
  infoWindow: null,
  pendingGeocodes: [],
};

function fireMarkerEvent(marker: FakeMarker, event: string) {
  const cbs = marker.listeners.get(event) ?? [];
  for (const cb of cbs) cb();
}

function fireMapEvent(event: string) {
  const cbs = mapsState.map?.listeners.get(event) ?? [];
  for (const cb of cbs) cb();
}

function installFakeGoogleMaps() {
  // Default POINT for synchronous geocoding in info-bubble tests
  const POINT = { lat: 30.2672, lng: -97.7431 };

  class FakeMap {
    listeners = new Map<string, Array<() => void>>();
    options: Record<string, unknown>;
    constructor(_el: HTMLElement, options: Record<string, unknown>) {
      this.options = options;
      mapsState.map = this as unknown as FakeMap;
    }
    setCenter() {}
    setZoom() {}
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
    listeners = new Map<string, Array<() => void>>();
    // Backing field for the `map` property setter below. Mirrors
    // AdvancedMarkerElement, which removes itself from the parent map
    // when its `map` property is set to null.
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
    addEventListener(event: string, cb: () => void) {
      const cur = this.listeners.get(event) ?? [];
      cur.push(cb);
      this.listeners.set(event, cur);
    }
  }
  class FakeInfoWindow {
    constructor() {
      mapsState.infoWindow = {
        content: null,
        isOpen: false,
        openCount: 0,
        closeCount: 0,
        lastAnchor: null,
      };
    }
    setContent(content: HTMLElement | string) {
      if (mapsState.infoWindow) mapsState.infoWindow.content = content;
    }
    open(opts: { map: unknown; anchor: FakeMarker }) {
      if (mapsState.infoWindow) {
        mapsState.infoWindow.isOpen = true;
        mapsState.infoWindow.openCount += 1;
        mapsState.infoWindow.lastAnchor = opts.anchor;
      }
    }
    close() {
      if (mapsState.infoWindow) {
        mapsState.infoWindow.isOpen = false;
        mapsState.infoWindow.closeCount += 1;
      }
    }
    addListener() {}
  }
  class FakeGeocoder {
    geocode(req: { address: string }, cb: PendingGeocode["cb"]) {
      mapsState.pendingGeocodes.push({ addr: req.address, cb });
      // For tests that expect synchronous resolution, they can just use
      // mapsState.pendingGeocodes[0].cb(...) themselves, but for the
      // info-bubble tests we often want it to just work.
      // However, to keep it clean, we let the tests decide when to fire.
    }
  }
  class FakeBounds {
    extend() {}
    getCenter() {
      return { lat: () => POINT.lat, lng: () => POINT.lng };
    }
  }

  const w = window as unknown as {
    google?: { maps?: unknown };
    __housingopsMapsLoader?: Promise<void>;
  };
  w.google = {
    maps: {
      Map: FakeMap,
      // The marker library lives under `google.maps.marker` and is
      // pulled in by adding `libraries=marker` to the loader URL.
      // Mirrors the real SDK's namespace so the component can call
      // `new maps.marker.AdvancedMarkerElement({...})`.
      marker: { AdvancedMarkerElement: FakeAdvancedMarkerElement },
      Geocoder: FakeGeocoder,
      LatLngBounds: FakeBounds,
      InfoWindow: FakeInfoWindow,
    },
  };
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

function makeProperty(over: Partial<MappableProperty> = {}): MappableProperty {
  return {
    id: "p1",
    name: "Maple",
    address: "123 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    ...over,
  };
}

// Per-test QueryClient + provider so cached `/api/config` responses
// can't bleed across tests. Tests that pass `apiKey` explicitly skip
// the runtime fetch entirely (the hook is mounted with `enabled:
// false`), but the QueryClientProvider is still required because the
// component always calls `useGetRuntimeConfig`.
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
  return Wrapper;
}

async function flush() {
  // Drain the microtask queue + a macrotask so the loader promise's
  // `.then`, the resulting `setState("ready")`, and the next effect run
  // all get a chance to settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function settle() {
  // Several flush cycles — enough to walk through loader.then →
  // setStatus("ready") → render → geocode-effect → geocoder.geocode.
  for (let i = 0; i < 5; i++) {
    await flush();
  }
}

// React Query schedules its observer notifications via `setTimeout`
// and `queueMicrotask`, so a fixed-count microtask drain is not
// reliable for the runtime-config branch. We poll a predicate inside
// `act()` between checks. Mirrors the helper used by
// property-location-map.test.tsx.
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

describe("PortfolioMap — pin info bubble", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  const baseProperty: MappableProperty = {
    id: "p1",
    name: "Maple Apartments",
    address: "100 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    customerName: "Acme Co",
    totalBeds: 4,
    occupied: 3,
    vacant: 1,
  };

  beforeEach(() => {
    mapsState.map = null;
    mapsState.markers = [];
    mapsState.infoWindow = null;
    mapsState.pendingGeocodes = [];
    installFakeGoogleMaps();
    __resetPortfolioMapCachesForTest();
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
    __resetPortfolioMapCachesForTest();
  });

  async function renderMap(
    props: Partial<React.ComponentProps<typeof PortfolioMap>> = {},
  ) {
    const onPinClick = vi.fn();
    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap
            properties={[baseProperty]}
            onPinClick={onPinClick}
            apiKey="fake-key"
            {...props}
          />
        </Wrapper>,
      );
    });

    // Resolve geocodes for info-bubble tests immediately
    await settle();
    while (mapsState.pendingGeocodes.length > 0) {
      const p = mapsState.pendingGeocodes.shift()!;
      await act(async () => {
        p.cb(
          [
            {
              geometry: {
                location: { lat: () => 30.2672, lng: () => -97.7431 },
              },
            },
          ],
          "OK",
        );
      });
      await settle();
    }

    return { onPinClick };
  }

  it("does not navigate when the pin itself is clicked — opens the bubble instead", async () => {
    const { onPinClick } = await renderMap();
    expect(mapsState.markers).toHaveLength(1);
    const marker = mapsState.markers[0];

    await act(async () => {
      fireMarkerEvent(marker, "gmp-click");
    });

    expect(onPinClick).not.toHaveBeenCalled();
    expect(mapsState.infoWindow?.isOpen).toBe(true);
    expect(mapsState.infoWindow?.openCount).toBe(1);
  });

  it("opens the bubble on hover and renders name, customer, and bed counts", async () => {
    await renderMap();
    const marker = mapsState.markers[0];
    await act(async () => {
      fireMarkerEvent(marker, "mouseover");
    });

    expect(mapsState.infoWindow?.isOpen).toBe(true);
    const content = mapsState.infoWindow?.content as HTMLElement | null;
    expect(content).not.toBeNull();
    expect(content!.textContent).toContain("Maple Apartments");
    expect(content!.textContent).toContain("Acme Co");
    expect(
      content!.querySelector('[data-testid="portfolio-map-info-total-p1"]')
        ?.textContent,
    ).toContain("4");
    expect(
      content!.querySelector('[data-testid="portfolio-map-info-occupied-p1"]')
        ?.textContent,
    ).toContain("3");
    expect(
      content!.querySelector('[data-testid="portfolio-map-info-vacant-p1"]')
        ?.textContent,
    ).toContain("1");
  });

  it("fires onPinClick only when 'View details' is clicked inside the bubble", async () => {
    const { onPinClick } = await renderMap();
    const marker = mapsState.markers[0];
    await act(async () => {
      fireMarkerEvent(marker, "gmp-click");
    });

    const content = mapsState.infoWindow?.content as HTMLElement | null;
    const view = content?.querySelector(
      '[data-testid="portfolio-map-info-view-p1"]',
    ) as HTMLButtonElement | null;
    expect(view).not.toBeNull();
    await act(async () => {
      view!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPinClick).toHaveBeenCalledWith("p1");
    expect(onPinClick).toHaveBeenCalledTimes(1);
  });

  it("closes the bubble when the operator clicks elsewhere on the map background", async () => {
    await renderMap();
    const marker = mapsState.markers[0];
    await act(async () => {
      fireMarkerEvent(marker, "gmp-click");
    });
    expect(mapsState.infoWindow?.isOpen).toBe(true);

    await act(async () => {
      fireMapEvent("click");
    });
    expect(mapsState.infoWindow?.isOpen).toBe(false);
    expect(mapsState.infoWindow?.closeCount).toBeGreaterThanOrEqual(1);
  });

  it("closes the bubble when Escape is pressed", async () => {
    await renderMap();
    const marker = mapsState.markers[0];
    await act(async () => {
      fireMarkerEvent(marker, "gmp-click");
    });
    expect(mapsState.infoWindow?.isOpen).toBe(true);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(mapsState.infoWindow?.isOpen).toBe(false);
    expect(mapsState.infoWindow?.closeCount).toBeGreaterThanOrEqual(1);
  });

  it("re-uses a single InfoWindow when the operator switches between pins", async () => {
    const second: MappableProperty = {
      ...baseProperty,
      id: "p2",
      name: "Oak Apartments",
      address: "200 Side St",
    };
    await renderMap({ properties: [baseProperty, second] });
    expect(mapsState.markers).toHaveLength(2);

    const [m1, m2] = mapsState.markers;
    await act(async () => {
      fireMarkerEvent(m1, "gmp-click");
    });
    await act(async () => {
      fireMarkerEvent(m2, "gmp-click");
    });

    expect(mapsState.infoWindow?.openCount).toBe(2);
    expect(mapsState.infoWindow?.lastAnchor).toBe(m2);
    expect(
      (mapsState.infoWindow?.content as HTMLElement | null)?.textContent,
    ).toContain("Oak Apartments");
  });

  it("uses the latest onPinClick callback after the parent re-renders", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap
            properties={[baseProperty]}
            onPinClick={first}
            apiKey="fake-key"
          />
        </Wrapper>,
      );
    });
    await settle();
    // Resolve initial geocode
    const p = mapsState.pendingGeocodes.shift()!;
    await act(async () => {
      p.cb(
        [
          {
            geometry: {
              location: { lat: () => 30.2672, lng: () => -97.7431 },
            },
          },
        ],
        "OK",
      );
    });
    await settle();

    // Re-render with a different callback identity.
    await act(async () => {
      root!.render(
        <Wrapper>
          <PortfolioMap
            properties={[baseProperty]}
            onPinClick={second}
            apiKey="fake-key"
          />
        </Wrapper>,
      );
    });
    await settle();

    const marker = mapsState.markers[0];
    await act(async () => {
      fireMarkerEvent(marker, "gmp-click");
    });
    const content = mapsState.infoWindow?.content as HTMLElement | null;
    const view = content?.querySelector(
      '[data-testid="portfolio-map-info-view-p1"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      view!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("p1");
  });

  it("omits bed-count rows when the caller doesn't pass them", async () => {
    const minimal: MappableProperty = {
      id: "px",
      name: "Tiny",
      address: "1 Way",
      city: "Austin",
      state: "TX",
      zip: "78701",
    };
    await renderMap({ properties: [minimal] });
    const marker = mapsState.markers[0];
    await act(async () => {
      fireMarkerEvent(marker, "gmp-click");
    });
    const content = mapsState.infoWindow?.content as HTMLElement | null;
    expect(content!.textContent).toContain("Tiny");
    expect(content!.textContent).not.toContain("undefined");
    expect(
      content!.querySelector('[data-testid="portfolio-map-info-total-px"]'),
    ).toBeNull();
  });
});

describe("PortfolioMap geocode deduplication", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    __resetPortfolioMapCachesForTest();
    mapsState.map = null;
    mapsState.markers = [];
    mapsState.infoWindow = null;
    mapsState.pendingGeocodes = [];
    installFakeGoogleMaps();
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
    __resetPortfolioMapCachesForTest();
  });

  it("only issues one geocoder call per unique address even when the parent re-renders", async () => {
    const propsV1: MappableProperty[] = [
      makeProperty({ id: "p1", address: "100 First St" }),
      makeProperty({ id: "p2", address: "200 Second Ave" }),
      makeProperty({ id: "p3", address: "100 First St" }),
    ];
    const onGeocoded = vi.fn();
    const onPinClick = vi.fn();
    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap
            properties={propsV1}
            onPinClick={onPinClick}
            onGeocoded={onGeocoded}
            apiKey="test-key"
          />
        </Wrapper>,
      );
    });
    await settle();

    const pending = mapsState.pendingGeocodes;
    const uniqueAddrs = new Set(pending.map((p) => p.addr));
    expect(pending).toHaveLength(2);
    expect(uniqueAddrs).toEqual(
      new Set([
        "100 First St, Austin, TX 78701",
        "200 Second Ave, Austin, TX 78701",
      ]),
    );

    const propsV2 = propsV1.map((p) => ({ ...p }));
    await act(async () => {
      root!.render(
        <Wrapper>
          <PortfolioMap
            properties={propsV2}
            onPinClick={onPinClick}
            onGeocoded={onGeocoded}
            apiKey="test-key"
          />
        </Wrapper>,
      );
    });
    await settle();

    expect(pending).toHaveLength(2);
  });

  it("calls onGeocoded exactly once per property even when the parent rerenders mid-flight", async () => {
    const propsInitial: MappableProperty[] = [
      makeProperty({ id: "p1", address: "100 First St" }),
      makeProperty({ id: "p2", address: "200 Second Ave" }),
    ];
    const onGeocoded = vi.fn();
    const onPinClick = vi.fn();
    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap
            properties={propsInitial}
            onPinClick={onPinClick}
            onGeocoded={onGeocoded}
            apiKey="test-key"
          />
        </Wrapper>,
      );
    });
    await settle();
    const pending = mapsState.pendingGeocodes;
    expect(pending).toHaveLength(2);

    const p1Pending = pending.find((p) => p.addr.startsWith("100 First St"))!;
    await act(async () => {
      p1Pending.cb(
        [
          {
            geometry: {
              location: { lat: () => 30.1, lng: () => -97.1 },
            },
          },
        ],
        "OK",
      );
    });
    await settle();

    const propsAfterP1: MappableProperty[] = [
      makeProperty({
        id: "p1",
        address: "100 First St",
        lat: 30.1,
        lng: -97.1,
      }),
      makeProperty({ id: "p2", address: "200 Second Ave" }),
    ];
    await act(async () => {
      root!.render(
        <Wrapper>
          <PortfolioMap
            properties={propsAfterP1}
            onPinClick={onPinClick}
            onGeocoded={onGeocoded}
            apiKey="test-key"
          />
        </Wrapper>,
      );
    });
    await settle();

    expect(pending).toHaveLength(2);

    const p2Pending = pending.find((p) => p.addr.startsWith("200 Second Ave"))!;
    await act(async () => {
      p2Pending.cb(
        [
          {
            geometry: {
              location: { lat: () => 30.2, lng: () => -97.2 },
            },
          },
        ],
        "OK",
      );
    });
    await settle();

    expect(onGeocoded).toHaveBeenCalledTimes(2);
    const calls = onGeocoded.mock.calls.map(([id, point]) => ({ id, point }));
    expect(calls).toEqual(
      expect.arrayContaining([
        { id: "p1", point: { lat: 30.1, lng: -97.1 } },
        { id: "p2", point: { lat: 30.2, lng: -97.2 } },
      ]),
    );
  });

  it("does not call the geocoder for properties that already have stored lat/lng", async () => {
    const props: MappableProperty[] = [
      makeProperty({
        id: "p1",
        address: "100 First St",
        lat: 30.1,
        lng: -97.1,
      }),
      makeProperty({
        id: "p2",
        address: "200 Second Ave",
        lat: 30.2,
        lng: -97.2,
      }),
    ];
    const onGeocoded = vi.fn();
    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap
            properties={props}
            onPinClick={vi.fn()}
            onGeocoded={onGeocoded}
            apiKey="test-key"
          />
        </Wrapper>,
      );
    });
    await settle();

    expect(mapsState.pendingGeocodes).toHaveLength(0);
    expect(onGeocoded).not.toHaveBeenCalled();
  });
});

describe("PortfolioMap — branded Map ID", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    __resetPortfolioMapCachesForTest();
    mapsState.map = null;
    mapsState.markers = [];
    mapsState.infoWindow = null;
    mapsState.pendingGeocodes = [];
    installFakeGoogleMaps();
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
    __resetPortfolioMapCachesForTest();
  });

  it("passes the explicit mapId prop straight to google.maps.Map", async () => {
    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap
            properties={[makeProperty()]}
            onPinClick={vi.fn()}
            apiKey="test-key"
            mapId="HOUSINGOPS_BRANDED_MAP_ID"
          />
        </Wrapper>,
      );
    });
    await settle();
    expect(mapsState.map?.options.mapId).toBe("HOUSINGOPS_BRANDED_MAP_ID");
  });

  it("falls back to DEMO_MAP_ID when no prop is supplied and no runtime config has been fetched (apiKey explicitly provided so the fetch is skipped)", async () => {
    // When `apiKey` is provided, the runtime config fetch is skipped
    // entirely — there's no source for a Map ID other than the prop, so
    // we fall back to DEMO_MAP_ID. This keeps existing test ergonomics
    // (most tests in this file pass `apiKey` and expect DEMO_MAP_ID
    // without standing up a fake `/api/config`) and matches what
    // production sees on a fresh workspace where no Map ID has been
    // configured yet.
    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap
            properties={[makeProperty()]}
            onPinClick={vi.fn()}
            apiKey="test-key"
          />
        </Wrapper>,
      );
    });
    await settle();
    expect(mapsState.map?.options.mapId).toBe("DEMO_MAP_ID");
  });

});

// ---------------------------------------------------------------------------
// Runtime-config branch (Task #165): when no `apiKey` prop is supplied,
// the portfolio map fetches both the API key and the Map ID from the
// api-server's `/api/config` endpoint at mount and caches them via
// react-query. Operators rotate either value by setting
// `GOOGLE_MAPS_API_KEY` / `GOOGLE_MAPS_MAP_ID` on the api-server and
// restarting only the api-server — no web rebuild needed. These tests
// mock the global fetch so we can exercise that flow without a real
// server. They live in their own describe block because they need a
// per-test fetch override and shouldn't pollute the inline-key tests
// above.
// ---------------------------------------------------------------------------

describe("PortfolioMap — runtime config", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    __resetPortfolioMapCachesForTest();
    mapsState.map = null;
    mapsState.markers = [];
    mapsState.infoWindow = null;
    mapsState.pendingGeocodes = [];
    installFakeGoogleMaps();
    // Clean up any <script data-housingops-maps> tags a previous test
    // may have left attached (e.g. the SDK-reload-on-rotation test
    // appends a real script tag whose `load` event never fires in the
    // jsdom environment). Without this, that leftover would defeat
    // the "no script tag yet" precondition the rotation test relies
    // on to spot the rotation-triggered reload.
    document
      .querySelectorAll('script[data-housingops-maps]')
      .forEach((s) => s.remove());
    container = document.createElement("div");
    document.body.appendChild(container);
    originalFetch = globalThis.fetch;
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
    __resetPortfolioMapCachesForTest();
    document
      .querySelectorAll('script[data-housingops-maps]')
      .forEach((s) => s.remove());
    globalThis.fetch = originalFetch;
  });

  function get(testId: string): HTMLElement | null {
    return container.querySelector(
      `[data-testid="${testId}"]`,
    ) as HTMLElement | null;
  }

  it("fetches /api/config exactly once on mount when no apiKey prop is supplied", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            googleMapsApiKey: "rotated-key-xyz",
            googleMapsMapId: "branded-map-id",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap properties={[makeProperty()]} onPinClick={vi.fn()} />
        </Wrapper>,
      );
    });

    // The component must hit the runtime config endpoint exactly once.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      ...unknown[],
    ];
    const requestedUrl = String(firstCall[0]);
    expect(requestedUrl).toContain("/api/config");
  });

  it("renders a neutral loading placeholder while /api/config is in flight (not the 'set up your key' fallback)", async () => {
    // The loading branch is what keeps the operator from being shown a
    // scary "set up your key" warning during the brief window between
    // mount and the first response from the api-server.
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap properties={[makeProperty()]} onPinClick={vi.fn()} />
        </Wrapper>,
      );
    });

    expect(get("portfolio-map-config-loading")).not.toBeNull();
    expect(get("portfolio-map-fallback")).toBeNull();
    expect(get("portfolio-map")).toBeNull();

    // Resolve the in-flight request so cleanup doesn't hang.
    await act(async () => {
      resolveFetch!(
        new Response(
          JSON.stringify({
            googleMapsApiKey: "live-key",
            googleMapsMapId: "live-map-id",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });
    await waitFor(() => get("portfolio-map") !== null);
  });

  it("loads the map with the fetched key and Map ID once /api/config resolves", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            googleMapsApiKey: "rotated-key-xyz",
            googleMapsMapId: "branded-map-id",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap properties={[makeProperty()]} onPinClick={vi.fn()} />
        </Wrapper>,
      );
    });

    // Wait for the query to resolve and the map to mount with the
    // fetched values. Polling avoids races with react-query's
    // setTimeout-scheduled notifications.
    await waitFor(() => mapsState.map !== null);

    // The Map ID handed to google.maps.Map comes from the runtime
    // config — proves the rotation path works end-to-end without a
    // rebuild or env var on the web side.
    expect(mapsState.map?.options.mapId).toBe("branded-map-id");
    // And the loading placeholder is no longer visible.
    expect(get("portfolio-map-config-loading")).toBeNull();
    expect(get("portfolio-map")).not.toBeNull();
  });

  it("falls back to DEMO_MAP_ID when /api/config returns googleMapsMapId: null but an API key is configured", async () => {
    // Mirrors the production case where an operator has set the API
    // key but hasn't provisioned a branded Map ID yet — the map still
    // needs to render pins, so it falls back to Google's built-in
    // demo Map ID rather than refusing to mount.
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            googleMapsApiKey: "live-key",
            googleMapsMapId: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap properties={[makeProperty()]} onPinClick={vi.fn()} />
        </Wrapper>,
      );
    });

    await waitFor(() => mapsState.map !== null);
    expect(mapsState.map?.options.mapId).toBe("DEMO_MAP_ID");
  });

  it("renders the friendly fallback (pointing at the api-server secret) when /api/config reports no key configured", async () => {
    // The fallback message must NOT mention the retired build-time
    // env vars (`VITE_GOOGLE_MAPS_API_KEY` / `VITE_GOOGLE_MAPS_MAP_ID`)
    // — operators who follow that copy would update the wrong place
    // now that the key lives on the api-server.
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            googleMapsApiKey: null,
            googleMapsMapId: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap properties={[makeProperty()]} onPinClick={vi.fn()} />
        </Wrapper>,
      );
    });

    await waitFor(() => get("portfolio-map-fallback") !== null);

    expect(get("portfolio-map-config-loading")).toBeNull();
    expect(get("portfolio-map")).toBeNull();
    const fallback = get("portfolio-map-fallback");
    expect(fallback).not.toBeNull();
    const text = fallback!.textContent ?? "";
    // Names the api-server secret (the new source of truth) so the
    // operator updates the right thing.
    expect(text).toContain("GOOGLE_MAPS_API_KEY");
    expect(text.toLowerCase()).toContain("api-server");
    // Must NOT name the retired build-time vars — that would be a
    // rotation trap.
    expect(text).not.toContain("VITE_GOOGLE_MAPS_API_KEY");
    expect(text).not.toContain("VITE_GOOGLE_MAPS_MAP_ID");
  });

  it("does not fetch /api/config when the caller passes an explicit apiKey prop (test injection short-circuit)", async () => {
    // The component must skip the network entirely when tests inject
    // the key — otherwise every existing test in this file would need
    // to stand up a fake fetch.
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap
            properties={[makeProperty()]}
            onPinClick={vi.fn()}
            apiKey="injected-key"
          />
        </Wrapper>,
      );
    });
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    // And nothing should be in the loading branch — we have a key.
    expect(get("portfolio-map-config-loading")).toBeNull();
  });

  it("renders an explicit error branch (with Retry) when /api/config rejects, instead of getting stuck on the loading placeholder", async () => {
    // Pre-Task #170: when `/api/config` errored, react-query left
    // `data` undefined and `isPending` false, so the component fell
    // through to the "set up your key" fallback — sending the
    // operator chasing the wrong fix. The explicit error branch must
    // name `/api/config` and the api-server so the operator knows
    // where to look, and must NOT silently render the missing-key
    // fallback or leave the loading placeholder visible.
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap properties={[makeProperty()]} onPinClick={vi.fn()} />
        </Wrapper>,
      );
    });

    await waitFor(() => get("portfolio-map-config-error") !== null);

    // Loading placeholder is gone — the operator gets a real signal.
    expect(get("portfolio-map-config-loading")).toBeNull();
    // And we did NOT mistake "fetch failed" for "no key configured" —
    // those are two completely different stories.
    expect(get("portfolio-map-fallback")).toBeNull();
    expect(get("portfolio-map")).toBeNull();

    const text = get("portfolio-map-config-error-text");
    expect(text).not.toBeNull();
    const copy = text!.textContent ?? "";
    expect(copy).toContain("/api/config");
    expect(copy.toLowerCase()).toContain("api-server");

    const retry = get("portfolio-map-config-retry") as
      | HTMLButtonElement
      | null;
    expect(retry).not.toBeNull();
  });

  it("retries the /api/config fetch and recovers into the live map when the operator clicks Retry", async () => {
    // First call rejects, second resolves — the Retry button should
    // re-issue the request and let the map mount once the second
    // response lands. Without a working retry, an operator hitting a
    // transient error would have to reload the whole page.
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
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap properties={[makeProperty()]} onPinClick={vi.fn()} />
        </Wrapper>,
      );
    });

    await waitFor(() => get("portfolio-map-config-error") !== null);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const retry = get("portfolio-map-config-retry") as
      | HTMLButtonElement
      | null;
    expect(retry).not.toBeNull();
    await act(async () => {
      retry!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => mapsState.map !== null);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(get("portfolio-map-config-error")).toBeNull();
    expect(mapsState.map?.options.mapId).toBe("recovered-map-id");
  });

  it("renders the explicit error branch (not the loading placeholder) when /api/config returns a 500", async () => {
    // A non-2xx response from the api-server still resolves the fetch
    // promise — but the generated client throws on a non-OK status,
    // which flips the query to the error state. The operator must see
    // the actionable error branch, not be lied to with the
    // missing-key fallback.
    const fetchMock = vi.fn(
      async () =>
        new Response("internal error", {
          status: 500,
          headers: { "content-type": "text/plain" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap properties={[makeProperty()]} onPinClick={vi.fn()} />
        </Wrapper>,
      );
    });

    await waitFor(() => get("portfolio-map-config-error") !== null);

    expect(get("portfolio-map-config-loading")).toBeNull();
    expect(get("portfolio-map-fallback")).toBeNull();
    expect(get("portfolio-map")).toBeNull();
  });

  it("picks up a rotated Map ID on the next /api/config refetch and re-creates the map without a hard refresh", async () => {
    // Operators rotate the branded Map ID by setting GOOGLE_MAPS_MAP_ID
    // on the api-server and restarting only it. The shared
    // runtime-config hook fires a periodic refetch so an open browser
    // tab swaps in the new value within a bounded window — this test
    // proves that path end-to-end.
    //
    // We don't wait for the actual refetch interval (would slow the
    // test down without adding signal); instead we simulate the poll
    // landing a fresh response by calling QueryClient.invalidateQueries
    // and changing what `fetch` returns on the second call. That is
    // what the periodic refetch effectively does — re-fire the
    // /api/config request and let the new values flow through.
    //
    // We hold the API key constant across both responses on purpose:
    // a *key* rotation also triggers the JS SDK script reload path
    // (covered by its own dedicated test below), and that path can't
    // resolve in jsdom without manually firing a synthetic `load` event
    // on the appended script. Rotating only the Map ID keeps this
    // test focused on the periodic-refetch contract it's pinning down.
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      const body =
        call === 1
          ? { googleMapsApiKey: "stable-key", googleMapsMapId: "map-A" }
          : { googleMapsApiKey: "stable-key", googleMapsMapId: "map-B" };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Build the wrapper inline so we can reach the QueryClient and
    // trigger an invalidation from the test body.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 },
      },
    });
    function LocalWrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    await act(async () => {
      root = createRoot(container);
      root.render(
        <LocalWrapper>
          <PortfolioMap properties={[makeProperty()]} onPinClick={vi.fn()} />
        </LocalWrapper>,
      );
    });

    // First load lands the initial values.
    await waitFor(() => mapsState.map !== null);
    expect(mapsState.map?.options.mapId).toBe("map-A");

    // Trigger a refetch (stand-in for the periodic poll firing while
    // the tab is open) — the query observer will re-call /api/config,
    // get the rotated values, and the map should re-create with the
    // new Map ID.
    await act(async () => {
      await client.invalidateQueries();
    });
    await waitFor(() => mapsState.map?.options.mapId === "map-B");

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mapsState.map?.options.mapId).toBe("map-B");
  });

  it("re-loads the Maps SDK <script> with the rotated key so subsequent SDK calls bill against the new key (not the stale one)", async () => {
    // The Google Maps JS SDK binds the API key in its <script> URL
    // at load time. Without a script reload, a rotated key would
    // never take effect for an open tab — the SDK would keep auth'ing
    // against whatever key was in the URL at first load, defeating
    // the no-rebuild rotation flow. This test verifies that on a key
    // change the old script + global are torn down and a fresh script
    // pointing at the new key is appended.
    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap
            properties={[makeProperty()]}
            onPinClick={vi.fn()}
            apiKey="key-A"
          />
        </Wrapper>,
      );
    });
    await settle();
    expect(mapsState.map).not.toBeNull();
    // The fake bypasses real script loading (the loader promise is
    // pre-resolved by installFakeGoogleMaps), so no script tag is
    // attached on the initial mount — only on the rotation path
    // below. That makes the appearance of the script tag a clean
    // signal that rotation triggered a reload.
    expect(
      document.querySelector('script[data-housingops-maps]'),
    ).toBeNull();

    // Re-render with the rotated key — the load effect re-runs on
    // resolvedKey change and detects the rotation.
    await act(async () => {
      root!.render(
        <Wrapper>
          <PortfolioMap
            properties={[makeProperty()]}
            onPinClick={vi.fn()}
            apiKey="key-B"
          />
        </Wrapper>,
      );
    });
    await flush();

    // Rotation handler tore down `window.google` and the loader
    // promise, then the load effect created a fresh script tag
    // pointing at the new key.
    const script = document.querySelector(
      'script[data-housingops-maps]',
    ) as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    expect(script!.src).toContain("key=key-B");
    expect(script!.src).not.toContain("key=key-A");

    // Resolve the new SDK by re-installing the fake (so the readiness
    // check inside loadMapsApi's onReady callback finds the classes)
    // and firing the script's load event manually — there's no real
    // network in the test environment.
    installFakeGoogleMaps();
    await act(async () => {
      script!.dispatchEvent(new Event("load"));
    });
    await settle();

    // The map re-mounts against the freshly-loaded SDK so any
    // subsequent geocoder / marker calls bill against the new key.
    expect(mapsState.map).not.toBeNull();

    // Cleanup: the fresh script tag is left on the page since
    // teardown of the test only removes the container; remove it
    // here so it doesn't leak into the next test's selectors.
    script!.remove();
  });

  it("disposes the previous map's markers and info window when the API key is rotated, leaving no stale references", async () => {
    // The Maps SDK script reload (covered above) is only half the
    // rotation story. Before this test was added, the load effect
    // simply overwrote `mapRef.current` with the freshly-built Map —
    // the previous map's AdvancedMarkerElement pins and the shared
    // InfoWindow stayed reachable through `markersRef` /
    // `infoWindowRef`, with their pin-level event listeners and the
    // last-set bubble content node still attached. For the rare
    // operator who rotates keys multiple times in a single tab,
    // those leaks compound on every rotation.
    //
    // The fix is to dispose the prior map instance + markers + info
    // window in the load effect's cleanup, before the new SDK takes
    // over. This test pins that contract down by:
    //   1. mounting against key-A and capturing the marker /
    //      InfoWindow created against it,
    //   2. rotating to key-B,
    //   3. asserting the captured marker has been removed from the
    //      old map (`map === null`) and is no longer in the live
    //      marker registry, and the captured InfoWindow has had
    //      `close()` called on it,
    //   4. resolving the rotated SDK and asserting the freshly-built
    //      map ends up with brand-new marker + InfoWindow instances
    //      (i.e. nothing was reused across the rotation boundary).
    //
    // Pre-supply lat/lng so a marker is created synchronously and we
    // don't need to drive the geocoder before the rotation.
    const propWithCoords = makeProperty({
      id: "p1",
      lat: 30.2672,
      lng: -97.7431,
    });

    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap
            properties={[propWithCoords]}
            onPinClick={vi.fn()}
            apiKey="key-A"
          />
        </Wrapper>,
      );
    });
    await settle();

    // Sanity check: the initial marker + InfoWindow exist against
    // key-A. Capture them so we can verify they're torn down by the
    // rotation rather than just shadowed by fresh ones.
    expect(mapsState.markers).toHaveLength(1);
    const oldMarker = mapsState.markers[0];
    expect(oldMarker.map).not.toBeNull();

    // Open the bubble so we can later assert the OLD InfoWindow was
    // explicitly closed (closeCount goes up). Without opening it
    // first, closeCount would simply still be 0 — useful, but a
    // weaker signal that disposal actually ran. The captured state
    // object survives even after a new InfoWindow is constructed,
    // because new instances reassign `mapsState.infoWindow` to a
    // fresh object rather than mutating the old one.
    await act(async () => {
      fireMarkerEvent(oldMarker, "gmp-click");
    });
    expect(mapsState.infoWindow).not.toBeNull();
    const oldInfoWindowState = mapsState.infoWindow!;
    expect(oldInfoWindowState.isOpen).toBe(true);
    expect(oldInfoWindowState.closeCount).toBe(0);

    // Rotate the key. The load effect's cleanup must fire before
    // the next render commits a fresh `setStatus("loading")` — that
    // cleanup is where disposal happens.
    await act(async () => {
      root!.render(
        <Wrapper>
          <PortfolioMap
            properties={[propWithCoords]}
            onPinClick={vi.fn()}
            apiKey="key-B"
          />
        </Wrapper>,
      );
    });
    await flush();

    // Disposal happened: the captured marker has been removed from
    // its parent map (AdvancedMarkerElement's documented teardown is
    // assigning `map = null`, which the fake mirrors by also
    // splicing the marker out of `mapsState.markers`). Without the
    // cleanup, `oldMarker.map` would still point at the previous
    // google.maps.Map and the array would still contain it.
    expect(oldMarker.map).toBeNull();
    expect(mapsState.markers).not.toContain(oldMarker);
    // The InfoWindow we captured was explicitly closed by the
    // cleanup — proves we didn't leave a stale bubble (and its
    // last-set content node) attached against a vanished marker.
    expect(oldInfoWindowState.closeCount).toBeGreaterThan(0);

    // Drive the rotated SDK to readiness (jsdom won't fire `load`
    // for a real network fetch, so re-install the fake namespace and
    // dispatch the load event manually) and let the marker effect
    // re-run against the freshly-built map.
    const script = document.querySelector(
      'script[data-housingops-maps]',
    ) as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    installFakeGoogleMaps();
    await act(async () => {
      script!.dispatchEvent(new Event("load"));
    });
    await settle();

    // The new map mounted with a brand-new marker and a brand-new
    // InfoWindow — none of them are the captured references from
    // before the rotation. If disposal had been a no-op, the
    // re-built marker effect would have appended a *second* marker
    // alongside the old (still-attached) one and we'd see length 2
    // here.
    expect(mapsState.markers).toHaveLength(1);
    const newMarker = mapsState.markers[0];
    expect(newMarker).not.toBe(oldMarker);
    expect(mapsState.infoWindow).not.toBeNull();
    expect(mapsState.infoWindow).not.toBe(oldInfoWindowState);

    // Cleanup: the fresh script tag is left on the page since
    // teardown of the test only removes the container; remove it
    // here so it doesn't leak into the next test's selectors.
    script!.remove();
  });

  it("prefers an explicit mapId prop over whatever /api/config returned (so tests can override per render)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            googleMapsApiKey: "live-key",
            googleMapsMapId: "fetched-map-id",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap
            properties={[makeProperty()]}
            onPinClick={vi.fn()}
            mapId="prop-wins"
          />
        </Wrapper>,
      );
    });

    await waitFor(() => mapsState.map !== null);
    expect(mapsState.map?.options.mapId).toBe("prop-wins");
  });
});

// ---------------------------------------------------------------------------
// Key-rejected branch (Task #167): when the shared Google Maps key-error
// store reports a code — either because the JS SDK called
// `window.gm_authFailure` after rejecting our key, or because a sibling
// embed (the per-property location card) observed a postMessage error code
// — the portfolio map flips out of its loading/canvas branch into a
// dedicated "key rejected" panel. Without these tests, a refactor that
// drops the `useGoogleMapsKeyError` subscription, swaps the panel's test
// id, or short-circuits the branch wouldn't fail any portfolio-map test
// (the branch is only covered indirectly by the hook tests).
// ---------------------------------------------------------------------------
describe("PortfolioMap — key-rejected branch", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  // Capture/restore the real `fetch` around each test. The in-flight
  // /api/config test below overrides `globalThis.fetch` to hold the
  // request unresolved; restoring it here keeps that override from
  // bleeding into other suites if tests are reordered or appended.
  let originalFetch: typeof fetch;

  beforeEach(() => {
    // Reset BOTH module-level stores so a code reported in one test
    // can't leak into the next (the key-error store is keyed by code,
    // not by component instance, so unmounting alone wouldn't clear it).
    __resetPortfolioMapCachesForTest();
    __resetGoogleMapsKeyErrorForTest();
    mapsState.map = null;
    mapsState.markers = [];
    mapsState.infoWindow = null;
    mapsState.pendingGeocodes = [];
    installFakeGoogleMaps();
    container = document.createElement("div");
    document.body.appendChild(container);
    originalFetch = globalThis.fetch;
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
    __resetPortfolioMapCachesForTest();
    __resetGoogleMapsKeyErrorForTest();
    globalThis.fetch = originalFetch;
  });

  function get(testId: string): HTMLElement | null {
    return container.querySelector(
      `[data-testid="${testId}"]`,
    ) as HTMLElement | null;
  }

  it("flips into the key-rejected panel when the JS SDK reports gm_authFailure (synthetic MapsJsAuthFailure code)", async () => {
    // Mount the map first so the canvas branch is what's rendered, then
    // simulate the JS SDK rejecting our key. The component subscribes
    // to the shared store via `useGoogleMapsKeyError`, so the report
    // should trigger a re-render into the dedicated panel without
    // anyone unmounting the component.
    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap
            properties={[makeProperty()]}
            onPinClick={vi.fn()}
            apiKey="fake-key"
          />
        </Wrapper>,
      );
    });
    await settle();

    // Sanity check — the canvas is what's rendered before the error.
    expect(get("portfolio-map")).not.toBeNull();
    expect(get("portfolio-map-key-error")).toBeNull();

    // Simulate `window.gm_authFailure` by feeding the same synthetic
    // code the global listener would emit. Calling
    // `reportGoogleMapsKeyError` directly (vs. invoking
    // `window.gm_authFailure`) lets the test exercise the branch
    // without also having to mount the app-level toast listener that
    // installs the global handler.
    await act(async () => {
      reportGoogleMapsKeyError(MAPS_AUTH_FAILURE_CODE);
    });

    // The canvas must be gone — operators should not still see a stale
    // map next to a "key rejected" message.
    expect(get("portfolio-map")).toBeNull();

    const panel = get("portfolio-map-key-error");
    expect(panel).not.toBeNull();
    // The code attribute must be set and non-empty so downstream
    // tooling (and humans) can tell which signal flipped the branch.
    const code = panel!.getAttribute("data-error-code");
    expect(code).not.toBeNull();
    expect(code).not.toBe("");
    expect(code).toBe(MAPS_AUTH_FAILURE_CODE);

    // The panel renders the tailored copy from the shared lookup
    // table — not a generic "something failed" string.
    const text = get("portfolio-map-key-error-text");
    expect(text).not.toBeNull();
    const copy = (text!.textContent ?? "").toLowerCase();
    expect(copy).toContain("google");
    expect(copy).toContain("rejected");
  });

  it("flips into the same key-rejected panel when an embed-iframe code is reported elsewhere on the page (cross-surface sharing)", async () => {
    // The per-property location card also feeds the shared store when
    // it observes a postMessage code from the Google Maps Embed
    // iframe. The portfolio map shouldn't care which surface saw the
    // error first — it must flip into the same panel either way.
    // Without this assertion, a refactor that breaks the cross-surface
    // sharing (e.g. each component getting its own private store)
    // would silently regress the unified UX.
    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap
            properties={[makeProperty()]}
            onPinClick={vi.fn()}
            apiKey="fake-key"
          />
        </Wrapper>,
      );
    });
    await settle();

    expect(get("portfolio-map-key-error")).toBeNull();

    // Use a real embed-iframe code (the kind the Embed API posts back
    // via window.postMessage) — proves the portfolio map honors codes
    // observed by *other* surfaces, not just the JS-SDK auth failure.
    await act(async () => {
      reportGoogleMapsKeyError("RefererNotAllowedMapError");
    });

    expect(get("portfolio-map")).toBeNull();
    const panel = get("portfolio-map-key-error");
    expect(panel).not.toBeNull();
    const code = panel!.getAttribute("data-error-code");
    expect(code).not.toBeNull();
    expect(code).not.toBe("");
    expect(code).toBe("RefererNotAllowedMapError");

    // The tailored copy for RefererNotAllowedMapError names the
    // concrete fix (HTTP referrer allowlist) — the whole point of
    // having per-code messages is so the panel tells the operator
    // exactly what to do, not a generic line.
    const text = get("portfolio-map-key-error-text");
    expect(text).not.toBeNull();
    const copy = (text!.textContent ?? "").toLowerCase();
    expect(copy).toContain("referrer");
  });

  it("flips into the key-rejected panel even while /api/config is still in flight (key-error wins over the loading placeholder)", async () => {
    // Regression for Task #176: the portfolio map's "Loading map…"
    // placeholder used to be checked BEFORE the key-error branch in
    // the component's branch order, so a sibling Maps surface (e.g.
    // the per-property Location card) detecting a rejected key while
    // this component's `/api/config` request was still in flight would
    // be silently hidden — the operator saw an indefinite loading
    // state next to a toast saying the key was rejected, with no
    // in-page explanation. The branches were re-ordered so the
    // key-error panel wins. Without this test, swapping them back
    // would only fail at the toast/integration level.
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          {/* No `apiKey` prop, so the component fetches /api/config —
              and we hold that fetch unresolved below. */}
          <PortfolioMap properties={[makeProperty()]} onPinClick={vi.fn()} />
        </Wrapper>,
      );
    });

    // Sanity check — with the fetch held in flight, the loading
    // placeholder is what's currently rendered.
    expect(get("portfolio-map-config-loading")).not.toBeNull();
    expect(get("portfolio-map-key-error")).toBeNull();

    // Now simulate a sibling Maps surface (or the JS SDK) reporting
    // a rejected key while the config request is still pending. Use
    // an embed-iframe code so the test exercises the realistic
    // cross-surface path described in the task.
    await act(async () => {
      reportGoogleMapsKeyError("InvalidKeyMapError");
    });

    // The loading placeholder must be gone — leaving it visible would
    // leave the operator staring at a stuck spinner next to a toast.
    expect(get("portfolio-map-config-loading")).toBeNull();

    // And the dedicated key-error panel must be what's rendered now,
    // even though `/api/config` has not yet resolved.
    const panel = get("portfolio-map-key-error");
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute("data-error-code")).toBe("InvalidKeyMapError");

    // Resolve the in-flight fetch so cleanup doesn't hang on the
    // pending promise. The key-error branch should still win after
    // the config arrives.
    await act(async () => {
      resolveFetch!(
        new Response(
          JSON.stringify({
            googleMapsApiKey: "live-key",
            googleMapsMapId: "live-map-id",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });
    await settle();
    expect(get("portfolio-map-key-error")).not.toBeNull();
    expect(get("portfolio-map")).toBeNull();
  });

  // -------------------------------------------------------------------
  // Open-in-Google-Cloud-Console action button (Task #177)
  //
  // The same per-code Console deep-link the toast carries (Task #173)
  // also has to live in this in-page panel so an operator who
  // dismissed the toast — or arrived at the map after the toast had
  // already fired and timed out — still gets a single-click jump to
  // the right Console page for whatever code Google reported. These
  // tests pin down: the link's per-code href, that it opens in a new
  // tab with the right `rel`, that an unknown code falls back instead
  // of breaking the link, and that the same code drives both panel +
  // link in lockstep.
  // -------------------------------------------------------------------
  // Cover at least one code per Console page (credentials, library,
  // quotas, project picker) plus the synthetic JS-SDK auth-failure
  // code — that is the surface area Task #173's URL table cares
  // about, so the panel's link must follow the same shape.
  const CONSOLE_LINK_CASES: ReadonlyArray<{
    code: string;
    expectedHref: string;
  }> = [
    {
      code: MAPS_AUTH_FAILURE_CODE,
      expectedHref: "https://console.cloud.google.com/apis/credentials",
    },
    {
      code: "RefererNotAllowedMapError",
      expectedHref: "https://console.cloud.google.com/apis/credentials",
    },
    {
      code: "ApiNotActivatedMapError",
      expectedHref:
        "https://console.cloud.google.com/apis/library/maps-embed-backend.googleapis.com",
    },
    {
      code: "OverQuotaMapError",
      expectedHref:
        "https://console.cloud.google.com/apis/api/maps-embed-backend.googleapis.com/quotas",
    },
    {
      code: "DeletedApiProjectMapError",
      expectedHref:
        "https://console.cloud.google.com/projectselector2/home/dashboard",
    },
  ];

  for (const { code, expectedHref } of CONSOLE_LINK_CASES) {
    it(`renders an "Open in Google Cloud Console" link pointing at ${expectedHref} for ${code}`, async () => {
      const Wrapper = makeWrapper();
      await act(async () => {
        root = createRoot(container);
        root.render(
          <Wrapper>
            <PortfolioMap
              properties={[makeProperty()]}
              onPinClick={vi.fn()}
              apiKey="fake-key"
            />
          </Wrapper>,
        );
      });
      await settle();

      await act(async () => {
        reportGoogleMapsKeyError(code);
      });

      const panel = get("portfolio-map-key-error");
      expect(panel).not.toBeNull();
      // Stable contract: the panel's data-error-code must agree with
      // the code that drives the Console link, so no future refactor
      // can drift them apart and silently send the operator to the
      // wrong page.
      expect(panel!.getAttribute("data-error-code")).toBe(code);

      const link = get(
        "portfolio-map-key-error-console-link",
      ) as HTMLAnchorElement | null;
      expect(link).not.toBeNull();
      // Per-code expectations are the contract: the URL has to be
      // the right page for the fix the message names. Hard-coding
      // the expected URLs (instead of round-tripping through
      // MAPS_KEY_CONSOLE_URLS) keeps the assertion honest — a typo
      // in the table would silently pass a "table === table" check.
      expect(link!.href).toBe(expectedHref);
      // Cross-check: also matches the source-of-truth helper, so
      // the panel's link can't drift from the toast's link without
      // one of these expectations failing first.
      expect(link!.href).toBe(getMapsKeyConsoleUrl(code));
      expect(MAPS_KEY_CONSOLE_URLS[code]).toBe(expectedHref);
      // Opens in a new tab so a click doesn't blow the operator's
      // current HousingOps view away.
      expect(link!.target).toBe("_blank");
      // `noopener` so the opened Console tab can't reach back into
      // window.opener — same hygiene the toast's action enforces.
      expect(link!.rel).toContain("noopener");
      expect(link!.rel).toContain("noreferrer");
      expect(link!.textContent ?? "").toContain("Open in Google Cloud Console");
    });
  }

  it("falls back to the credentials list when Google reports a code we don't have a tailored URL for (link is never dead)", async () => {
    // Mirrors the toast's contract: an unknown / brand-new code must
    // still produce a working button instead of an empty href, so
    // the operator always has a one-click path even before we ship
    // a tailored mapping for the new code.
    const unknownCode = "BrandNewUnknownMapError";
    expect(MAPS_KEY_CONSOLE_URLS[unknownCode]).toBeUndefined();

    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap
            properties={[makeProperty()]}
            onPinClick={vi.fn()}
            apiKey="fake-key"
          />
        </Wrapper>,
      );
    });
    await settle();

    await act(async () => {
      reportGoogleMapsKeyError(unknownCode);
    });

    const link = get(
      "portfolio-map-key-error-console-link",
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.href).toBe(
      "https://console.cloud.google.com/apis/credentials",
    );
    expect(link!.target).toBe("_blank");
    expect(link!.rel).toContain("noopener");
  });
});

// ---------------------------------------------------------------------------
// Rotation-confirmation toast (Task #179): when the operator rotates
// GOOGLE_MAPS_API_KEY on the api-server, the SDK silently tears down and
// reloads against the new key. Without an in-tab signal, operators have to
// inspect the network tab (or wait for the old key to start failing) to
// know the swap was actually picked up. These tests pin down the contract
// that a "Google Maps key updated" toast fires exactly once on rotation
// success — and stays silent on the very first load (no rotation has
// happened yet).
// ---------------------------------------------------------------------------
describe("PortfolioMap — rotation-confirmation toast", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    toastCalls.length = 0;
    __resetPortfolioMapCachesForTest();
    mapsState.map = null;
    mapsState.markers = [];
    mapsState.infoWindow = null;
    mapsState.pendingGeocodes = [];
    installFakeGoogleMaps();
    // Same precondition the SDK-reload rotation test relies on — wipe
    // any leftover <script> from a previous test so the fresh-key
    // reload path is observable end-to-end.
    document
      .querySelectorAll('script[data-housingops-maps]')
      .forEach((s) => s.remove());
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
    __resetPortfolioMapCachesForTest();
    document
      .querySelectorAll('script[data-housingops-maps]')
      .forEach((s) => s.remove());
    toastCalls.length = 0;
  });

  it("does not fire a toast on the very first map load (no rotation has happened yet)", async () => {
    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap
            properties={[makeProperty()]}
            onPinClick={vi.fn()}
            apiKey="initial-key"
          />
        </Wrapper>,
      );
    });
    await settle();

    // Fresh tab — `loadedApiKey` was null, so loadMapsApi reports
    // `rotated: false` and the success path skips the toast. A toast
    // here would mean an operator opening a fresh tab gets a
    // confusing "key updated" popup before any rotation occurred.
    expect(mapsState.map).not.toBeNull();
    expect(toastCalls).toHaveLength(0);
  });

  it("fires the rotation-confirmation toast exactly once when a rotated key successfully reloads the SDK", async () => {
    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PortfolioMap
            properties={[makeProperty()]}
            onPinClick={vi.fn()}
            apiKey="key-A"
          />
        </Wrapper>,
      );
    });
    await settle();
    // Sanity check — initial load did not toast (covered by the test
    // above, but re-asserted here so the post-rotation count is
    // unambiguous).
    expect(toastCalls).toHaveLength(0);

    // Rotate. The load effect re-runs on `resolvedKey` change,
    // loadMapsApi tears down the old SDK + script, and a fresh script
    // tag is appended pointing at the new key.
    await act(async () => {
      root!.render(
        <Wrapper>
          <PortfolioMap
            properties={[makeProperty()]}
            onPinClick={vi.fn()}
            apiKey="key-B"
          />
        </Wrapper>,
      );
    });
    await flush();

    // Fresh script tag for key-B is now in the DOM, but the toast
    // must NOT fire until the rotated SDK actually resolves — until
    // that point the operator has no proof the new key works.
    expect(toastCalls).toHaveLength(0);

    // Drive the rotated SDK to readiness (jsdom doesn't run real
    // network fetches, so we re-install the fake namespace and
    // dispatch the script's `load` event manually).
    const script = document.querySelector(
      'script[data-housingops-maps]',
    ) as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    installFakeGoogleMaps();
    await act(async () => {
      script!.dispatchEvent(new Event("load"));
    });
    await settle();

    // Exactly one toast, with copy that names the change so the
    // operator can tell it apart from unrelated notifications.
    expect(toastCalls).toHaveLength(1);
    expect(toastCalls[0].title).toBe("Google Maps key updated");
    expect(toastCalls[0].description).toBe(
      "Map reloaded against the rotated key.",
    );

    // Cleanup: leftover script would defeat the "no tag yet"
    // precondition any subsequent test relies on.
    script!.remove();
  });
});
