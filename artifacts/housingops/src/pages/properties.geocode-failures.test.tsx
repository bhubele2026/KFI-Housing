import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// These tests pin down the Properties page's "addresses Google can't
// pinpoint" rollup panel. The panel must:
//   • appear above the toolbar/table whenever the shared in-session
//     geocode cache contains *any* failure that matches a property's
//     current address;
//   • stay visible regardless of view mode (table OR map) so an
//     operator who never opens the map view still sees what needs
//     fixing;
//   • update LIVE as new failures land — the rollup is driven by the
//     real `useGeocodeFailures` hook subscribing to the real cache, so
//     a per-property Location card on a sibling page reporting a
//     failure into the cache must surface here on the next render;
//   • disappear automatically when the failing address is edited (the
//     cache is keyed by address string, so a different address misses
//     the failure entry and the property drops out of the rollup);
//   • route the operator into the property's detail page on click so
//     they can fix the address there.
//
// We use the REAL `@/lib/google-maps-sdk` module — no SDK mock — and
// drive the cache via `primeGeocodeCache(addr, null)` so we don't have
// to stand up Google Maps. PortfolioMap is mocked to a stub since the
// rollup is independent of how the failures got into the cache.

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

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

// Mirror the Select mock used by the sibling properties.test.tsx so
// the toolbar renders. The rollup tests don't interact with these.
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

