import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// These tests pin down the Properties page's "Map view" toggle:
//   • flipping between Table and Map swaps which surface is rendered;
//   • the map view honors the same upstream filter (we mount with a
//     status filter and confirm only matching properties reach the map);
//   • properties that have NO address never get silently dropped — they
//     show up in the side panel instead so the operator can fix them.
//
// We mock PortfolioMap to a passthrough that records the props it was
// rendered with, so the tests stay deterministic and never have to
// stand up Google Maps inside jsdom.

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

// The Properties page now reads `/api/config` (Google Maps API key)
// for its rollup Retry button. The data-store is mocked, so there's no
// other react-query consumer in this file — mocking the runtime-config
// hook lets us skip standing up a `QueryClientProvider` while the page
// still gets a non-empty key shape on first render.
vi.mock("@workspace/api-client-react", () => ({
  useGetRuntimeConfig: () => ({
    data: {
      googleMapsApiKey: "test-key",
      googleMapsMapId: "test-map-id",
    },
    isPending: false,
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
    status: "success",
    fetchStatus: "idle",
  }),
  getGetRuntimeConfigQueryKey: () => ["/api/config"] as const,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: Pass,
    DialogTrigger: Pass,
    DialogContent: () => null,
    DialogHeader: Pass,
    DialogTitle: Pass,
    DialogDescription: Pass,
    DialogFooter: Pass,
    DialogClose: Pass,
    DialogPortal: Pass,
    DialogOverlay: () => null,
  };
});

vi.mock("@/components/ui/hover-card", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    HoverCard: Pass,
    HoverCardTrigger: Pass,
    HoverCardContent: () => null,
  };
});

vi.mock("@/components/ui/dropdown-menu", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: () => null,
    DropdownMenuItem: Pass,
    DropdownMenuLabel: Pass,
    DropdownMenuSeparator: Pass,
  };
});

// Mirror the Select mock used by the sibling properties.test.tsx so the
// toolbar renders. Each SelectItem becomes a span — the tests below do
// not need to interact with the Select dropdowns.
vi.mock("@/components/ui/select", () => {
  function collectItems(
    node: unknown,
    out: Array<{ value: string; label: string }>,
  ) {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach((c) => collectItems(c, out));
      return;
    }
    if (typeof node === "object" && isValidElement(node)) {
      const props = (node as { props: Record<string, unknown> }).props ?? {};
      const v = props.value;
      const ch = props.children;
      if (typeof v === "string" && (typeof ch === "string" || typeof ch === "number")) {
        out.push({ value: v, label: String(ch) });
      }
      if ("children" in props) collectItems(ch, out);
    }
  }
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  function Select({
    value,
    children,
  }: {
    value: string;
    onValueChange?: (v: string) => void;
    children?: ReactNode;
  }) {
    const items: Array<{ value: string; label: string }> = [];
    collectItems(children, items);
    return (
      <div data-current={value}>
        {items.map((it) => (
          <span key={it.value} data-item-value={it.value}>{it.label}</span>
        ))}
      </div>
    );
  }
  const Item = ({ value, children }: { value: string; children?: ReactNode }) => (
    <span data-value={value}>{children}</span>
  );
  return {
    Select,
    SelectContent: Pass,
    SelectGroup: Pass,
    SelectItem: Item,
    SelectLabel: Pass,
    SelectScrollDownButton: Pass,
    SelectScrollUpButton: Pass,
    SelectSeparator: Pass,
    SelectTrigger: Pass,
    SelectValue: Pass,
  };
});

// Capture every render of PortfolioMap so each test can assert on the
// exact `properties` array that was handed to the map. Using a module
// variable (vs vi.fn) keeps the assertions simple — we just look at the
// most recent call. We also expose the most recent `onUnmappableChange`
// callback so tests can simulate a geocode failure being reported back
// from the SDK without standing up the real Google Maps loader.
const portfolioMapCalls: Array<{
  ids: string[];
  names: string[];
  coords: Array<{ id: string; lat: number | null; lng: number | null }>;
}> = [];
let lastUnmappableHandler:
  | ((ids: string[]) => void)
  | undefined;
