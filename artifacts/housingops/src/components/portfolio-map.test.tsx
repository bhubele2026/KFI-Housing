import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PortfolioMap, type MappableProperty } from "./portfolio-map";

// These tests pin down the pin info-bubble behavior added to the
// portfolio map:
//   • hovering or clicking a pin opens the bubble with the property's
//     name, customer, and bed counts;
//   • the "View details" link is what now drives navigation — clicking
//     the pin itself no longer jumps the operator off the page;
//   • Escape closes an open bubble;
//   • only one bubble is open at a time even after switching pins.
//
// The Google Maps SDK is faked at window.google so jsdom never has to
// load the real script. The fake records the listeners each marker
// registered so the tests can drive marker mouseover/click directly,
// and exposes the InfoWindow's most recent content node + open/close
// calls so the tests can read its rendered contents.

interface FakeMarker {
  position: { lat: number; lng: number };
  title?: string;
  listeners: Map<string, Array<() => void>>;
  setMap: (m: unknown | null) => void;
  addListener: (event: string, cb: () => void) => void;
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
}

const mapsState: {
  map: FakeMap | null;
  markers: FakeMarker[];
  infoWindow: FakeInfoWindowState | null;
  lastGeocodeRequest: string | null;
} = {
  map: null,
  markers: [],
  infoWindow: null,
  lastGeocodeRequest: null,
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
  // Cached "Austin, TX" coordinates so geocoding completes synchronously
  // — every test below uses this same address pair.
  const POINT = { lat: 30.2672, lng: -97.7431 };

  class FakeMap {
    listeners = new Map<string, Array<() => void>>();
    constructor() {
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
  class FakeMarker {
    position: { lat: number; lng: number };
    title?: string;
    listeners = new Map<string, Array<() => void>>();
    constructor(opts: {
      position: { lat: number; lng: number };
      title?: string;
    }) {
      this.position = opts.position;
      this.title = opts.title;
      mapsState.markers.push(this as unknown as FakeMarker);
    }
    setMap() {}
    addListener(event: string, cb: () => void) {
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
    geocode(
      req: { address: string },
      cb: (
        results: Array<{ geometry: { location: { lat: () => number; lng: () => number } } }>,
        status: string,
      ) => void,
    ) {
      mapsState.lastGeocodeRequest = req.address;
      cb(
        [
          {
            geometry: {
              location: { lat: () => POINT.lat, lng: () => POINT.lng },
            },
          },
        ],
        "OK",
      );
    }
  }
  class FakeBounds {
    extend() {}
    getCenter() {
      return { lat: () => POINT.lat, lng: () => POINT.lng };
    }
  }
  (window as unknown as { google: unknown }).google = {
    maps: {
      Map: FakeMap,
      Marker: FakeMarker,
      Geocoder: FakeGeocoder,
      LatLngBounds: FakeBounds,
      InfoWindow: FakeInfoWindow,
    },
  };
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
    mapsState.lastGeocodeRequest = null;
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
    delete (window as unknown as { google?: unknown }).google;
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
    // Flush the SDK-loaded → geocode → marker render chain. A single
    // microtask flush isn't enough because loadMapsApi resolves a
    // pre-resolved promise that re-enters React state on the next tick.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return { onPinClick };
  }

  it("does not navigate when the pin itself is clicked — opens the bubble instead", async () => {
    // The whole point of the bubble: scanning the map shouldn't yank
    // the operator off the page on every click. onPinClick must stay
    // unfired until they explicitly hit "View details".
    const { onPinClick } = await renderMap();
    expect(mapsState.markers).toHaveLength(1);
    const marker = mapsState.markers[0];

    await act(async () => {
      fireMarkerEvent(marker, "click");
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
    // Bed counts: total / occupied / vacant — same numbers the table
    // cells show. If the table's counting logic ever changes, these
    // assertions will catch the drift because both views read from the
    // same upstream `bedStatsByPropertyId` map.
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
      fireMarkerEvent(marker, "click");
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
    // The acceptance criterion calls out "clicking elsewhere closes the
    // bubble" alongside Escape. We wire an explicit map click listener
    // (rather than relying on Google's built-in close behavior) so this
    // path is testable and stable across SDK versions.
    await renderMap();
    const marker = mapsState.markers[0];
    await act(async () => {
      fireMarkerEvent(marker, "click");
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
      fireMarkerEvent(marker, "click");
    });
    expect(mapsState.infoWindow?.isOpen).toBe(true);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(mapsState.infoWindow?.isOpen).toBe(false);
    expect(mapsState.infoWindow?.closeCount).toBeGreaterThanOrEqual(1);
  });

  it("re-uses a single InfoWindow when the operator switches between pins", async () => {
    // Two pins → one InfoWindow shared between them. Otherwise a stale
    // bubble would linger over the previous pin while a fresh one
    // popped over the new one, leaving two open at once.
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
      fireMarkerEvent(m1, "click");
    });
    await act(async () => {
      fireMarkerEvent(m2, "click");
    });

    // open() called twice (once per pin) but on the same InfoWindow
    // instance — anchored to the most recently clicked marker.
    expect(mapsState.infoWindow?.openCount).toBe(2);
    expect(mapsState.infoWindow?.lastAnchor).toBe(m2);
    expect(
      (mapsState.infoWindow?.content as HTMLElement | null)?.textContent,
    ).toContain("Oak Apartments");
  });

  it("uses the latest onPinClick callback after the parent re-renders", async () => {
    // Defends the ref-trick that decouples the imperative bubble from
    // React's closure capture. Without it, clicking "View details"
    // after a re-render would still fire the original callback.
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
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
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

    const marker = mapsState.markers[0];
    await act(async () => {
      fireMarkerEvent(marker, "click");
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
    // Lightweight callers (e.g. preview-only embeds) shouldn't be
    // forced to thread bed data through. The bubble degrades to just
    // name + customer + View details rather than rendering "undefined".
    const minimal: MappableProperty = {
      id: "px",
      name: "Tiny",
      address: "1 Way",
      city: "Austin",
      state: "TX",
      zip: "78701",
      // intentionally no totalBeds/occupied/vacant
    };
    await renderMap({ properties: [minimal] });
    const marker = mapsState.markers[0];
    await act(async () => {
      fireMarkerEvent(marker, "click");
    });
    const content = mapsState.infoWindow?.content as HTMLElement | null;
    expect(content!.textContent).toContain("Tiny");
    expect(content!.textContent).not.toContain("undefined");
    expect(
      content!.querySelector('[data-testid="portfolio-map-info-total-px"]'),
    ).toBeNull();
  });
});
