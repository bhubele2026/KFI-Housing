import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
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

vi.mock("@/components/ui/popover", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Popover: Pass,
    PopoverTrigger: Pass,
    PopoverContent: () => null,
  };
});

vi.mock("@/components/ui/accordion", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Accordion: Pass,
    AccordionItem: Pass,
    AccordionTrigger: Pass,
    AccordionContent: () => null,
  };
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

const SelectCtx = React.createContext<{
  onValueChange?: (v: string) => void;
}>({});
vi.mock("@/components/ui/select", () => {
  function Select({
    value,
    children,
    onValueChange,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children?: ReactNode;
  }) {
    return (
      <SelectCtx.Provider value={{ onValueChange }}>
        <div data-select-value={value}>{children}</div>
      </SelectCtx.Provider>
    );
  }
  function SelectItem({
    children,
    value,
  }: {
    children?: ReactNode;
    value: string;
  }) {
    const ctx = React.useContext(SelectCtx);
    return (
      <button
        type="button"
        data-value={value}
        data-testid={`select-item-${value}`}
        onClick={() => ctx.onValueChange?.(value)}
      >
        {children}
      </button>
    );
  }
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Select,
    SelectContent: Pass,
    SelectGroup: Pass,
    SelectItem,
    SelectLabel: Pass,
    SelectScrollDownButton: Pass,
    SelectScrollUpButton: Pass,
    SelectSeparator: Pass,
    SelectTrigger: Pass,
    SelectValue: Pass,
  };
});

vi.mock("@/components/add-lease-dialog", () => ({
  AddLeaseDialog: () => null,
}));
vi.mock("@/components/upload-lease-pdf-dialog", () => ({
  UploadLeasePdfDialog: () => null,
}));
vi.mock("@/components/import-master-leases-button", () => ({
  ImportMasterLeasesButton: () => null,
}));
vi.mock("@/components/last-auto-import-indicator", () => ({
  LastAutoImportIndicator: () => null,
}));
vi.mock("@/components/renew-lease-popover", () => ({
  RenewLeasePopover: ({ trigger }: { trigger?: ReactNode }) => <>{trigger}</>,
}));
vi.mock("@/components/assign-occupant-dialog", () => ({
  AssignOccupantDialog: () => null,
}));
vi.mock("@/components/property-location-map", () => ({
  PropertyLocationMap: () => <div data-testid="mock-property-location-map" />,
}));

// Task #492: dashboard reads /api/config for alert thresholds; stub
// the hook so this integration test doesn't need to wire it up.
vi.mock("@/hooks/use-runtime-config", () => ({
  useRuntimeConfigQuery: () => ({ data: undefined }),
  useRuntimeConfigStream: () => undefined,
}));

vi.mock("@workspace/api-client-react", () => ({
  useListRoomNightLogs: () => ({ data: [] }),
  useListUnplacedPayroll: () => ({
    data: {
      unmatched: [
        {
          customer: "Acme Dairy",
          personId: "emp-1",
          name: "Jane Smith",
          weekly: 125,
          suggestions: [],
        },
      ],
      lowConfidenceMatches: [],
    },
  }),
  getListUnplacedPayrollQueryKey: () => ["/payroll/unplaced"],
  useGetLastAutoMasterImport: () => ({ data: undefined, isLoading: false, isError: false }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
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

const updateOccupant = vi.fn();
const updateBed = vi.fn();
const deleteProperty = vi.fn();
const addOccupant = vi.fn();

function makeState(): State {
  return {
    customers: [
      { id: "c1", name: "Acme Dairy", contactName: "", email: "", phone: "", notes: "" },
    ],
    properties: [
      {
        id: "pp1",
        customerId: "c1",
        name: "Roster — Pending Placement (Acme Dairy)",
        address: "",
        city: "",
        state: "",
        zip: "",
        totalBeds: 0,
        monthlyRent: 0,
        chargePerBed: 0,
        status: "Active",
        ratings: {},
        paymentNotes: "",
        notes: "",
        furnishings: [],
      },
      {
        id: "real1",
        customerId: "c1",
        name: "Maple Court",
        address: "1 Real St",
        city: "Austin",
        state: "TX",
        zip: "78701",
        totalBeds: 1,
        monthlyRent: 1000,
        chargePerBed: 0,
        status: "Active",
        ratings: {},
        paymentNotes: "",
        notes: "",
        furnishings: [],
      },
    ],
    leases: [],
    rooms: [
      { id: "room-1", propertyId: "real1", name: "Bedroom 1", sqft: 0, bathrooms: 0, monthlyRent: 0 },
    ],
    beds: [
      {
        id: "bed-1",
        propertyId: "real1",
        bedNumber: 1,
        roomId: "room-1",
        status: "Vacant" as const,
        occupantId: null as string | null,
      },
    ],
    occupants: [
      {
        id: "occ-pending-1",
        propertyId: "pp1",
        bedId: null as string | null,
        name: "Jane Smith",
        employeeId: "emp-1",
        company: "Acme Dairy",
        moveInDate: "",
        moveOutDate: null as string | null,
        status: "Active",
        chargePerBed: 125,
        billingFrequency: "Weekly",
        email: "",
        phone: "",
      },
    ],
    utilities: [],
    insuranceCertificates: [],
  };
}

let state: State = makeState();

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    ...state,
    isLoading: false,
    addLease: vi.fn(),
    updateLease: vi.fn(),
    deleteLease: vi.fn(),
    addOccupant,
    updateBed,
    updateOccupant,
    deleteProperty,
    addBed: vi.fn(),
    deleteBed: vi.fn(),
    addRoom: vi.fn(),
    updateRoom: vi.fn(),
    deleteRoom: vi.fn(),
    updateProperty: vi.fn(),
    deleteOccupant: vi.fn(),
    updateUtility: vi.fn(),
    addUtility: vi.fn(),
    deleteUtility: vi.fn(),
  }),
  RoomInUseError: class RoomInUseError extends Error {},
}));