let lastGeocodedHandler:
  | ((id: string, coords: { lat: number; lng: number }) => void)
  | undefined;

vi.mock("@/components/portfolio-map", () => ({
  PortfolioMap: ({
    properties,
    onUnmappableChange,
    onGeocoded,
  }: {
    properties: Array<{ id: string; name: string; lat?: number | null; lng?: number | null }>;
    onPinClick: (id: string) => void;
    onUnmappableChange?: (ids: string[]) => void;
    onGeocoded?: (id: string, coords: { lat: number; lng: number }) => void;
  }) => {
    portfolioMapCalls.push({
      ids: properties.map((p) => p.id),
      names: properties.map((p) => p.name),
      coords: properties.map((p) => ({
        id: p.id,
        lat: p.lat ?? null,
        lng: p.lng ?? null,
      })),
    });
    lastUnmappableHandler = onUnmappableChange;
    lastGeocodedHandler = onGeocoded;
    return (
      <div data-testid="portfolio-map-stub" data-pin-count={properties.length} />
    );
  },
}));

type State = {
  customers: Array<Record<string, unknown>>;
  properties: Array<Record<string, unknown>>;
  beds: Array<Record<string, unknown>>;
  leases: Array<Record<string, unknown>>;
  rooms: Array<Record<string, unknown>>;
};

function baseProperty(over: Record<string, unknown>): Record<string, unknown> {
  return {
    address: "123 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    totalBeds: 0,
    monthlyRent: 0,
    chargePerBed: 0,
    status: "Active",
    landlordName: "",
    landlordEmail: "",
    landlordPhone: "",
    paymentMethod: "ACH",
    paymentRecipient: "",
    paymentDueDay: 1,
    paymentNotes: "",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes: "",
    furnishings: [],
    ratings: undefined,
    ...over,
  };
}

// Four properties chosen to exercise every branch of the map view at
// once:
//   p1 → fully-addressed, Active   → goes to the map
//   p2 → fully-addressed, Inactive → filtered out by the status select
//   p3 → blank address, Active     → goes to the missing-address panel
//   p4 → whitespace-only address   → also goes to the missing-address
//                                    panel (defends against a regression
//                                    that .length-checked instead of
//                                    trimming).
function makeFreshState(): State {
  return {
    customers: [
      { id: "c1", name: "Acme Co", contactName: "", email: "", phone: "", notes: "" },
    ],
    properties: [
      baseProperty({ id: "p1", customerId: "c1", name: "Maple" }),
      baseProperty({
        id: "p2",
        customerId: "c1",
        name: "Oak",
        status: "Inactive",
      }),
      baseProperty({
        id: "p3",
        customerId: "c1",
        name: "Pine",
        address: "",
        city: "",
        state: "",
        zip: "",
      }),
      baseProperty({
        id: "p4",
        customerId: "c1",
        name: "Birch",
        address: "   ",
        city: " ",
        state: "",
        zip: "  ",
      }),
    ],
    beds: [],
    leases: [],
    rooms: [],
  };
}

let state: State = makeFreshState();

const storeMocks = {
  addProperty: vi.fn(),
  addCustomer: vi.fn(),
  updateProperty: vi.fn(),
};

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    ...state,
    isLoading: false,
    ...storeMocks,
  }),
}));

import Properties from "./properties";
import { CustomerScopeProvider } from "@/context/customer-scope";

function PropertiesUnderTest() {
  return (
    <CustomerScopeProvider>
      <Properties />
    </CustomerScopeProvider>
  );
}

