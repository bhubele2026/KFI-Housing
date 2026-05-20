import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

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
      if ("children" in props) {
        return findTestId(props.children);
      }
    }
    return null;
  }

  function Select({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children?: ReactNode;
  }) {
    const testid = findTestId(children);
    if (testid) {
      selectHandlers.set(testid, { value, onValueChange });
    }
    return <div data-testid={testid ?? undefined} data-current={value} />;
  }

  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const Item = ({ value, children }: { value: string; children?: ReactNode }) => (
    <div data-value={value}>{children}</div>
  );

  return {
    Select,
    SelectContent: Passthrough,
    SelectGroup: Passthrough,
    SelectItem: Item,
    SelectLabel: Passthrough,
    SelectScrollDownButton: Passthrough,
    SelectScrollUpButton: Passthrough,
    SelectSeparator: Passthrough,
    SelectTrigger: Passthrough,
    SelectValue: Passthrough,
  };
});

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// Radix DropdownMenu uses portals + focus traps that don't behave in
// jsdom — swap it for transparent passthroughs that always render the
// content inline so the snooze test (Task #357) can click items
// directly via their data-testid. `onSelect` is wired up the same way
// it is in the real Radix primitive.
vi.mock("@/components/ui/dropdown-menu", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  function Item({
    children,
    onSelect,
    ...rest
  }: {
    children?: ReactNode;
    onSelect?: () => void;
  } & Record<string, unknown>) {
    return (
      <button {...rest} onClick={() => onSelect?.()}>
        {children}
      </button>
    );
  }
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: Item,
    DropdownMenuLabel: Pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuGroup: Pass,
    DropdownMenuPortal: Pass,
    DropdownMenuSub: Pass,
    DropdownMenuSubTrigger: Pass,
    DropdownMenuSubContent: Pass,
    DropdownMenuCheckboxItem: Item,
    DropdownMenuRadioItem: Item,
    DropdownMenuRadioGroup: Pass,
    DropdownMenuShortcut: Pass,
  };
});

// Radix's AlertDialog uses portals + focus traps that don't behave in
// jsdom; swap it for a transparent passthrough that respects `open` so
// the confirm/cancel buttons inside are clickable in tests.
vi.mock("@/components/ui/alert-dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  function AlertDialog({
    open,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: ReactNode;
  }) {
    if (!open) return null;
    return <div>{children}</div>;
  }
  return {
    AlertDialog,
    AlertDialogTrigger: Pass,
    AlertDialogContent: ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => (
      <div {...rest}>{children}</div>
    ),
    AlertDialogHeader: Pass,
    AlertDialogTitle: Pass,
    AlertDialogDescription: Pass,
    AlertDialogFooter: Pass,
    AlertDialogAction: ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => (
      <button {...rest}>{children}</button>
    ),
    AlertDialogCancel: ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => (
      <button {...rest}>{children}</button>
    ),
    AlertDialogPortal: Pass,
    AlertDialogOverlay: () => null,
  };
});

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("framer-motion", () => {
  const Motion = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const motion = new Proxy(
    {},
    { get: () => Motion },
  );
  return { motion };
});

vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Stub,
    Bar: Stub,
    XAxis: Stub,
    YAxis: Stub,
    CartesianGrid: Stub,
    Tooltip: Stub,
    Legend: Stub,
    ResponsiveContainer: Stub,
  };
});

const mockData: {
  properties: unknown[];
  buildings: unknown[];
  beds: unknown[];
  rooms: unknown[];
  leases: unknown[];
  utilities: unknown[];
  insuranceCertificates: unknown[];
  occupants: unknown[];
  customers: { id: string; name: string }[];
  isLoading: boolean;
} = {
  properties: [],
  // `buildings` is destructured from `useData()` in dashboard.tsx and
  // iterated via `.map(...)`; omitting it (the original test stub
  // pre-dated buildings landing in the data store) makes Dashboard
  // throw on first render. Task #632 keeps it as an empty list so the
  // rest of the suite — which doesn't exercise the buildings axis —
  // stays untouched.
  buildings: [],
  beds: [],
  rooms: [],
  leases: [],
  utilities: [],
  insuranceCertificates: [],
  occupants: [],
  customers: [
    { id: "c1", name: "Acme Co" },
    { id: "c2", name: "Globex" },
  ],
  isLoading: false,
};

const addOccupantMock = vi.fn();
const updateBedMock = vi.fn();

const updateOccupantMock = vi.fn();
const updateLeaseMock = vi.fn();

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    ...mockData,
    addOccupant: addOccupantMock,
    updateBed: updateBedMock,
    updateOccupant: updateOccupantMock,
    updateLease: updateLeaseMock,
  }),
}));

type Suggestion = {
  occupantId: string;
  name: string;
  company: string;
  propertyName: string | null;
  score: number;
  crossEmployer: boolean;
};
const unplacedPayrollState: {
  rows: Array<{ customer: string; name: string; personId: string; weekly: number; suggestions: Suggestion[] }>;
  lowConfidenceMatches: Array<{
    customer: string;
    name: string;
    personId: string;
    weekly: number;
    matched: Suggestion;
    suggestions: Suggestion[];
  }>;
} = {
  rows: [],
  lowConfidenceMatches: [],
};
const invalidateQueriesMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useListUnplacedPayroll: () => ({
    data: {
      unmatched: unplacedPayrollState.rows,
      lowConfidenceMatches: unplacedPayrollState.lowConfidenceMatches,
    },
  }),
  getListUnplacedPayrollQueryKey: () => ["/payroll/unplaced"],
  // Task #632: the dashboard's payroll tile reads
  // `useListPayrollDeductions` to surface per-occupant deduction
  // history. The dashboard tests don't exercise the tile directly,
  // but the hook must still resolve cleanly so the page renders.
  // Defaulting to an empty array keeps the existing dashboard test
  // expectations stable.
  useListPayrollDeductions: () => ({ data: [] }),
  getListPayrollDeductionsQueryKey: () => ["/payroll/deductions"],
  // Task #320 added a hotel-rate / lease-expiry alerts tile that
  // reads from this hook. Tests in this file don't exercise it
  // directly but the hook must still resolve cleanly.
  useListRoomNightLogs: () => ({ data: [] }),
  // Task #578 added a portfolio-wide projected-move-ins roll-up to the
  // dashboard. Tests in this file don't exercise that card directly,
  // but the hook must still resolve cleanly so the page renders.
  useListAllProjectedMoveIns: () => ({ data: [] }),
  getListAllProjectedMoveInsQueryKey: () => ["/projected-move-ins"],
  useListPropertyViolations: () => ({ data: [] }),
  useCreatePropertyViolation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeletePropertyViolation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  getListPropertyViolationsQueryKey: () => [],
}));

// Task #492: the dashboard subscribes to /api/config so its alert-card
// thresholds (notice-deadline lead window + low-occupancy %) match the
// weekly digest. The tests don't exercise the runtime-config wiring;
// stubbing the two hooks here keeps them off the network and out of
// react-query's machinery, and the component's documented fallbacks
// (30 / 80 — same as the api-server defaults) keep the alert math
// stable when `data` is undefined.
vi.mock("@/hooks/use-runtime-config", () => ({
  useRuntimeConfigQuery: () => ({ data: undefined }),
  useRuntimeConfigStream: () => undefined,
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
    // Dashboard makes two ambient `useQuery` calls (team-me role check
    // + closed-month finance snapshot). Neither drives the assertions
    // in this suite — admin-only UI and snapshot-vs-live behaviour are
    // covered elsewhere — so stub them with empty data. Without this,
    // the bare `useQuery` reaches into the unmocked QueryClient and
    // throws "No QueryClient set" the moment we mount Dashboard,
    // which exploded the entire suite once the missing
    // `useListPayrollDeductions` mock (below) stopped short-circuiting
    // the render path.
    useQuery: () => ({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }),
    // Same story for the admin-only Close/Reopen month mutations —
    // they also reach into the real QueryClient. The dashboard tests
    // never invoke them, so a no-op mutate keeps render quiet.
    useMutation: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(async () => undefined),
      isPending: false,
      isError: false,
      error: null,
      reset: vi.fn(),
    }),
  };
});

// The shared dialog pulls in `useData` for its property/bed picker. The
// dashboard test only cares that the trigger renders with the right
// pre-fill, so stub the dialog out and capture its props.
const dialogProps: Array<Record<string, unknown>> = [];
vi.mock("@/components/assign-occupant-dialog", () => ({
  AssignOccupantDialog: (props: Record<string, unknown>) => {
    dialogProps.push(props);
    return <div data-testid={`assign-dialog-stub-${(props as { testIdSuffix?: string }).testIdSuffix ?? ""}`} />;
  },
}));

import Dashboard from "./dashboard";
import { CustomerScopeProvider } from "@/context/customer-scope";

