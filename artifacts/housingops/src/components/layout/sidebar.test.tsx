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
const previewMergeImportMock = vi.fn();
const inspectImportPayloadMock = vi.fn();
const importDataMock = vi.fn();
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
  importData: typeof importDataMock;
  previewMergeImport: typeof previewMergeImportMock;
} = {
  customers: [],
  properties: [],
  isLoading: false,
  resetToSampleData: resetToSampleDataMock,
  exportData: vi.fn(),
  importData: importDataMock,
  previewMergeImport: previewMergeImportMock,
};

vi.mock("@/context/data-store", () => ({
  useData: () => mockData,
  // The sidebar imports these for its import-data flow. Most tests don't
  // trigger that flow; the merge-preview tests below override the mocks.
  inspectImportPayload: (...args: unknown[]) => inspectImportPayloadMock(...args),
  totalImportSummary: vi.fn(() => 0),
  totalMergeDryRun: (dry: {
    customers: { added: number; updated: number; unchanged: number };
    properties: { added: number; updated: number; unchanged: number };
    leases: { added: number; updated: number; unchanged: number };
    rooms: { added: number; updated: number; unchanged: number };
    beds: { added: number; updated: number; unchanged: number };
    occupants: { added: number; updated: number; unchanged: number };
    utilities: { added: number; updated: number; unchanged: number };
  }) => {
    let added = 0, updated = 0, unchanged = 0;
    for (const k of ["customers", "properties", "leases", "rooms", "beds", "occupants", "utilities"] as const) {
      added += dry[k].added; updated += dry[k].updated; unchanged += dry[k].unchanged;
    }
    return { added, updated, unchanged };
  },
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
  __FAILURE_STORAGE_KEY_FOR_TEST,
  __hydrateGeocodeFailuresFromStorageForTest,
  __resetGoogleMapsSdkForTest,
  clearGeocodeFailures,
  dismissGeocodeFailure,
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

  // ── Persistence across page reloads ───────────────────────────────────
  //
  // The badge previously reset to empty on every refresh because
  // failures lived in a module-level Map. The cases below pin down
  // the localStorage-backed persistence so an operator who reloads
  // the tab still sees the same count immediately, without any Maps
  // surface needing to re-trigger the bad geocode.

  it("renders the badge from a localStorage-persisted failure on a simulated reload", async () => {
    // Seed storage as if a prior session recorded a failure for p1.
    // Tear down in-memory state, restore the snapshot, then hydrate
    // — this mimics a fresh module load against a populated
    // localStorage. Without persistence + hydration, the badge would
    // stay empty until something re-issued the failing geocode.
    const persisted = JSON.stringify({
      failures: [addrFor(0)],
      dismissed: [],
    });
    __resetGoogleMapsSdkForTest();
    window.localStorage.setItem(__FAILURE_STORAGE_KEY_FOR_TEST, persisted);
    __hydrateGeocodeFailuresFromStorageForTest();

    await render();
    expect(navBadge()).not.toBeNull();
    expect(navBadge()!.textContent).toBe("1");
  });

  it("respects a persisted dismissal so the badge doesn't bring back a triaged row on reload", async () => {
    // Seed both a failure and its dismissal — the operator already
    // looked at this address last session and decided it's fine. A
    // fresh reload must NOT bump the badge again; otherwise the
    // dismiss button would be a one-shot affordance the operator
    // has to re-fire after every refresh.
    const persisted = JSON.stringify({
      failures: [addrFor(0)],
      dismissed: [addrFor(0)],
    });
    __resetGoogleMapsSdkForTest();
    window.localStorage.setItem(__FAILURE_STORAGE_KEY_FOR_TEST, persisted);
    __hydrateGeocodeFailuresFromStorageForTest();

    await render();
    expect(navBadge()).toBeNull();
  });

  // ── Badge tooltip "Oldest flag checked …" parity with /properties ────
  //
  // The Properties page rollup labels each flagged row with
  // "Checked N ago". On narrow displays where operators rarely open
  // /properties, the same staleness signal needs to surface from the
  // sidebar badge — hovering should reveal the OLDEST flag's
  // relative-time stamp so an operator can decide whether triage is
  // urgent without leaving their current page.

  it("tooltip surfaces 'Oldest flag checked N ago' for a single failure (and keeps the count phrasing)", async () => {
    primeGeocodeCache(addrFor(0), null);
    await render();
    const badgeEl = navBadge();
    expect(badgeEl).not.toBeNull();
    // Just-recorded failures land at Date.now(), so the relative-time
    // string can be "less than a minute ago" / "1 minute ago" depending
    // on the clock — assert on the prefix instead of the exact suffix
    // so the test is stable across runs.
    const title = badgeEl!.getAttribute("title") ?? "";
    expect(title).toMatch(/Oldest flag checked /);
    expect(title).toMatch(/ago/);
    // aria-label and title are kept in sync so screen-reader users
    // get the same context as sighted operators on hover.
    expect(badgeEl!.getAttribute("aria-label")).toBe(title);
  });

  it("tooltip reports the OLDEST timestamp when multiple failures are cached", async () => {
    // Hydrate two failures whose timestamps differ by many days so the
    // formatter outputs distinct, deterministic strings — "7 days ago"
    // for the older, "1 day ago" for the newer. The badge tooltip must
    // surface the older one so operators see the most-stale flag's age.
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const oneDayAgo = now - 1 * 24 * 60 * 60 * 1000;
    const persisted = JSON.stringify({
      failures: [
        { address: addrFor(0), lastCheckedAt: sevenDaysAgo },
        { address: addrFor(2), lastCheckedAt: oneDayAgo },
      ],
      dismissed: [],
    });
    __resetGoogleMapsSdkForTest();
    window.localStorage.setItem(__FAILURE_STORAGE_KEY_FOR_TEST, persisted);
    __hydrateGeocodeFailuresFromStorageForTest();

    await render();

    const badgeEl = navBadge();
    expect(badgeEl).not.toBeNull();
    expect(badgeEl!.textContent).toBe("2");
    const title = badgeEl!.getAttribute("title") ?? "";
    expect(title).toMatch(/2 addresses need fixing/);
    // The OLDER stamp wins. We assert on the "7 days" substring rather
    // than the full string so a future formatter tweak (e.g. dropping
    // the leading "about ") doesn't break the test, and we verify the
    // newer "1 day" stamp does NOT leak into the tooltip.
    expect(title).toMatch(/Oldest flag checked .*7 days ago/);
    expect(title).not.toMatch(/1 day ago/);
  });

  it("tooltip updates live when a fresh failure with an older timestamp lands mid-session", async () => {
    // Start with a recent failure; the tooltip should reflect that.
    primeGeocodeCache(addrFor(0), null);
    await render();
    let title = navBadge()!.getAttribute("title") ?? "";
    expect(title).toMatch(/Oldest flag checked /);
    // Now simulate a sibling surface recording a much-older failure
    // (e.g. hydration from a re-imported backup). The badge tooltip
    // must re-render to call out the now-oldest stamp without the
    // operator navigating anywhere.
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const persisted = JSON.stringify({
      failures: [
        { address: addrFor(0), lastCheckedAt: Date.now() },
        { address: addrFor(2), lastCheckedAt: sevenDaysAgo },
      ],
      dismissed: [],
    });
    __resetGoogleMapsSdkForTest();
    window.localStorage.setItem(__FAILURE_STORAGE_KEY_FOR_TEST, persisted);
    __hydrateGeocodeFailuresFromStorageForTest();
    // A subsequent prime triggers the live subscription path so the
    // sidebar re-renders against the freshly-hydrated cache.
    await act(async () => {
      primeGeocodeCache(addrFor(2), null);
    });
    title = navBadge()!.getAttribute("title") ?? "";
    expect(title).toMatch(/2 addresses need fixing/);
    expect(title).toMatch(/Oldest flag checked /);
  });

  it("tooltip auto-refreshes 'Oldest flag checked …' as time passes without any user interaction", async () => {
    // The tooltip exists to give operators a staleness signal at a
    // glance. Before this behavior was added, the relative-time
    // suffix only recomputed when the geocode-failure cache itself
    // changed — so a session that recorded a failure and then sat
    // idle for an hour would still read "checked 1 minute ago".
    // The minute-tick subscription on this surface must keep the
    // tooltip honest without any other event firing.
    vi.useFakeTimers();
    try {
      const start = new Date(2026, 0, 1, 12, 0, 0).getTime();
      vi.setSystemTime(start);
      // `primeGeocodeCache` stamps the failure with `Date.now()`, so
      // the cache entry's `lastCheckedAt` is exactly `start`.
      primeGeocodeCache(addrFor(0), null);

      await render();

      const titleAtStart = navBadge()!.getAttribute("title") ?? "";
      // Just-recorded failure renders as "less than a minute ago".
      expect(titleAtStart).toMatch(/Oldest flag checked /);
      expect(titleAtStart).not.toMatch(/minutes ago/);

      // Advance the wall clock by 5 minutes — no cache writes, no
      // route changes, nothing else that would force a re-render.
      // The shared minute-tick from `useNow` must drive the
      // re-render so the tooltip suffix tracks elapsed time.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      });

      const titleAfter = navBadge()!.getAttribute("title") ?? "";
      expect(titleAfter).toMatch(/Oldest flag checked .*5 minutes ago/);
      // aria-label stays in sync with title so screen-reader users
      // get the freshly-ticked suffix too.
      expect(navBadge()!.getAttribute("aria-label")).toBe(titleAfter);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clearGeocodeFailures (called from the reset flows) drops the badge and wipes storage", async () => {
    // The reset handlers in this same file invoke
    // `clearGeocodeFailures()` from their `onSuccess` callback.
    // This test pins down the contract those handlers depend on:
    // calling `clearGeocodeFailures` must drop the badge live AND
    // wipe storage so a subsequent reload starts clean.
    primeGeocodeCache(addrFor(0), null);
    primeGeocodeCache(addrFor(2), null);
    dismissGeocodeFailure(addrFor(0));

    await render();
    expect(navBadge()?.textContent).toBe("1");
    expect(
      window.localStorage.getItem(__FAILURE_STORAGE_KEY_FOR_TEST),
    ).not.toBeNull();

    await act(async () => {
      clearGeocodeFailures();
    });

    expect(navBadge()).toBeNull();
    expect(
      window.localStorage.getItem(__FAILURE_STORAGE_KEY_FOR_TEST),
    ).toBeNull();
  });
});

// ── Import dialog merge-preview ─────────────────────────────────────────
//
// When the operator picks "Merge into current data" the dialog must show
// a per-type breakdown (added / updated / unchanged) plus a collapsible
// list of records that will be overwritten so accidental overwrites are
// caught BEFORE confirming. These tests exercise that surface end-to-end
// via the file-input + radio toggle.

describe("Sidebar import dialog — merge preview", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  // Empty bundle the inspectImportPayload mock returns; the dry-run
  // result is what actually drives the rendered preview, so the
  // bundle's contents don't matter for these tests.
  const emptyData = {
    customers: [], properties: [], leases: [], rooms: [],
    beds: [], occupants: [], utilities: [],
  };

  function dryRun(over: Partial<Record<keyof typeof emptyData, {
    added?: number; updated?: number; unchanged?: number;
    addedItems?: { id: string; label: string }[];
    updatedItems?: { id: string; label: string }[];
  }>>) {
    const empty = () => ({
      added: 0,
      updated: 0,
      unchanged: 0,
      addedItems: [] as { id: string; label: string }[],
      updatedItems: [] as { id: string; label: string }[],
    });
    const out: Record<string, ReturnType<typeof empty>> = {
      customers: empty(), properties: empty(), leases: empty(), rooms: empty(),
      beds: empty(), occupants: empty(), utilities: empty(),
    };
    for (const [k, v] of Object.entries(over)) {
      out[k] = { ...out[k], ...v };
    }
    return out;
  }

  beforeEach(() => {
    mockData.customers = [];
    mockData.properties = [];
    mockData.isLoading = false;
    inspectImportPayloadMock.mockReset();
    previewMergeImportMock.mockReset();
    importDataMock.mockReset();
    toastMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      const r = root;
      await act(async () => { r.unmount(); });
      root = null;
    }
    container.remove();
    // The dialog portals into document.body — clean any leftover nodes
    // so a previous test's dialog doesn't satisfy the next test's query.
    document.querySelectorAll('[role="alertdialog"]').forEach((el) => el.remove());
  });

  async function openImportDialog() {
    inspectImportPayloadMock.mockReturnValue({
      data: emptyData,
      summary: {
        customers: 0, properties: 0, leases: 0, rooms: 0,
        beds: 0, occupants: 0, utilities: 0,
      },
      migratedFromV1: false,
      migratedRooms: false,
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<SidebarUnderTest />);
    });
    const fileInput = container.querySelector(
      '[data-testid="input-import-file"]',
    ) as HTMLInputElement;
    // Synthesize a JSON file pick — the handler reads it via .text().
    // jsdom's File prototype lacks a reliable `.text()`, so stub it on
    // the instance so the handler's `await file.text()` resolves
    // immediately to valid JSON.
    const file = {
      name: "backup.json",
      type: "application/json",
      text: () => Promise.resolve("{}"),
    } as unknown as File;
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // The handler awaits file.text() + JSON.parse before calling
    // inspectImportPayload + setting state. Spin until the dialog
    // mounts (or give up after a generous tick budget) so the rest
    // of the test can interact with the rendered radio group.
    for (let i = 0; i < 20; i++) {
      if (document.querySelector('[data-testid="radio-import-mode-merge"]')) break;
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
  }

  async function selectMergeMode() {
    const mergeRadio = document.querySelector(
      '[data-testid="radio-import-mode-merge"]',
    ) as HTMLElement | null;
    expect(mergeRadio).not.toBeNull();
    await act(async () => { mergeRadio!.click(); });
  }

  it("hides the merge preview while replace mode is selected (the default)", async () => {
    previewMergeImportMock.mockReturnValue(dryRun({
      properties: { added: 1, updated: 1, unchanged: 0, updatedItems: [{ id: "p1", label: "Maple House" }] },
    }));
    await openImportDialog();

    // Replace is the default. The preview block must not render and
    // previewMergeImport must NOT be called (replace is total — there's
    // nothing to diff and we shouldn't pay for the work).
    expect(document.querySelector('[data-testid="merge-import-preview"]')).toBeNull();
    expect(previewMergeImportMock).not.toHaveBeenCalled();
  });

  it("renders per-type counts when merge mode is selected", async () => {
    previewMergeImportMock.mockReturnValue(dryRun({
      customers: { added: 0, updated: 0, unchanged: 1 },
      properties: { added: 1, updated: 2, unchanged: 3,
        updatedItems: [
          { id: "p1", label: "Maple House" },
          { id: "p2", label: "Oak Place" },
        ] },
    }));
    await openImportDialog();
    await selectMergeMode();

    expect(previewMergeImportMock).toHaveBeenCalledTimes(1);

    const preview = document.querySelector('[data-testid="merge-import-preview"]');
    expect(preview).not.toBeNull();
    // Totals header rolls up every type.
    const totals = document.querySelector('[data-testid="merge-import-preview-totals"]');
    expect(totals?.textContent).toBe("1 added · 2 updated · 4 unchanged");
    // Per-type rows render only for types with any activity.
    const propRow = document.querySelector('[data-testid="merge-preview-row-properties"]');
    expect(propRow?.textContent).toContain("1 added");
    expect(propRow?.textContent).toContain("2 updated");
    expect(propRow?.textContent).toContain("3 unchanged");
    // Types with all zeros are omitted to keep the list scannable.
    expect(document.querySelector('[data-testid="merge-preview-row-leases"]')).toBeNull();
  });

  it("hides the overwrite-list toggle when nothing would be overwritten", async () => {
    previewMergeImportMock.mockReturnValue(dryRun({
      properties: { added: 3, updated: 0, unchanged: 0,
        addedItems: [
          { id: "p1", label: "A" }, { id: "p2", label: "B" }, { id: "p3", label: "C" },
        ] },
    }));
    await openImportDialog();
    await selectMergeMode();

    expect(
      document.querySelector('[data-testid="merge-preview-overwrites-toggle"]'),
    ).toBeNull();
  });

  it("expands the overwrite list and shows updated record labels per type", async () => {
    previewMergeImportMock.mockReturnValue(dryRun({
      properties: { added: 0, updated: 2, unchanged: 0,
        updatedItems: [
          { id: "p1", label: "Maple House" },
          { id: "p2", label: "Oak Place" },
        ] },
      customers: { added: 0, updated: 1, unchanged: 0,
        updatedItems: [{ id: "c1", label: "Acme Co" }] },
    }));
    await openImportDialog();
    await selectMergeMode();

    const toggle = document.querySelector(
      '[data-testid="merge-preview-overwrites-toggle"]',
    ) as HTMLElement | null;
    expect(toggle).not.toBeNull();
    expect(toggle!.textContent).toContain("3");

    await act(async () => { toggle!.click(); });

    // Both per-type rows render with the existing labels (the names the
    // operator already knows) — that's how they spot overwrites.
    const propsRow = document.querySelector('[data-testid="merge-preview-overwrites-properties"]');
    expect(propsRow).not.toBeNull();
    expect(propsRow!.textContent).toContain("Maple House");
    expect(propsRow!.textContent).toContain("Oak Place");
    const custRow = document.querySelector('[data-testid="merge-preview-overwrites-customers"]');
    expect(custRow!.textContent).toContain("Acme Co");
  });

  it("recomputes the preview when toggling back from merge to replace and forward again", async () => {
    previewMergeImportMock.mockReturnValue(dryRun({
      properties: { added: 1, updated: 0, unchanged: 0, addedItems: [{ id: "p9", label: "New" }] },
    }));
    await openImportDialog();
    await selectMergeMode();
    expect(previewMergeImportMock).toHaveBeenCalledTimes(1);

    // Toggle back to replace — the preview must disappear.
    const replaceRadio = document.querySelector(
      '[data-testid="radio-import-mode-replace"]',
    ) as HTMLElement;
    await act(async () => { replaceRadio.click(); });
    expect(document.querySelector('[data-testid="merge-import-preview"]')).toBeNull();

    // Back to merge — the dialog must recompute and show the preview again.
    await selectMergeMode();
    expect(previewMergeImportMock).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-testid="merge-import-preview"]')).not.toBeNull();
  });
});