describe("Properties page — Map view", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeFreshState();
    portfolioMapCalls.length = 0;
    lastUnmappableHandler = undefined;
    Object.values(storeMocks).forEach((m) => m.mockReset());
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/properties");
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
  });

  async function renderPage() {
    await act(async () => {
      root = createRoot(container);
      root.render(<PropertiesUnderTest />);
    });
  }

  function get(testId: string): HTMLElement | null {
    return container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  }

  async function click(el: HTMLElement) {
    await act(async () => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("defaults to the table view and hides the map surface", async () => {
    // Default load must NOT mount the map — table view is the
    // historical behavior and the existing properties.test.tsx suite
    // depends on it being on by default.
    await renderPage();
    expect(get("portfolio-map-stub")).toBeNull();
    expect(get("properties-map-view")).toBeNull();
    // The table is rendered (rows for every property show up).
    expect(container.querySelector("thead th")).not.toBeNull();
  });

  it("swaps to the map view and back when the toggle is clicked", async () => {
    await renderPage();
    const mapBtn = get("button-view-map");
    expect(mapBtn).not.toBeNull();
    await click(mapBtn!);

    // Map surface present, table gone.
    expect(get("properties-map-view")).not.toBeNull();
    expect(get("portfolio-map-stub")).not.toBeNull();
    expect(container.querySelector("thead th")).toBeNull();

    // Click back: table returns, map disappears. The toggle has to
    // round-trip cleanly, otherwise the operator gets stuck on one view.
    const tableBtn = get("button-view-table");
    expect(tableBtn).not.toBeNull();
    await click(tableBtn!);
    expect(get("portfolio-map-stub")).toBeNull();
    expect(get("properties-map-view")).toBeNull();
    expect(container.querySelector("thead th")).not.toBeNull();
  });

  it("only sends mappable (non-blank-address) properties to the map", async () => {
    // p1 has a real address. p3 (blank) and p4 (whitespace-only) must
    // NOT be rendered as pins — they belong in the side panel. p2 is
    // Inactive but with no status filter applied yet, so it DOES make
    // it to the map.
    await renderPage();
    await click(get("button-view-map")!);

    // Most recent render's pin set:
    const last = portfolioMapCalls.at(-1);
    expect(last).toBeDefined();
    expect(last!.ids.sort()).toEqual(["p1", "p2"]);
    // p3 and p4 must NOT appear as pins.
    expect(last!.ids).not.toContain("p3");
    expect(last!.ids).not.toContain("p4");
  });

  it("lists every blank-address property in the side panel with its customer", async () => {
    await renderPage();
    await click(get("button-view-map")!);

    const panel = get("properties-without-address-panel");
    expect(panel).not.toBeNull();

    // Both p3 (truly blank) and p4 (whitespace-only) show up.
    expect(get("property-without-address-p3")).not.toBeNull();
    expect(get("property-without-address-p4")).not.toBeNull();
    // Properties that DO have an address must NOT appear here.
    expect(get("property-without-address-p1")).toBeNull();
    expect(get("property-without-address-p2")).toBeNull();

    // Count badge tracks the panel contents.
    const count = get("properties-without-address-count");
    expect(count?.textContent).toBe("2");

    // Customer name is rendered in each side-panel row so the operator
    // can tell which portfolio is missing the address.
    expect(panel!.textContent).toContain("Acme Co");
    expect(panel!.textContent).toContain("Pine");
    expect(panel!.textContent).toContain("Birch");
    // Negative control: Maple (p1) has an address and must NOT leak
    // into the missing-address panel.
    expect(panel!.textContent).not.toContain("Maple");
  });

  it("re-renders the map with fewer pins when the upstream search filter narrows the set", async () => {
    // Start in map view, then narrow with the search input. The map
    // must respect the same `filtered` array the table does — otherwise
    // operators would see a stale, fuller portfolio on the map.
    await renderPage();
    await click(get("button-view-map")!);

    const before = portfolioMapCalls.at(-1)!;
    expect(before.ids.sort()).toEqual(["p1", "p2"]);

    const search = container.querySelector(
      '[data-testid="input-search-properties"]',
    ) as HTMLInputElement;
    expect(search).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(search, "Maple");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const after = portfolioMapCalls.at(-1)!;
    // After the search narrows to "Maple", only p1 should remain on
    // the map. p2 ("Oak") is dropped, and p3/p4 stay out (no address).
    expect(after.ids).toEqual(["p1"]);
  });

  it("persists the chosen view between mounts via localStorage", async () => {
    // Operator picks the map view, navigates away, comes back. The
    // persisted toolbar pref must restore the map view automatically —
    // otherwise the toggle would reset on every navigation and the
    // feature would feel broken.
    await renderPage();
    await click(get("button-view-map")!);
    expect(get("portfolio-map-stub")).not.toBeNull();

    // Unmount and remount on the same /properties path.
    if (root) {
      const r = root;
      await act(async () => {
        r.unmount();
      });
      root = null;
    }
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    await renderPage();

    // Map view restored from localStorage.
    expect(get("portfolio-map-stub")).not.toBeNull();
    expect(get("properties-map-view")).not.toBeNull();
  });

  it("moves geocode failures from the map into the side panel when reported back", async () => {
    // Simulates the SDK telling us "I couldn't find a real lat/lng for
    // p1's address". Even though p1 has a non-blank address, it must
    // not silently disappear — it has to surface in the missing-address
    // panel so the operator can fix the typo.
    await renderPage();
    await click(get("button-view-map")!);

    // Sanity: p1 starts as a pin, not in the side panel.
    expect(portfolioMapCalls.at(-1)!.ids.sort()).toEqual(["p1", "p2"]);
    expect(get("property-without-address-p1")).toBeNull();

    // The map's onUnmappableChange wiring is captured by the stub.
    expect(lastUnmappableHandler).toBeDefined();
    await act(async () => {
      lastUnmappableHandler!(["p1"]);
    });

    // After the failure is reported, p1 surfaces in the side panel
    // alongside the genuinely-blank rows. The map itself still receives
    // p1 in its props by design — the PortfolioMap owns the
    // "address-but-no-pin" state internally so it can keep a single
    // source of truth for which addresses have been attempted, and so
    // it doesn't have to re-geocode if the parent later removes p1
    // from its unmappable set.
    expect(get("property-without-address-p1")).not.toBeNull();
    expect(get("properties-without-address-count")?.textContent).toBe("3");
  });

  it("forwards stored lat/lng to the map and persists fresh geocodes via updateProperty", async () => {
    // p1 already has a stored lat/lng — those must reach the map verbatim
    // so the first paint is instant. p2 has no stored coords; when the map
    // reports a fresh geocode for it, the page should write the coordinates
    // back via updateProperty so the next visit is also instant.
    state = {
      ...makeFreshState(),
      properties: [
        baseProperty({
          id: "p1",
          customerId: "c1",
          name: "Maple",
          lat: 30.2672,
          lng: -97.7431,
        }),
        baseProperty({
          id: "p2",
          customerId: "c1",
          name: "Oak",
        }),
      ],
    };
    await renderPage();
    await click(get("button-view-map")!);

    const last = portfolioMapCalls.at(-1)!;
    const p1Coords = last.coords.find((c) => c.id === "p1");
    const p2Coords = last.coords.find((c) => c.id === "p2");
    expect(p1Coords).toEqual({ id: "p1", lat: 30.2672, lng: -97.7431 });
    expect(p2Coords).toEqual({ id: "p2", lat: null, lng: null });

    // The map calls back with a fresh geocode result for p2.
    expect(lastGeocodedHandler).toBeDefined();
    await act(async () => {
      lastGeocodedHandler!("p2", { lat: 32.7767, lng: -96.797 });
    });

    // Page persists the result so the next visit can skip the round-trip.
    expect(storeMocks.updateProperty).toHaveBeenCalledWith("p2", {
      lat: 32.7767,
      lng: -96.797,
    });
  });

  it("shows an empty state when no properties match the filters at all", async () => {
    // Wipe the property list so both halves are empty. The map view
    // must render its own empty state instead of an awkward blank map
    // canvas with an empty side panel.
    state = {
      ...makeFreshState(),
      properties: [],
    };
    await renderPage();
    await click(get("button-view-map")!);

    expect(get("empty-map-view")).not.toBeNull();
    expect(get("portfolio-map-stub")).toBeNull();
    // The side panel still exists (it's part of the layout) but its
    // own empty-state copy renders inside it.
    expect(get("properties-without-address-empty")).not.toBeNull();
  });
});