const FILTER_TESTID = "select-dashboard-customer-filter";

function DashboardUnderTest() {
  return (
    <CustomerScopeProvider>
      <Dashboard />
    </CustomerScopeProvider>
  );
}

describe("Dashboard customer filter URL persistence", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    selectHandlers.clear();
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
      root.render(<DashboardUnderTest />);
    });
  }

  function getFilterSelect() {
    const el = container.querySelector(`[data-testid="${FILTER_TESTID}"]`);
    if (!el) throw new Error(`Could not find ${FILTER_TESTID}`);
    return el;
  }

  function getHandler() {
    const h = selectHandlers.get(FILTER_TESTID);
    if (!h) throw new Error(`No handler captured for ${FILTER_TESTID}`);
    return h;
  }

  it("selecting a customer adds ?customer=<id> to the URL", async () => {
    await renderAt("/dashboard");

    expect(getFilterSelect().getAttribute("data-current")).toBe("All");
    expect(window.location.search).toBe("");

    await act(async () => {
      getHandler().onValueChange("c1");
    });

    expect(window.location.pathname).toBe("/dashboard");
    expect(new URLSearchParams(window.location.search).get("customer")).toBe("c1");
    expect(getFilterSelect().getAttribute("data-current")).toBe("c1");
  });

  it("switching back to All Customers removes the ?customer param", async () => {
    await renderAt("/dashboard?customer=c1");

    expect(getFilterSelect().getAttribute("data-current")).toBe("c1");

    await act(async () => {
      getHandler().onValueChange("All");
    });

    expect(window.location.pathname).toBe("/dashboard");
    expect(window.location.search).toBe("");
    expect(getFilterSelect().getAttribute("data-current")).toBe("All");
  });

  it("loading /dashboard?customer=<id> pre-selects that customer", async () => {
    await renderAt("/dashboard?customer=c2");

    expect(getFilterSelect().getAttribute("data-current")).toBe("c2");
    // The URL should not be rewritten for a known customer.
    expect(new URLSearchParams(window.location.search).get("customer")).toBe("c2");
  });

  it("falls back to All Customers when the URL carries an unknown customer id", async () => {
    await renderAt("/dashboard?customer=does-not-exist");

    expect(getFilterSelect().getAttribute("data-current")).toBe("All");
    // The unknown id should also be normalized out of the URL.
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/dashboard");
  });

  it("preserves other unrelated query params when toggling the filter", async () => {
    await renderAt("/dashboard?other=keep");

    await act(async () => {
      getHandler().onValueChange("c1");
    });

    const params1 = new URLSearchParams(window.location.search);
    expect(params1.get("customer")).toBe("c1");
    expect(params1.get("other")).toBe("keep");

    await act(async () => {
      getHandler().onValueChange("All");
    });

    const params2 = new URLSearchParams(window.location.search);
    expect(params2.get("customer")).toBeNull();
    expect(params2.get("other")).toBe("keep");
  });
});

describe("Dashboard customer filter back/forward navigation", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let nowMs: number;
  let dateNowSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    selectHandlers.clear();
    mockData.isLoading = false;
    window.sessionStorage.clear();
    // jsdom's history persists across tests; push a sentinel marker we
    // can walk back to so each test has a clean, known baseline regardless
    // of where prior tests left the history pointer.
    window.history.pushState({}, "", "/__test_baseline__");
    window.history.pushState({}, "", "/dashboard");
    container = document.createElement("div");
    document.body.appendChild(container);
    // Drive the debounce window deterministically by spying on Date.now
    // instead of using fake timers (we still need real setTimeout for
    // jsdom popstate to flush).
    nowMs = 1_700_000_000_000;
    dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => nowMs);
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
    dateNowSpy?.mockRestore();
    dateNowSpy = null;
  });

  function advanceClockMs(ms: number) {
    nowMs += ms;
  }

  async function renderAt(url: string) {
    window.history.replaceState({}, "", url);
    await act(async () => {
      root = createRoot(container);
      root.render(<DashboardUnderTest />);
    });
  }

  function getFilterSelect() {
    const el = container.querySelector(`[data-testid="${FILTER_TESTID}"]`);
    if (!el) throw new Error(`Could not find ${FILTER_TESTID}`);
    return el;
  }

  function getHandler() {
    const h = selectHandlers.get(FILTER_TESTID);
    if (!h) throw new Error(`No handler captured for ${FILTER_TESTID}`);
    return h;
  }

  // jsdom dispatches popstate via a delayed real timer (observed ~10–50ms),
  // so waiting a single microtask is not enough — the URL itself does not
  // update until the timer fires. Wait long enough for the URL to change,
  // then flush React inside act so wouter re-renders the new state.
  // Note: Date.now is spied to a frozen value, so we count poll iterations
  // for the timeout instead of using wall-clock time.
  async function waitForUrlChange(initialHref: string, maxAttempts = 60) {
    for (let i = 0; i < maxAttempts; i++) {
      if (window.location.href !== initialHref) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  async function goBack() {
    const before = window.location.href;
    window.history.back();
    await waitForUrlChange(before);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function goForward() {
    const before = window.location.href;
    window.history.forward();
    await waitForUrlChange(before);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("pushes a new history entry when the user picks a customer", async () => {
    await renderAt("/dashboard");

    await act(async () => {
      getHandler().onValueChange("c1");
    });
    expect(new URLSearchParams(window.location.search).get("customer")).toBe("c1");

    // The new entry must be undoable: a single Back returns to the
    // unfiltered URL (which only happens if pushState — not replaceState
    // — was used).
    await goBack();
    expect(window.location.pathname).toBe("/dashboard");
    expect(window.location.search).toBe("");
  });

  it("Back restores the previous All filter after picking a customer", async () => {
    await renderAt("/dashboard");

    await act(async () => {
      getHandler().onValueChange("c1");
    });
    expect(getFilterSelect().getAttribute("data-current")).toBe("c1");

    await goBack();

    expect(window.location.pathname).toBe("/dashboard");
    expect(window.location.search).toBe("");
    expect(getFilterSelect().getAttribute("data-current")).toBe("All");
  });

  it("Back then Forward re-applies the customer filter", async () => {
    await renderAt("/dashboard");

    await act(async () => {
      getHandler().onValueChange("c2");
    });

    await goBack();
    expect(getFilterSelect().getAttribute("data-current")).toBe("All");

    await goForward();
    expect(new URLSearchParams(window.location.search).get("customer")).toBe("c2");
    expect(getFilterSelect().getAttribute("data-current")).toBe("c2");
  });

  it("walks back through deliberate, well-spaced filter changes one at a time", async () => {
    await renderAt("/dashboard");

    await act(async () => {
      getHandler().onValueChange("c1");
    });
    advanceClockMs(1000);
    await act(async () => {
      getHandler().onValueChange("c2");
    });

    expect(getFilterSelect().getAttribute("data-current")).toBe("c2");

    await goBack();
    expect(getFilterSelect().getAttribute("data-current")).toBe("c1");

    await goBack();
    expect(getFilterSelect().getAttribute("data-current")).toBe("All");
  });

  it("collapses rapid successive filter changes into one history entry", async () => {
    await renderAt("/dashboard");

    // Three changes in quick succession (all within the debounce window):
    // the first should push, the next two should replace.
    await act(async () => {
      getHandler().onValueChange("c1");
    });
    advanceClockMs(50);
    await act(async () => {
      getHandler().onValueChange("c2");
    });
    advanceClockMs(50);
    await act(async () => {
      getHandler().onValueChange("c1");
    });

    expect(getFilterSelect().getAttribute("data-current")).toBe("c1");

    // A single Back should jump straight to the original All state, not
    // walk through the intermediate rapid selections (c2 and the first c1).
    await goBack();
    expect(window.location.pathname).toBe("/dashboard");
    expect(window.location.search).toBe("");
    expect(getFilterSelect().getAttribute("data-current")).toBe("All");
  });
});

describe("Dashboard Needs review tile", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    selectHandlers.clear();
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
    mockData.properties = [];
    mockData.beds = [];
    mockData.leases = [];
    mockData.utilities = [];
    mockData.occupants = [];
  });

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(<DashboardUnderTest />);
    });
  }

  function getCard() {
    return container.querySelector('[data-testid="card-needs-review"]');
  }

  function getCount(): string | null {
    const el = container.querySelector(
      '[data-testid="text-needs-review-occupants-count"]',
    );
    return el ? el.textContent : null;
  }

  function getCtaHref(): string | null {
    // Button uses `asChild` so the anchor itself carries the test id.
    const el = container.querySelector(
      'a[data-testid="button-needs-review-occupants-cta"]',
    );
    return el ? el.getAttribute("href") : null;
  }

  it("hides the tile when every occupant has a move-in date", async () => {
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
    ];
    mockData.occupants = [
      { id: "o1", propertyId: "p1", moveInDate: "2024-01-01" },
      { id: "o2", propertyId: "p1", moveInDate: "2024-02-01" },
    ];

    await render();

    expect(getCard()).toBeNull();
  });

  it("shows the tile with the right count when some occupants are missing a move-in date", async () => {
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
    ];
    mockData.occupants = [
      { id: "o1", propertyId: "p1", moveInDate: "2024-01-01" },
      { id: "o2", propertyId: "p1", moveInDate: "" },
      { id: "o3", propertyId: "p1", moveInDate: null },
    ];

    await render();

    expect(getCard()).not.toBeNull();
    expect(getCount()).toBe("2");
    // Without a customer scope, the CTA deep-links to the bare needsReview URL.
    expect(getCtaHref()).toBe("/occupants?needsReview=1");
  });

  it("respects the active customer scope when counting and linking", async () => {
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
      { id: "p2", name: "Hillside", customerId: "c2", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
    ];
    mockData.occupants = [
      // c1: 1 missing move-in
      { id: "o1", propertyId: "p1", moveInDate: "" },
      { id: "o2", propertyId: "p1", moveInDate: "2024-01-01" },
      // c2: 2 missing — should NOT count when scoped to c1.
      { id: "o3", propertyId: "p2", moveInDate: null },
      { id: "o4", propertyId: "p2", moveInDate: "" },
      // Unassigned occupant — never counts since it has no propertyId.
      { id: "o5", propertyId: null, moveInDate: "" },
    ];

    await render();

    // All-customers default: 3 missing across both customers (the
    // unassigned occupant is excluded by scopedOccupants).
    expect(getCount()).toBe("3");

    // Scope to c1 via the dashboard customer filter.
    const handler = selectHandlers.get(FILTER_TESTID);
    if (!handler) throw new Error("filter handler missing");
    await act(async () => {
      handler.onValueChange("c1");
    });

    expect(getCount()).toBe("1");
    // CTA carries the active customer through to the occupants page.
    expect(getCtaHref()).toBe("/occupants?needsReview=1&customer=c1");

    // Scope to c2 — count flips to 2 and the CTA re-targets c2.
    await act(async () => {
      handler.onValueChange("c2");
    });
    expect(getCount()).toBe("2");
    expect(getCtaHref()).toBe("/occupants?needsReview=1&customer=c2");
  });
});

