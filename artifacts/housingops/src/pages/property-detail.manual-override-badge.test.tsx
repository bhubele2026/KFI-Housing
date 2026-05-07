import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// NOTE on `skippedOverridden` dashboard counter (task #382 scope check):
// The seeder's `skippedOverridden` count lives exclusively in the API
// server response (api-server/src/lib/seed-housing-deductions.ts) and is
// NOT surfaced anywhere in the HousingOps UI dashboard. The seeder path
// is already covered by unit tests in seed-housing-deductions.test.ts.
// If a future task adds a dashboard widget for this counter, a UI test
// should be added at that point.

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@workspace/api-client-react", () => ({
  useListRoomNightLogs: () => ({ data: [] }),
}));

vi.mock("@/components/property-location-map", () => ({
  PropertyLocationMap: () => <div data-testid="mock-property-location-map" />,
}));

vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

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

type State = {
  customers: Array<Record<string, unknown>>;
  properties: Array<Record<string, unknown>>;
  leases: Array<Record<string, unknown>>;
  rooms: Array<Record<string, unknown>>;
  beds: Array<Record<string, unknown>>;
  occupants: Array<Record<string, unknown>>;
  utilities: Array<Record<string, unknown>>;
  insuranceCertificates: Array<Record<string, unknown>>;
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
  addInsuranceCertificate: vi.fn(),
  updateInsuranceCertificate: vi.fn(),
  deleteInsuranceCertificate: vi.fn(),
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
    rooms: [
      { id: "r1", propertyId: "p1", name: "Master", sqft: 200, bathrooms: 1, monthlyRent: 1000 },
    ],
    beds: [
      { id: "b1", propertyId: "p1", bedNumber: 1, roomId: "r1", status: "Occupied", occupantId: "occ-override" },
      { id: "b2", propertyId: "p1", bedNumber: 2, roomId: "r1", status: "Occupied", occupantId: "occ-payroll" },
      { id: "b3", propertyId: "p1", bedNumber: 3, roomId: "r1", status: "Occupied", occupantId: "occ-plain" },
      { id: "b4", propertyId: "p1", bedNumber: 4, roomId: "r1", status: "Occupied", occupantId: "occ-manual" },
    ],
    occupants: [
      {
        id: "occ-override",
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
        chargeSource: "manual_override",
        chargeSourceCustomer: "Acme Co",
        chargeSourcePersonId: "P-42",
      },
      {
        id: "occ-payroll",
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
        chargeSource: "payroll",
        chargeSourceCustomer: "Acme Co",
        chargeSourcePersonId: "P-99",
      },
      {
        id: "occ-plain",
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
        chargeSource: "",
        chargeSourceCustomer: "",
        chargeSourcePersonId: "",
      },
      {
        id: "occ-manual",
        propertyId: "p1",
        bedId: "b4",
        name: "Bob Jones",
        employeeId: "EMP4",
        company: "Acme Co",
        shift: null,
        moveInDate: "2024-01-01",
        chargePerBed: 60,
        billingFrequency: "Weekly",
        email: "",
        phone: "",
        status: "Active",
        chargeSource: "manual",
        chargeSourceCustomer: "",
        chargeSourcePersonId: "",
      },
    ],
    utilities: [],
    insuranceCertificates: [],
  };
}

let state: State = makeFreshState();

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    ...state,
    isLoading: false,
    dataIssues: [],
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

describe("Property detail — 'manually overridden' badge on the bed table", () => {
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

  function getOverrideBadge(occId: string): HTMLElement | null {
    return container.querySelector(
      `[data-testid="badge-manual-override-${occId}"]`,
    ) as HTMLElement | null;
  }

  function getPayrollBadge(occId: string): HTMLElement | null {
    return container.querySelector(
      `[data-testid="badge-payroll-source-${occId}"]`,
    ) as HTMLElement | null;
  }

  it("renders the 'manually overridden' badge with amber styling for occupants with chargeSource='manual_override'", async () => {
    await renderBedsTab();

    const badge = getOverrideBadge("occ-override");
    expect(badge).not.toBeNull();
    expect((badge!.textContent ?? "").toLowerCase()).toContain("manually overridden");
    expect(badge!.className).toContain("bg-amber-50");
    expect(badge!.className).toContain("text-amber-700");
    expect(badge!.className).toContain("border-amber-200");
  });

  it("does NOT render the override badge for occupants with chargeSource='payroll'", async () => {
    await renderBedsTab();

    expect(getOverrideBadge("occ-payroll")).toBeNull();
    expect(getPayrollBadge("occ-payroll")).not.toBeNull();
  });

  it("does NOT render the override badge for occupants with chargeSource='manual' (plain manual entry)", async () => {
    await renderBedsTab();

    expect(getOverrideBadge("occ-manual")).toBeNull();
    expect(getPayrollBadge("occ-manual")).toBeNull();
  });

  it("does NOT render the override badge for occupants with no chargeSource", async () => {
    await renderBedsTab();

    expect(getOverrideBadge("occ-plain")).toBeNull();
    expect(getPayrollBadge("occ-plain")).toBeNull();
  });

  it("the badge tooltip surfaces the prior customer and Person Id", async () => {
    await renderBedsTab();

    const badge = getOverrideBadge("occ-override");
    expect(badge).not.toBeNull();

    const tooltips = Array.from(
      container.querySelectorAll('[data-testid="tooltip-content"]'),
    );
    const matching = tooltips.find((el) => {
      const text = el.textContent ?? "";
      return text.includes("Acme Co") && text.includes("P-42");
    });
    expect(matching, "expected a tooltip with the prior customer + person id").not.toBeUndefined();
    expect(matching!.textContent ?? "").toContain("Manually overridden");
    expect(matching!.textContent ?? "").toContain("was payroll for");
  });

  it("the tooltip falls back to em-dashes when the prior customer / person id are missing", async () => {
    state.occupants = [
      {
        id: "occ-override-blank",
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
        chargeSource: "manual_override",
        chargeSourceCustomer: "",
        chargeSourcePersonId: "",
      },
    ];
    state.beds = [
      { id: "b1", propertyId: "p1", bedNumber: 1, roomId: "r1", status: "Occupied", occupantId: "occ-override-blank" },
    ];

    await renderBedsTab();

    const badge = getOverrideBadge("occ-override-blank");
    expect(badge).not.toBeNull();

    const tooltips = Array.from(
      container.querySelectorAll('[data-testid="tooltip-content"]'),
    );
    const matching = tooltips.find((el) =>
      (el.textContent ?? "").includes("Manually overridden"),
    );
    expect(matching).not.toBeUndefined();
    const text = matching!.textContent ?? "";
    expect(text).toContain("—");
    expect(text).toContain("Person —");
    expect(text.toLowerCase()).not.toContain("null");
  });
});
