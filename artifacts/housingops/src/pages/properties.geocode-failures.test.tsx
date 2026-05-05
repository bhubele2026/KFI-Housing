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

// Hoisted toast spy — shared across all `useToast()` consumers in this
// test file so the Retry tests can assert on the user-facing
// "still couldn't pinpoint" / "retry failed" / "key isn't loaded yet"
// toasts that the page surfaces from `handleRetryAddress`. Each
// `useToast()` call returning a fresh `vi.fn()` (the prior shape) made
// those assertions impossible.
const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

// Mirror the property-detail location-map test: mock the runtime-config
// hook so the page's `useRuntimeConfigQuery` resolves synchronously to
// a non-empty key without us having to mount a `QueryClientProvider`
// (the data-store is mocked too, so there's no other react-query
// consumer to satisfy). The Retry button needs a key to call
// `loadMapsApi` — the "no key" branch is exercised by its own test
// below via `runtimeConfigMock.mockReturnValueOnce(...)`.
// Narrow shape covering only the fields the page reads off
// `useGetRuntimeConfig()` (just `data`, in `properties.tsx`'s
// `mapsApiKey` derivation), plus the react-query status fields kept
// on the object for parity with real behavior. All fields are
// optional so individual tests can swap in a "still loading" /
// "errored" shape via `mockImplementation` without each call site
// having to spell out the entire discriminated-union return type of
// `UseQueryResult`.
type RuntimeConfigMockReturn = {
  data?: { googleMapsApiKey: string; googleMapsMapId: string };
  isPending?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  isSuccess?: boolean;
  error?: unknown;
  status?: string;
  fetchStatus?: string;
};
const runtimeConfigMock = vi.fn<() => RuntimeConfigMockReturn>(() => ({
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
}));
vi.mock("@workspace/api-client-react", () => ({
  useGetRuntimeConfig: (...args: unknown[]) => runtimeConfigMock(...(args as [])),
  getGetRuntimeConfigQueryKey: () => ["/api/config"] as const,
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
  __FAILURE_STORAGE_KEY_FOR_TEST,
  __hydrateGeocodeFailuresFromStorageForTest,
  __resetGoogleMapsSdkForTest,
  clearGeocodeFailures,
  dismissGeocodeFailure,
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
    toastMock.mockReset();
    runtimeConfigMock.mockReset();
    runtimeConfigMock.mockImplementation(() => ({
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
    }));
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/properties");
    // Reset the shared module-level cache so a previous test's
    // failures don't leak into this one. Listeners are React-driven
    // and torn down at unmount, so we don't touch them.
    __resetGoogleMapsSdkForTest();
    // Clean any lingering Maps SDK globals planted by a prior Retry
    // test so `loadMapsApi` re-evaluates against the current test's
    // setup. Done in `beforeEach` (rather than `afterEach`) so the
    // Retry tests can plant their own globals locally without us
    // wiping them out before assertions complete.
    delete (window as { google?: unknown }).google;
    delete window.__housingopsMapsLoader;
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
    delete (window as { google?: unknown }).google;
    delete window.__housingopsMapsLoader;
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

  it("hides the row for the rest of the session when Dismiss is clicked", async () => {
    // Operator looked at the flagged address, decided it's actually
    // correct (rural lot, brand new build, P.O. box, etc.), and
    // wants the row to stop cluttering the panel. Clicking Dismiss
    // must drop the row immediately and, when it was the only entry,
    // tear down the panel entirely so a healthy-looking session
    // shows nothing at all.
    primeGeocodeCache(addrFor(0), null);
    primeGeocodeCache(addrFor(2), null);

    await renderPage();
    expect(get("addresses-needing-review-count")?.textContent).toBe("2");

    await act(async () => {
      get("dismiss-address-needing-review-p1")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(get("address-needing-review-p1")).toBeNull();
    expect(get("address-needing-review-p3")).not.toBeNull();
    expect(get("addresses-needing-review-count")?.textContent).toBe("1");

    await act(async () => {
      get("dismiss-address-needing-review-p3")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    // Last failure dismissed → panel disappears entirely. Without
    // re-checking the snapshot in `notifyGeocodeFailureListeners`
    // the panel would linger with a stale empty list.
    expect(get("addresses-needing-review-panel")).toBeNull();
  });

  it("does not navigate when the Dismiss button is clicked", async () => {
    // The dismiss control sits inside a row that ALSO routes to the
    // property detail page. The two affordances must not bleed into
    // each other — clicking Dismiss should suppress the row, not
    // open the property.
    primeGeocodeCache(addrFor(0), null);

    await renderPage();
    expect(window.location.pathname).toBe("/properties");

    await act(async () => {
      get("dismiss-address-needing-review-p1")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(window.location.pathname).toBe("/properties");
    expect(get("address-needing-review-p1")).toBeNull();
  });

  it("keeps a dismissed row hidden after toggling map/table view", async () => {
    // Dismissals share the geocode cache's session lifetime — they
    // must outlast view-mode toggles, which would otherwise be a
    // trivial way for the row to bounce back. The map view's local
    // `unmappableIds` resets on toggle, but the cache-driven rollup
    // must not be subject to that reset.
    primeGeocodeCache(addrFor(0), null);

    await renderPage();
    await act(async () => {
      get("dismiss-address-needing-review-p1")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(get("addresses-needing-review-panel")).toBeNull();

    await act(async () => {
      get("button-view-map")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(get("addresses-needing-review-panel")).toBeNull();

    await act(async () => {
      get("button-view-table")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(get("addresses-needing-review-panel")).toBeNull();
  });

  it("brings a dismissed row back when the same address is re-flagged", async () => {
    // "Re-flagging" simulates a future geocode attempt landing a
    // fresh `null` after the cache lost its prior entry (e.g. a
    // hard cache invalidation). The dismissal must NOT permanently
    // suppress genuinely new failures — that would silently hide
    // problems the operator hasn't seen yet.
    const addr = addrFor(0);
    primeGeocodeCache(addr, null);

    await renderPage();
    await act(async () => {
      get("dismiss-address-needing-review-p1")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(get("addresses-needing-review-panel")).toBeNull();

    // Simulate the cache losing its prior failure entry, then
    // re-recording the failure — this is the path that triggers
    // `notifyGeocodeFailureListeners` and must clear the dismissal.
    await act(async () => {
      __resetGoogleMapsSdkForTest();
    });
    // The reset wipes everything, so re-dismiss to verify the
    // dismissal of a *separate* address doesn't suppress this one,
    // then prime the failure that should resurface.
    dismissGeocodeFailure(addrFor(2));
    await act(async () => {
      primeGeocodeCache(addr, null);
    });

    expect(get("addresses-needing-review-panel")).not.toBeNull();
    expect(get("address-needing-review-p1")).not.toBeNull();
  });

  it("does not double-render when Dismiss is clicked for an already-dismissed address", async () => {
    // Defensive: a stuck click handler firing twice (or two rows
    // for the same address — possible if two properties share the
    // same canonical string) must not blow away listeners or fire
    // a second redundant snapshot. We can only observe this
    // indirectly: after two dismiss clicks the panel must still
    // be gone and re-priming must still bring the row back.
    const addr = addrFor(0);
    primeGeocodeCache(addr, null);

    await renderPage();
    await act(async () => {
      get("dismiss-address-needing-review-p1")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    // Re-dismiss directly via the SDK — the row is gone so the
    // button can't be clicked again, but a second call must be a
    // no-op rather than re-notify.
    await act(async () => {
      dismissGeocodeFailure(addr);
    });

    expect(get("addresses-needing-review-panel")).toBeNull();
  });

  // ── Persistence across page reloads ───────────────────────────────────
  //
  // Failures used to live in a module-level Map that reset on every
  // page refresh, so an operator who reloaded the tab lost the rollup
  // until some Maps surface re-issued the bad geocode (silently
  // re-hitting Google billing). The cases below pin down the
  // localStorage-backed persistence that keeps the rollup honest
  // across reloads.

  it("persists a fresh failure to localStorage so a reload can rehydrate it", async () => {
    // Recording a failure must immediately land in storage — without
    // this, a reload that happens before any other write loses the
    // entry entirely. We assert on storage directly rather than the
    // DOM here so the test fails loudly if persistence regresses
    // even when in-memory behavior still looks fine.
    primeGeocodeCache(addrFor(0), null);

    const raw = window.localStorage.getItem(__FAILURE_STORAGE_KEY_FOR_TEST);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as {
      failures: Array<{ address: string; lastCheckedAt: number }>;
      dismissed: string[];
    };
    expect(parsed.failures.map((f) => f.address)).toContain(addrFor(0));
    // The timestamp must land alongside the address so a reload can
    // render "Checked N ago" without resetting the clock to "now".
    const entry = parsed.failures.find((f) => f.address === addrFor(0));
    expect(entry).toBeDefined();
    expect(typeof entry!.lastCheckedAt).toBe("number");
    expect(entry!.lastCheckedAt).toBeGreaterThan(0);
    expect(parsed.dismissed).toEqual([]);
  });

  it("rehydrates the rollup from localStorage on a simulated page reload", async () => {
    // Simulate the prior session: prime a failure, confirm it
    // landed in storage, then wipe in-memory state to mimic a fresh
    // page load (storage survives, module caches don't).
    primeGeocodeCache(addrFor(0), null);
    const persistedRaw = window.localStorage.getItem(
      __FAILURE_STORAGE_KEY_FOR_TEST,
    );
    expect(persistedRaw).not.toBeNull();

    // Tear down in-memory state and restore the persisted blob —
    // `__resetGoogleMapsSdkForTest` clears storage too, so we put
    // the snapshot back before re-hydrating.
    __resetGoogleMapsSdkForTest();
    window.localStorage.setItem(__FAILURE_STORAGE_KEY_FOR_TEST, persistedRaw!);
    __hydrateGeocodeFailuresFromStorageForTest();

    // The rollup must show the persisted failure on first render —
    // no Maps surface needs to re-trigger the bad geocode.
    await renderPage();
    expect(get("addresses-needing-review-panel")).not.toBeNull();
    expect(get("address-needing-review-p1")).not.toBeNull();
    expect(get("addresses-needing-review-count")?.textContent).toBe("1");
  });

  it("persists a dismissal so a reload doesn't bring the dismissed row back", async () => {
    // Dismissal is the operator's "I looked at it, it's fine"
    // signal. If a refresh brought the row back, the operator would
    // have to re-dismiss every time — defeating the affordance.
    primeGeocodeCache(addrFor(0), null);
    primeGeocodeCache(addrFor(2), null);
    dismissGeocodeFailure(addrFor(0));

    const raw = window.localStorage.getItem(__FAILURE_STORAGE_KEY_FOR_TEST);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as {
      failures: Array<{ address: string; lastCheckedAt: number }>;
      dismissed: string[];
    };
    expect(parsed.failures.map((f) => f.address)).toEqual(
      expect.arrayContaining([addrFor(0), addrFor(2)]),
    );
    expect(parsed.dismissed).toEqual([addrFor(0)]);

    // Simulate a reload: tear down memory, restore storage, hydrate.
    __resetGoogleMapsSdkForTest();
    window.localStorage.setItem(__FAILURE_STORAGE_KEY_FOR_TEST, raw!);
    __hydrateGeocodeFailuresFromStorageForTest();

    await renderPage();
    // The dismissed row stays hidden after reload; the un-dismissed
    // one still shows. Without persisting the dismissal both rows
    // would render on the fresh mount.
    expect(get("address-needing-review-p1")).toBeNull();
    expect(get("address-needing-review-p3")).not.toBeNull();
    expect(get("addresses-needing-review-count")?.textContent).toBe("1");
  });

  it("removes an address from persisted failures when stored coords overwrite the failure", async () => {
    // The task spec calls this out specifically: "Successful
    // geocodes (cached coordinates) clear any prior failure entry
    // for that address so a fixed address stops alerting after the
    // next render." Without dropping the address from storage too,
    // the next reload would resurrect the failure even though it's
    // been resolved.
    const addr = addrFor(0);
    primeGeocodeCache(addr, null);
    let parsed = JSON.parse(
      window.localStorage.getItem(__FAILURE_STORAGE_KEY_FOR_TEST)!,
    ) as { failures: Array<{ address: string; lastCheckedAt: number }>; dismissed: string[] };
    expect(parsed.failures.map((f) => f.address)).toContain(addr);

    // Successful coords land for the same address — simulates a
    // per-property Location card priming the cache after the
    // operator fixed the address (or after a re-attempt resolved).
    primeGeocodeCache(addr, { lat: 30, lng: -97 });

    const after = window.localStorage.getItem(__FAILURE_STORAGE_KEY_FOR_TEST);
    if (after !== null) {
      parsed = JSON.parse(after) as {
        failures: Array<{ address: string; lastCheckedAt: number }>;
        dismissed: string[];
      };
      expect(parsed.failures.map((f) => f.address)).not.toContain(addr);
    }
    // And the rollup must drop the row immediately too — the
    // overwrite path notifies subscribers so the panel reflects the
    // fix without waiting for an unrelated re-render.
    await renderPage();
    expect(get("address-needing-review-p1")).toBeNull();
    expect(get("addresses-needing-review-panel")).toBeNull();
  });

  it("clearGeocodeFailures wipes both in-memory and persisted failures + dismissals", async () => {
    // Backs the "Reset to sample data" / "Reset demo data" flows.
    // A fresh demo take must NOT carry stale "addresses Google can't
    // pinpoint" entries from the previous session — operators
    // expect a pristine slate after reset.
    primeGeocodeCache(addrFor(0), null);
    primeGeocodeCache(addrFor(2), null);
    dismissGeocodeFailure(addrFor(0));
    expect(window.localStorage.getItem(__FAILURE_STORAGE_KEY_FOR_TEST)).not.toBeNull();

    await renderPage();
    expect(get("addresses-needing-review-panel")).not.toBeNull();

    await act(async () => {
      clearGeocodeFailures();
    });

    // Panel disappears immediately (subscribers were notified) and
    // storage is wiped so a subsequent reload doesn't resurrect the
    // failures we just cleared.
    expect(get("addresses-needing-review-panel")).toBeNull();
    expect(
      window.localStorage.getItem(__FAILURE_STORAGE_KEY_FOR_TEST),
    ).toBeNull();
  });

  it("ignores a corrupt localStorage payload instead of blocking the SDK", async () => {
    // Defensive: a malformed blob must not throw on hydration —
    // otherwise a single bad write (rare, but possible across
    // version upgrades) would brick the badge until the operator
    // manually cleared storage.
    __resetGoogleMapsSdkForTest();
    window.localStorage.setItem(
      __FAILURE_STORAGE_KEY_FOR_TEST,
      "{not valid json",
    );
    expect(() => __hydrateGeocodeFailuresFromStorageForTest()).not.toThrow();

    await renderPage();
    expect(get("addresses-needing-review-panel")).toBeNull();
  });

  // ── "Checked N ago" relative-time label ──────────────────────────────
  //
  // Each persisted failure carries a `lastCheckedAt` timestamp so the
  // rollup row can show how stale the flag is — operators need to
  // tell a five-minute-old flag from a three-week-old one to triage
  // honestly. The cases below pin down the rendering path, the
  // re-record refresh, and the persistence behavior.

  it("renders a 'Checked … ago' label for each flagged row", async () => {
    // The label must appear on every row the panel surfaces so
    // operators can prioritize fresh failures over stale ones at a
    // glance — without it, a row that's been failing for weeks looks
    // identical to one that just landed this minute.
    primeGeocodeCache(addrFor(0), null);

    await renderPage();

    const stamp = get("address-needing-review-checked-p1");
    expect(stamp).not.toBeNull();
    // We don't pin down the exact relative-time string (it'd churn
    // every minute), but it must contain the "Checked" prefix and
    // an "ago" suffix so the row's intent is unambiguous.
    expect(stamp!.textContent).toMatch(/^Checked /);
    expect(stamp!.textContent).toMatch(/ ago$/);
  });

  it("shows 'Checked … ago' that reflects an older timestamp from storage", async () => {
    // A reload should NOT reset the clock to "now" — the persisted
    // timestamp must drive the label so an operator who's been away
    // for a week sees "Checked 7 days ago", not "Checked just now".
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    __resetGoogleMapsSdkForTest();
    window.localStorage.setItem(
      __FAILURE_STORAGE_KEY_FOR_TEST,
      JSON.stringify({
        failures: [{ address: addrFor(0), lastCheckedAt: sevenDaysAgo }],
        dismissed: [],
      }),
    );
    __hydrateGeocodeFailuresFromStorageForTest();

    await renderPage();

    const stamp = get("address-needing-review-checked-p1");
    expect(stamp).not.toBeNull();
    // date-fns' formatDistanceToNow outputs "7 days ago" for ~1
    // week back. Asserting on the "days" unit (not the exact
    // number) keeps this stable against tiny clock drift between
    // computing the stamp and rendering.
    expect(stamp!.textContent).toMatch(/days? ago$/);
  });

  it("advances the timestamp when the same address is re-recorded as failing", async () => {
    // The contract: re-recording an already-failing address advances
    // the timestamp so the row reflects the most recent attempt, not
    // the first one. Without this, an address re-checked every hour
    // would show a label growing stale even though we keep
    // confirming the failure.
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    __resetGoogleMapsSdkForTest();
    window.localStorage.setItem(
      __FAILURE_STORAGE_KEY_FOR_TEST,
      JSON.stringify({
        failures: [{ address: addrFor(0), lastCheckedAt: fiveMinutesAgo }],
        dismissed: [],
      }),
    );
    __hydrateGeocodeFailuresFromStorageForTest();

    await renderPage();
    // Snapshot the persisted timestamp before re-recording.
    const beforeRaw = window.localStorage.getItem(__FAILURE_STORAGE_KEY_FOR_TEST);
    const beforeParsed = JSON.parse(beforeRaw!) as {
      failures: Array<{ address: string; lastCheckedAt: number }>;
    };
    const beforeTs = beforeParsed.failures.find(
      (f) => f.address === addrFor(0),
    )!.lastCheckedAt;
    expect(beforeTs).toBe(fiveMinutesAgo);

    // Re-record the same failure — simulates a sibling Maps surface
    // re-attempting the address and getting the same `null` back.
    await act(async () => {
      primeGeocodeCache(addrFor(0), null);
    });

    const afterRaw = window.localStorage.getItem(__FAILURE_STORAGE_KEY_FOR_TEST);
    const afterParsed = JSON.parse(afterRaw!) as {
      failures: Array<{ address: string; lastCheckedAt: number }>;
    };
    const afterTs = afterParsed.failures.find(
      (f) => f.address === addrFor(0),
    )!.lastCheckedAt;
    // The new stamp must be strictly newer than the old one — the
    // exact value depends on `Date.now()`, but it MUST move forward.
    expect(afterTs).toBeGreaterThan(beforeTs);

    // The row stays present (the failure hasn't been resolved) and
    // still carries the label — the re-record refreshes it rather
    // than clearing it.
    expect(get("address-needing-review-checked-p1")).not.toBeNull();
  });

  it("hydrates legacy string-only persisted failures into stamped entries", async () => {
    // Older builds persisted `failures: string[]` without timestamps.
    // A user upgrading mid-session must NOT crash on hydration and
    // must still see the row — we stamp legacy entries with `now` so
    // the label renders sensibly ("Checked just now") instead of
    // "Checked 56 years ago" or throwing.
    __resetGoogleMapsSdkForTest();
    window.localStorage.setItem(
      __FAILURE_STORAGE_KEY_FOR_TEST,
      JSON.stringify({
        failures: [addrFor(0)],
        dismissed: [],
      }),
    );
    __hydrateGeocodeFailuresFromStorageForTest();

    await renderPage();

    expect(get("addresses-needing-review-panel")).not.toBeNull();
    expect(get("address-needing-review-p1")).not.toBeNull();
    const stamp = get("address-needing-review-checked-p1");
    expect(stamp).not.toBeNull();
    expect(stamp!.textContent).toMatch(/^Checked /);
  });

  it("auto-refreshes the 'Checked … ago' label as time passes without any user interaction", async () => {
    // The whole point of the rollup label is to honestly show how
    // stale a flag is. Before this behavior was added, the label was
    // computed once on render — an operator who left Properties open
    // for an hour without touching it could be staring at "Checked 5
    // minutes ago" the whole time. The label MUST tick over on its
    // own so the displayed elapsed time tracks real time.
    vi.useFakeTimers();
    try {
      // Pin wall time so we can reason about exact label wording.
      // `primeGeocodeCache` stamps with `Date.now()`, so the cache
      // entry will record `start` as its `lastCheckedAt`.
      const start = new Date(2026, 0, 1, 12, 0, 0).getTime();
      vi.setSystemTime(start);
      primeGeocodeCache(addrFor(0), null);

      await renderPage();

      const stampAtStart = get("address-needing-review-checked-p1");
      expect(stampAtStart).not.toBeNull();
      // date-fns renders a fresh-ish stamp as "less than a minute
      // ago". Asserting on the unit (not the exact wording) keeps
      // this stable if date-fns ever phrases the sub-minute case
      // slightly differently across versions.
      expect(stampAtStart!.textContent).not.toMatch(/minutes ago$/);

      // Advance the clock by 5 minutes WITHOUT touching the page —
      // no new failure landing, no filter change, nothing else that
      // would force a re-render. `advanceTimersByTimeAsync` both
      // moves fake `Date.now()` forward AND fires the minute-tick
      // intervals along the way; React then flushes the resulting
      // state updates inside `act`.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      });

      const stampAfter = get("address-needing-review-checked-p1");
      expect(stampAfter).not.toBeNull();
      // The label must now reflect the elapsed 5 minutes — without
      // the auto-refresh it would still say "less than a minute
      // ago" because nothing else triggered a re-render.
      expect(stampAfter!.textContent).toMatch(/5 minutes ago$/);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Per-row Retry button ──────────────────────────────────────────────
  //
  // The rollup ships with a Retry affordance next to Dismiss so a row
  // stuck in the panel because of a one-time Google outage / network
  // blip can be re-attempted without making the operator either edit
  // a perfectly fine address or dismiss it (which would silently hide
  // a real problem if it recurred). Retry must:
  //   • bypass the cached `null` so Google actually sees a fresh
  //     request — the whole point is the previous attempt failed and
  //     we want a do-over;
  //   • drop the row on success (delegated to the existing
  //     success-overriding-failure cache write that notifies
  //     subscribers — `useGeocodeFailures` re-renders without the row);
  //   • leave the row in place + toast on a still-failing retry so the
  //     operator knows the click was honored but didn't help;
  //   • surface a loading state and disable itself while in flight so a
  //     stuck double-click never double-spends Google quota.

  type GeocoderCb = (
    results: Array<{ geometry: { location: { lat: () => number; lng: () => number } } }> | null,
    status: string,
  ) => void;

  /**
   * Plant a fake Google Maps SDK on `window` so `loadMapsApi`
   * short-circuits to its already-loaded fast path and the page's
   * `new google.maps.Geocoder()` returns whatever the test provides.
   * The fake exposes the bare surface the loader's readiness check
   * reads (`marker.AdvancedMarkerElement`) plus a Geocoder constructor
   * driven by the per-test handler.
   */
  function plantFakeMapsSdk(handler: (addr: string, cb: GeocoderCb) => void) {
    const Geocoder = function () {
      return {
        geocode(req: { address: string }, cb: GeocoderCb) {
          handler(req.address, cb);
        },
      };
    } as unknown as new () => unknown;
    (window as unknown as { google: { maps: Record<string, unknown> } }).google = {
      maps: {
        Geocoder,
        marker: { AdvancedMarkerElement: function () {} },
      },
    };
  }

  it("renders a Retry button on every row in the rollup", async () => {
    primeGeocodeCache(addrFor(0), null);
    primeGeocodeCache(addrFor(2), null);

    await renderPage();

    expect(get("retry-address-needing-review-p1")).not.toBeNull();
    expect(get("retry-address-needing-review-p3")).not.toBeNull();
    // Healthy property must NOT get a Retry button — there's no row
    // for it in the rollup in the first place.
    expect(get("retry-address-needing-review-p2")).toBeNull();
  });

  it("drops the row when the Retry succeeds (Google now returns coords)", async () => {
    // The success-overriding-failure cache write inside `runGeocode`
    // is what makes the row vanish: it removes the cached `null`,
    // updates persistence, and notifies `useGeocodeFailures`. No code
    // in `handleRetryAddress` itself touches the rollup state — so
    // this test pins down the *contract* that retry success ⇒ row gone.
    plantFakeMapsSdk((_addr, cb) => {
      cb(
        [
          {
            geometry: {
              location: { lat: () => 30, lng: () => -97 },
            },
          },
        ],
        "OK",
      );
    });
    primeGeocodeCache(addrFor(0), null);

    await renderPage();
    expect(get("address-needing-review-p1")).not.toBeNull();

    await act(async () => {
      get("retry-address-needing-review-p1")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(get("address-needing-review-p1")).toBeNull();
    expect(get("addresses-needing-review-panel")).toBeNull();
  });

  it("toasts a one-shot success confirmation when the Retry lands coords", async () => {
    // The row vanishing IS the structural confirmation, but it's
    // easy to miss for an operator who clicked Retry and then
    // scrolled or tab-switched while waiting. A success toast keeps
    // the success path as legible as the ZERO_RESULTS path (which
    // already toasts) so the click never feels like a silent no-op.
    plantFakeMapsSdk((_addr, cb) => {
      cb(
        [
          {
            geometry: {
              location: { lat: () => 30, lng: () => -97 },
            },
          },
        ],
        "OK",
      );
    });
    primeGeocodeCache(addrFor(0), null);

    await renderPage();

    await act(async () => {
      get("retry-address-needing-review-p1")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const titles = toastMock.mock.calls.map(
      (c) => (c[0] as { title?: string }).title,
    );
    expect(titles).toContain("Found it");
    // The success toast must NOT also fire the failure-branch toast —
    // that would be a contradictory pair of signals for one click.
    expect(titles).not.toContain("Still couldn't pinpoint");
    expect(titles).not.toContain("Retry failed");
    // And the success toast is informational, not destructive — it's
    // a positive confirmation, so it should never carry the
    // destructive variant the error-branch toasts use.
    const variants = toastMock.mock.calls.map(
      (c) => (c[0] as { variant?: string }).variant,
    );
    expect(variants).not.toContain("destructive");
  });

  it("keeps the row and toasts when Google still returns no result", async () => {
    // Operator clicked Retry; Google replied ZERO_RESULTS again. The
    // row must STAY (the address is still bad — silently dropping it
    // would lie about the cache state) and we must surface a toast
    // so the click isn't a silent no-op visually.
    plantFakeMapsSdk((_addr, cb) => {
      cb(null, "ZERO_RESULTS");
    });
    primeGeocodeCache(addrFor(0), null);

    await renderPage();

    await act(async () => {
      get("retry-address-needing-review-p1")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(get("address-needing-review-p1")).not.toBeNull();
    expect(toastMock).toHaveBeenCalled();
    const titles = toastMock.mock.calls.map(
      (c) => (c[0] as { title?: string }).title,
    );
    expect(titles).toContain("Still couldn't pinpoint");
    // Belt-and-suspenders for the success-toast addition: the
    // ZERO_RESULTS branch must NOT also fire the success
    // confirmation, or the operator would see contradictory toasts
    // for a single click.
    expect(titles).not.toContain("Found it");
  });

  it("toasts and leaves the row in place when the SDK fails to load", async () => {
    // No Maps globals planted → `loadMapsApi` will try to inject a
    // <script> tag, but jsdom never fires its `load` event. To force
    // a deterministic failure we instead plant a SDK shape *missing*
    // the Geocoder class so `handleRetryAddress` falls into its
    // "Geocoder unavailable" throw branch — same operator-visible
    // outcome as a network failure: a destructive toast + the row
    // stays.
    (window as unknown as { google: { maps: Record<string, unknown> } }).google = {
      maps: {
        // Intentionally no Geocoder.
        marker: { AdvancedMarkerElement: function () {} },
      },
    };
    primeGeocodeCache(addrFor(0), null);

    await renderPage();

    await act(async () => {
      get("retry-address-needing-review-p1")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(get("address-needing-review-p1")).not.toBeNull();
    const titles = toastMock.mock.calls.map(
      (c) => (c[0] as { title?: string }).title,
    );
    expect(titles).toContain("Retry failed");
  });

  it("disables the Retry button and shows a loading label while in flight", async () => {
    // Stash the geocoder callback so we can keep the request "open"
    // for the duration of the assertions and then complete it
    // explicitly. Without this, an immediately-resolving Geocoder
    // would race against the disabled-state assertion and we'd be
    // testing a render that already passed back through the finally
    // block — false-greens guaranteed.
    let pendingCb: GeocoderCb | null = null;
    plantFakeMapsSdk((_addr, cb) => {
      pendingCb = cb;
    });
    primeGeocodeCache(addrFor(0), null);

    await renderPage();
    const btn = get("retry-address-needing-review-p1") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain("Retry");

    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Mid-flight: the button is disabled (so a double-click can't
    // double-spend quota) and shows the loading copy so the operator
    // can tell the click registered.
    const inFlight = get("retry-address-needing-review-p1") as HTMLButtonElement;
    expect(inFlight.disabled).toBe(true);
    expect(inFlight.textContent).toContain("Retrying…");
    expect(inFlight.getAttribute("aria-busy")).toBe("true");

    // Complete the request with success — the row should drop, which
    // also removes the button from the DOM, confirming the in-flight
    // state was real.
    await act(async () => {
      pendingCb!(
        [
          {
            geometry: {
              location: { lat: () => 30, lng: () => -97 },
            },
          },
        ],
        "OK",
      );
    });
    expect(get("retry-address-needing-review-p1")).toBeNull();
  });

  it("ignores a second click on Retry while the first is still in flight", async () => {
    // Belt-and-suspenders alongside the `disabled` attribute: the
    // handler itself early-returns when its address is in the
    // in-flight set so a stuck keyboard "Enter" on a stale render
    // can't fire a parallel Google request.
    let geocodeCalls = 0;
    let pendingCb: GeocoderCb | null = null;
    plantFakeMapsSdk((_addr, cb) => {
      geocodeCalls += 1;
      pendingCb = cb;
    });
    primeGeocodeCache(addrFor(0), null);

    await renderPage();
    const btn = get("retry-address-needing-review-p1") as HTMLButtonElement;

    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Second click while still loading — must NOT issue a second
    // geocode request. The disabled button doesn't dispatch click in
    // a real browser, but the handler still has to defend itself
    // against the stale-render path.
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(geocodeCalls).toBe(1);

    await act(async () => {
      pendingCb!(null, "ZERO_RESULTS");
    });
  });

  it("toasts and skips the call when no Maps API key is loaded yet", async () => {
    // Edge case: rollup is visible but `/api/config` hasn't resolved
    // (or returned a null key). Clicking Retry can't do anything
    // useful, but it must NOT silently no-op — surface a toast so
    // the operator understands why and can try again in a moment.
    // Mirror the loading-but-not-yet-resolved shape: `data` is
    // undefined while react-query is still fetching. The page's
    // `mapsApiKey` derivation treats absent data the same as a null
    // key (empty string), which routes the click into the "key isn't
    // loaded yet" toast branch. Using `undefined` rather than a
    // null-keyed payload also keeps us off the runtime-config response
    // schema (which types `googleMapsApiKey` as a non-null string).
    runtimeConfigMock.mockImplementation(() => ({
      data: undefined,
      isPending: true,
      isLoading: true,
      isError: false,
      isSuccess: false,
      error: null,
      status: "pending",
      fetchStatus: "fetching",
    }));
    let geocodeCalls = 0;
    plantFakeMapsSdk((_addr, cb) => {
      geocodeCalls += 1;
      cb(null, "ZERO_RESULTS");
    });
    primeGeocodeCache(addrFor(0), null);

    await renderPage();
    await act(async () => {
      get("retry-address-needing-review-p1")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(geocodeCalls).toBe(0);
    const titles = toastMock.mock.calls.map(
      (c) => (c[0] as { title?: string }).title,
    );
    expect(titles).toContain("Couldn't retry");
    expect(get("address-needing-review-p1")).not.toBeNull();
  });

  it("does not navigate when the Retry button is clicked", async () => {
    // The Retry control sits inside a row that ALSO routes to the
    // property detail page. The two affordances must not bleed into
    // each other — clicking Retry should re-attempt the geocode, not
    // open the property.
    plantFakeMapsSdk((_addr, cb) => {
      cb(null, "ZERO_RESULTS");
    });
    primeGeocodeCache(addrFor(0), null);

    await renderPage();
    expect(window.location.pathname).toBe("/properties");

    await act(async () => {
      get("retry-address-needing-review-p1")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(window.location.pathname).toBe("/properties");
  });

  // ── "Retry all" button ────────────────────────────────────────────────
  //
  // After a Google Maps outage or a bulk-import that ran while the
  // api-server was misconfigured, the rollup can fill with dozens of
  // flagged addresses. Clicking Retry on each row one-by-one is tedious;
  // a single "Retry all" button drains the rollup in one action while
  // still respecting per-row dedupe / quota safety. The button must:
  //   • only appear when there are 2+ flagged addresses (a single row is
  //     already a one-click operation via its own per-row Retry);
  //   • iterate the snapshotted addresses sequentially through the same
  //     `handleRetryAddress` path so we never produce parallel Google
  //     requests for the same address;
  //   • disable itself + show a combined progress indicator while the
  //     run is in flight;
  //   • toast and skip the run when no Maps API key is loaded yet.

  it("hides the Retry all button when only one address is flagged", async () => {
    // Single-row case: the per-row Retry already covers it. Showing
    // both buttons for a count of 1 would be busywork and would also
    // make the panel header noisy in the common partial-recovery
    // case where only one row is left.
    primeGeocodeCache(addrFor(0), null);

    await renderPage();

    expect(get("addresses-needing-review-panel")).not.toBeNull();
    expect(get("retry-all-addresses-needing-review")).toBeNull();
  });

  it("shows the Retry all button when there are 2+ flagged addresses", async () => {
    primeGeocodeCache(addrFor(0), null);
    primeGeocodeCache(addrFor(2), null);

    await renderPage();

    const btn = get("retry-all-addresses-needing-review");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("Retry all");
  });

  it("retries every flagged address sequentially when clicked", async () => {
    // Pin down the contract that one click drains the panel: each
    // address gets exactly one Google call AND the calls happen one
    // at a time (not in parallel) so a partial-outage burst doesn't
    // hammer Google.
    let inFlight = 0;
    let maxInFlight = 0;
    const calledFor: string[] = [];
    plantFakeMapsSdk((addr, cb) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calledFor.push(addr);
      // Resolve on a microtask so the loop's `await` actually has to
      // suspend — a synchronous resolve would let the for-loop body
      // run to completion before the next iteration "starts", masking
      // a parallel implementation.
      queueMicrotask(() => {
        inFlight -= 1;
        cb(
          [
            {
              geometry: {
                location: { lat: () => 30, lng: () => -97 },
              },
            },
          ],
          "OK",
        );
      });
    });
    primeGeocodeCache(addrFor(0), null);
    primeGeocodeCache(addrFor(2), null);

    await renderPage();

    await act(async () => {
      get("retry-all-addresses-needing-review")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    // Both addresses got exactly one Google call each, and at no
    // point were two requests in flight simultaneously.
    expect(calledFor).toEqual(
      expect.arrayContaining([addrFor(0), addrFor(2)]),
    );
    expect(calledFor.length).toBe(2);
    expect(maxInFlight).toBe(1);
    // Both successes drop their rows — the panel is gone.
    expect(get("addresses-needing-review-panel")).toBeNull();
  });

  it("shows a combined progress indicator while the bulk run is in flight", async () => {
    // The button doubles as the progress indicator — "Retrying X of
    // Y…" reads off a snapshot taken at click time so the denominator
    // stays stable even as successful rows drop out of the rollup
    // mid-iteration. We hold each geocode open with a stashed callback
    // so the assertion lands while the run is genuinely in flight,
    // not after a fast resolver has already closed it out.
    const pending: GeocoderCb[] = [];
    plantFakeMapsSdk((_addr, cb) => {
      pending.push(cb);
    });
    primeGeocodeCache(addrFor(0), null);
    primeGeocodeCache(addrFor(2), null);

    await renderPage();
    const btn = get("retry-all-addresses-needing-review") as HTMLButtonElement;

    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // First request in flight: indicator reads "Retrying 1 of 2…",
    // button is disabled, aria-busy is set so screen readers know
    // the click registered.
    const midFirst = get("retry-all-addresses-needing-review") as HTMLButtonElement;
    expect(midFirst.disabled).toBe(true);
    expect(midFirst.getAttribute("aria-busy")).toBe("true");
    expect(midFirst.textContent).toContain("Retrying 1 of 2");

    // Resolve the first request as a success — the loop should
    // advance to "Retrying 2 of 2…" with the second request now in
    // flight.
    await act(async () => {
      pending[0]!(
        [
          {
            geometry: {
              location: { lat: () => 30, lng: () => -97 },
            },
          },
        ],
        "OK",
      );
    });
    const midSecond = get("retry-all-addresses-needing-review") as HTMLButtonElement;
    expect(midSecond).not.toBeNull();
    expect(midSecond.textContent).toContain("Retrying 2 of 2");

    // Resolve the second request — bulk run finishes, panel empties.
    await act(async () => {
      pending[1]!(
        [
          {
            geometry: {
              location: { lat: () => 30, lng: () => -97 },
            },
          },
        ],
        "OK",
      );
    });
    expect(get("addresses-needing-review-panel")).toBeNull();
  });

  it("disables per-row Retry for the address currently being retried in bulk", async () => {
    // The per-row Retry buttons must remain visible during the bulk
    // run (so the operator can still kick off an individual retry on
    // a row the loop hasn't reached yet) but must disable while their
    // own row is the one currently in flight — otherwise a click
    // would fall through to `handleRetryAddress`'s in-flight guard
    // and silently no-op, looking broken.
    const pending: GeocoderCb[] = [];
    plantFakeMapsSdk((_addr, cb) => {
      pending.push(cb);
    });
    primeGeocodeCache(addrFor(0), null);
    primeGeocodeCache(addrFor(2), null);

    await renderPage();

    await act(async () => {
      get("retry-all-addresses-needing-review")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    // The first address is in flight; its row's per-row Retry is
    // disabled, while the second row's is still clickable so the
    // operator isn't locked out of acting on rows the loop hasn't
    // reached yet.
    const rowOne = get("retry-address-needing-review-p1") as HTMLButtonElement;
    const rowTwo = get("retry-address-needing-review-p3") as HTMLButtonElement;
    expect(rowOne.disabled).toBe(true);
    expect(rowTwo.disabled).toBe(false);

    // Resolve first address. Loop advances to the second; now THAT
    // per-row button disables and the first one is gone (success
    // dropped the row).
    await act(async () => {
      pending[0]!(
        [
          {
            geometry: {
              location: { lat: () => 30, lng: () => -97 },
            },
          },
        ],
        "OK",
      );
    });
    expect(get("retry-address-needing-review-p1")).toBeNull();
    const rowTwoNow = get("retry-address-needing-review-p3") as HTMLButtonElement;
    expect(rowTwoNow.disabled).toBe(true);

    // Drain the second so we don't leak a pending promise into the
    // afterEach unmount.
    await act(async () => {
      pending[1]!(
        [
          {
            geometry: {
              location: { lat: () => 30, lng: () => -97 },
            },
          },
        ],
        "OK",
      );
    });
  });

  it("ignores a second click on Retry all while the first run is still in flight", async () => {
    // Belt-and-suspenders alongside the `disabled` attribute: the
    // handler itself early-returns when a bulk run is already in
    // flight so a stuck keyboard "Enter" on a stale render can't
    // double the Google round-trips.
    let geocodeCalls = 0;
    const pending: GeocoderCb[] = [];
    plantFakeMapsSdk((_addr, cb) => {
      geocodeCalls += 1;
      pending.push(cb);
    });
    primeGeocodeCache(addrFor(0), null);
    primeGeocodeCache(addrFor(2), null);

    await renderPage();
    const btn = get("retry-all-addresses-needing-review")!;

    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Second click while the first run is still working through its
    // first address — must NOT spawn a parallel run.
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(geocodeCalls).toBe(1);

    // Drain.
    await act(async () => {
      pending[0]!(null, "ZERO_RESULTS");
    });
    await act(async () => {
      pending[1]!(null, "ZERO_RESULTS");
    });
  });

  it("toasts and skips the bulk run when no Maps API key is loaded yet", async () => {
    // Same edge case as the per-row branch: rollup is visible but
    // /api/config hasn't resolved. Clicking Retry all can't do
    // anything useful, but it must NOT silently no-op — surface a
    // toast so the operator understands why and can try again in a
    // moment. We also assert NO geocode calls land, so a regression
    // that flipped the order (set bulk-progress THEN check key)
    // would still get caught.
    runtimeConfigMock.mockImplementation(() => ({
      data: undefined,
      isPending: true,
      isLoading: true,
      isError: false,
      isSuccess: false,
      error: null,
      status: "pending",
      fetchStatus: "fetching",
    }));
    let geocodeCalls = 0;
    plantFakeMapsSdk((_addr, cb) => {
      geocodeCalls += 1;
      cb(null, "ZERO_RESULTS");
    });
    primeGeocodeCache(addrFor(0), null);
    primeGeocodeCache(addrFor(2), null);

    await renderPage();
    await act(async () => {
      get("retry-all-addresses-needing-review")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(geocodeCalls).toBe(0);
    const titles = toastMock.mock.calls.map(
      (c) => (c[0] as { title?: string }).title,
    );
    expect(titles).toContain("Couldn't retry");
    // Both rows still present — nothing was attempted.
    expect(get("address-needing-review-p1")).not.toBeNull();
    expect(get("address-needing-review-p3")).not.toBeNull();
  });
});
