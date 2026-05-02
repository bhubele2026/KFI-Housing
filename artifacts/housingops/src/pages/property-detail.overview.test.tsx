import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// These tests pin down the Room Totals roll-up that appears at the top of
// the Overview tab on Property Detail. The card is computed on every
// render from `computeRoomTotals` + the active lease's monthlyRent, so a
// regression in the data shape, the helper, or the JSX would silently put
// a wrong number in front of the customer.
//
// Behaviors locked down here:
//   1. Each metric (rooms, total sqft, total bathrooms, expected rent)
//      renders the totals from the rooms list.
//   2. The empty state replaces the metrics grid when no rooms exist.
//   3. The "vs lease rent" delta only appears when BOTH expected rent
//      and the active lease's monthly rent are non-zero — otherwise the
//      comparison would read "vs $0" and mislead the user.
//   4. The delta is green (covering) when expected ≥ lease, red
//      (underpriced) when expected < lease.

// Hoisted mocks shared with vi.mock() factories — the toast and the
// custom RoomInUseError class need to be referenced from inside the data
// store mock and (potentially) from individual tests.
const { toastMock, MockRoomInUseError } = vi.hoisted(() => {
  class MockRoomInUseError extends Error {
    constructor() {
      super("Cannot delete a room that still has beds.");
      this.name = "RoomInUseError";
    }
  }
  return { toastMock: vi.fn(), MockRoomInUseError };
});

// MainLayout pulls in the sidebar + header which aren't relevant here.
vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// framer-motion's motion.<tag> becomes a plain element of the same tag,
// stripping animation-only props so DOM semantics are preserved.
vi.mock("framer-motion", () => {
  const motionPropKeys = new Set([
    "initial", "animate", "exit", "transition",
    "whileHover", "whileTap", "whileFocus", "whileDrag", "whileInView",
    "variants", "layout", "layoutId", "drag", "dragConstraints",
    "onAnimationStart", "onAnimationComplete", "onUpdate", "viewport",
  ]);
  const motion = new Proxy({} as Record<string, unknown>, {
    get: (_t, tag: string) => {
      const Component = ({ children, ...rest }: Record<string, unknown> & { children?: ReactNode }) => {
        const dom: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rest)) {
          if (!motionPropKeys.has(k)) dom[k] = v;
        }
        return React.createElement(tag, dom, children);
      };
      return Component;
    },
  });
  return {
    motion,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

// Tabs mock — renders the active tab's TabsContent only. Defaults match
// the real Tabs default (the page passes defaultValue="overview"), so the
// Overview tab is active without any extra setup.
vi.mock("@/components/ui/tabs", () => {
  const TabsCtx = React.createContext<{ value: string; setValue: (v: string) => void }>({
    value: "",
    setValue: () => {},
  });
  const Tabs = ({
    defaultValue,
    children,
    className,
  }: {
    defaultValue?: string;
    children?: ReactNode;
    className?: string;
  }) => {
    const [value, setValue] = React.useState<string>(defaultValue ?? "");
    return (
      <TabsCtx.Provider value={{ value, setValue }}>
        <div className={className}>{children}</div>
      </TabsCtx.Provider>
    );
  };
  const TabsList = ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  );
  const TabsTrigger = ({ value, children }: { value: string; children?: ReactNode }) => {
    const ctx = React.useContext(TabsCtx);
    return (
      <button
        type="button"
        data-testid={`tab-trigger-${value}`}
        onClick={() => ctx.setValue(value)}
      >
        {children}
      </button>
    );
  };
  const TabsContent = ({
    value,
    children,
    className,
  }: {
    value: string;
    children?: ReactNode;
    className?: string;
  }) => {
    const ctx = React.useContext(TabsCtx);
    if (ctx.value !== value) return null;
    return <div className={className}>{children}</div>;
  };
  return { Tabs, TabsList, TabsTrigger, TabsContent };
});

// Tooltips, hover cards, dialogs, popovers — none of these are inspected
// for the Room Totals card, so reduce them to passthroughs / null portals.
vi.mock("@/components/ui/tooltip", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Tooltip: Pass,
    TooltipTrigger: Pass,
    TooltipContent: () => null,
    TooltipProvider: Pass,
  };
});

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

