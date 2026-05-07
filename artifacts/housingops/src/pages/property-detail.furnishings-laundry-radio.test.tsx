import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

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
  return {
    Tooltip: Pass,
    TooltipTrigger: Pass,
    TooltipContent: Pass,
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
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  function Select({ children }: { value?: string; onValueChange?: (v: string) => void; children?: ReactNode }) {
    return <div>{children}</div>;
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

type Property = {
  id: string;
  customerId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  totalBeds: number;
  monthlyRent: number;
  chargePerBed: number;
  status: string;
  landlordName: string;
  landlordEmail: string;
  landlordPhone: string;
  paymentMethod: string;
  paymentRecipient: string;
  paymentDueDay: number;
  paymentNotes: string;
  bankName: string;
  bankRouting: string;
  bankAccount: string;
  portalUrl: string;
  notes: string;
  furnishings: string[];
};

type State = {
  customers: Array<Record<string, unknown>>;
  properties: Property[];
  leases: Array<Record<string, unknown>>;
  rooms: Array<Record<string, unknown>>;
  beds: Array<Record<string, unknown>>;
  occupants: Array<Record<string, unknown>>;
  utilities: Array<Record<string, unknown>>;
  insuranceCertificates: Array<Record<string, unknown>>;
};

const updatePropertySpy = vi.fn(
  (id: string, patch: Partial<Property>) => {
    const p = state.properties.find((x) => x.id === id);
    if (p) Object.assign(p, patch);
  },
);

const mocks = {
  addRoom: vi.fn(),
  updateRoom: vi.fn(),
  deleteRoom: vi.fn(),
  addBed: vi.fn(),
  deleteBed: vi.fn(),
  updateBed: vi.fn(),
  updateProperty: updatePropertySpy,
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

function makeFreshState(furnishings: string[] = []): State {
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
        furnishings,
      },
    ],
    leases: [],
    rooms: [],
    beds: [],
    occupants: [],
    utilities: [],
    insuranceCertificates: [],
  };
}

let state: State = makeFreshState();

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    ...state,
    otherCosts: [],
    roomNightLogs: [],
    isLoading: false,
    dataIssues: [],
    ...mocks,
    updateProperty: (id: string, patch: Partial<Property>) =>
      mocks.updateProperty(id, patch),
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

describe("Property detail — Laundry Onsite/Offsite/N/A radio group", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeFreshState();
    Object.values(mocks).forEach((m) => m.mockReset?.());
    updatePropertySpy.mockImplementation((id: string, patch: Partial<Property>) => {
      const p = state.properties.find((x) => x.id === id);
      if (p) Object.assign(p, patch);
    });
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

  async function renderFurnishingsTab(initialFurnishings: string[] = []) {
    if (root) {
      const r = root;
      await act(async () => {
        r.unmount();
      });
      root = null;
    }
    state = makeFreshState(initialFurnishings);
    const { Harness } = makeHarness("/properties/p1");
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });
    const trigger = container.querySelector(
      '[data-testid="tab-trigger-furnishings"]',
    ) as HTMLButtonElement | null;
    if (!trigger) throw new Error("Could not find Furnishings tab trigger");
    await act(async () => {
      trigger.click();
    });
  }

  function clickRadio(testId: string) {
    const btn = container.querySelector(
      `[data-testid="${testId}"]`,
    ) as HTMLButtonElement | null;
    if (!btn) throw new Error(`Could not find radio ${testId}`);
    return act(async () => {
      btn.click();
    });
  }

  function lastFurnishings(): string[] | null {
    const calls = updatePropertySpy.mock.calls;
    if (calls.length === 0) return null;
    const lastCall = calls[calls.length - 1];
    const patch = lastCall[1] as Partial<Property>;
    return patch.furnishings ?? null;
  }

  it("picking Onsite removes Offsite from the property's furnishings array", async () => {
    await renderFurnishingsTab(["Laundry: Offsite"]);

    await clickRadio("furnishings-laundry-radio-onsite");

    const furn = lastFurnishings();
    expect(furn).not.toBeNull();
    expect(furn).toContain("Laundry: Onsite");
    expect(furn).not.toContain("Laundry: Offsite");
  });

  it("picking Offsite removes Onsite from the property's furnishings array", async () => {
    await renderFurnishingsTab(["Laundry: Onsite"]);

    await clickRadio("furnishings-laundry-radio-offsite");

    const furn = lastFurnishings();
    expect(furn).not.toBeNull();
    expect(furn).toContain("Laundry: Offsite");
    expect(furn).not.toContain("Laundry: Onsite");
  });

  it("the category header badge appears with the right label for the current selection", async () => {
    await renderFurnishingsTab();
    expect(
      container.querySelector('[data-testid="furnishings-laundry-radio-badge"]'),
    ).toBeNull();

    await renderFurnishingsTab(["Laundry: Onsite"]);
    let badge = container.querySelector(
      '[data-testid="furnishings-laundry-radio-badge"]',
    ) as HTMLElement | null;
    expect(badge).not.toBeNull();
    expect((badge!.textContent ?? "").trim()).toBe("Onsite");

    await renderFurnishingsTab(["Laundry: Offsite"]);
    badge = container.querySelector(
      '[data-testid="furnishings-laundry-radio-badge"]',
    ) as HTMLElement | null;
    expect(badge).not.toBeNull();
    expect((badge!.textContent ?? "").trim()).toBe("Offsite");
  });

  it("picking N/A clears any previously-selected location", async () => {
    await renderFurnishingsTab(["Laundry: Onsite"]);

    expect(
      container.querySelector('[data-testid="furnishings-laundry-radio-badge"]'),
    ).not.toBeNull();

    await clickRadio("furnishings-laundry-radio-na");

    const furn = lastFurnishings();
    expect(furn).not.toBeNull();
    expect(furn).not.toContain("Laundry: Onsite");
    expect(furn).not.toContain("Laundry: Offsite");
    expect(furn).toEqual([]);
  });
});