describe("Dashboard Missing dates tile (task #367 / #412)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    selectHandlers.clear();
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
    mockData.properties = [];
    mockData.beds = [];
    mockData.leases = [];
    mockData.utilities = [];
    mockData.occupants = [];
  });

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(<DashboardUnderTest />);
    });
  }

  function getCount(): string | null {
    const el = container.querySelector(
      '[data-testid="text-needs-review-leases-needs-dates-count"]',
    );
    return el ? el.textContent : null;
  }

  function getCtaHref(): string | null {
    const el = container.querySelector(
      'a[data-testid="button-needs-review-leases-needs-dates-cta"]',
    );
    return el ? el.getAttribute("href") : null;
  }

  it("hides the tile when every lease has both start and end dates", async () => {
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
    ];
    mockData.leases = [
      { id: "l1", propertyId: "p1", startDate: "2025-01-01", endDate: "2025-12-31", monthlyRent: 1000, securityDeposit: 0, status: "Active", notes: "", clauses: "" },
      { id: "l2", propertyId: "p1", startDate: "2025-03-01", endDate: "2025-09-30", monthlyRent: 800, securityDeposit: 0, status: "Active", notes: "", clauses: "" },
    ];

    await render();

    expect(container.querySelector('[data-testid="tile-needs-review-leases-needs-dates"]')).toBeNull();
    expect(getCount()).toBeNull();
    expect(getCtaHref()).toBeNull();
  });

  it("shows the tile with the correct count when some leases are missing dates", async () => {
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
    ];
    mockData.leases = [
      { id: "l1", propertyId: "p1", startDate: "2025-01-01", endDate: "2025-12-31", monthlyRent: 1000, securityDeposit: 0, status: "Active", notes: "", clauses: "" },
      { id: "l2", propertyId: "p1", startDate: "", endDate: "2025-12-31", monthlyRent: 800, securityDeposit: 0, status: "Active", notes: "", clauses: "" },
      { id: "l3", propertyId: "p1", startDate: "2025-01-01", endDate: "", monthlyRent: 600, securityDeposit: 0, status: "Active", notes: "", clauses: "" },
      { id: "l4", propertyId: "p1", startDate: null, endDate: null, monthlyRent: 500, securityDeposit: 0, status: "Active", notes: "", clauses: "" },
    ];

    await render();

    expect(container.querySelector('[data-testid="card-needs-review"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tile-needs-review-leases-needs-dates"]')).not.toBeNull();
    expect(getCount()).toBe("3");
    expect(getCtaHref()).toBe("/leases?needsDates=1");
  });

  it("scopes the count and CTA to the active customer filter", async () => {
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
      { id: "p2", name: "Hillside", customerId: "c2", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
    ];
    mockData.leases = [
      { id: "l1", propertyId: "p1", startDate: "", endDate: "2025-12-31", monthlyRent: 800, securityDeposit: 0, status: "Active", notes: "", clauses: "" },
      { id: "l2", propertyId: "p2", startDate: "", endDate: "", monthlyRent: 600, securityDeposit: 0, status: "Active", notes: "", clauses: "" },
      { id: "l3", propertyId: "p2", startDate: "2025-01-01", endDate: "", monthlyRent: 500, securityDeposit: 0, status: "Active", notes: "", clauses: "" },
    ];

    await render();

    expect(getCount()).toBe("3");

    const handler = selectHandlers.get(FILTER_TESTID);
    if (!handler) throw new Error("filter handler missing");
    await act(async () => {
      handler.onValueChange("c1");
    });

    expect(getCount()).toBe("1");
    expect(getCtaHref()).toBe("/leases?needsDates=1&customer=c1");

    await act(async () => {
      handler.onValueChange("c2");
    });
    expect(getCount()).toBe("2");
    expect(getCtaHref()).toBe("/leases?needsDates=1&customer=c2");
  });
});

describe("Dashboard Hotel-rate at-risk tile (task #358 deep-link)", () => {
  // The Needs review card surfaces a "hotel-rate leases at risk this
  // month" item whose CTA must deep-link to /leases?atRisk=1, where the
  // matching at-risk filter (also task #358) does the actual narrowing.
  // Two contracts have to hold for the round-trip to feel honest:
  //   1. The dashboard count equals the number of Active/Upcoming
  //      hotel-rate leases that are at risk for the current month.
  //   2. The CTA href carries `?atRisk=1` so /leases lands pre-filtered
  //      and shows the same set of rows. The customer scope is also
  //      threaded through so a scoped dashboard hands a scoped list to
  //      /leases (not the global one).
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    selectHandlers.clear();
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
    mockData.properties = [];
    mockData.beds = [];
    mockData.leases = [];
    mockData.utilities = [];
    mockData.occupants = [];
  });

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(<DashboardUnderTest />);
    });
  }

  it("counts only Active/Upcoming hotel-rate leases at risk this month and points the CTA at /leases?atRisk=1", async () => {
    // Module-level useListRoomNightLogs mock returns []  → every
    // hotel-rate lease is `missing` for the current month, exactly
    // the case the tile exists to surface. Mix in non-hotel and
    // expired leases to prove they're correctly excluded from the
    // count (and therefore from the deep-linked /leases view).
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
    ];
    mockData.leases = [
      // Two at-risk hotel-rate leases — both should count.
      { id: "lH1", propertyId: "p1", status: "Active",   startDate: "2025-01-01", endDate: "2026-12-31", monthlyRent: 0, monthlyRoomNightMin: 50 },
      { id: "lH2", propertyId: "p1", status: "Upcoming", startDate: "2025-01-01", endDate: "2026-12-31", monthlyRent: 0, monthlyRoomNightMin: 25 },
      // Hotel-rate but Expired — must NOT count (rate no longer applies).
      { id: "lH3", propertyId: "p1", status: "Expired",  startDate: "2024-01-01", endDate: "2024-06-01", monthlyRent: 0, monthlyRoomNightMin: 50 },
      // Non-hotel-rate Active lease — must NOT count.
      { id: "lN1", propertyId: "p1", status: "Active",   startDate: "2025-01-01", endDate: "2026-12-31", monthlyRent: 1000 },
    ];

    await render();

    // Tile is visible with the count of 2 (lH1 + lH2).
    expect(
      container.querySelector('[data-testid="tile-needs-review-hotel-rate-at-risk"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="text-needs-review-hotel-rate-at-risk-count"]')?.textContent,
    ).toBe("2");

    // CTA is an anchor (Button asChild → Link) carrying the deep-link
    // URL that activates the matching ?atRisk=1 filter on /leases.
    const cta = container.querySelector(
      'a[data-testid="button-needs-review-hotel-rate-at-risk-cta"]',
    );
    expect(cta).not.toBeNull();
    expect(cta!.getAttribute("href")).toBe("/leases?atRisk=1");
  });

  it("hides the tile when there are no at-risk hotel-rate leases", async () => {
    // No hotel-rate leases at all (no monthlyRoomNightMin) → tile
    // must not render. Without this guard the dashboard would show a
    // 0-count "Needs review" item with a link to an empty list.
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
    ];
    mockData.leases = [
      { id: "lN1", propertyId: "p1", status: "Active", startDate: "2025-01-01", endDate: "2026-12-31", monthlyRent: 1000 },
    ];

    await render();

    expect(
      container.querySelector('[data-testid="tile-needs-review-hotel-rate-at-risk"]'),
    ).toBeNull();
  });

  it("threads the active customer scope through the CTA so the linked /leases view stays in the same scope", async () => {
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
      { id: "p2", name: "Hillside", customerId: "c2", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
    ];
    mockData.leases = [
      { id: "lH-c1", propertyId: "p1", status: "Active", startDate: "2025-01-01", endDate: "2026-12-31", monthlyRent: 0, monthlyRoomNightMin: 50 },
      { id: "lH-c2", propertyId: "p2", status: "Active", startDate: "2025-01-01", endDate: "2026-12-31", monthlyRent: 0, monthlyRoomNightMin: 50 },
    ];

    await render();

    // Both at-risk under all-customers default.
    expect(
      container.querySelector('[data-testid="text-needs-review-hotel-rate-at-risk-count"]')?.textContent,
    ).toBe("2");
    expect(
      container
        .querySelector('a[data-testid="button-needs-review-hotel-rate-at-risk-cta"]')
        ?.getAttribute("href"),
    ).toBe("/leases?atRisk=1");

    // Scope to c1 → count drops to 1 and the CTA carries the scope so
    // /leases lands on the same filter+scope combo.
    const handler = selectHandlers.get(FILTER_TESTID);
    if (!handler) throw new Error("filter handler missing");
    await act(async () => {
      handler.onValueChange("c1");
    });

    expect(
      container.querySelector('[data-testid="text-needs-review-hotel-rate-at-risk-count"]')?.textContent,
    ).toBe("1");
    expect(
      container
        .querySelector('a[data-testid="button-needs-review-hotel-rate-at-risk-cta"]')
        ?.getAttribute("href"),
    ).toBe("/leases?atRisk=1&customer=c1");
  });
});

