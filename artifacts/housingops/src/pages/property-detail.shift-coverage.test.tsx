import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactNode } from "react";
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
}));

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

const PROP_ID = "prop-patriot-baraboo-1850-pine";
const ROOM_509 = "room-patriot-baraboo-u509";
const ROOM_510 = "room-patriot-baraboo-u510";
const ROOM_512 = "room-patriot-baraboo-u512";
const ROOM_811 = "room-patriot-baraboo-u811";
const ROOM_812 = "room-patriot-baraboo-u812";

function bedId(unit: string, slot: number) {
  return `bed-patriot-baraboo-u${unit}-b${slot}`;
}
function occId(unit: string, slot: number) {
  return `occ-patriot-baraboo-u${unit}-b${slot}`;
}
function roomId(unit: string) {
  return `room-patriot-baraboo-u${unit}`;
}

function makeBarabooUnit(
  unit: string,
  roster: Array<{ slot: 1 | 2 | 3 | 4; name: string; shift: "1st" | "2nd" | null }>,
) {
  const room = { id: roomId(unit), propertyId: PROP_ID, name: `Unit ${unit}`, sqft: 0, bathrooms: 0, monthlyRent: 1675 };
  const beds = roster.map((r) => ({
    id: bedId(unit, r.slot),
    propertyId: PROP_ID,
    bedNumber: r.slot,
    roomId: roomId(unit),
    status: "Occupied",
    occupantId: occId(unit, r.slot),
  }));
  const occupants = roster.map((r) => ({
    id: occId(unit, r.slot),
    name: r.name,
    email: "",
    phone: "",
    bedId: bedId(unit, r.slot),
    propertyId: PROP_ID,
    moveInDate: "2025-10-03",
    moveOutDate: null,
    status: "Active",
    chargePerBed: 418.75,
    billingFrequency: "Monthly",
    employeeId: "",
    company: "Milwaukee Valve",
    shift: r.shift,
  }));
  return { room, beds, occupants };
}

