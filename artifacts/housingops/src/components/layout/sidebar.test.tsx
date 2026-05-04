import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// ── Mocks ───────────────────────────────────────────────────────────────
//
// The sidebar pulls in a number of unrelated concerns (auth, toasts, the
// full data-store) just to render its layout. For the badge tests we only
// care about the customer scope wiring, so we replace everything else with
// minimal stand-ins.

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ logout: vi.fn(), login: vi.fn(), isAuthenticated: true }),
}));

// Mutable mock data so individual tests can rename / delete the active
// scoped customer between renders and verify the badge reacts.
const resetToSampleDataMock =
  vi.fn<
    (opts?: { onSuccess?: () => void; onError?: () => void; onSettled?: () => void }) => void
  >();
const mockData: {
  customers: { id: string; name: string }[];
  properties: Array<{
    id: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  }>;
  isLoading: boolean;
  resetToSampleData: typeof resetToSampleDataMock;
  exportData: () => unknown;
  importData: () => unknown;
} = {
  customers: [],
  properties: [],
  isLoading: false,
  resetToSampleData: resetToSampleDataMock,
  exportData: vi.fn(),
  importData: vi.fn(),
};

vi.mock("@/context/data-store", () => ({
  useData: () => mockData,
  // The sidebar imports these for its import-data flow. The badge tests
  // never trigger that flow, so trivial stand-ins are enough.
  inspectImportPayload: vi.fn(),
  totalImportSummary: vi.fn(() => 0),
  UnsupportedImportError: class UnsupportedImportError extends Error {},
}));

import { Sidebar } from "./sidebar";
import { CustomerScopeProvider } from "@/context/customer-scope";

const BADGE = "sidebar-customer-scope";
const NAME = "text-sidebar-customer-name";
const CLEAR_BTN = "button-sidebar-clear-customer";

function SidebarUnderTest() {
  return (
    <CustomerScopeProvider>
      <Sidebar />
    </CustomerScopeProvider>
  );
}