describe("Dashboard Unplaced payroll tile", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    selectHandlers.clear();
    dialogProps.length = 0;
    invalidateQueriesMock.mockReset();
    addOccupantMock.mockReset();
    updateBedMock.mockReset();
    updateOccupantMock.mockReset();
    toastMock.mockReset();
    unplacedPayrollState.rows = [];
    unplacedPayrollState.lowConfidenceMatches = [];
    mockData.isLoading = false;
    mockData.properties = [];
    mockData.occupants = [];
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
    unplacedPayrollState.rows = [];
    unplacedPayrollState.lowConfidenceMatches = [];
  });

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(<DashboardUnderTest />);
    });
  }

  it("hides the tile when the payroll list is empty", async () => {
    unplacedPayrollState.rows = [];
    await render();
    expect(container.querySelector('[data-testid="card-unplaced-payroll"]')).toBeNull();
    expect(container.querySelector('[data-testid="card-low-confidence-payroll"]')).toBeNull();
  });

  it("groups rows by customer, shows weekly totals, and pre-fills the assign dialog", async () => {
    unplacedPayrollState.rows = [
      { customer: "Acme Co", name: "Jane Smith", personId: "EMP1", weekly: 100, suggestions: [] },
      { customer: "Acme Co", name: "John Doe", personId: "EMP2", weekly: 75, suggestions: [] },
      { customer: "Globex", name: "Sarah Lee", personId: "EMP3", weekly: 200, suggestions: [] },
    ];

    await render();

    const card = container.querySelector('[data-testid="card-unplaced-payroll"]');
    expect(card).not.toBeNull();
    // Total row count badge.
    expect(
      container.querySelector('[data-testid="text-unplaced-payroll-total-count"]')?.textContent,
    ).toContain("3");
    // Both customer groups present.
    expect(container.querySelector('[data-testid="group-unplaced-Acme Co"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="group-unplaced-Globex"]')).not.toBeNull();
    // Three dialog stubs (one per row), each pre-filled with the row data.
    expect(dialogProps).toHaveLength(3);
    const acmeJane = dialogProps.find((p) => (p.testIdSuffix as string) === "EMP1");
    expect(acmeJane?.initial).toEqual({
      name: "Jane Smith",
      company: "Acme Co",
      employeeId: "EMP1",
      chargePerBed: 100,
      billingFrequency: "Weekly",
    });
  });

  it("scopes the list to the active customer filter", async () => {
    unplacedPayrollState.rows = [
      { customer: "Acme Co", name: "Jane Smith", personId: "EMP1", weekly: 100, suggestions: [] },
      { customer: "Globex", name: "Sarah Lee", personId: "EMP3", weekly: 200, suggestions: [] },
    ];

    await render();

    // All-customers default shows both groups.
    expect(container.querySelector('[data-testid="group-unplaced-Acme Co"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="group-unplaced-Globex"]')).not.toBeNull();

    const handler = selectHandlers.get(FILTER_TESTID);
    if (!handler) throw new Error("filter handler missing");
    await act(async () => {
      handler.onValueChange("c1"); // Acme Co
    });

    expect(container.querySelector('[data-testid="group-unplaced-Acme Co"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="group-unplaced-Globex"]')).toBeNull();
  });

  it("renders a distinct 'different employer' label and prompts for confirmation before overwriting company on cross-employer suggestions", async () => {
    unplacedPayrollState.rows = [
      {
        customer: "Penda Corp",
        name: "JANE A SMITH",
        personId: "EMP9",
        weekly: 175,
        suggestions: [
          {
            occupantId: "occ-cross",
            name: "Jane Smith",
            company: "Trienda Holdings",
            propertyName: "Maple Court",
            score: 0.95,
            crossEmployer: true,
          },
        ],
      },
    ];

    await render();

    const wrap = container.querySelector(
      '[data-testid="suggestions-unplaced-EMP9"]',
    );
    expect(wrap).not.toBeNull();
    expect(wrap?.textContent ?? "").toContain("different employer");
    const btn = container.querySelector(
      '[data-testid="button-apply-suggestion-EMP9-occ-cross"]',
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    // Display includes the candidate's current employer so the operator
    // sees what they're switching away from.
    expect(btn?.textContent ?? "").toContain("Trienda Holdings");

    // First click: opens the confirm dialog. Nothing is written yet
    // because the operator hasn't confirmed the employer change.
    await act(async () => {
      btn!.click();
    });

    expect(updateOccupantMock).not.toHaveBeenCalled();
    expect(invalidateQueriesMock).not.toHaveBeenCalled();

    const dialog = container.querySelector(
      '[data-testid="dialog-confirm-employer-move"]',
    );
    expect(dialog).not.toBeNull();
    const dialogText = dialog?.textContent ?? "";
    expect(dialogText).toContain("Jane Smith");
    expect(dialogText).toContain("Trienda Holdings");
    expect(dialogText).toContain("Penda Corp");
    expect(dialogText).toContain("Maple Court");

    const confirm = container.querySelector(
      '[data-testid="button-confirm-employer-move-confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirm).not.toBeNull();

    await act(async () => {
      confirm!.click();
    });

    expect(updateOccupantMock).toHaveBeenCalledWith("occ-cross", {
      chargePerBed: 175,
      billingFrequency: "Weekly",
      employeeId: "EMP9",
      company: "Penda Corp",
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["/payroll/unplaced"],
    });
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Occupant moved" }),
    );

    // Dialog closes once the move has been applied.
    expect(
      container.querySelector('[data-testid="dialog-confirm-employer-move"]'),
    ).toBeNull();
  });

  it("cancelling the cross-employer confirm dialog leaves the occupant unchanged", async () => {
    unplacedPayrollState.rows = [
      {
        customer: "Penda Corp",
        name: "JANE A SMITH",
        personId: "EMP9",
        weekly: 175,
        suggestions: [
          {
            occupantId: "occ-cross",
            name: "Jane Smith",
            company: "Trienda Holdings",
            propertyName: "Maple Court",
            score: 0.95,
            crossEmployer: true,
          },
        ],
      },
    ];

    await render();

    const btn = container.querySelector(
      '[data-testid="button-apply-suggestion-EMP9-occ-cross"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      btn!.click();
    });

    const cancel = container.querySelector(
      '[data-testid="button-confirm-employer-move-cancel"]',
    ) as HTMLButtonElement | null;
    expect(cancel).not.toBeNull();
    await act(async () => {
      cancel!.click();
    });

    expect(updateOccupantMock).not.toHaveBeenCalled();
    expect(invalidateQueriesMock).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("renders the plain 'Did you mean:' label and does NOT touch company for same-employer suggestions", async () => {
    unplacedPayrollState.rows = [
      {
        customer: "Acme Co",
        name: "JANE A SMITH",
        personId: "EMP10",
        weekly: 100,
        suggestions: [
          {
            occupantId: "occ-same",
            name: "Jane Smith",
            company: "Acme Co",
            propertyName: "Maple Court",
            score: 0.95,
            crossEmployer: false,
          },
        ],
      },
    ];

    await render();

    const wrap = container.querySelector(
      '[data-testid="suggestions-unplaced-EMP10"]',
    );
    expect(wrap?.textContent ?? "").toContain("Did you mean:");
    expect(wrap?.textContent ?? "").not.toContain("different employer");

    const btn = container.querySelector(
      '[data-testid="button-apply-suggestion-EMP10-occ-same"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      btn!.click();
    });

    expect(updateOccupantMock).toHaveBeenCalledWith("occ-same", {
      chargePerBed: 100,
      billingFrequency: "Weekly",
      employeeId: "EMP10",
    });
    // Same-employer suggestions skip the confirm dialog entirely.
    expect(
      container.querySelector('[data-testid="dialog-confirm-employer-move"]'),
    ).toBeNull();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Suggestion applied" }),
    );
  });

  it("routes the row to the pending-placement bucket page (and skips the create-new dialog) when an existing occupant already owns this employeeId — Task #349 duplicate guard", async () => {
    mockData.properties = [
      {
        id: "prop-pending-acme",
        name: "Roster — Pending Placement (Acme Co)",
        customerId: "c1",
        monthlyRent: 0,
        totalBeds: 0,
        ratings: {},
        paymentNotes: "",
        notes: "",
      },
    ];
    mockData.occupants = [
      {
        id: "occ-pending-emp1",
        name: "Jane Smith",
        employeeId: "EMP1",
        company: "Acme Co",
        propertyId: "prop-pending-acme",
        bedId: null,
        status: "Active",
      },
    ];
    unplacedPayrollState.rows = [
      { customer: "Acme Co", name: "Jane Smith", personId: "EMP1", weekly: 100, suggestions: [] },
    ];

    await render();

    // The create-new dialog must NOT render for this row — that's the
    // exact path that would call addOccupant and produce a duplicate.
    expect(
      container.querySelector('[data-testid="assign-dialog-stub-EMP1"]'),
    ).toBeNull();
    // Instead, a link to the pending-placement bucket is shown.
    const link = container.querySelector(
      '[data-testid="button-open-existing-unplaced-EMP1"]',
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/properties/prop-pending-acme");
    expect(link?.getAttribute("data-existing-pending")).toBe("1");
    expect(link?.textContent ?? "").toContain("Open pending bucket");
  });

  it("links to the existing occupant's property (not the bucket label) when the matched occupant lives in a real property", async () => {
    mockData.properties = [
      {
        id: "prop-real",
        name: "Maple Court",
        customerId: "c1",
        monthlyRent: 1000,
        totalBeds: 4,
        ratings: {},
        paymentNotes: "",
        notes: "",
      },
    ];
    mockData.occupants = [
      {
        id: "occ-emp2",
        name: "John Doe",
        employeeId: "EMP2",
        company: "Acme Co",
        propertyId: "prop-real",
        bedId: "bed-1",
        status: "Active",
      },
    ];
    unplacedPayrollState.rows = [
      { customer: "Acme Co", name: "John Doe", personId: "EMP2", weekly: 75, suggestions: [] },
    ];

    await render();

    expect(
      container.querySelector('[data-testid="assign-dialog-stub-EMP2"]'),
    ).toBeNull();
    const link = container.querySelector(
      '[data-testid="button-open-existing-unplaced-EMP2"]',
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/properties/prop-real");
    expect(link?.getAttribute("data-existing-pending")).toBe("0");
    expect(link?.textContent ?? "").toContain("Open occupant");
  });

  it("blocks the create-new dialog even when the matched occupant has a missing/orphaned propertyId — strict no-duplicate guard (Task #349)", async () => {
    // No matching property in mockData.properties — propertyById lookup
    // returns undefined. The guard must STILL skip the create-new dialog
    // and offer a fallback link to the occupants page.
    mockData.properties = [];
    mockData.occupants = [
      {
        id: "occ-orphan",
        name: "Orphan Person",
        employeeId: "EMP9",
        company: "Acme Co",
        propertyId: "prop-missing",
        bedId: null,
        status: "Active",
      },
    ];
    unplacedPayrollState.rows = [
      { customer: "Acme Co", name: "Orphan Person", personId: "EMP9", weekly: 50, suggestions: [] },
    ];

    await render();

    expect(
      container.querySelector('[data-testid="assign-dialog-stub-EMP9"]'),
    ).toBeNull();
    const link = container.querySelector(
      '[data-testid="button-open-existing-unplaced-EMP9"]',
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe(
      `/occupants?focus=${encodeURIComponent("occ-orphan")}`,
    );
    expect(link?.getAttribute("data-existing-pending")).toBe("0");
  });

  it("on assign: writes occupant + bed and invalidates the unplaced list so the row drops off", async () => {
    unplacedPayrollState.rows = [
      { customer: "Acme Co", name: "Jane Smith", personId: "EMP1", weekly: 100, suggestions: [] },
    ];

    await render();

    const props = dialogProps[0];
    expect(props).toBeDefined();
    const onAssign = props.onAssign as (
      occ: { id: string },
      bed: { id: string; propertyId: string },
    ) => void;
    await act(async () => {
      onAssign(
        { id: "occ-new" } as { id: string },
        { id: "bed-1", propertyId: "p1" },
      );
    });

    expect(addOccupantMock).toHaveBeenCalledTimes(1);
    expect(updateBedMock).toHaveBeenCalledWith("bed-1", {
      status: "Occupied",
      occupantId: "occ-new",
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["/payroll/unplaced"],
    });
  });
});

describe("Dashboard Lease expiry alerts", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    selectHandlers.clear();
    invalidateQueriesMock.mockReset();
    updateOccupantMock.mockReset();
    unplacedPayrollState.rows = [];
    unplacedPayrollState.lowConfidenceMatches = [];
    mockData.isLoading = false;
    mockData.properties = [];
    mockData.beds = [];
    mockData.leases = [];
    mockData.utilities = [];
    mockData.occupants = [];
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/dashboard");
    container = document.createElement("div");
    document.body.appendChild(container);
    // Freeze the system clock at 2026-05-06 so day-distance math in
    // `daysUntil` (which calls `new Date()`) is deterministic.
    // `vi.useFakeTimers` + `setSystemTime` controls both `Date.now` and
    // the no-arg `new Date()` constructor, unlike a `Date.now` spy.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T12:00:00Z"));
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
    vi.useRealTimers();
    mockData.properties = [];
    mockData.leases = [];
    unplacedPayrollState.lowConfidenceMatches = [];
  });

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(<DashboardUnderTest />);
    });
  }

  function getCard() {
    return container.querySelector('[data-testid="card-expiring-leases"]');
  }

  it("hides the card when no leases fall in the alert windows", async () => {
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
    ];
    mockData.leases = [
      // Far-future end date — outside the 90-day window.
      { id: "l1", propertyId: "p1", status: "Active", startDate: "2025-01-01", endDate: "2027-01-01", monthlyRent: 100 },
      // Long-expired — outside the 30-day look-back.
      { id: "l2", propertyId: "p1", status: "Expired", startDate: "2023-01-01", endDate: "2024-01-01", monthlyRent: 100 },
    ];

    await render();

    expect(getCard()).toBeNull();
  });

  it("buckets leases into critical / warning / soon / expired and links each row to lease detail", async () => {
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
    ];
    mockData.leases = [
      // Expired 5 days ago.
      { id: "l-exp", propertyId: "p1", status: "Expired", startDate: "2024-01-01", endDate: "2026-05-01", monthlyRent: 100 },
      // Critical: 15 days left.
      { id: "l-crit", propertyId: "p1", status: "Active", startDate: "2025-01-01", endDate: "2026-05-21", monthlyRent: 100 },
      // Warning: 45 days left.
      { id: "l-warn", propertyId: "p1", status: "Active", startDate: "2025-01-01", endDate: "2026-06-20", monthlyRent: 100 },
      // Soon: 75 days left.
      { id: "l-soon", propertyId: "p1", status: "Active", startDate: "2025-01-01", endDate: "2026-07-20", monthlyRent: 100 },
      // Out of range — no row.
      { id: "l-far", propertyId: "p1", status: "Active", startDate: "2025-01-01", endDate: "2027-05-06", monthlyRent: 100 },
      // Upcoming — never alerted.
      { id: "l-up", propertyId: "p1", status: "Upcoming", startDate: "2026-06-01", endDate: "2026-05-21", monthlyRent: 100 },
    ];

    await render();

    expect(getCard()).not.toBeNull();
    expect(
      container.querySelector('[data-testid="text-expiring-leases-total-count"]')?.textContent,
    ).toContain("4");

    // Each bucketed lease appears as its own row with the right bucket
    // attribute.
    const expRow = container.querySelector('[data-testid="row-expiring-lease-l-exp"]');
    const critRow = container.querySelector('[data-testid="row-expiring-lease-l-crit"]');
    const warnRow = container.querySelector('[data-testid="row-expiring-lease-l-warn"]');
    const soonRow = container.querySelector('[data-testid="row-expiring-lease-l-soon"]');
    expect(expRow?.getAttribute("data-bucket")).toBe("expired");
    expect(critRow?.getAttribute("data-bucket")).toBe("critical");
    expect(warnRow?.getAttribute("data-bucket")).toBe("warning");
    expect(soonRow?.getAttribute("data-bucket")).toBe("soon");

    // Out-of-range leases must NOT appear.
    expect(container.querySelector('[data-testid="row-expiring-lease-l-far"]')).toBeNull();
    expect(container.querySelector('[data-testid="row-expiring-lease-l-up"]')).toBeNull();

    // Bucket counter chips reflect the breakdown.
    expect(
      container.querySelector('[data-testid="bucket-count-expiring-leases-expired"]')?.textContent,
    ).toContain("1");
    expect(
      container.querySelector('[data-testid="bucket-count-expiring-leases-critical"]')?.textContent,
    ).toContain("1");
    expect(
      container.querySelector('[data-testid="bucket-count-expiring-leases-warning"]')?.textContent,
    ).toContain("1");
    expect(
      container.querySelector('[data-testid="bucket-count-expiring-leases-soon"]')?.textContent,
    ).toContain("1");

    // Each row links to /leases/<id>.
    const link = container.querySelector(
      'a[data-testid="link-expiring-lease-l-crit"]',
    );
    expect(link?.getAttribute("href")).toBe("/leases/l-crit");

    // The "When" cell phrases days correctly: future leases say "X days
    // left", expired ones say "Expired N days ago".
    expect(
      container.querySelector('[data-testid="text-expiring-lease-l-crit-when"]')?.textContent,
    ).toBe("15 days left");
    expect(
      container.querySelector('[data-testid="text-expiring-lease-l-exp-when"]')?.textContent,
    ).toBe("Expired 5 days ago");
  });

  it("sorts most-overdue first, then soonest expiring", async () => {
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
    ];
    mockData.leases = [
      { id: "l-soon", propertyId: "p1", status: "Active", startDate: "2025-01-01", endDate: "2026-07-20", monthlyRent: 100 },
      { id: "l-crit", propertyId: "p1", status: "Active", startDate: "2025-01-01", endDate: "2026-05-21", monthlyRent: 100 },
      { id: "l-exp", propertyId: "p1", status: "Expired", startDate: "2024-01-01", endDate: "2026-05-01", monthlyRent: 100 },
    ];

    await render();

    const rows = Array.from(
      container.querySelectorAll('[data-testid^="row-expiring-lease-"]'),
    ).map((el) => el.getAttribute("data-testid"));
    expect(rows).toEqual([
      "row-expiring-lease-l-exp",
      "row-expiring-lease-l-crit",
      "row-expiring-lease-l-soon",
    ]);
  });

  it("respects the active customer scope", async () => {
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
      { id: "p2", name: "Hillside", customerId: "c2", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
    ];
    mockData.leases = [
      { id: "l-c1", propertyId: "p1", status: "Active", startDate: "2025-01-01", endDate: "2026-05-21", monthlyRent: 100 },
      { id: "l-c2", propertyId: "p2", status: "Active", startDate: "2025-01-01", endDate: "2026-05-21", monthlyRent: 100 },
    ];

    await render();

    // All-customers default shows both.
    expect(container.querySelector('[data-testid="row-expiring-lease-l-c1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-expiring-lease-l-c2"]')).not.toBeNull();

    const handler = selectHandlers.get(FILTER_TESTID);
    if (!handler) throw new Error("filter handler missing");
    await act(async () => {
      handler.onValueChange("c1");
    });

    expect(container.querySelector('[data-testid="row-expiring-lease-l-c1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-expiring-lease-l-c2"]')).toBeNull();
  });
});

