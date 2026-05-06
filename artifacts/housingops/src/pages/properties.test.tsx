import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// These tests pin down behaviors of the Properties listing page. The
// per-property Total Sqft column was removed from this overview list
// (it still appears on the individual Property page); related tests
// were dropped along with it.

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// framer-motion's motion.<tag> becomes a plain element of the same tag,
// preserving table semantics so `tbody tr` queries still resolve. The
// shared mock caches one component per tag (see
// src/test-utils/framer-motion-mock.tsx) — without that cache, React
// would unmount/remount the entire <motion.tr> subtree on every parent
// re-render and silently destroy any child useState.
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

// Dialogs / hover cards / dropdowns all render via Radix portals which
// don't behave well in jsdom. Replace them with simple passthroughs;
// none of the tests below open or read them.
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

// Select mock — renders each SelectItem as a plain span so the toolbar
// doesn't crash. The persistence tests below also need to drive the
// onValueChange handler, so we capture each Select's handler in a
// shared map keyed by the SelectTrigger's data-testid.
const selectHandlers = new Map<
  string,
  { value: string; onValueChange: (v: string) => void }
>();
vi.mock("@/components/ui/select", () => {
  function findTestId(node: unknown): string | null {
    if (node == null || typeof node === "string" || typeof node === "number") return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const id = findTestId(child);
        if (id) return id;
      }
      return null;
    }
    if (typeof node === "object" && "props" in (node as Record<string, unknown>)) {
      const props = (node as { props: Record<string, unknown> }).props;
      if (typeof props["data-testid"] === "string") {
        return props["data-testid"] as string;
      }
      if ("children" in props) return findTestId(props.children);
    }
    return null;
  }
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
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange?: (v: string) => void;
    children?: ReactNode;
  }) {
    const items: Array<{ value: string; label: string }> = [];
    collectItems(children, items);
    const testid = findTestId(children);
    if (testid && onValueChange) {
      selectHandlers.set(testid, { value, onValueChange });
    }
    return (
      <div data-testid={testid ?? undefined} data-current={value}>
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

// ── Mock data store ─────────────────────────────────────────────────────
//
// Three properties chosen so the Total Sqft column has every interesting
// shape on screen at once:
//   p1 → two rooms (200 + 320 = 520 sqft)
//   p2 → one room  (150 sqft)
//   p3 → no rooms  (must render the em-dash placeholder)
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
    ],
    properties: [
      baseProperty({ id: "p1", customerId: "c1", name: "Maple" }),
      baseProperty({ id: "p2", customerId: "c1", name: "Oak" }),
      baseProperty({ id: "p3", customerId: "c1", name: "Pine" }),
    ],
    beds: [],
    leases: [],
    rooms: [
      { id: "r1", propertyId: "p1", name: "Master", sqft: 200, bathrooms: 1, monthlyRent: 1000 },
      { id: "r2", propertyId: "p1", name: "Guest",  sqft: 320, bathrooms: 1, monthlyRent: 1200 },
      { id: "r3", propertyId: "p2", name: "Only",   sqft: 150, bathrooms: 1, monthlyRent: 700 },
      // p3 intentionally has no rooms.
    ],
  };
}

let state: State = makeFreshState();

const storeMocks = {
  addProperty: vi.fn(),
  addCustomer: vi.fn(),
};

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    ...state,
    isLoading: false,
    ...storeMocks,
  }),
}));

// Imports that consume the mocks above MUST come after vi.mock calls.
import Properties from "./properties";
import { CustomerScopeProvider } from "@/context/customer-scope";

function PropertiesUnderTest() {
  return (
    <CustomerScopeProvider>
      <Properties />
    </CustomerScopeProvider>
  );
}