function makeSeededBarabooState(): State {
  const u509 = makeBarabooUnit("509", [
    { slot: 1, name: "Eladio Ramos Jr", shift: "1st" },
    { slot: 2, name: "Lawrence Cortez", shift: "2nd" },
    { slot: 3, name: "Pedro Garcia", shift: "1st" },
    { slot: 4, name: "Jonathan Ariola", shift: "2nd" },
  ]);
  const u510 = makeBarabooUnit("510", [
    { slot: 1, name: "Claudio Alvarado", shift: "1st" },
    { slot: 2, name: "Juan Lozada Lugo", shift: "2nd" },
    { slot: 3, name: "Carlos Galvez Garcia", shift: "1st" },
    { slot: 4, name: "Jacob Zepeda", shift: "2nd" },
  ]);
  const u512 = makeBarabooUnit("512", [
    { slot: 1, name: "Alexander A Marrero", shift: "1st" },
    { slot: 2, name: "Alexis Perez", shift: "2nd" },
    { slot: 3, name: "Xavior R Robinson", shift: "1st" },
    { slot: 4, name: "Dorian Kyles", shift: "2nd" },
  ]);
  const u811 = makeBarabooUnit("811", [
    { slot: 1, name: "Moices Bernal", shift: "1st" },
    { slot: 2, name: "Jacob C Ferguson", shift: "2nd" },
    { slot: 3, name: "Gabriel Romero", shift: "1st" },
    { slot: 4, name: "Ricco Antonio Lorenzana", shift: "2nd" },
  ]);
  const u812 = makeBarabooUnit("812", [
    { slot: 1, name: "Abein Flores", shift: "1st" },
    { slot: 2, name: "Antonio Hernandez", shift: "2nd" },
    { slot: 3, name: "Jose Castro", shift: "1st" },
    { slot: 4, name: "Ismael Meza", shift: "2nd" },
  ]);
  const units = [u509, u510, u512, u811, u812];
  return {
    customers: [
      { id: "cust-kfi-baraboo", name: "KFI Staffing – Baraboo, WI", contactName: "Valeria Alderman", email: "", phone: "", notes: "" },
    ],
    properties: [
      {
        id: PROP_ID,
        customerId: "cust-kfi-baraboo",
        name: "1850 W. Pine St. – Baraboo, WI",
        address: "1850 W. Pine St.",
        city: "Baraboo",
        state: "WI",
        zip: "53913",
        totalBeds: 20,
        monthlyRent: 8375,
        chargePerBed: 418.75,
        status: "Active",
        landlordName: "Patriot Properties",
        landlordEmail: "",
        landlordPhone: "(608) 849-6500",
        paymentMethod: "ACH",
        paymentRecipient: "JCW Baraboo LLC",
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
    leases: [
      { id: "lease-patriot-baraboo-u509", propertyId: PROP_ID, startDate: "2025-09-30", endDate: "2026-08-31", monthlyRent: 1675, securityDeposit: 1675, status: "Active", notes: "", clauses: "", unit: "509" },
      { id: "lease-patriot-baraboo-u510", propertyId: PROP_ID, startDate: "2025-09-30", endDate: "2026-08-31", monthlyRent: 1675, securityDeposit: 1675, status: "Active", notes: "", clauses: "", unit: "510" },
      { id: "lease-patriot-baraboo-u512", propertyId: PROP_ID, startDate: "2025-09-30", endDate: "2026-08-31", monthlyRent: 1675, securityDeposit: 1675, status: "Active", notes: "", clauses: "", unit: "512" },
      { id: "lease-patriot-baraboo-u811", propertyId: PROP_ID, startDate: "2025-09-30", endDate: "2026-08-31", monthlyRent: 1675, securityDeposit: 1675, status: "Active", notes: "", clauses: "", unit: "811" },
      { id: "lease-patriot-baraboo-u812", propertyId: PROP_ID, startDate: "2025-09-30", endDate: "2026-08-31", monthlyRent: 1675, securityDeposit: 1675, status: "Active", notes: "", clauses: "", unit: "812" },
    ],
    rooms: units.map((u) => u.room),
    beds: units.flatMap((u) => u.beds),
    occupants: units.flatMap((u) => u.occupants),
    utilities: [],
    insuranceCertificates: [],
  };
}

const NON_HOT_BED_PROP_ID = "prop-13-delallo-jeannette-pa";

function makeNonHotBeddedState(): State {
  return {
    customers: [
      { id: "cust-delallo", name: "DeLallo", contactName: "", email: "", phone: "", notes: "" },
    ],
    properties: [
      {
        id: NON_HOT_BED_PROP_ID,
        customerId: "cust-delallo",
        name: "DeLallo (Jeannette, PA)",
        address: "123 Main St",
        city: "Jeannette",
        state: "PA",
        zip: "15644",
        totalBeds: 4,
        monthlyRent: 2000,
        chargePerBed: 500,
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
      { id: "r_delallo_1", propertyId: NON_HOT_BED_PROP_ID, name: "Apt N/A • BR1", sqft: 200, bathrooms: 1, monthlyRent: 500 },
      { id: "r_delallo_2", propertyId: NON_HOT_BED_PROP_ID, name: "Apt N/A • BR2", sqft: 200, bathrooms: 1, monthlyRent: 500 },
    ],
    beds: [
      { id: "bed-d1", propertyId: NON_HOT_BED_PROP_ID, bedNumber: 1, roomId: "r_delallo_1", status: "Occupied", occupantId: "occ-d1" },
      { id: "bed-d2", propertyId: NON_HOT_BED_PROP_ID, bedNumber: 2, roomId: "r_delallo_1", status: "Occupied", occupantId: "occ-d2" },
      { id: "bed-d3", propertyId: NON_HOT_BED_PROP_ID, bedNumber: 1, roomId: "r_delallo_2", status: "Occupied", occupantId: "occ-d3" },
      { id: "bed-d4", propertyId: NON_HOT_BED_PROP_ID, bedNumber: 2, roomId: "r_delallo_2", status: "Occupied", occupantId: "occ-d4" },
    ],
    occupants: [
      { id: "occ-d1", name: "John Doe", email: "", phone: "", bedId: "bed-d1", propertyId: NON_HOT_BED_PROP_ID, moveInDate: "2025-10-03", moveOutDate: null, status: "Active", chargePerBed: 500, billingFrequency: "Monthly", employeeId: "", company: "DeLallo", shift: null },
      { id: "occ-d2", name: "Jane Doe", email: "", phone: "", bedId: "bed-d2", propertyId: NON_HOT_BED_PROP_ID, moveInDate: "2025-10-03", moveOutDate: null, status: "Active", chargePerBed: 500, billingFrequency: "Monthly", employeeId: "", company: "DeLallo", shift: null },
      { id: "occ-d3", name: "Jim Doe", email: "", phone: "", bedId: "bed-d3", propertyId: NON_HOT_BED_PROP_ID, moveInDate: "2025-10-03", moveOutDate: null, status: "Active", chargePerBed: 500, billingFrequency: "Monthly", employeeId: "", company: "DeLallo", shift: null },
      { id: "occ-d4", name: "Jill Doe", email: "", phone: "", bedId: "bed-d4", propertyId: NON_HOT_BED_PROP_ID, moveInDate: "2025-10-03", moveOutDate: null, status: "Active", chargePerBed: 500, billingFrequency: "Monthly", employeeId: "", company: "DeLallo", shift: null },
    ],
    utilities: [],
    insuranceCertificates: [],
  };
}

let state: State = makeSeededBarabooState();

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    ...state,
    isLoading: false,
    dataIssues: [],
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

describe("Property detail — Shift coverage badges (seeded 1850 W. Pine St. Baraboo)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeSeededBarabooState();
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

  async function renderBedsTab() {
    const { Harness } = makeHarness(`/properties/${PROP_ID}`);
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

  it("renders fully-covered badges (emerald) for all five units when each bedroom pair has 1st + 2nd shifts", async () => {
    await renderBedsTab();

    for (const unit of ["509", "510", "512", "811", "812"]) {
      const rid = roomId(unit);
      const coverageStrip = container.querySelector(`[data-testid="shift-coverage-${rid}"]`);
      expect(coverageStrip, `shift-coverage strip missing for Unit ${unit}`).not.toBeNull();

      const badgeA = container.querySelector(`[data-testid="shift-pair-${rid}-A"]`);
      const badgeB = container.querySelector(`[data-testid="shift-pair-${rid}-B"]`);
      expect(badgeA, `Bedroom A badge missing for Unit ${unit}`).not.toBeNull();
      expect(badgeB, `Bedroom B badge missing for Unit ${unit}`).not.toBeNull();

      expect(badgeA!.textContent).toContain("Bedroom A");
      expect(badgeA!.textContent).toContain("1st + 2nd");
      expect(badgeA!.className).toContain("emerald");

      expect(badgeB!.textContent).toContain("Bedroom B");
      expect(badgeB!.textContent).toContain("1st + 2nd");
      expect(badgeB!.className).toContain("emerald");
    }
  });

  it("renders bedroom-letter sublabels (Bdr A / Bdr B) on each bed row", async () => {
    await renderBedsTab();

    for (const unit of ["509", "510", "512", "811", "812"]) {
      const letterB1 = container.querySelector(`[data-testid="bed-${bedId(unit, 1)}-bedroom-letter"]`);
      const letterB2 = container.querySelector(`[data-testid="bed-${bedId(unit, 2)}-bedroom-letter"]`);
      const letterB3 = container.querySelector(`[data-testid="bed-${bedId(unit, 3)}-bedroom-letter"]`);
      const letterB4 = container.querySelector(`[data-testid="bed-${bedId(unit, 4)}-bedroom-letter"]`);

      expect(letterB1, `bed 1 bedroom letter missing for Unit ${unit}`).not.toBeNull();
      expect(letterB2, `bed 2 bedroom letter missing for Unit ${unit}`).not.toBeNull();
      expect(letterB3, `bed 3 bedroom letter missing for Unit ${unit}`).not.toBeNull();
      expect(letterB4, `bed 4 bedroom letter missing for Unit ${unit}`).not.toBeNull();

      expect(letterB1!.textContent).toContain("A");
      expect(letterB2!.textContent).toContain("A");
      expect(letterB3!.textContent).toContain("B");
      expect(letterB4!.textContent).toContain("B");
    }
  });

  it("shows half-covered (amber) badge when one slot has a shift and the other does not", async () => {
    const occ = state.occupants.find((o) => o.id === occId("509", 2));
    if (occ) occ.shift = null;

    await renderBedsTab();

    const badgeA = container.querySelector(`[data-testid="shift-pair-${ROOM_509}-A"]`);
    expect(badgeA).not.toBeNull();
    expect(badgeA!.textContent).toContain("1st only");
    expect(badgeA!.textContent).toContain("needs 2nd");
    expect(badgeA!.className).toContain("amber");

    const badgeB = container.querySelector(`[data-testid="shift-pair-${ROOM_509}-B"]`);
    expect(badgeB).not.toBeNull();
    expect(badgeB!.textContent).toContain("1st + 2nd");
    expect(badgeB!.className).toContain("emerald");
  });

  it("shows double-booked (rose) badge when both occupants in a pair share the same shift", async () => {
    const occ = state.occupants.find((o) => o.id === occId("509", 2));
    if (occ) occ.shift = "1st";

    await renderBedsTab();

    const badgeA = container.querySelector(`[data-testid="shift-pair-${ROOM_509}-A"]`);
    expect(badgeA).not.toBeNull();
    expect(badgeA!.textContent).toContain("double-booked");
    expect(badgeA!.className).toContain("rose");
  });

  it("shows empty (muted) badge when neither occupant in a pair has a shift set", async () => {
    const occ1 = state.occupants.find((o) => o.id === occId("509", 1));
    const occ2 = state.occupants.find((o) => o.id === occId("509", 2));
    if (occ1) occ1.shift = null;
    if (occ2) occ2.shift = null;

    await renderBedsTab();

    const badgeA = container.querySelector(`[data-testid="shift-pair-${ROOM_509}-A"]`);
    expect(badgeA).not.toBeNull();
    expect(badgeA!.textContent).toContain("No shifts set");
    expect(badgeA!.className).toContain("muted");

    const badgeB = container.querySelector(`[data-testid="shift-pair-${ROOM_509}-B"]`);
    expect(badgeB!.textContent).toContain("1st + 2nd");
    expect(badgeB!.className).toContain("emerald");
  });

  it("toggling an occupant shift via select-occupant-shift updates the badge (fully-covered → half-covered → double-booked → restored)", async () => {
    await renderBedsTab();

    const badgeA = container.querySelector(`[data-testid="shift-pair-${ROOM_509}-A"]`);
    expect(badgeA!.textContent).toContain("1st + 2nd");
    expect(badgeA!.className).toContain("emerald");

    const shiftSelect = container.querySelector(
      `[data-testid="select-occupant-shift-${occId("509", 2)}"]`,
    ) as HTMLElement;
    expect(shiftSelect).not.toBeNull();

    const noneBtn = shiftSelect.querySelector('[data-select-item="none"]') as HTMLButtonElement;
    await act(async () => {
      noneBtn.click();
    });
    expect(mocks.updateOccupant).toHaveBeenCalledWith(occId("509", 2), { shift: null });

    const occ = state.occupants.find((o) => o.id === occId("509", 2))!;
    occ.shift = null;
    await act(async () => {
      root!.render(makeHarness(`/properties/${PROP_ID}`).Harness());
    });
    const trigger1 = container.querySelector('[data-testid="tab-trigger-beds"]') as HTMLButtonElement;
    await act(async () => { trigger1.click(); });

    const badgeAHalf = container.querySelector(`[data-testid="shift-pair-${ROOM_509}-A"]`);
    expect(badgeAHalf!.textContent).toContain("1st only");
    expect(badgeAHalf!.textContent).toContain("needs 2nd");
    expect(badgeAHalf!.className).toContain("amber");

    const shiftSelect2 = container.querySelector(
      `[data-testid="select-occupant-shift-${occId("509", 2)}"]`,
    ) as HTMLElement;
    const firstBtn = shiftSelect2.querySelector('[data-select-item="1st"]') as HTMLButtonElement;
    await act(async () => {
      firstBtn.click();
    });
    expect(mocks.updateOccupant).toHaveBeenCalledWith(occId("509", 2), { shift: "1st" });

    occ.shift = "1st";
    await act(async () => {
      root!.render(makeHarness(`/properties/${PROP_ID}`).Harness());
    });
    const trigger2 = container.querySelector('[data-testid="tab-trigger-beds"]') as HTMLButtonElement;
    await act(async () => { trigger2.click(); });

    const badgeADouble = container.querySelector(`[data-testid="shift-pair-${ROOM_509}-A"]`);
    expect(badgeADouble!.textContent).toContain("double-booked");
    expect(badgeADouble!.className).toContain("rose");

    const shiftSelect3 = container.querySelector(
      `[data-testid="select-occupant-shift-${occId("509", 2)}"]`,
    ) as HTMLElement;
    const secondBtn = shiftSelect3.querySelector('[data-select-item="2nd"]') as HTMLButtonElement;
    await act(async () => {
      secondBtn.click();
    });
    expect(mocks.updateOccupant).toHaveBeenCalledWith(occId("509", 2), { shift: "2nd" });

    occ.shift = "2nd";
    await act(async () => {
      root!.render(makeHarness(`/properties/${PROP_ID}`).Harness());
    });
    const trigger3 = container.querySelector('[data-testid="tab-trigger-beds"]') as HTMLButtonElement;
    await act(async () => { trigger3.click(); });

    const badgeARestored = container.querySelector(`[data-testid="shift-pair-${ROOM_509}-A"]`);
    expect(badgeARestored!.textContent).toContain("1st + 2nd");
    expect(badgeARestored!.className).toContain("emerald");
  });
});

describe("Property detail — Non-hot-bedded property (no shift coverage strip)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeNonHotBeddedState();
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

  async function renderBedsTab() {
    const { Harness } = makeHarness(`/properties/${NON_HOT_BED_PROP_ID}`);
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

  it("does NOT render the shift coverage strip or shift-pair badges when no occupant has a shift", async () => {
    await renderBedsTab();

    const coverageStrips = container.querySelectorAll('[data-testid^="shift-coverage-"]');
    expect(coverageStrips.length).toBe(0);

    const shiftPairs = container.querySelectorAll('[data-testid^="shift-pair-"]');
    expect(shiftPairs.length).toBe(0);
  });

  it("does NOT render bedroom letter sublabels when no occupant has a shift", async () => {
    await renderBedsTab();

    const bedroomLetters = container.querySelectorAll('[data-testid$="-bedroom-letter"]');
    expect(bedroomLetters.length).toBe(0);
  });
});