describe("Dashboard Lease expiry snooze (Task #357)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    selectHandlers.clear();
    invalidateQueriesMock.mockReset();
    updateOccupantMock.mockReset();
    updateLeaseMock.mockReset();
    toastMock.mockReset();
    unplacedPayrollState.rows = [];
    unplacedPayrollState.lowConfidenceMatches = [];
    mockData.isLoading = false;
    mockData.properties = [];
    mockData.beds = [];
    mockData.leases = [];
    mockData.utilities = [];
    mockData.occupants = [];
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/dashboard");
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T12:00:00Z"));
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
    vi.useRealTimers();
    mockData.properties = [];
    mockData.leases = [];
  });

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(<DashboardUnderTest />);
    });
  }

  it("hides a row whose snoozedUntil is in the future and exposes a snooze action that calls updateLease", async () => {
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
    ];
    mockData.leases = [
      // Critical (15 days left) — should appear, snooze action available.
      { id: "l-crit", propertyId: "p1", status: "Active", startDate: "2025-01-01", endDate: "2026-05-21", monthlyRent: 100 },
      // Warning (45 days left) — already snoozed past today, hidden from
      // the panel and surfaced in the "snoozed" summary instead.
      {
        id: "l-warn",
        propertyId: "p1",
        status: "Active",
        startDate: "2025-01-01",
        endDate: "2026-06-20",
        monthlyRent: 100,
        snoozedUntil: "2026-06-01",
      },
      // Snooze date already passed — must NOT be treated as snoozed,
      // mirrors the operator-visible contract that the row reappears
      // once the window passes.
      {
        id: "l-soon",
        propertyId: "p1",
        status: "Active",
        startDate: "2025-01-01",
        endDate: "2026-07-20",
        monthlyRent: 100,
        snoozedUntil: "2026-04-01",
      },
    ];

    await render();

    // Snoozed row hidden, expired-snooze row visible, total reflects 2.
    expect(container.querySelector('[data-testid="row-expiring-lease-l-crit"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-expiring-lease-l-soon"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-expiring-lease-l-warn"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="text-expiring-leases-total-count"]')?.textContent,
    ).toContain("2");
    expect(
      container.querySelector('[data-testid="text-snoozed-leases-count"]')?.textContent,
    ).toContain("1");

    // Click "Snooze 7 days" on the visible critical row → updateLease is
    // called with a YYYY-MM-DD 7 days from today (2026-05-06 → 2026-05-13).
    const snoozeBtn = container.querySelector(
      '[data-testid="button-snooze-lease-l-crit-7d"]',
    ) as HTMLButtonElement | null;
    expect(snoozeBtn).not.toBeNull();
    await act(async () => {
      snoozeBtn!.click();
    });
    expect(updateLeaseMock).toHaveBeenCalledWith(
      "l-crit",
      expect.objectContaining({
        snoozedUntil: "2026-05-13",
        snoozedAt: expect.any(String),
        snoozedBy: expect.any(String),
      }),
    );

    // "Renewal in progress" preset snoozes for ~1 year.
    const renewalBtn = container.querySelector(
      '[data-testid="button-snooze-lease-l-crit-renewal"]',
    ) as HTMLButtonElement | null;
    expect(renewalBtn).not.toBeNull();
    await act(async () => {
      renewalBtn!.click();
    });
    expect(updateLeaseMock).toHaveBeenLastCalledWith(
      "l-crit",
      expect.objectContaining({
        snoozedUntil: "2027-05-06",
        snoozedAt: expect.any(String),
        snoozedBy: expect.any(String),
      }),
    );

    // "Unsnooze all" clears the future-snoozed rows.
    const unsnoozeAll = container.querySelector(
      '[data-testid="button-unsnooze-all-leases"]',
    ) as HTMLButtonElement | null;
    expect(unsnoozeAll).not.toBeNull();
    await act(async () => {
      unsnoozeAll!.click();
    });
    expect(updateLeaseMock).toHaveBeenLastCalledWith("l-warn", {
      snoozedUntil: "",
      snoozedAt: "",
      snoozedBy: "",
    });
  });

  it("keeps the card visible when every active alert is snoozed so operators can undo", async () => {
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
    ];
    mockData.leases = [
      {
        id: "l-crit",
        propertyId: "p1",
        status: "Active",
        startDate: "2025-01-01",
        endDate: "2026-05-21",
        monthlyRent: 100,
        snoozedUntil: "2026-06-30",
      },
    ];

    await render();

    // No active alerts but card stays so the operator can unsnooze.
    expect(container.querySelector('[data-testid="card-expiring-leases"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-expiring-lease-l-crit"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="text-expiring-leases-total-count"]')?.textContent,
    ).toContain("0");
    expect(
      container.querySelector('[data-testid="text-snoozed-leases-count"]')?.textContent,
    ).toContain("1");
  });

});