// ── Toolbar persistence ────────────────────────────────────────────────
//
// The Properties page persists the user's last sort column, sort
// direction, status filter, and min-rating filter in localStorage under
// `housingops:properties:prefs` so a refresh or "navigate away and
// back" doesn't reset their toolbar to defaults. These tests pin down
// the storage contract — silently dropping persistence (or worse,
// silently writing the wrong shape) would only surface as a vague
// "my filters keep resetting" complaint weeks later.
//
// Search input is component-local for a reason (people don't expect
// half-typed search text to come back tomorrow) and the customer
// filter has its own ?customer= URL contract that other pages
// deep-link against — neither belongs in this storage key.

const PREFS_KEY = "housingops:properties:prefs";
const STATUS_FILTER_TESTID = "select-status-filter";
const MIN_RATING_TESTID = "select-min-rating";
const CUSTOMER_FILTER_TESTID = "select-customer-filter";

describe("Properties toolbar persistence", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeFreshState();
    Object.values(storeMocks).forEach((m) => m.mockReset());
    selectHandlers.clear();
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

  function getSelect(testid: string): HTMLElement {
    const el = container.querySelector(`[data-testid="${testid}"]`);
    if (!el) throw new Error(`select ${testid} not found`);
    return el as HTMLElement;
  }
  function getHandler(testid: string) {
    const h = selectHandlers.get(testid);
    if (!h) throw new Error(`no handler captured for ${testid}`);
    return h;
  }
  function getSortButton(testid: string): HTMLButtonElement {
    const el = container.querySelector(`[data-testid="${testid}"]`);
    if (!el) throw new Error(`sort button ${testid} not found`);
    return el as HTMLButtonElement;
  }
  function readPrefs(): Record<string, unknown> | null {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  }

  it("hydrates statusFilter, minRating, sortKey, and sortDir from localStorage on mount", async () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        statusFilter: "Inactive",
        minRating: "4",
        sortKey: "totalBeds",
        sortDir: "desc",
      }),
    );

    await renderPage();

    expect(getSelect(STATUS_FILTER_TESTID).getAttribute("data-current")).toBe("Inactive");
    expect(getSelect(MIN_RATING_TESTID).getAttribute("data-current")).toBe("4");
    // The sort button's aria-label encodes the live direction so the
    // hydrated sort key + direction are both observable from the DOM.
    const totalBedsBtn = getSortButton("button-sort-total-beds");
    expect(totalBedsBtn.getAttribute("aria-label")).toContain("currently descending");
    // No other column should be the active sort.
    expect(getSortButton("button-sort-occupied").getAttribute("aria-label")).not.toContain(
      "currently",
    );
  });

  it("writes statusFilter, minRating, sortKey, and sortDir back to localStorage when the user changes them", async () => {
    await renderPage();

    // Default mount with everything at defaults must NOT leave a stale
    // empty-object payload behind. The first effect run sees defaults
    // and should drop the key entirely.
    expect(window.localStorage.getItem(PREFS_KEY)).toBeNull();

    await act(async () => {
      getHandler(STATUS_FILTER_TESTID).onValueChange("Active");
    });
    expect(readPrefs()).toEqual({ statusFilter: "Active" });

    await act(async () => {
      getHandler(MIN_RATING_TESTID).onValueChange("5");
    });
    expect(readPrefs()).toEqual({ statusFilter: "Active", minRating: "5" });

    // Cycle the Total Beds column to ascending — the persisted shape
    // must include both sortKey and sortDir, never one without the
    // other (a sortKey with no direction is meaningless on rehydrate).
    await act(async () => {
      getSortButton("button-sort-total-beds").click();
    });
    expect(readPrefs()).toEqual({
      statusFilter: "Active",
      minRating: "5",
      sortKey: "totalBeds",
      sortDir: "asc",
    });

    // Click again → desc.
    await act(async () => {
      getSortButton("button-sort-total-beds").click();
    });
    expect(readPrefs()).toEqual({
      statusFilter: "Active",
      minRating: "5",
      sortKey: "totalBeds",
      sortDir: "desc",
    });
  });

  it("removes the storage key entirely when the toolbar is back to fully default state", async () => {
    // Seed with a non-default state so the key starts populated.
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        statusFilter: "Active",
        minRating: "5",
        sortKey: "totalBeds",
        sortDir: "asc",
      }),
    );

    await renderPage();
    // Sanity: the seeded payload survived the initial render.
    expect(readPrefs()).toEqual({
      statusFilter: "Active",
      minRating: "5",
      sortKey: "totalBeds",
      sortDir: "asc",
    });

    // Reset each control back to its default. Sort cycles
    // asc → desc → off, so two clicks from the seeded "asc" clears it.
    await act(async () => {
      getHandler(STATUS_FILTER_TESTID).onValueChange("All");
    });
    await act(async () => {
      getHandler(MIN_RATING_TESTID).onValueChange("any");
    });
    await act(async () => {
      getSortButton("button-sort-total-beds").click(); // asc → desc
    });
    await act(async () => {
      getSortButton("button-sort-total-beds").click(); // desc → off
    });

    // No stale `{}` left behind — the key must be gone.
    expect(window.localStorage.getItem(PREFS_KEY)).toBeNull();
  });

  it("ignores invalid / garbage values in localStorage instead of crashing", async () => {
    // Mix of: a syntactically-invalid JSON blob would throw on parse,
    // but a valid JSON object with bad field values should be silently
    // ignored on a per-field basis. We exercise the latter — the
    // page should render with full defaults, not crash, and not echo
    // the garbage back into the toolbar.
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        statusFilter: "Pending", // not a valid status
        minRating: "7", // not in the allowed set
        sortKey: "lolwut", // not a valid sort key
        sortDir: "sideways", // not a valid sort direction
        ratingSortCategory: 123, // wrong type entirely
      }),
    );

    await renderPage();

    // Every control must fall back to its default.
    expect(getSelect(STATUS_FILTER_TESTID).getAttribute("data-current")).toBe("All");
    expect(getSelect(MIN_RATING_TESTID).getAttribute("data-current")).toBe("any");
    expect(getSortButton("button-sort-total-beds").getAttribute("aria-label")).not.toContain(
      "currently",
    );
    expect(getSortButton("button-sort-customer")).toBeTruthy();

    // And on the next effect run (which sees defaults), the garbage
    // payload should be replaced — i.e. removed entirely, since
    // defaults persist as nothing.
    expect(window.localStorage.getItem(PREFS_KEY)).toBeNull();
  });

  it("survives an outright unparseable JSON blob without crashing", async () => {
    // Belt and suspenders for the catch in readPersistedPrefs. If a
    // future refactor drops the try/catch this test will fail loudly
    // instead of bricking every page load for users with corrupted
    // storage from an earlier broken release.
    window.localStorage.setItem(PREFS_KEY, "{not json at all");

    await renderPage();

    expect(getSelect(STATUS_FILTER_TESTID).getAttribute("data-current")).toBe("All");
    expect(getSelect(MIN_RATING_TESTID).getAttribute("data-current")).toBe("any");
  });

  it("does NOT persist the search input", async () => {
    await renderPage();

    const searchInput = container.querySelector(
      '[data-testid="input-search-properties"]',
    ) as HTMLInputElement | null;
    if (!searchInput) throw new Error("search input not found");

    await act(async () => {
      searchInput.value = "maple";
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Search text is intentionally component-local — typing must
    // never write to the prefs key.
    expect(window.localStorage.getItem(PREFS_KEY)).toBeNull();
  });

  it("does NOT persist the customer filter (it owns its own ?customer= URL contract)", async () => {
    await renderPage();

    await act(async () => {
      getHandler(CUSTOMER_FILTER_TESTID).onValueChange("c1");
    });

    // Customer scope changes belong to the URL, not the prefs blob.
    // If a future refactor folds them into the same storage key, two
    // pages deep-linking to different customers would silently
    // clobber each other on navigation.
    expect(window.localStorage.getItem(PREFS_KEY)).toBeNull();
  });
});
