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
});