describe("Dashboard Confirm match (low-confidence payroll) tile", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    selectHandlers.clear();
    invalidateQueriesMock.mockReset();
    updateOccupantMock.mockReset();
    unplacedPayrollState.rows = [];
    unplacedPayrollState.lowConfidenceMatches = [];
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
    unplacedPayrollState.lowConfidenceMatches = [];
  });

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(<DashboardUnderTest />);
    });
  }

  it("renders one row per low-confidence match with the currently-applied occupant and alternatives", async () => {
    unplacedPayrollState.lowConfidenceMatches = [
      {
        customer: "Acme Co",
        name: "JOSE GARCIA",
        personId: "EMP9",
        weekly: 125,
        matched: { occupantId: "occ-a", name: "Jose Garcia", company: "Acme Co", propertyName: "Hilltop", score: 1, crossEmployer: false },
        suggestions: [
          { occupantId: "occ-b", name: "Jose Garcia", company: "Acme Co", propertyName: "Lakeside", score: 1, crossEmployer: false },
        ],
      },
    ];

    await render();

    expect(container.querySelector('[data-testid="card-low-confidence-payroll"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="text-low-confidence-payroll-total-count"]')?.textContent,
    ).toContain("1");
    expect(
      container.querySelector('[data-testid="row-low-confidence-EMP9"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="low-confidence-matched-EMP9"]')?.textContent,
    ).toContain("Jose Garcia @ Hilltop");
    expect(
      container.querySelector('[data-testid="button-redirect-low-confidence-EMP9-occ-b"]'),
    ).not.toBeNull();
  });

  it("Confirm stamps the payroll Person Id on the matched occupant and refetches", async () => {
    unplacedPayrollState.lowConfidenceMatches = [
      {
        customer: "Acme Co",
        name: "JOSE GARCIA",
        personId: "EMP9",
        weekly: 125,
        matched: { occupantId: "occ-a", name: "Jose Garcia", company: "Acme Co", propertyName: "Hilltop", score: 1, crossEmployer: false },
        suggestions: [],
      },
    ];

    await render();

    const btn = container.querySelector(
      '[data-testid="button-confirm-low-confidence-EMP9"]',
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    await act(async () => {
      btn!.click();
    });

    expect(updateOccupantMock).toHaveBeenCalledWith("occ-a", { employeeId: "EMP9" });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["/payroll/unplaced"] });
  });

  it("Pick-different redirects the rate to an alternate occupant and refetches", async () => {
    unplacedPayrollState.lowConfidenceMatches = [
      {
        customer: "Acme Co",
        name: "JOSE GARCIA",
        personId: "EMP9",
        weekly: 125,
        matched: { occupantId: "occ-a", name: "Jose Garcia", company: "Acme Co", propertyName: "Hilltop", score: 1, crossEmployer: false },
        suggestions: [
          { occupantId: "occ-b", name: "Jose Garcia", company: "Acme Co", propertyName: "Lakeside", score: 1, crossEmployer: false },
        ],
      },
    ];

    await render();

    const btn = container.querySelector(
      '[data-testid="button-redirect-low-confidence-EMP9-occ-b"]',
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    await act(async () => {
      btn!.click();
    });

    expect(updateOccupantMock).toHaveBeenCalledWith("occ-b", {
      chargePerBed: 125,
      billingFrequency: "Weekly",
      employeeId: "EMP9",
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["/payroll/unplaced"] });
  });

  it("scopes the list to the active customer filter", async () => {
    unplacedPayrollState.lowConfidenceMatches = [
      {
        customer: "Acme Co",
        name: "A",
        personId: "EMP1",
        weekly: 100,
        matched: { occupantId: "occ-a", name: "A", company: "Acme Co", propertyName: null, score: 1, crossEmployer: false },
        suggestions: [],
      },
      {
        customer: "Globex",
        name: "B",
        personId: "EMP2",
        weekly: 50,
        matched: { occupantId: "occ-b", name: "B", company: "Globex", propertyName: null, score: 1, crossEmployer: false },
        suggestions: [],
      },
    ];

    await render();

    expect(container.querySelector('[data-testid="group-low-confidence-Acme Co"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="group-low-confidence-Globex"]')).not.toBeNull();

    const handler = selectHandlers.get(FILTER_TESTID);
    if (!handler) throw new Error("filter handler missing");
    await act(async () => {
      handler.onValueChange("c1"); // Acme Co
    });

    expect(container.querySelector('[data-testid="group-low-confidence-Acme Co"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="group-low-confidence-Globex"]')).toBeNull();
  });
});