// Select mock — same shape used by property-detail.beds.test.tsx so any
// `<Select>` inside the Overview tab (e.g. customer/status pickers) still
// renders without a real Radix portal.
vi.mock("@/components/ui/select", () => {
  function findTestId(node: unknown): string | null {
    if (node == null || typeof node === "string" || typeof node === "number") return null;
    if (Array.isArray(node)) {
      for (const c of node) {
        const id = findTestId(c);
        if (id) return id;
      }
      return null;
    }
    if (typeof node === "object" && isValidElement(node)) {
      const props = (node as { props: Record<string, unknown> }).props ?? {};
      if (typeof props["data-testid"] === "string") return props["data-testid"] as string;
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
    onValueChange: (v: string) => void;
    children?: ReactNode;
  }) {
    const testid = findTestId(children);
    const items: Array<{ value: string; label: string }> = [];
    collectItems(children, items);
    return (
      <div data-testid={testid ?? undefined} data-current={value}>
        {items.map((it) => (
          <button
            key={it.value}
            type="button"
            data-select-item={it.value}
            onClick={() => onValueChange(it.value)}
          >
            {it.label}
          </button>
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
type State = {
  customers: Array<Record<string, unknown>>;
  properties: Array<Record<string, unknown>>;
  leases: Array<Record<string, unknown>>;
  rooms: Array<Record<string, unknown>>;
  beds: Array<Record<string, unknown>>;
  occupants: Array<Record<string, unknown>>;
  utilities: Array<Record<string, unknown>>;
};

// No-op spies for every store mutation PropertyDetail destructures from
// useData(). The Overview tab only triggers updateProperty / updateLease
// in user flows we don't exercise here, but the destructuring would crash
// without them.
const mocks = {
  addRoom: vi.fn(),
  updateRoom: vi.fn(),
  deleteRoom: vi.fn(),
  addBed: vi.fn(),
  deleteBed: vi.fn(),
  updateBed: vi.fn(),
  updateProperty: vi.fn(),
  updateLease: vi.fn(),
  addLease: vi.fn(),
  deleteLease: vi.fn(),
  updateOccupant: vi.fn(),
  addOccupant: vi.fn(),
  updateUtility: vi.fn(),
  addUtility: vi.fn(),
  deleteUtility: vi.fn(),
};

// State shape is recreated per test so individual tests can mutate
// `state.rooms` / `state.leases` to vary the Room Totals scenario.
function makeFreshState(): State {
  return {
    customers: [
      { id: "c1", name: "Acme Co", contactName: "", email: "", phone: "", notes: "" },
    ],
    properties: [
      {
        id: "p1",
        customerId: "c1",
        name: "Maple",
        address: "1 Main St",
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
      },
    ],
    leases: [],
    rooms: [],
    beds: [],
    occupants: [],
    utilities: [],
  };
}

let state: State = makeFreshState();

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    ...state,
    isLoading: false,
    ...mocks,
  }),
  RoomInUseError: MockRoomInUseError,
}));

// Imports that consume the mocks above MUST come after vi.mock calls.
import PropertyDetail from "./property-detail";

function makeHarness(initialPath: string) {
  const memory = memoryLocation({ path: initialPath, record: true });
  function Harness() {
    return (
      <Router hook={memory.hook}>
        <Switch>
          <Route path="/properties/:id" component={PropertyDetail} />
        </Switch>
      </Router>
    );
  }
  return { memory, Harness };
}

// ── Tests ───────────────────────────────────────────────────────────────
describe("Property detail — Room Totals card on Overview", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeFreshState();
    Object.values(mocks).forEach((m) => m.mockReset());
    toastMock.mockReset();
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
    const { Harness } = makeHarness("/properties/p1");
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });
  }

  function getCard(): HTMLElement {
    const el = container.querySelector('[data-testid="room-totals-card"]');
    if (!el) throw new Error("room-totals-card not found");
    return el as HTMLElement;
  }

  function getMetric(testId: string): HTMLElement | null {
    return container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  }

  it("shows the empty-state message and no metrics grid when the property has no rooms", async () => {
    // No rooms were seeded — the card should advise the user to add rooms
    // on the Beds tab and must NOT render any of the four metric tiles
    // (otherwise zero counts would silently look like "real" data).
    await renderPage();

    const card = getCard();
    expect(card.textContent).toContain("No rooms yet");
    expect(card.textContent?.toLowerCase()).toContain("beds");

    expect(getMetric("room-totals-rooms")).toBeNull();
    expect(getMetric("room-totals-sqft")).toBeNull();
    expect(getMetric("room-totals-bathrooms")).toBeNull();
    expect(getMetric("room-totals-expected-rent")).toBeNull();
    expect(getMetric("room-totals-vs-lease")).toBeNull();
  });

  it("renders the rolled-up rooms / sqft / bathrooms / expected rent across multiple rooms", async () => {
    // Two rooms with distinct numbers so an off-by-one mapping bug
    // (e.g. rendering bathrooms in the sqft tile) would fail loudly.
    state.rooms = [
      { id: "r1", propertyId: "p1", name: "Master", sqft: 200, bathrooms: 1, monthlyRent: 1000 },
      { id: "r2", propertyId: "p1", name: "Guest", sqft: 320, bathrooms: 0.5, monthlyRent: 850 },
    ];
    await renderPage();

    const card = getCard();
    // Header subtitle reflects the room count (pluralized).
    expect(card.textContent).toContain("Rolled up from 2 rooms");

    expect(getMetric("room-totals-rooms")?.textContent).toContain("2");

    // Sqft tile uses toLocaleString — for 520 that's still "520".
    const sqft = getMetric("room-totals-sqft");
    expect(sqft?.textContent).toContain("520");
    expect(sqft?.textContent).toContain("sqft");

    // Bathrooms total of 1.5 → fractional formatter (toFixed(1)).
    expect(getMetric("room-totals-bathrooms")?.textContent).toContain("1.5");

    // Expected rent total of 1850 → "$1,850/mo".
    const rent = getMetric("room-totals-expected-rent");
    expect(rent?.textContent).toContain("$1,850");
    expect(rent?.textContent).toContain("/mo");
  });

  it("formats integer bathroom totals without a decimal, fractional totals with one decimal", async () => {
    // Two whole bathrooms → "2" (not "2.0"). A regression that always
    // applied toFixed(1) would render "2.0" and read as a typo to
    // operators who never see fractional bathrooms.
    state.rooms = [
      { id: "r1", propertyId: "p1", name: "A", sqft: 100, bathrooms: 1, monthlyRent: 0 },
      { id: "r2", propertyId: "p1", name: "B", sqft: 100, bathrooms: 1, monthlyRent: 0 },
    ];
    await renderPage();

    const tile = getMetric("room-totals-bathrooms");
    expect(tile?.textContent).toContain("2");
    expect(tile?.textContent).not.toContain("2.0");
  });

  it("uses the singular 'room' in the header subtitle when only one room exists", async () => {
    state.rooms = [
      { id: "r1", propertyId: "p1", name: "Only", sqft: 150, bathrooms: 1, monthlyRent: 700 },
    ];
    await renderPage();

    expect(getCard().textContent).toContain("Rolled up from 1 room");
    // Make sure it's not the pluralized form.
    expect(getCard().textContent).not.toContain("1 rooms");
  });

  it("hides the vs-lease delta when the property has no active lease (lease rent is 0)", async () => {
    // Rooms add up to a non-zero expected rent, but with no active lease
    // there is no meaningful comparison — showing "vs $0" would mislead.
    state.rooms = [
      { id: "r1", propertyId: "p1", name: "A", sqft: 200, bathrooms: 1, monthlyRent: 1000 },
    ];
    state.leases = [];
    await renderPage();

    expect(getMetric("room-totals-vs-lease")).toBeNull();
  });

  it("hides the vs-lease delta when no room has any expected rent (expected total is 0)", async () => {
    // The active lease has rent, but every room is at $0/mo (e.g. all
    // freshly added). Same rationale — comparing "$0 vs $1500" would
    // read as a wild data error rather than the empty-data state.
    state.rooms = [
      { id: "r1", propertyId: "p1", name: "A", sqft: 200, bathrooms: 1, monthlyRent: 0 },
    ];
    state.leases = [
      {
        id: "l1",
        propertyId: "p1",
        startDate: "2025-01-01",
        endDate: "2026-01-01",
        monthlyRent: 1500,
        securityDeposit: 0,
        status: "Active",
        notes: "",
      },
    ];
    await renderPage();

    expect(getMetric("room-totals-vs-lease")).toBeNull();
    // The fallback line should still surface the lease rent so the user
    // sees what their lease costs even without a per-room comparison.
    expect(getCard().textContent).toContain("Lease rent $1,500");
  });

  it("renders a green positive delta when expected rent exceeds the active lease rent", async () => {
    // Expected rent $2,000/mo, lease $1,500/mo → +$500 (covering the
    // lease). The badge should be green (`text-green-600`).
    state.rooms = [
      { id: "r1", propertyId: "p1", name: "A", sqft: 200, bathrooms: 1, monthlyRent: 1200 },
      { id: "r2", propertyId: "p1", name: "B", sqft: 150, bathrooms: 1, monthlyRent: 800 },
    ];
    state.leases = [
      {
        id: "l1",
        propertyId: "p1",
        startDate: "2025-01-01",
        endDate: "2026-01-01",
        monthlyRent: 1500,
        securityDeposit: 0,
        status: "Active",
        notes: "",
      },
    ];
    await renderPage();

    const delta = getMetric("room-totals-vs-lease");
    expect(delta).not.toBeNull();
    expect(delta!.textContent).toContain("+$500");
    expect(delta!.textContent?.toLowerCase()).toContain("vs lease rent");
    expect(delta!.className).toContain("text-green-600");
    expect(delta!.className).not.toContain("text-destructive");
  });

  it("renders a green delta of +$0 when expected rent exactly matches the lease rent", async () => {
    // Boundary case: the helper considers ≥ 0 as "covering". A regression
    // that flipped the comparison to strictly > 0 would paint the exact
    // breakeven case red and alarm the operator over a non-issue.
    state.rooms = [
      { id: "r1", propertyId: "p1", name: "A", sqft: 200, bathrooms: 1, monthlyRent: 1500 },
    ];
    state.leases = [
      {
        id: "l1",
        propertyId: "p1",
        startDate: "2025-01-01",
        endDate: "2026-01-01",
        monthlyRent: 1500,
        securityDeposit: 0,
        status: "Active",
        notes: "",
      },
    ];
    await renderPage();

    const delta = getMetric("room-totals-vs-lease");
    expect(delta).not.toBeNull();
    expect(delta!.textContent).toContain("+$0");
    expect(delta!.className).toContain("text-green-600");
  });

  it("renders a red negative delta with a minus sign when expected rent falls short of the lease rent", async () => {
    // Expected rent $1,200/mo, lease $1,500/mo → −$300 (underpriced).
    state.rooms = [
      { id: "r1", propertyId: "p1", name: "A", sqft: 200, bathrooms: 1, monthlyRent: 1200 },
    ];
    state.leases = [
      {
        id: "l1",
        propertyId: "p1",
        startDate: "2025-01-01",
        endDate: "2026-01-01",
        monthlyRent: 1500,
        securityDeposit: 0,
        status: "Active",
        notes: "",
      },
    ];
    await renderPage();

    const delta = getMetric("room-totals-vs-lease");
    expect(delta).not.toBeNull();
    expect(delta!.textContent).toContain("−$300");
    expect(delta!.textContent?.toLowerCase()).toContain("vs lease rent");
    expect(delta!.className).toContain("text-destructive");
    expect(delta!.className).not.toContain("text-green-600");
  });

  it("ignores Expired and Upcoming leases when computing the vs-lease delta (only Active counts)", async () => {
    // An Expired lease for $5,000 should NOT swing the delta — only the
    // currently Active lease's rent feeds the comparison. The page picks
    // the lease via `propLeases.find(l => l.status === "Active")`.
    state.rooms = [
      { id: "r1", propertyId: "p1", name: "A", sqft: 200, bathrooms: 1, monthlyRent: 1000 },
    ];
    state.leases = [
      {
        id: "l-expired",
        propertyId: "p1",
        startDate: "2024-01-01",
        endDate: "2024-12-31",
        monthlyRent: 5000,
        securityDeposit: 0,
        status: "Expired",
        notes: "",
      },
    ];
    await renderPage();

    // No Active lease → no delta, falling back to the empty-comparison
    // case (because monthlyLeaseCost is 0).
    expect(getMetric("room-totals-vs-lease")).toBeNull();
  });
});
