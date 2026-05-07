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
  beds: unknown[];
  leases: unknown[];
  utilities: unknown[];
  occupants: unknown[];
  customers: { id: string; name: string }[];
  isLoading: boolean;
} = {
  properties: [],
  beds: [],
  leases: [],
  utilities: [],
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

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    ...mockData,
    addOccupant: addOccupantMock,
    updateBed: updateBedMock,
    updateOccupant: updateOccupantMock,
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
  // Task #320 added a hotel-rate / lease-expiry alerts tile that
  // reads from this hook. Tests in this file don't exercise it
  // directly but the hook must still resolve cleanly.
  useListRoomNightLogs: () => ({ data: [] }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
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

  it("renders a distinct 'different employer' label and overwrites company on confirm for cross-employer suggestions", async () => {
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

    await act(async () => {
      btn!.click();
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