import Dashboard from "./dashboard";
import PropertyDetail from "./property-detail";
import { CustomerScopeProvider } from "@/context/customer-scope";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Dashboard duplicate-occupant guard → pending-placement bucket → Move-to-bed (Task #349)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeState();
    updateOccupant.mockReset();
    updateBed.mockReset();
    deleteProperty.mockReset();
    addOccupant.mockReset();
    sessionStorage.clear();
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

  it("shows 'Open pending bucket' instead of 'Assign to bed' when the payroll row already has a pending-placement occupant", async () => {
    const memory = memoryLocation({ path: "/dashboard", record: true });
    function Harness() {
      return (
        <CustomerScopeProvider>
          <Router hook={memory.hook}>
            <Switch>
              <Route path="/dashboard" component={Dashboard} />
              <Route path="/properties/:id" component={PropertyDetail} />
            </Switch>
          </Router>
        </CustomerScopeProvider>
      );
    }

    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });

    const openBtn = container.querySelector(
      '[data-testid="button-open-existing-unplaced-emp-1"]',
    );
    expect(openBtn).not.toBeNull();
    expect(openBtn!.textContent).toBe("Open pending bucket");
    expect(openBtn!.getAttribute("data-existing-pending")).toBe("1");
    expect(openBtn!.getAttribute("data-existing-occupant-id")).toBe("occ-pending-1");

    const assignBtn = container.querySelector(
      '[data-testid="button-assign-unplaced-emp-1"]',
    );
    expect(assignBtn).toBeNull();
  });

  it("follows the link to the bucket page and moves the existing occupant to a real bed without spawning a duplicate", async () => {
    const memory = memoryLocation({ path: "/dashboard", record: true });
    function Harness() {
      return (
        <CustomerScopeProvider>
          <Router hook={memory.hook}>
            <Switch>
              <Route path="/dashboard" component={Dashboard} />
              <Route path="/properties/:id" component={PropertyDetail} />
            </Switch>
          </Router>
        </CustomerScopeProvider>
      );
    }

    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });

    const openBtn = container.querySelector(
      '[data-testid="button-open-existing-unplaced-emp-1"]',
    ) as HTMLAnchorElement | null;
    expect(openBtn).not.toBeNull();

    const link = openBtn!.closest("a") ?? openBtn!;
    expect(link.getAttribute("href")).toBe("/properties/pp1");

    await act(async () => {
      link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    });

    expect(memory.history[memory.history.length - 1]).toBe("/properties/pp1");

    expect(
      container.querySelector('[data-testid="property-detail-pending-placement"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="pending-placement-board"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="pending-placement-row-occ-pending-1"]'),
    ).not.toBeNull();

    const propertyOption = container.querySelector(
      '[data-testid="select-item-real1"]',
    ) as HTMLButtonElement | null;
    expect(propertyOption).not.toBeNull();
    await act(async () => {
      propertyOption!.click();
    });

    const bedOption = container.querySelector(
      '[data-testid="select-item-bed-1"]',
    ) as HTMLButtonElement | null;
    expect(bedOption).not.toBeNull();
    await act(async () => {
      bedOption!.click();
    });

    const moveBtn = container.querySelector(
      '[data-testid="pending-move-button-occ-pending-1"]',
    ) as HTMLButtonElement | null;
    expect(moveBtn).not.toBeNull();
    expect(moveBtn!.disabled).toBe(false);
    await act(async () => {
      moveBtn!.click();
    });

    expect(updateOccupant).toHaveBeenCalledTimes(1);
    const [movedId, patch] = updateOccupant.mock.calls[0];
    expect(movedId).toBe("occ-pending-1");
    expect(patch.propertyId).toBe("real1");
    expect(patch.bedId).toBe("bed-1");
    expect(typeof patch.moveInDate).toBe("string");
    expect(patch.moveInDate.length).toBeGreaterThan(0);

    expect(updateBed).toHaveBeenCalledWith("bed-1", {
      status: "Occupied",
      occupantId: "occ-pending-1",
    });

    expect(addOccupant).not.toHaveBeenCalled();

    expect(deleteProperty).toHaveBeenCalledWith("pp1");
  });
});