// PortfolioMap is mocked to a passthrough stub — the rollup panel is
// independent of how failures land in the cache, and the test drives
// failures directly via primeGeocodeCache below.
vi.mock("@/components/portfolio-map", () => ({
  PortfolioMap: () => <div data-testid="portfolio-map-stub" />,
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

function makeFreshState(): State {
  return {
    customers: [
      { id: "c1", name: "Acme Co", contactName: "", email: "", phone: "", notes: "" },
      { id: "c2", name: "Beta Ltd", contactName: "", email: "", phone: "", notes: "" },
    ],
    properties: [
      // Rejectable address used to seed the cache as a failure.
      baseProperty({
        id: "p1",
        customerId: "c1",
        name: "Maple",
        address: "999 Nonexistent Way",
        city: "Nowhere",
        state: "ZZ",
        zip: "00000",
      }),
      // Healthy address — never a failure, must NOT appear in rollup.
      baseProperty({
        id: "p2",
        customerId: "c1",
        name: "Oak",
      }),
      // Second rejectable address belonging to a different customer.
      baseProperty({
        id: "p3",
        customerId: "c2",
        name: "Pine",
        address: "12 Bad Lane",
        city: "Errortown",
        state: "XY",
        zip: "11111",
      }),
      // Blank-address property — has nothing for Google to reject in
      // the first place, so it must NOT show up in the rollup even
      // though the toolbar's missing-address side panel would list it.
      baseProperty({
        id: "p4",
        customerId: "c1",
        name: "Birch",
        address: "",
        city: "",
        state: "",
        zip: "",
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
import {
  __resetGoogleMapsSdkForTest,
  formatGeocodeAddress,
  primeGeocodeCache,
} from "@/lib/google-maps-sdk";

function PropertiesUnderTest() {
  return (
    <CustomerScopeProvider>
      <Properties />
    </CustomerScopeProvider>
  );
}

describe("Properties page — addresses Google can't pinpoint rollup", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeFreshState();
    Object.values(storeMocks).forEach((m) => m.mockReset());
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/properties");
    // Reset the shared module-level cache so a previous test's
    // failures don't leak into this one. Listeners are React-driven
    // and torn down at unmount, so we don't touch them.
    __resetGoogleMapsSdkForTest();
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
    __resetGoogleMapsSdkForTest();
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

  function addrFor(propertyIdx: number): string {
    const p = state.properties[propertyIdx] as {
      address: string;
      city: string;
      state: string;
      zip: string;
    };
    return formatGeocodeAddress(p);
  }

  it("hides the rollup when the cache has no failures", async () => {
    // Healthy session: cache is empty, no panel should be rendered.
    // Rendering an empty rollup would nag the operator about a
    // problem that doesn't exist.
    await renderPage();
    expect(get("addresses-needing-review-panel")).toBeNull();
  });

  it("renders the rollup when a failure is already cached on mount", async () => {
    // Operator visited a property-detail page earlier in the session
    // and that surface recorded a geocode failure into the shared
    // cache. The rollup must reflect that the moment Properties is
    // mounted — without a one-shot snapshot read in the hook the
    // panel would stay empty until the next push.
    primeGeocodeCache(addrFor(0), null);

    await renderPage();

    expect(get("addresses-needing-review-panel")).not.toBeNull();
    expect(get("address-needing-review-p1")).not.toBeNull();
    expect(get("addresses-needing-review-count")?.textContent).toBe("1");
    // Negative controls: healthy + blank-address rows must NOT leak
    // into the rollup.
    expect(get("address-needing-review-p2")).toBeNull();
    expect(get("address-needing-review-p4")).toBeNull();
  });

  it("grows the rollup live as new failures land in the cache", async () => {
    await renderPage();
    expect(get("addresses-needing-review-panel")).toBeNull();

    // Simulate a per-property Location card (or the portfolio map)
    // recording a failure mid-session. The page must re-render
    // through the subscription — without it, the operator would
    // have to navigate away and back to see the new entry.
    await act(async () => {
      primeGeocodeCache(addrFor(0), null);
    });

    expect(get("addresses-needing-review-panel")).not.toBeNull();
    expect(get("address-needing-review-p1")).not.toBeNull();
    expect(get("addresses-needing-review-count")?.textContent).toBe("1");

    // A second failure landing later must extend the existing list,
    // not replace it.
    await act(async () => {
      primeGeocodeCache(addrFor(2), null);
    });

    expect(get("address-needing-review-p1")).not.toBeNull();
    expect(get("address-needing-review-p3")).not.toBeNull();
    expect(get("addresses-needing-review-count")?.textContent).toBe("2");
  });

  it("shows the property's customer alongside each rejected address", async () => {
    // Operators triage by portfolio — surfacing the customer name on
    // each row lets them spot which client owns the bad address
    // without having to click into it first.
    primeGeocodeCache(addrFor(0), null);
    primeGeocodeCache(addrFor(2), null);

    await renderPage();

    const panel = get("addresses-needing-review-panel");
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("Maple");
    expect(panel!.textContent).toContain("Acme Co");
    expect(panel!.textContent).toContain("Pine");
    expect(panel!.textContent).toContain("Beta Ltd");
    // The full address Google rejected should be visible too — it's
    // what the operator needs to recognize the typo.
    expect(panel!.textContent).toContain("999 Nonexistent Way");
  });

  it("stays visible after switching from map view to table view", async () => {
    // Failures observed via the map view are page-scoped today (the
    // map's local `unmappableIds` state resets on view-mode change).
    // The cache-driven rollup must not be subject to that reset —
    // failures persist for the operator's whole session.
    primeGeocodeCache(addrFor(0), null);

    await renderPage();
    expect(get("addresses-needing-review-panel")).not.toBeNull();

    // Toggle into the map view and back.
    await act(async () => {
      get("button-view-map")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(get("addresses-needing-review-panel")).not.toBeNull();
    await act(async () => {
      get("button-view-table")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(get("addresses-needing-review-panel")).not.toBeNull();
    expect(get("address-needing-review-p1")).not.toBeNull();
  });

  it("drops a property from the rollup when its address is edited away from the failure", async () => {
    // Edit the address so the cache key (formatted full address)
    // changes — the new address has no cache entry, so the rollup
    // must drop the property automatically. Without the
    // address-keyed lookup the row would remain stuck even after the
    // operator's fix.
    primeGeocodeCache(addrFor(0), null);

    await renderPage();
    expect(get("address-needing-review-p1")).not.toBeNull();

    // Mutate the property's address to a fresh string the cache
    // doesn't know about, then re-render by changing the data-store
    // identity. This mirrors what `updateProperty` would do
    // upstream.
    state = {
      ...state,
      properties: state.properties.map((p) =>
        (p as { id: string }).id === "p1"
          ? { ...(p as Record<string, unknown>), address: "1 New Street" }
          : p,
      ),
    };
    // Force a re-render by toggling something cheap in the URL.
    await act(async () => {
      window.history.replaceState({}, "", "/properties?refresh=1");
      // Drive a state change on the page — toggle map view back and
      // forth so React commits a fresh render that re-reads the
      // store.
      get("button-view-map")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await act(async () => {
      get("button-view-table")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(get("address-needing-review-p1")).toBeNull();
    expect(get("addresses-needing-review-panel")).toBeNull();
  });

  it("navigates into the property detail page when a row is clicked", async () => {
    primeGeocodeCache(addrFor(0), null);

    await renderPage();
    const row = get("address-needing-review-p1");
    expect(row).not.toBeNull();

    await act(async () => {
      row!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(window.location.pathname).toBe("/properties/p1");
  });
});
