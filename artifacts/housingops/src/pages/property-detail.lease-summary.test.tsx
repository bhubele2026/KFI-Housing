import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// These tests pin down the multi-active-lease behavior surfaced on the
// Property Detail header. Two facts must always hold:
//
//   1. The "Lease Rent" stat sums the monthlyRent of EVERY Active lease for
//      the property — not just the first match. Using `find(...Active)`
//      under-reports rent and profit when a property has overlapping
//      renewals or multi-room leases.
//
//   2. The "N active leases — rents combined" warning badge appears only
//      when two or more Active leases exist. With zero or one Active lease
//      the badge would either be wrong (no leases) or noise (one lease).
//
// The header's StatCard is computed on every render from `getActiveLeasesForProperty`
// + a reduce over `monthlyRent`, so a regression in the helper, the page,
// or the StatCard wiring would silently put the wrong number on screen.

const { toastMock, MockRoomInUseError } = vi.hoisted(() => {
  class MockRoomInUseError extends Error {
    constructor() {
      super("Cannot delete a room that still has beds.");
      this.name = "RoomInUseError";
    }
  }
  return { toastMock: vi.fn(), MockRoomInUseError };
});

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

// Tabs mock — defaults to the "overview" tab so the header's StatCard row
// is rendered without any clicks. The header itself sits OUTSIDE TabsContent
// (it's always visible), but the page also renders TabsContent for overview
// by default and we don't want the test to accidentally hit a TabsContent
// branch that errors.
vi.mock("@/components/ui/tabs", () => {
  const TabsCtx = React.createContext<{ value: string; setValue: (v: string) => void }>({
    value: "",
    setValue: () => {},
  });
  const Tabs = ({
    defaultValue,
    value: controlledValue,
    onValueChange,
    children,
    className,
  }: {
    defaultValue?: string;
    value?: string;
    onValueChange?: (v: string) => void;
    children?: ReactNode;
    className?: string;
  }) => {
    const [internalValue, setInternalValue] = React.useState<string>(
      controlledValue ?? defaultValue ?? "",
    );
    const value = controlledValue ?? internalValue;
    const setValue = (v: string) => {
      if (controlledValue === undefined) setInternalValue(v);
      onValueChange?.(v);
    };
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
      <button type="button" data-testid={`tab-trigger-${value}`} onClick={() => ctx.setValue(value)}>
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

vi.mock("@/components/ui/popover", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Popover: Pass,
    PopoverTrigger: Pass,
    PopoverContent: () => null,
  };
});

// Select mock — same shape as the other property-detail tests.
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
    onValueChange?: (v: string) => void;
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
            onClick={() => onValueChange?.(it.value)}
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

// Vitest's React-19 act helper looks for this global; without it the page
// hits an "act(...) is not configured" warning that hides real failures.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function makeLease(over: Partial<{
  id: string;
  propertyId: string;
  startDate: string;
  endDate: string;
  monthlyRent: number;
  securityDeposit: number;
  status: "Active" | "Expired" | "Upcoming";
  notes: string;
}>): Record<string, unknown> {
  return {
    id: "l1",
    propertyId: "p1",
    startDate: "2025-01-01",
    endDate: "2026-01-01",
    monthlyRent: 1500,
    securityDeposit: 0,
    status: "Active",
    notes: "",
    ...over,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────
describe("Property detail — Lease Rent header sums every active lease", () => {
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

  function getStatCard(): HTMLElement {
    const el = container.querySelector('[data-testid="stat-lease-rent"]');
    if (!el) throw new Error("stat-lease-rent not found");
    return el as HTMLElement;
  }

  function getMultiBadge(): HTMLElement | null {
    return container.querySelector(
      '[data-testid="badge-multi-active-leases"]',
    ) as HTMLElement | null;
  }

  it("sums monthly rent across every Active lease for the property (not just the first match)", async () => {
    // Two Active leases ($1,500 + $800 = $2,300) plus one Expired lease that
    // must NOT be counted. A regression that used `find(...Active)` would
    // render only $1,500 and miss the second active lease entirely.
    state.leases = [
      makeLease({ id: "l1", monthlyRent: 1500, status: "Active",  endDate: "2026-01-01" }),
      makeLease({ id: "l2", monthlyRent: 800,  status: "Active",  endDate: "2026-06-01" }),
      makeLease({ id: "l3", monthlyRent: 999,  status: "Expired", endDate: "2024-01-01" }),
    ];
    await renderPage();

    const card = getStatCard();
    expect(card.textContent).toContain("$2,300");
    // The expired lease's rent must not bleed into the displayed total —
    // searching the whole card for the literal "$999" guards against any
    // future StatCard tweak that accidentally shows additional sub-amounts.
    expect(card.textContent).not.toContain("$999");
  });

  it("renders the multi-active badge when two or more Active leases exist", async () => {
    // Two Active leases — the badge must surface so the operator
    // understands the displayed rent is a sum, not a single agreement.
    state.leases = [
      makeLease({ id: "l1", monthlyRent: 1500, status: "Active", endDate: "2026-01-01" }),
      makeLease({ id: "l2", monthlyRent: 800,  status: "Active", endDate: "2026-06-01" }),
    ];
    await renderPage();

    const badge = getMultiBadge();
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("2 active leases");
    expect(badge!.textContent?.toLowerCase()).toContain("rents combined");
  });

  it("does NOT render the multi-active badge when there is exactly one Active lease", async () => {
    // The single-active case is the common path — surfacing the badge here
    // would be visual noise on every property in the system.
    state.leases = [
      makeLease({ id: "l1", monthlyRent: 1500, status: "Active", endDate: "2026-01-01" }),
    ];
    await renderPage();

    expect(getMultiBadge()).toBeNull();
    // Sanity: the StatCard still renders the single lease's rent so we know
    // we're not just looking at a missing card.
    expect(getStatCard().textContent).toContain("$1,500");
  });

  it("does NOT render the multi-active badge when there are no Active leases (only expired/upcoming)", async () => {
    // Boundary case: zero Active leases. The badge guards on `>= 2` so the
    // empty case must stay quiet — and the rent value must read as the
    // empty-state em-dash, never "$0" alongside a confusing badge.
    state.leases = [
      makeLease({ id: "l1", monthlyRent: 1500, status: "Expired",  endDate: "2024-01-01" }),
      makeLease({ id: "l2", monthlyRent: 1800, status: "Upcoming", endDate: "2026-12-01" }),
    ];
    await renderPage();

    expect(getMultiBadge()).toBeNull();
    expect(getStatCard().textContent).toContain("—");
  });
});