describe("Dashboard Property Performance correctness", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    selectHandlers.clear();
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
    mockData.properties = [];
    mockData.beds = [];
    mockData.leases = [];
    mockData.utilities = [];
  });

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(<DashboardUnderTest />);
    });
  }

  function getProfitLossText(propertyId: string): string {
    const row = container.querySelector(`[data-testid="row-perf-${propertyId}"]`);
    if (!row) throw new Error(`Could not find row-perf-${propertyId}`);
    return row.textContent ?? "";
  }

  it("sums every Active lease per property (does not stop at the first)", async () => {
    // Property p1 has TWO active leases ($1,000 + $2,000 = $3,000 total
    // monthly cost). The old `find(...)` code would have only counted the
    // first $1,000 lease and reported a $1,500 profit; the correct sum
    // produces a $500 profit instead.
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 500, totalBeds: 5, ratings: {}, paymentNotes: "", notes: "" },
    ];
    mockData.beds = [
      { id: "b1", propertyId: "p1", status: "Occupied", roomId: "r1" },
      { id: "b2", propertyId: "p1", status: "Occupied", roomId: "r1" },
      { id: "b3", propertyId: "p1", status: "Occupied", roomId: "r1" },
      { id: "b4", propertyId: "p1", status: "Occupied", roomId: "r1" },
      { id: "b5", propertyId: "p1", status: "Occupied", roomId: "r1" },
    ];
    mockData.leases = [
      { id: "l1", propertyId: "p1", status: "Active", monthlyRent: 1000 },
      { id: "l2", propertyId: "p1", status: "Active", monthlyRent: 2000 },
      // An expired lease must NOT count toward cost.
      { id: "l3", propertyId: "p1", status: "Expired", monthlyRent: 9999 },
    ];
    mockData.utilities = [];

    await render();

    const text = getProfitLossText("p1");
    // Revenue = 5 occupied * $500 = $2,500. Cost = $3,000. Loss = $500.
    expect(text).toContain("$500");
    expect(text).toContain("Loss");
  });

  it("keys rows by property id so duplicate names don't mis-map", async () => {
    // Two distinct properties share the SAME display name. The old code
    // looked them up with `find(p => p.name === data.name)` which would
    // bind both rows to the first property — corrupting the customer
    // and occupancy columns. Using `id` keeps them distinct.
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
      { id: "p2", name: "Lakeside", customerId: "c2", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
    ];
    mockData.beds = [
      { id: "b1", propertyId: "p1", status: "Occupied", roomId: "r1" },
      { id: "b2", propertyId: "p2", status: "Vacant", roomId: "r2" },
    ];
    mockData.leases = [];
    mockData.utilities = [];

    await render();

    const row1 = container.querySelector('[data-testid="row-perf-p1"]');
    const row2 = container.querySelector('[data-testid="row-perf-p2"]');
    expect(row1).toBeTruthy();
    expect(row2).toBeTruthy();
    // Distinct customer columns prove rows resolved to distinct properties.
    expect(row1?.textContent).toContain("Acme Co");
    expect(row2?.textContent).toContain("Globex");
    // Distinct occupancies (100% vs 0%) prove bed lookups went to the
    // correct property id, not the duplicate name.
    expect(row1?.textContent).toContain("100%");
    expect(row2?.textContent).toContain("0%");
  });

  it("derives occupancy from real bed rows, not the static totalBeds field", async () => {
    // The property record claims totalBeds=99 but only 2 real beds exist.
    // The old `occupied / (totalBeds || 1)` math would print 1% (1/99).
    // The correct math uses the actual bed count and prints 50% (1/2).
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 100, totalBeds: 99, ratings: {}, paymentNotes: "", notes: "" },
    ];
    mockData.beds = [
      { id: "b1", propertyId: "p1", status: "Occupied", roomId: "r1" },
      { id: "b2", propertyId: "p1", status: "Vacant", roomId: "r1" },
    ];
    mockData.leases = [];
    mockData.utilities = [];

    await render();

    const row = container.querySelector('[data-testid="row-perf-p1"]');
    expect(row?.textContent).toContain("50%");
  });
});