describe("Sidebar customer scope badge", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    mockData.customers = [
      { id: "c1", name: "Acme Co" },
      { id: "c2", name: "Globex" },
    ];
    mockData.properties = [];
    mockData.isLoading = false;
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/dashboard");
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

  async function renderAt(url: string) {
    window.history.replaceState({}, "", url);
    await act(async () => {
      root = createRoot(container);
      root.render(<SidebarUnderTest />);
    });
  }

  // Force React to re-render the same tree so effects pick up the new
  // mockData.customers reference (simulates the data-store emitting a
  // fresh customers array after a rename or delete).
  async function rerender() {
    if (!root) throw new Error("rerender called before initial render");
    const r = root;
    await act(async () => {
      r.render(<SidebarUnderTest />);
    });
  }

  function badge() {
    return container.querySelector(`[data-testid="${BADGE}"]`);
  }
  function nameEl() {
    return container.querySelector(`[data-testid="${NAME}"]`);
  }
  function clearBtn() {
    return container.querySelector(
      `[data-testid="${CLEAR_BTN}"]`,
    ) as HTMLButtonElement | null;
  }

  it("hides the badge while scope is All Customers", async () => {
    await renderAt("/dashboard");

    expect(badge()).toBeNull();
    expect(nameEl()).toBeNull();
    expect(clearBtn()).toBeNull();
  });

  it("renders the badge with the active customer's name when a scope is set", async () => {
    await renderAt("/dashboard?customer=c1");

    expect(badge()).not.toBeNull();
    expect(nameEl()?.textContent).toBe("Acme Co");
    expect(clearBtn()).not.toBeNull();
  });

  it("renders the second customer's name when scoped to a different id", async () => {
    await renderAt("/dashboard?customer=c2");

    expect(badge()).not.toBeNull();
    expect(nameEl()?.textContent).toBe("Globex");
  });

  it("clear button resets the scope to All Customers and hides the badge", async () => {
    await renderAt("/dashboard?customer=c2");
    expect(nameEl()?.textContent).toBe("Globex");

    await act(async () => {
      clearBtn()!.click();
    });

    expect(badge()).toBeNull();
    expect(nameEl()).toBeNull();
    expect(clearBtn()).toBeNull();
    expect(
      new URLSearchParams(window.location.search).get("customer"),
    ).toBeNull();
  });

  it("badge follows the customer name when the underlying record is renamed", async () => {
    await renderAt("/dashboard?customer=c1");
    expect(nameEl()?.textContent).toBe("Acme Co");

    // Simulate the data-store emitting a renamed customer record. The
    // id stays the same so the scope must remain active and the badge
    // must show the new name.
    mockData.customers = [
      { id: "c1", name: "Acme Holdings" },
      { id: "c2", name: "Globex" },
    ];
    await rerender();

    expect(badge()).not.toBeNull();
    expect(nameEl()?.textContent).toBe("Acme Holdings");
    expect(
      new URLSearchParams(window.location.search).get("customer"),
    ).toBe("c1");
  });

  it("renders the dev-only Reset demo data button when import.meta.env.DEV is true", async () => {
    vi.stubEnv("DEV", true);
    try {
      await renderAt("/dashboard");
      const btn = container.querySelector(
        '[data-testid="button-reset-demo-data"]',
      );
      expect(btn).not.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("hides the dev-only Reset demo data button in production builds", async () => {
    vi.stubEnv("DEV", false);
    try {
      await renderAt("/dashboard");
      const btn = container.querySelector(
        '[data-testid="button-reset-demo-data"]',
      );
      expect(btn).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("opens the confirm dialog and triggers reset + success toast on confirm", async () => {
    vi.stubEnv("DEV", true);
    resetToSampleDataMock.mockReset();
    resetToSampleDataMock.mockImplementation((opts) => {
      opts?.onSuccess?.();
      opts?.onSettled?.();
    });
    toastMock.mockReset();
    try {
      await renderAt("/dashboard");

      const openBtn = container.querySelector(
        '[data-testid="button-reset-demo-data"]',
      ) as HTMLButtonElement | null;
      expect(openBtn).not.toBeNull();

      await act(async () => {
        openBtn!.click();
      });

      // The AlertDialog portals into document.body, not the test container.
      const confirmBtn = document.querySelector(
        '[data-testid="button-reset-demo-confirm"]',
      ) as HTMLButtonElement | null;
      expect(confirmBtn).not.toBeNull();

      await act(async () => {
        confirmBtn!.click();
      });

      expect(resetToSampleDataMock).toHaveBeenCalledTimes(1);
      expect(toastMock).toHaveBeenCalledTimes(1);
      const arg = toastMock.mock.calls[0][0];
      expect(arg.title).toBe("Demo data reset");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("guards against duplicate clicks while the reset is still in flight", async () => {
    // Simulates an operator double-clicking Confirm before the async reset
    // mutation finishes. The handler holds isResetting=true until the
    // mutation's onSettled fires, so the second click should be a no-op.
    vi.stubEnv("DEV", true);
    resetToSampleDataMock.mockReset();
    let releaseSettled: (() => void) | null = null;
    resetToSampleDataMock.mockImplementation((opts) => {
      // Don't fire onSettled yet — mimic an in-flight network request.
      releaseSettled = () => {
        opts?.onSuccess?.();
        opts?.onSettled?.();
      };
    });
    toastMock.mockReset();
    try {
      await renderAt("/dashboard");

      const openBtn = container.querySelector(
        '[data-testid="button-reset-demo-data"]',
      ) as HTMLButtonElement;
      await act(async () => {
        openBtn.click();
      });

      const confirmBtn = document.querySelector(
        '[data-testid="button-reset-demo-confirm"]',
      ) as HTMLButtonElement;
      expect(confirmBtn).not.toBeNull();

      // Two rapid clicks while the mutation hasn't settled.
      await act(async () => {
        confirmBtn.click();
        confirmBtn.click();
      });

      expect(resetToSampleDataMock).toHaveBeenCalledTimes(1);

      // Release the pending mutation. Now subsequent clicks would be allowed
      // again — but only after the dialog is reopened, which is the safe
      // intended UX.
      await act(async () => {
        releaseSettled?.();
      });
      expect(toastMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("badge disappears automatically when the underlying customer is deleted", async () => {
    await renderAt("/dashboard?customer=c1");
    expect(nameEl()?.textContent).toBe("Acme Co");

    // Simulate the active scoped customer being deleted from the data
    // store. The scope must fall back to All and the badge must vanish
    // — including stripping the now-stale ?customer= param from the URL.
    mockData.customers = [{ id: "c2", name: "Globex" }];
    await rerender();

    expect(badge()).toBeNull();
    expect(nameEl()).toBeNull();
    expect(clearBtn()).toBeNull();
    expect(
      new URLSearchParams(window.location.search).get("customer"),
    ).toBeNull();
  });
});

// ── Geocode-failure badge on the Properties nav link ────────────────────
//
// These tests pin down the small numeric badge that appears next to the
// "Properties" link in the sidebar whenever the shared in-session
// geocode cache contains addresses Google can't pinpoint that match a
// real property. The badge mirrors the rollup panel rendered on
// /properties so an operator sees a problem the moment it lands —
// without needing to navigate to /properties to discover the badge.
//
// We drive the cache via the real `@/lib/google-maps-sdk` module
// (priming entries with `null` to record a failure) so the subscription
// path is exercised end-to-end.

import {
  __resetGoogleMapsSdkForTest,
  formatGeocodeAddress,
  primeGeocodeCache,
} from "@/lib/google-maps-sdk";

const NAV_BADGE = "badge-properties-needing-address-fix";

function baseProp(over: {
  id: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}): {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
} {
  return {
    address: "123 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    ...over,
  };
}

describe("Sidebar Properties nav — addresses-needing-fix badge", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    mockData.customers = [{ id: "c1", name: "Acme Co" }];
    mockData.properties = [
      baseProp({ id: "p1", address: "999 Nonexistent Way", city: "Nowhere", state: "ZZ", zip: "00000" }),
      baseProp({ id: "p2" }),
      baseProp({ id: "p3", address: "12 Bad Lane", city: "Errortown", state: "XY", zip: "11111" }),
      // Blank-address property — has nothing for Google to reject in
      // the first place, so it must NOT contribute to the badge count
      // even if a stray empty entry somehow lands in the cache.
      baseProp({ id: "p4", address: "", city: "", state: "", zip: "" }),
    ];
    mockData.isLoading = false;
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/dashboard");
    // Reset the shared module-level cache so a previous test's failures
    // don't leak into this one.
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

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(<SidebarUnderTest />);
    });
  }

  function navBadge(): HTMLElement | null {
    return container.querySelector(`[data-testid="${NAV_BADGE}"]`);
  }

  function addrFor(idx: number): string {
    return formatGeocodeAddress(mockData.properties[idx]);
  }

  it("hides the badge in a healthy session with no cached failures", async () => {
    await render();
    expect(navBadge()).toBeNull();
  });

  it("renders the badge with the count when a failure is cached on mount", async () => {
    // Operator visited a property-detail page earlier in the session
    // and that surface recorded a failure into the shared cache. The
    // badge must reflect that the moment the sidebar mounts on any
    // route — not just after navigating to /properties.
    primeGeocodeCache(addrFor(0), null);

    await render();

    const badgeEl = navBadge();
    expect(badgeEl).not.toBeNull();
    expect(badgeEl!.textContent).toBe("1");
  });

  it("grows the badge live as new failures land in the cache", async () => {
    await render();
    expect(navBadge()).toBeNull();

    // Simulate a per-property Location card recording a failure
    // mid-session. Without the live subscription the badge would
    // stay empty until the operator navigated away and back.
    await act(async () => {
      primeGeocodeCache(addrFor(0), null);
    });
    expect(navBadge()?.textContent).toBe("1");

    await act(async () => {
      primeGeocodeCache(addrFor(2), null);
    });
    expect(navBadge()?.textContent).toBe("2");
  });

  it("ignores cached failures that don't match any current property address", async () => {
    // The blank-address property has no formatted address at all, so
    // even if some random failure lands in the cache it must not bump
    // the badge — the badge only counts addresses that an operator
    // can actually go fix on a real property.
    primeGeocodeCache("totally unrelated address", null);

    await render();

    expect(navBadge()).toBeNull();
  });

  it("disappears once the failing property's address is edited away from the failure", async () => {
    primeGeocodeCache(addrFor(0), null);

    await render();
    expect(navBadge()?.textContent).toBe("1");

    // Mutate the failing property's address to a fresh string the
    // cache doesn't know about. The cache is keyed by the formatted
    // address so the new address misses, the count goes to zero, and
    // the badge must disappear entirely (not render a "0").
    mockData.properties = mockData.properties.map((p) =>
      p.id === "p1" ? { ...p, address: "1 New Street" } : p,
    );
    await act(async () => {
      root!.render(<SidebarUnderTest />);
    });

    expect(navBadge()).toBeNull();
  });
});
