import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  PortfolioMap,
  __resetPortfolioMapCachesForTest,
  type MappableProperty,
} from "./portfolio-map";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    await act(async () => {
      root = createRoot(container);
      root.render(
        <PortfolioMap
          properties={[baseProperty]}
          onPinClick={onPinClick}
          apiKey="fake-key"
          {...props}
        />,
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
    await act(async () => {
      root = createRoot(container);
      root.render(
        <PortfolioMap
          properties={[baseProperty]}
          onPinClick={first}
          apiKey="fake-key"
        />,
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
        <PortfolioMap
          properties={[baseProperty]}
          onPinClick={second}
          apiKey="fake-key"
        />,
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
    await act(async () => {
      root = createRoot(container);
      root.render(
        <PortfolioMap
          properties={propsV1}
          onPinClick={onPinClick}
          onGeocoded={onGeocoded}
          apiKey="test-key"
        />,
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
        <PortfolioMap
          properties={propsV2}
          onPinClick={onPinClick}
          onGeocoded={onGeocoded}
          apiKey="test-key"
        />,
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
    await act(async () => {
      root = createRoot(container);
      root.render(
        <PortfolioMap
          properties={propsInitial}
          onPinClick={onPinClick}
          onGeocoded={onGeocoded}
          apiKey="test-key"
        />,
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
        <PortfolioMap
          properties={propsAfterP1}
          onPinClick={onPinClick}
          onGeocoded={onGeocoded}
          apiKey="test-key"
        />,
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
    await act(async () => {
      root = createRoot(container);
      root.render(
        <PortfolioMap
          properties={props}
          onPinClick={vi.fn()}
          onGeocoded={onGeocoded}
          apiKey="test-key"
        />,
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
    // Defensive: clean up the env override even if a test threw before
    // its inline cleanup ran, so the next test starts from the same
    // baseline as production code.
    delete (
      import.meta.env as unknown as Record<string, string | undefined>
    ).VITE_GOOGLE_MAPS_MAP_ID;
  });

  it("passes the explicit mapId prop straight to google.maps.Map", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <PortfolioMap
          properties={[makeProperty()]}
          onPinClick={vi.fn()}
          apiKey="test-key"
          mapId="HOUSINGOPS_BRANDED_MAP_ID"
        />,
      );
    });
    await settle();
    expect(mapsState.map?.options.mapId).toBe("HOUSINGOPS_BRANDED_MAP_ID");
  });

  it("uses the VITE_GOOGLE_MAPS_MAP_ID env var when no prop is supplied", async () => {
    (
      import.meta.env as unknown as Record<string, string | undefined>
    ).VITE_GOOGLE_MAPS_MAP_ID = "env-supplied-map-id";
    try {
      await act(async () => {
        root = createRoot(container);
        root.render(
          <PortfolioMap
            properties={[makeProperty()]}
            onPinClick={vi.fn()}
            apiKey="test-key"
          />,
        );
      });
      await settle();
      expect(mapsState.map?.options.mapId).toBe("env-supplied-map-id");
    } finally {
      delete (
        import.meta.env as unknown as Record<string, string | undefined>
      ).VITE_GOOGLE_MAPS_MAP_ID;
    }
  });

  it("falls back to DEMO_MAP_ID when neither prop nor env var is set so AdvancedMarkerElement still renders", async () => {
    // Sanity-check that no leaked env value influences this test.
    delete (
      import.meta.env as unknown as Record<string, string | undefined>
    ).VITE_GOOGLE_MAPS_MAP_ID;
    await act(async () => {
      root = createRoot(container);
      root.render(
        <PortfolioMap
          properties={[makeProperty()]}
          onPinClick={vi.fn()}
          apiKey="test-key"
        />,
      );
    });
    await settle();
    expect(mapsState.map?.options.mapId).toBe("DEMO_MAP_ID");
  });

  it("ignores a whitespace-only env value and falls back to DEMO_MAP_ID rather than silently breaking the map", async () => {
    (
      import.meta.env as unknown as Record<string, string | undefined>
    ).VITE_GOOGLE_MAPS_MAP_ID = "   ";
    try {
      await act(async () => {
        root = createRoot(container);
        root.render(
          <PortfolioMap
            properties={[makeProperty()]}
            onPinClick={vi.fn()}
            apiKey="test-key"
          />,
        );
      });
      await settle();
      expect(mapsState.map?.options.mapId).toBe("DEMO_MAP_ID");
    } finally {
      delete (
        import.meta.env as unknown as Record<string, string | undefined>
      ).VITE_GOOGLE_MAPS_MAP_ID;
    }
  });

  it("prefers the explicit prop over the env var so tests can override per render", async () => {
    (
      import.meta.env as unknown as Record<string, string | undefined>
    ).VITE_GOOGLE_MAPS_MAP_ID = "env-id";
    try {
      await act(async () => {
        root = createRoot(container);
        root.render(
          <PortfolioMap
            properties={[makeProperty()]}
            onPinClick={vi.fn()}
            apiKey="test-key"
            mapId="prop-id"
          />,
        );
      });
      await settle();
      expect(mapsState.map?.options.mapId).toBe("prop-id");
    } finally {
      delete (
        import.meta.env as unknown as Record<string, string | undefined>
      ).VITE_GOOGLE_MAPS_MAP_ID;
    }
  });
});

describe("PortfolioMap missing-key fallback copy", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    mapsState.map = null;
    mapsState.markers = [];
    mapsState.infoWindow = null;
    mapsState.pendingGeocodes = [];
    // No fake Google Maps install — the fallback branch must render
    // before the loader is even consulted, so no SDK shim is needed.
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
    __resetPortfolioMapCachesForTest();
  });

  // Pinning the wording of the missing-key fallback so a future
  // refactor can't reintroduce the retired build-time env var
  // (`VITE_GOOGLE_MAPS_API_KEY`). The Google Maps key now lives on
  // the api-server (`GOOGLE_MAPS_API_KEY`) and is fetched by the
  // property-detail Location card via `/api/config`; rotating the
  // old VITE_-prefixed var no longer does anything, so naming it in
  // the operator-facing fallback would send them on a wild goose
  // chase.
  it("tells operators to set GOOGLE_MAPS_API_KEY on the api-server (and never the retired VITE_ build-time var)", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <PortfolioMap
          properties={[
            {
              id: "p1",
              name: "Maple",
              address: "123 Main St",
              city: "Austin",
              state: "TX",
              zip: "78701",
            },
          ]}
          onPinClick={vi.fn()}
          apiKey=""
        />,
      );
    });

    const fallback = container.querySelector(
      '[data-testid="portfolio-map-fallback"]',
    );
    expect(fallback).not.toBeNull();

    const text = fallback!.textContent ?? "";
    // Points operators at the right knob: the server-side env var on
    // the api-server, matching the property-detail Location card.
    expect(text).toContain("GOOGLE_MAPS_API_KEY");
    expect(text.toLowerCase()).toContain("api-server");
    // And explicitly does NOT name the retired build-time var.
    expect(text).not.toContain("VITE_GOOGLE_MAPS_API_KEY");
  });
});

