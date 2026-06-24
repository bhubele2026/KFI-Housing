import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

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

vi.mock("@workspace/api-client-react", () => ({
  useListRoomNightLogs: () => ({ data: [] }),
  useListPropertyViolations: () => ({ data: [] }),
  useCreatePropertyViolation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeletePropertyViolation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  getListPropertyViolationsQueryKey: () => [],
  useListProjectedMoveIns: () => ({ data: [] }),
  useCreateProjectedMoveIn: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useUpdateProjectedMoveIn: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeleteProjectedMoveIn: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useConvertProjectedMoveIn: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  getListProjectedMoveInsQueryKey: () => [],
  getListBedsQueryKey: () => [],
  getListOccupantsQueryKey: () => [],
}));

// PropertyDetail calls useQueryClient() directly (added 2026-05-07) for the
// optimistic violations mutations. This harness doesn't stand up a real
// QueryClientProvider, so stub the client — mirrors the canonical pattern in
// dashboard.test.tsx / the dashboard integration tests.
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useQueryClient: () => ({
      getQueryData: () => undefined,
      setQueryData: vi.fn(),
      invalidateQueries: vi.fn(),
    }),
  };
});

vi.mock("@/components/property-location-map", () => ({
  PropertyLocationMap: () => <div data-testid="mock-property-location-map" />,
}));

vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
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

vi.mock("@/components/ui/select", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  function Select({ value, children }: { value?: string; children?: ReactNode }) {
    return <div data-current={value}>{children}</div>;
  }
  return {
    Select,
    SelectContent: Pass,
    SelectGroup: Pass,
    SelectItem: Pass,
    SelectLabel: Pass,
    SelectScrollDownButton: Pass,
    SelectScrollUpButton: Pass,
    SelectSeparator: Pass,
    SelectTrigger: Pass,
    SelectValue: Pass,
  };
});

type DataIssue = {
  kind: string;
  label: string;
  dropped: number;
  rows: Array<{
    id?: string;
    label?: string;
    href?: string;
    propertyId?: string;
    bedNumber?: number;
  }>;
};

type State = {
  customers: Array<Record<string, unknown>>;
  properties: Array<Record<string, unknown>>;
  leases: Array<Record<string, unknown>>;
  rooms: Array<Record<string, unknown>>;
  beds: Array<Record<string, unknown>>;
  occupants: Array<Record<string, unknown>>;
  utilities: Array<Record<string, unknown>>;
  insuranceCertificates: Array<Record<string, unknown>>;
  dataIssues: DataIssue[];
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
    rooms: [],
    beds: [],
    occupants: [],
    utilities: [],
    insuranceCertificates: [],
    dataIssues: [],
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

describe("Property detail — per-property dropped-records notice", () => {
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

  it("shows the dropped-records notice when rooms for this property were dropped", async () => {
    state.dataIssues = [
      {
        kind: "rooms",
        label: "rooms",
        dropped: 1,
        rows: [{ id: "room-bad-1", label: "Kitchen @ Maple", propertyId: "p1" }],
      },
    ];
    await renderPage();

    const notice = container.querySelector('[data-testid="property-dropped-notice"]');
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("Room");
    expect(notice!.textContent).toContain("room-bad-1");
    expect(notice!.textContent).toContain("Kitchen @ Maple");
  });

  it("shows the dropped-records notice when beds for this property were dropped", async () => {
    state.dataIssues = [
      {
        kind: "beds",
        label: "beds",
        dropped: 1,
        rows: [{ id: "bed-bad-1", label: "Bed #3 @ Maple", propertyId: "p1", bedNumber: 3 }],
      },
    ];
    await renderPage();

    const notice = container.querySelector('[data-testid="property-dropped-notice"]');
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("Bed #3");
    expect(notice!.textContent).toContain("bed-bad-1");
  });

  it("shows both dropped rooms and beds in one notice", async () => {
    state.dataIssues = [
      {
        kind: "rooms",
        label: "rooms",
        dropped: 1,
        rows: [{ id: "room-bad-1", label: "Attic @ Maple", propertyId: "p1" }],
      },
      {
        kind: "beds",
        label: "beds",
        dropped: 1,
        rows: [{ id: "bed-bad-1", label: "Bed #5 @ Maple", propertyId: "p1", bedNumber: 5 }],
      },
    ];
    await renderPage();

    const notice = container.querySelector('[data-testid="property-dropped-notice"]');
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("Room");
    expect(notice!.textContent).toContain("room-bad-1");
    expect(notice!.textContent).toContain("Bed #5");
    expect(notice!.textContent).toContain("bed-bad-1");
  });

  it("hides the notice when there are no dropped records for this property", async () => {
    state.dataIssues = [];
    await renderPage();

    const notice = container.querySelector('[data-testid="property-dropped-notice"]');
    expect(notice).toBeNull();
  });

  it("hides the notice when dropped records belong to a different property", async () => {
    state.dataIssues = [
      {
        kind: "rooms",
        label: "rooms",
        dropped: 1,
        rows: [{ id: "room-other", label: "Room @ Other", propertyId: "p-other" }],
      },
      {
        kind: "beds",
        label: "beds",
        dropped: 1,
        rows: [{ id: "bed-other", label: "Bed #1 @ Other", propertyId: "p-other", bedNumber: 1 }],
      },
    ];
    await renderPage();

    const notice = container.querySelector('[data-testid="property-dropped-notice"]');
    expect(notice).toBeNull();
  });
});
