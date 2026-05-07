import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// These tests pin down the "from payroll" badge that appears next to the
// per-bed weekly charge on Property Detail (added in task #304). The badge
// only renders when the occupant's chargeSource === "payroll", and its
// tooltip surfaces the originating customer + payroll Person Id so the
// operator can trace where the auto-set rate came from. Backend tests
// already cover the chargeSource projection itself; these tests prevent a
// silent UI regression where a refactor of the bed table either drops the
// badge entirely or shows it on every occupant.

// MainLayout pulls in the sidebar/header which aren't relevant here.
vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// PropertyLocationMap loads react-query for the Google Maps key. The
// other property-detail test files stub it the same way; mirror that.
vi.mock("@workspace/api-client-react", () => ({
  useListRoomNightLogs: () => ({ data: [] }),
}));

vi.mock("@/components/property-location-map", () => ({
  PropertyLocationMap: () => <div data-testid="mock-property-location-map" />,
}));

// Cached motion.<tag> mock — see property-detail.beds.test.tsx for why
// caching is required (Tabs internal useState would otherwise be wiped on
// every parent re-render).
vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

// Tabs mock — render only the active tab's TabsContent and let
// TabsTrigger flip the active value. Mirrors the pattern in the other
// property-detail tests.
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

// Tooltip — render the content inline (instead of through a portal) so we
// can read the customer + person id from the tooltip body. The badge's
// TooltipContent is what surfaces the source attribution; if a refactor
// dropped that subtree the test below would fail.
vi.mock("@/components/ui/tooltip", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const TooltipContent = ({ children }: { children?: ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  );
  return {
    Tooltip: Pass,
    TooltipTrigger: Pass,
    TooltipContent,
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

// Select mock — same passthrough pattern as the other property-detail
// tests; renders SelectItems as buttons and exposes the active value via
// data-current.
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

  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  function Select({
    value,
    children,
  }: {
    value: string;
    onValueChange?: (v: string) => void;
    children?: ReactNode;
  }) {
    const testid = findTestId(children);
    return (
      <div data-testid={testid ?? undefined} data-current={value}>
        {children}
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
  deleteOccupant: vi.fn(),
  updateUtility: vi.fn(),
  addUtility: vi.fn(),
  deleteUtility: vi.fn(),
};

function makeFreshState(): State {
  // Three Active occupants on three beds in one room. One has
  // chargeSource="payroll" (badge expected), one has chargeSource="manual"
  // (no badge), and one has no chargeSource at all (no badge — tests the
  // strict-equality check rather than a truthy check).
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
    rooms: [
      { id: "r1", propertyId: "p1", name: "Master", sqft: 200, bathrooms: 1, monthlyRent: 1000 },
    ],
    beds: [
      { id: "b1", propertyId: "p1", bedNumber: 1, roomId: "r1", status: "Occupied", occupantId: "occ-payroll" },
      { id: "b2", propertyId: "p1", bedNumber: 2, roomId: "r1", status: "Occupied", occupantId: "occ-manual" },
      { id: "b3", propertyId: "p1", bedNumber: 3, roomId: "r1", status: "Occupied", occupantId: "occ-no-source" },
    ],
    occupants: [
      {
        id: "occ-payroll",
        propertyId: "p1",
        bedId: "b1",
        name: "Jane Smith",
        employeeId: "EMP1",
        company: "Acme Co",
        shift: null,
        moveInDate: "2024-01-01",
        chargePerBed: 100,
        billingFrequency: "Weekly",
        email: "",
        phone: "",
        status: "Active",
        chargeSource: "payroll",
        chargeSourceCustomer: "Acme Co",
        chargeSourcePersonId: "EMP1",
      },
      {
        id: "occ-manual",
        propertyId: "p1",
        bedId: "b2",
        name: "John Doe",
        employeeId: "EMP2",
        company: "Acme Co",
        shift: null,
        moveInDate: "2024-01-01",
        chargePerBed: 75,
        billingFrequency: "Weekly",
        email: "",
        phone: "",
        status: "Active",
        chargeSource: "manual",
        chargeSourceCustomer: null,
        chargeSourcePersonId: null,
      },
      {
        id: "occ-no-source",
        propertyId: "p1",
        bedId: "b3",
        name: "Sarah Lee",
        employeeId: "EMP3",
        company: "Acme Co",
        shift: null,
        moveInDate: "2024-01-01",
        chargePerBed: 50,
        billingFrequency: "Weekly",
        email: "",
        phone: "",
        status: "Active",
      },
    ],
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
  RoomInUseError: class RoomInUseError extends Error {},
}));

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

describe("Property detail — 'from payroll' badge on the bed table", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeFreshState();
    Object.values(mocks).forEach((m) => m.mockReset());
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

  async function renderBedsTab() {
    const { Harness } = makeHarness("/properties/p1");
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });
    const trigger = container.querySelector(
      '[data-testid="tab-trigger-beds"]',
    ) as HTMLButtonElement | null;
    if (!trigger) throw new Error("Could not find Beds tab trigger");
    await act(async () => {
      trigger.click();
    });
  }

  function getBadge(occId: string): HTMLElement | null {
    return container.querySelector(
      `[data-testid="badge-payroll-source-${occId}"]`,
    ) as HTMLElement | null;
  }

  it("renders the badge for occupants with chargeSource='payroll'", async () => {
    await renderBedsTab();

    const badge = getBadge("occ-payroll");
    expect(badge).not.toBeNull();
    expect((badge!.textContent ?? "").toLowerCase()).toContain("from payroll");
  });

  it("does NOT render the badge for occupants with chargeSource='manual' or no chargeSource", async () => {
    await renderBedsTab();

    expect(getBadge("occ-manual")).toBeNull();
    expect(getBadge("occ-no-source")).toBeNull();
  });

  it("the badge's tooltip surfaces the source customer and Person Id", async () => {
    await renderBedsTab();

    const badge = getBadge("occ-payroll");
    expect(badge).not.toBeNull();

    // The badge is wrapped in a <Tooltip> with a <TooltipContent> sibling
    // that renders the attribution. Walking up to the nearest tooltip
    // wrapper isn't easy through the passthrough mock, so scan all
    // tooltip-content nodes for one that mentions BOTH the customer name
    // and the person id (uniquely identifying this badge's tooltip).
    const tooltips = Array.from(
      container.querySelectorAll('[data-testid="tooltip-content"]'),
    );
    const matching = tooltips.find((el) => {
      const text = el.textContent ?? "";
      return text.includes("Acme Co") && text.includes("EMP1");
    });
    expect(matching, "expected a tooltip with the source customer + person id").not.toBeUndefined();
    expect(matching!.textContent ?? "").toContain("Auto-reconciled from payroll");
  });

  it("the tooltip falls back to em-dashes when the source customer / person id are missing", async () => {
    // chargeSource='payroll' but the source attribution fields are blank.
    // The component renders "—" placeholders so the tooltip never shows
    // empty space or the literal string "null".
    state.occupants = [
      {
        id: "occ-payroll-no-attrib",
        propertyId: "p1",
        bedId: "b1",
        name: "Jane Smith",
        employeeId: "",
        company: "",
        shift: null,
        moveInDate: "2024-01-01",
        chargePerBed: 100,
        billingFrequency: "Weekly",
        email: "",
        phone: "",
        status: "Active",
        chargeSource: "payroll",
        chargeSourceCustomer: "",
        chargeSourcePersonId: "",
      },
    ];
    state.beds = [
      { id: "b1", propertyId: "p1", bedNumber: 1, roomId: "r1", status: "Occupied", occupantId: "occ-payroll-no-attrib" },
    ];

    await renderBedsTab();

    const badge = getBadge("occ-payroll-no-attrib");
    expect(badge).not.toBeNull();

    const tooltips = Array.from(
      container.querySelectorAll('[data-testid="tooltip-content"]'),
    );
    const matching = tooltips.find((el) =>
      (el.textContent ?? "").includes("Auto-reconciled from payroll"),
    );
    expect(matching).not.toBeUndefined();
    const text = matching!.textContent ?? "";
    expect(text).toContain("—");
    expect(text).toContain("Person —");
    expect(text.toLowerCase()).not.toContain("null");
  });
});