// Task #351: when an operator clicks a "Did you mean" / "Confirm"
// button, the dashboard should keep an audit trail of the applied
// suggestions so a wrong guess is easy to spot afterwards.
import {
  __resetRecentPayrollReconciliationsForTests,
  __getRecentPayrollReconciliationsForTests,
} from "@/lib/recent-payroll-reconciliations";

describe("Dashboard recently-reconciled-from-payroll audit trail", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    selectHandlers.clear();
    invalidateQueriesMock.mockReset();
    updateOccupantMock.mockReset();
    unplacedPayrollState.rows = [];
    unplacedPayrollState.lowConfidenceMatches = [];
    mockData.isLoading = false;
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/dashboard");
    __resetRecentPayrollReconciliationsForTests();
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
    __resetRecentPayrollReconciliationsForTests();
  });

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(<DashboardUnderTest />);
    });
  }

  it("hides the card when there is no audit trail yet", async () => {
    await render();
    expect(
      container.querySelector('[data-testid="card-recent-payroll-reconciliations"]'),
    ).toBeNull();
  });

  it("logs a cross-employer apply with the warning badge and a link to the occupant", async () => {
    unplacedPayrollState.rows = [
      {
        customer: "Penda",
        name: "JOSE GARCIA",
        personId: "EMP9",
        weekly: 175,
        suggestions: [
          {
            occupantId: "occ-x",
            name: "Jose Garcia",
            company: "Trienda",
            propertyName: "Park Place",
            score: 0.95,
            crossEmployer: true,
          },
        ],
      },
    ];

    await render();

    const btn = container.querySelector(
      '[data-testid="button-apply-suggestion-EMP9-occ-x"]',
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    await act(async () => {
      btn!.click();
    });

    expect(updateOccupantMock).toHaveBeenCalledWith("occ-x", {
      chargePerBed: 175,
      billingFrequency: "Weekly",
      employeeId: "EMP9",
      company: "Penda",
    });

    const snap = __getRecentPayrollReconciliationsForTests();
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({
      occupantId: "occ-x",
      occupantName: "Jose Garcia",
      propertyName: "Park Place",
      employer: "Penda",
      weekly: 175,
      kind: "cross-employer",
    });

    const card = container.querySelector(
      '[data-testid="card-recent-payroll-reconciliations"]',
    );
    expect(card).not.toBeNull();
    const badge = container.querySelector(
      '[data-testid="badge-recent-reconciliation-kind-occ-x"]',
    );
    expect(badge?.textContent).toContain("Cross-employer");
    const link = container.querySelector(
      '[data-testid="link-recent-reconciliation-occ-x"]',
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toContain("/occupants?q=Jose%20Garcia");
  });

  it("logs a low-confidence Confirm with the 'Confirmed' badge", async () => {
    unplacedPayrollState.lowConfidenceMatches = [
      {
        customer: "Acme Co",
        name: "JOSE GARCIA",
        personId: "EMP9",
        weekly: 125,
        matched: {
          occupantId: "occ-a",
          name: "Jose Garcia",
          company: "Acme Co",
          propertyName: "Hilltop",
          score: 1,
          crossEmployer: false,
        },
        suggestions: [],
      },
    ];

    await render();

    const btn = container.querySelector(
      '[data-testid="button-confirm-low-confidence-EMP9"]',
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    await act(async () => {
      btn!.click();
    });

    const snap = __getRecentPayrollReconciliationsForTests();
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({
      occupantId: "occ-a",
      occupantName: "Jose Garcia",
      propertyName: "Hilltop",
      employer: "Acme Co",
      weekly: 125,
      kind: "confirm",
    });

    const badge = container.querySelector(
      '[data-testid="badge-recent-reconciliation-kind-occ-a"]',
    );
    expect(badge?.textContent).toContain("Confirmed");
  });
});

describe("Dashboard payroll-needs-review KPI (Task #406)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    selectHandlers.clear();
    invalidateQueriesMock.mockReset();
    updateOccupantMock.mockReset();
    toastMock.mockReset();
    unplacedPayrollState.rows = [];
    unplacedPayrollState.lowConfidenceMatches = [];
    mockData.isLoading = false;
    mockData.properties = [];
    mockData.beds = [];
    mockData.leases = [];
    mockData.utilities = [];
    mockData.occupants = [];
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
    unplacedPayrollState.rows = [];
    unplacedPayrollState.lowConfidenceMatches = [];
    mockData.properties = [];
    mockData.occupants = [];
  });

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(<DashboardUnderTest />);
    });
  }

  function getKpi() {
    return container.querySelector('[data-testid="kpi-payroll-needs-review"]');
  }

  function getKpiCount(): string | null {
    const el = container.querySelector(
      '[data-testid="text-kpi-payroll-needs-review-count"]',
    );
    return el ? el.textContent : null;
  }

  it("hides the KPI when both payroll tiles are empty", async () => {
    unplacedPayrollState.rows = [];
    unplacedPayrollState.lowConfidenceMatches = [];

    await render();

    expect(getKpi()).toBeNull();
  });

  it("shows the count equal to unplaced + low-confidence rows", async () => {
    unplacedPayrollState.rows = [
      { customer: "Acme Co", name: "Alice", personId: "E1", weekly: 100, suggestions: [] },
      { customer: "Acme Co", name: "Bob", personId: "E2", weekly: 150, suggestions: [] },
    ];
    unplacedPayrollState.lowConfidenceMatches = [
      {
        customer: "Acme Co",
        name: "Carol",
        personId: "E3",
        weekly: 200,
        matched: {
          occupantId: "occ-c",
          name: "Carol",
          company: "Acme Co",
          propertyName: "Hilltop",
          score: 0.6,
          crossEmployer: false,
        },
        suggestions: [],
      },
    ];

    await render();

    expect(getKpi()).not.toBeNull();
    expect(getKpiCount()).toBe("3");
  });

  it("clicking the KPI scrolls the relevant card into view", async () => {
    unplacedPayrollState.rows = [
      { customer: "Acme Co", name: "Alice", personId: "E1", weekly: 100, suggestions: [] },
    ];

    await render();

    const target = container.querySelector('[data-testid="card-unplaced-payroll"]');
    expect(target).not.toBeNull();

    const scrollSpy = vi.fn();
    target!.scrollIntoView = scrollSpy;

    const kpi = getKpi() as HTMLButtonElement;
    await act(async () => {
      kpi.click();
    });

    expect(scrollSpy).toHaveBeenCalled();
  });

  it("scrolls to confirm-match card when only low-confidence rows exist", async () => {
    unplacedPayrollState.lowConfidenceMatches = [
      {
        customer: "Acme Co",
        name: "Carol",
        personId: "E3",
        weekly: 200,
        matched: {
          occupantId: "occ-c",
          name: "Carol",
          company: "Acme Co",
          propertyName: "Hilltop",
          score: 0.6,
          crossEmployer: false,
        },
        suggestions: [],
      },
    ];

    await render();

    const target = container.querySelector('[data-testid="card-low-confidence-payroll"]');
    expect(target).not.toBeNull();

    const scrollSpy = vi.fn();
    target!.scrollIntoView = scrollSpy;

    const kpi = getKpi() as HTMLButtonElement;
    await act(async () => {
      kpi.click();
    });

    expect(scrollSpy).toHaveBeenCalled();
  });

  it("updates the KPI count when the customer filter changes", async () => {
    mockData.properties = [
      { id: "p1", name: "Lakeside", customerId: "c1", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
      { id: "p2", name: "Hillside", customerId: "c2", monthlyRent: 100, totalBeds: 1, ratings: {}, paymentNotes: "", notes: "" },
    ];

    unplacedPayrollState.rows = [
      { customer: "Acme Co", name: "Alice", personId: "E1", weekly: 100, suggestions: [] },
      { customer: "Globex", name: "Bob", personId: "E2", weekly: 150, suggestions: [] },
    ];
    unplacedPayrollState.lowConfidenceMatches = [
      {
        customer: "Acme Co",
        name: "Carol",
        personId: "E3",
        weekly: 200,
        matched: {
          occupantId: "occ-c",
          name: "Carol",
          company: "Acme Co",
          propertyName: "Hilltop",
          score: 0.6,
          crossEmployer: false,
        },
        suggestions: [],
      },
    ];

    await render();

    expect(getKpiCount()).toBe("3");

    const handler = selectHandlers.get(FILTER_TESTID);
    if (!handler) throw new Error("filter handler missing");

    await act(async () => {
      handler.onValueChange("c1");
    });

    expect(getKpiCount()).toBe("2");

    await act(async () => {
      handler.onValueChange("c2");
    });

    expect(getKpiCount()).toBe("1");

    await act(async () => {
      handler.onValueChange("All");
    });

    expect(getKpiCount()).toBe("3");
  });
});

