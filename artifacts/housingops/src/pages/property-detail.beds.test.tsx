import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// ── Hoisted mock factory shared with vi.mock() factories ────────────────
// `vi.hoisted` evaluates before the module body and before vi.mock factories,
// so we can declare the toast spy and the mock RoomInUseError class once and
// reference them both from inside the mock factories *and* from the tests.
const { toastMock, MockRoomInUseError } = vi.hoisted(() => {
  class MockRoomInUseError extends Error {
    constructor() {
      super("Cannot delete a room that still has beds.");
      this.name = "RoomInUseError";
    }
  }
  return { toastMock: vi.fn(), MockRoomInUseError };
});

// ── Layout / motion / toast mocks ───────────────────────────────────────
// MainLayout pulls in the sidebar + header which aren't relevant to these
// tests; replace it with a passthrough so the property-detail content is
// rendered directly.
vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// PropertyLocationMap fetches the Google Maps key from the api-server's
// `/api/config` endpoint via react-query (Task #154). These tests don't
// stand up a QueryClientProvider, so render it as a benign placeholder
// to avoid pulling react-query into every property-detail test setup.
vi.mock("@workspace/api-client-react", () => ({
  useListRoomNightLogs: () => ({ data: [] }),
}));

vi.mock("@/components/property-location-map", () => ({
  PropertyLocationMap: () => <div data-testid="mock-property-location-map" />,
}));

// framer-motion's `motion.<tag>` becomes a plain element of the same tag,
// stripping animation-only props. This keeps DOM semantics intact. The
// shared mock caches one component per tag (see
// src/test-utils/framer-motion-mock.tsx) — without that cache, React
// would unmount/remount the entire <motion.div> subtree on every parent
// re-render (e.g. when the Beds-tab sort dropdown calls setBedsSort),
// blowing away the Tabs mock's internal useState and silently flipping
// the page back to the default "overview" tab mid-test.
vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

// ── Tabs mock ───────────────────────────────────────────────────────────
// Renders the active tab's TabsContent only. Clicking a TabsTrigger
// (data-testid="tab-trigger-<value>") flips to that tab. Lets the tests
// switch into the Beds tab the same way a real user would.
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

// Tooltip is portal-heavy; reduce to a passthrough since these tests don't
// inspect tooltip content.
vi.mock("@/components/ui/tooltip", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Tooltip: Pass,
    TooltipTrigger: Pass,
    TooltipContent: () => null,
    TooltipProvider: Pass,
  };
});

// Dialog content stays unmounted (open=false in every flow under test).
// The Trigger passes through so the visible "Assign occupant" buttons in
// the bed table still render.
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

// ── Select mock ─────────────────────────────────────────────────────────
// Mirrors the pattern in beds.test.tsx / utilities.test.tsx but renders
// each SelectItem as a real clickable <button data-select-item="<value>">
// so tests can both (a) read the option list and (b) trigger
// `onValueChange` by clicking — which is exactly how a user picks a room
// for an orphan bed.
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
  insuranceCertificates: Array<Record<string, unknown>>;
};

// A spy bag for every mutation the Beds tab can fire. Tests reset these in
// beforeEach. The data-store mock returns the same function references on
// every render, so `vi.fn().mock.calls` accumulates across renders.
const mocks = {
  addRoom: vi.fn(),
  updateRoom: vi.fn(),
  deleteRoom: vi.fn(),
  addBed: vi.fn(),
  deleteBed: vi.fn(),
  updateBed: vi.fn(),
  // Other store mutations — referenced by destructuring in PropertyDetail
  // even when their tab isn't rendered; provide no-op spies so nothing
  // crashes when the component reads them out of useData().
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
      // r1 has beds → its trash button must be disabled.
      { id: "r1", propertyId: "p1", name: "Master", sqft: 200, bathrooms: 1, monthlyRent: 1000 },
      // r2 has no beds → its trash button is enabled.
      { id: "r2", propertyId: "p1", name: "Guest",  sqft: 120, bathrooms: 0, monthlyRent: 600 },
    ],
    beds: [
      { id: "b1", propertyId: "p1", bedNumber: 1, roomId: "r1", status: "Vacant", occupantId: null },
      { id: "b2", propertyId: "p1", bedNumber: 2, roomId: "r1", status: "Vacant", occupantId: null },
    ],
    occupants: [],
    utilities: [],
    insuranceCertificates: [],
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

// ── Test helpers ────────────────────────────────────────────────────────
function setReactInputValue(el: HTMLInputElement, value: string) {
  // React tracks controlled inputs via a hidden _valueTracker; assigning
  // .value directly is silently ignored. The supported workaround is to
  // call the native value setter and dispatch an "input" event.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Could not get native input value setter");
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function flushPromises() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

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

// ── Tests: Beds tab room interactions ───────────────────────────────────
describe("Property detail — Beds tab room interactions", () => {
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

  function getRoomCard(id: string): HTMLElement {
    const el = container.querySelector(`[data-testid="room-card-${id}"]`);
    if (!el) throw new Error(`room-card-${id} missing`);
    return el as HTMLElement;
  }

  // Each InlineEdit renders a wrapper <span class="group …"> in the
  // collapsed state. Within a room card the four wrappers correspond to
  // name, sqft, bathrooms, rent (in DOM order). Vacant beds in the bed
  // table use a different button (Assign occupant) without `.group`, so
  // the indices stay stable.
  function getInlineEditWrappers(card: HTMLElement): HTMLElement[] {
    return Array.from(card.querySelectorAll(".group")) as HTMLElement[];
  }

  async function openInlineEdit(wrapper: HTMLElement) {
    await act(async () => {
      wrapper.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  }

  function getEditingInput(card: HTMLElement): HTMLInputElement {
    const input = card.querySelector("input");
    if (!input) throw new Error("InlineEdit input did not appear");
    return input as HTMLInputElement;
  }

  async function pressEnter(input: HTMLInputElement) {
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
  }

  it("renders a card per room, the Add Room button, and each room's field values", async () => {
    await renderBedsTab();

    expect(container.querySelector('[data-testid="button-add-room"]')).not.toBeNull();
    const r1 = getRoomCard("r1");
    const r2 = getRoomCard("r2");

    const r1Edits = getInlineEditWrappers(r1);
    expect(r1Edits.length).toBeGreaterThanOrEqual(4);
    expect(r1Edits[0].textContent).toContain("Master");
    expect(r1Edits[1].textContent).toContain("200");
    expect(r1Edits[2].textContent).toContain("1");
    expect(r1Edits[3].textContent).toContain("$1000");

    const r2Edits = getInlineEditWrappers(r2);
    expect(r2Edits[0].textContent).toContain("Guest");
    expect(r2Edits[1].textContent).toContain("120");
    expect(r2Edits[3].textContent).toContain("$600");
  });

  it("clicking Add Room calls addRoom with a sequentially-numbered Room name", async () => {
    mocks.addRoom.mockResolvedValueOnce({});
    await renderBedsTab();

    const btn = container.querySelector(
      '[data-testid="button-add-room"]',
    ) as HTMLButtonElement;
    await act(async () => {
      btn.click();
    });
    await flushPromises();

    expect(mocks.addRoom).toHaveBeenCalledTimes(1);
    const arg = mocks.addRoom.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.propertyId).toBe("p1");
    // 2 existing rooms in seed → next room is "Room 3".
    expect(arg.name).toBe("Room 3");
    expect(arg.sqft).toBe(0);
    expect(arg.bathrooms).toBe(0);
    expect(arg.monthlyRent).toBe(0);
    expect(typeof arg.id).toBe("string");
    expect((arg.id as string).length).toBeGreaterThan(0);
  });

  it("editing a room name commits the new value via updateRoom", async () => {
    await renderBedsTab();
    const r1 = getRoomCard("r1");
    const wrappers = getInlineEditWrappers(r1);

    await openInlineEdit(wrappers[0]); // name
    const input = getEditingInput(r1);
    await act(async () => {
      setReactInputValue(input, "Penthouse");
    });
    await pressEnter(input);

    expect(mocks.updateRoom).toHaveBeenCalledWith("r1", { name: "Penthouse" });
  });

  it("editing room sqft parses the typed value to an integer", async () => {
    await renderBedsTab();
    const r1 = getRoomCard("r1");
    const wrappers = getInlineEditWrappers(r1);

    await openInlineEdit(wrappers[1]); // sqft
    const input = getEditingInput(r1);
    await act(async () => {
      setReactInputValue(input, "350");
    });
    await pressEnter(input);

    expect(mocks.updateRoom).toHaveBeenCalledWith("r1", { sqft: 350 });
  });

  it("editing room bathrooms parses the typed value as a float", async () => {
    await renderBedsTab();
    const r1 = getRoomCard("r1");
    const wrappers = getInlineEditWrappers(r1);

    await openInlineEdit(wrappers[2]); // bathrooms
    const input = getEditingInput(r1);
    await act(async () => {
      setReactInputValue(input, "1.5");
    });
    await pressEnter(input);

    expect(mocks.updateRoom).toHaveBeenCalledWith("r1", { bathrooms: 1.5 });
  });

  it("editing room monthly rent parses the typed value as a float", async () => {
    await renderBedsTab();
    const r1 = getRoomCard("r1");
    const wrappers = getInlineEditWrappers(r1);

    await openInlineEdit(wrappers[3]); // monthly rent
    const input = getEditingInput(r1);
    await act(async () => {
      setReactInputValue(input, "1234.5");
    });
    await pressEnter(input);

    expect(mocks.updateRoom).toHaveBeenCalledWith("r1", { monthlyRent: 1234.5 });
  });

  it("the room trash button is disabled while the room still has beds", async () => {
    await renderBedsTab();

    const deleteR1 = container.querySelector(
      '[data-testid="button-delete-room-r1"]',
    ) as HTMLButtonElement;
    const deleteR2 = container.querySelector(
      '[data-testid="button-delete-room-r2"]',
    ) as HTMLButtonElement;

    expect(deleteR1).not.toBeNull();
    expect(deleteR2).not.toBeNull();
    // r1 has 2 beds → disabled with an explanatory title.
    expect(deleteR1.disabled).toBe(true);
    expect((deleteR1.getAttribute("title") ?? "").toLowerCase()).toContain(
      "delete or move the beds",
    );
    // r2 has 0 beds → enabled.
    expect(deleteR2.disabled).toBe(false);
  });

  // The room trash button is wrapped in a ConfirmDeleteButton (AlertDialog).
  // Clicking the trash opens the dialog; the actual deleteRoom call only
  // fires when the user clicks the confirm button inside the dialog (which
  // renders into a portal, so we query off `document` not `container`).
  async function clickRoomDeleteAndConfirm(roomId: string) {
    const btn = container.querySelector(
      `[data-testid="button-delete-room-${roomId}"]`,
    ) as HTMLButtonElement;
    await act(async () => {
      btn.click();
    });
    const confirm = document.querySelector(
      '[data-testid="button-confirm-delete-confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirm, "confirm dialog should be open after clicking trash").not.toBeNull();
    await act(async () => {
      confirm!.click();
    });
  }

  it("clicking the trash on an empty room calls deleteRoom and shows no toast on success", async () => {
    mocks.deleteRoom.mockResolvedValueOnce(undefined);
    await renderBedsTab();

    await clickRoomDeleteAndConfirm("r2");
    await flushPromises();

    expect(mocks.deleteRoom).toHaveBeenCalledWith("r2");
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("a 409-style RoomInUseError surfaces the 'Room still has beds' destructive toast", async () => {
    // Force the deletion to reject as the server's 409 path does (this is
    // the case where the client cache thinks the room is empty but the
    // server still has live bed FKs — the data-store wraps that 409 in
    // RoomInUseError, and the page must translate it into a tailored
    // destructive toast rather than the generic "couldn't delete" one).
    mocks.deleteRoom.mockRejectedValueOnce(new MockRoomInUseError());
    await renderBedsTab();

    await clickRoomDeleteAndConfirm("r2");
    await flushPromises();

    expect(mocks.deleteRoom).toHaveBeenCalledWith("r2");
    expect(toastMock).toHaveBeenCalledTimes(1);
    const toastArg = toastMock.mock.calls[0][0] as Record<string, unknown>;
    expect(toastArg.title).toBe("Room still has beds");
    expect(toastArg.variant).toBe("destructive");
    expect(String(toastArg.description ?? "").toLowerCase()).toContain(
      "delete or move the beds",
    );
  });

  it("a non-RoomInUseError rejection falls through to the generic 'Couldn't delete room' toast", async () => {
    // Pinned alongside the 409 test so the RoomInUseError branch is the
    // only branch that gets the bespoke title — a regression that mapped
    // every error to "Room still has beds" would lie to the user.
    mocks.deleteRoom.mockRejectedValueOnce(new Error("network down"));
    await renderBedsTab();

    await clickRoomDeleteAndConfirm("r2");
    await flushPromises();

    expect(toastMock).toHaveBeenCalledTimes(1);
    const toastArg = toastMock.mock.calls[0][0] as Record<string, unknown>;
    expect(toastArg.title).toBe("Couldn't delete room");
    expect(toastArg.variant).toBe("destructive");
  });

  it("clicking Add Bed inside a room creates a bed in that room with the next bedNumber", async () => {
    await renderBedsTab();

    // r2 has 0 beds; the property's max bedNumber is 2 → next is 3.
    const btn = container.querySelector(
      '[data-testid="button-add-bed-r2"]',
    ) as HTMLButtonElement;
    await act(async () => {
      btn.click();
    });

    expect(mocks.addBed).toHaveBeenCalledTimes(1);
    const arg = mocks.addBed.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.propertyId).toBe("p1");
    expect(arg.roomId).toBe("r2");
    expect(arg.bedNumber).toBe(3);
    expect(arg.status).toBe("Vacant");
    expect(arg.occupantId).toBeNull();
  });
});

// ── Tests: orphan beds (Beds without a room) ────────────────────────────
describe("Property detail — orphan beds card", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeFreshState();
    // An orphan bed: roomId points at a room that doesn't exist on this
    // property. Post-migration this shouldn't happen, but the page must
    // still surface and let the user fix it.
    state.beds.push({
      id: "b-orphan",
      propertyId: "p1",
      bedNumber: 99,
      roomId: "ghost-room",
      status: "Vacant",
      occupantId: null,
    });
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

  function orphanCard(): HTMLElement {
    const el = container.querySelector('[data-testid="orphan-beds-card"]');
    if (!el) throw new Error("orphan-beds-card missing");
    return el as HTMLElement;
  }

  it("renders the 'Beds without a room' card listing each orphan bed", async () => {
    await renderBedsTab();

    const card = orphanCard();
    expect(card.textContent).toContain("Beds without a room (1)");
    expect(card.textContent).toContain("Bed 99");

    // The orphan bed must NOT also appear under any of the room cards
    // (otherwise reassignment would double-count).
    const r1 = container.querySelector('[data-testid="room-card-r1"]');
    const r2 = container.querySelector('[data-testid="room-card-r2"]');
    expect(r1?.textContent ?? "").not.toContain("Bed 99");
    expect(r2?.textContent ?? "").not.toContain("Bed 99");
  });

  it("the orphan bed's reassign dropdown lists every existing room", async () => {
    await renderBedsTab();
    const card = orphanCard();

    const items = Array.from(card.querySelectorAll("[data-select-item]"))
      .map((el) => el.getAttribute("data-select-item"))
      .filter((v): v is string => v !== null)
      .sort();
    // The two seed rooms r1 and r2 must each be a reassignment target.
    expect(items).toEqual(["r1", "r2"]);
  });

  it("picking a room from the orphan dropdown reassigns the bed via updateBed", async () => {
    await renderBedsTab();
    const card = orphanCard();

    const r2Btn = card.querySelector(
      '[data-select-item="r2"]',
    ) as HTMLButtonElement | null;
    expect(r2Btn).not.toBeNull();
    await act(async () => {
      r2Btn!.click();
    });

    expect(mocks.updateBed).toHaveBeenCalledTimes(1);
    expect(mocks.updateBed).toHaveBeenCalledWith("b-orphan", { roomId: "r2" });
  });

  it("hides the orphan card entirely when every bed has a known roomId", async () => {
    // Reset to the no-orphans baseline, overriding the beforeEach push.
    state = makeFreshState();
    await renderBedsTab();
    expect(container.querySelector('[data-testid="orphan-beds-card"]')).toBeNull();
  });
});

// ── Tests: Beds tab room sort ───────────────────────────────────────────
// Lock down the Beds-tab room sort dropdown so neither the comparator
// (e.g. flipping null-handling so unrated rooms float to the top) nor the
// localStorage persistence wrapper can regress silently. Mirrors the
// matching Properties / Customers sort test follow-ups.
const BEDS_SORT_STORAGE_KEY = "housingops:property-beds:sort";

describe("Property detail — Beds tab room sort", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  // Five rooms chosen so each sort produces a distinct, easy-to-assert
  // ordering AND so the comparator's null bucket has at least one
  // representative for both the $/sqft sort (which goes through
  // computePricePerSqft and treats rent=0 OR sqft=0 as null) and the
  // single-axis rent / sqft sorts (which treat their own zero as null).
  //   r-A: sqft 100, rent 500  → ppsf 5.00
  //   r-B: sqft 200, rent 600  → ppsf 3.00
  //   r-C: sqft  50, rent 1000 → ppsf 20.00
  //   r-D: sqft   0, rent 800  → ppsf null (sqft=0); sqft sort → null
  //   r-E: sqft 150, rent   0  → ppsf null (rent=0); rent sort → null
  // Default order (insertion order in rooms[]) is A, B, C, D, E.
  function makeSortFixture(): State {
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
        { id: "r-A", propertyId: "p1", name: "Alpha",   sqft: 100, bathrooms: 1, monthlyRent: 500 },
        { id: "r-B", propertyId: "p1", name: "Bravo",   sqft: 200, bathrooms: 1, monthlyRent: 600 },
        { id: "r-C", propertyId: "p1", name: "Charlie", sqft:  50, bathrooms: 1, monthlyRent: 1000 },
        { id: "r-D", propertyId: "p1", name: "Delta",   sqft:   0, bathrooms: 1, monthlyRent: 800 },
        { id: "r-E", propertyId: "p1", name: "Echo",    sqft: 150, bathrooms: 1, monthlyRent: 0 },
      ],
      // Empty so every room card has its trash button enabled and so the
      // sortedGroups list under test is the only visible variable.
      beds: [],
      occupants: [],
      utilities: [],
      insuranceCertificates: [],
    };
  }

  beforeEach(() => {
    state = makeSortFixture();
    Object.values(mocks).forEach((m) => m.mockReset());
    toastMock.mockReset();
    // Critical: the sort key is read from localStorage on first render
    // and written on every change. Tests downstream of one that wrote a
    // non-default key would otherwise hydrate with that stale value.
    window.localStorage.clear();
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
    window.localStorage.clear();
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

  // Read the on-screen room order by walking room-card-* test ids in
  // document order. This is what the user actually sees, regardless of
  // how the comparator is implemented internally.
  function getRoomOrder(): string[] {
    return Array.from(
      container.querySelectorAll('[data-testid^="room-card-"]'),
    ).map((el) => {
      const id = el.getAttribute("data-testid") ?? "";
      return id.replace(/^room-card-/, "");
    });
  }

  // Click a sort option in the mocked Select. The mock renders each
  // SelectItem as a real <button data-select-item="<value>"> inside the
  // select-beds-sort wrapper, so this is exactly how a user would pick.
  async function pickSort(value: string) {
    const wrapper = container.querySelector(
      '[data-testid="select-beds-sort"]',
    ) as HTMLElement | null;
    if (!wrapper) throw new Error("select-beds-sort wrapper missing");
    const btn = wrapper.querySelector(
      `[data-select-item="${value}"]`,
    ) as HTMLButtonElement | null;
    if (!btn) throw new Error(`sort option ${value} missing`);
    await act(async () => {
      btn.click();
    });
    await flushPromises();
  }

  it("defaults to insertion order when no sort has been picked", async () => {
    await renderBedsTab();
    expect(getRoomOrder()).toEqual(["r-A", "r-B", "r-C", "r-D", "r-E"]);
  });

  it("sorts $/sqft high → low with null-ppsf rooms (rent or sqft = 0) at the bottom", async () => {
    await renderBedsTab();
    await pickSort("ppsf-desc");
    // ppsf: C=20, A=5, B=3 (sorted desc), then D & E (null) — D before E
    // because Array.prototype.sort is stable in V8 / modern engines and
    // their valueFor(...) is equal (both null), so original order is
    // preserved.
    expect(getRoomOrder()).toEqual(["r-C", "r-A", "r-B", "r-D", "r-E"]);
  });

  it("sorts $/sqft low → high with null-ppsf rooms still at the bottom (not flipped to the top)", async () => {
    // The regression this guards: a future refactor that flips null
    // handling so unrated rooms sort to the top in -asc would push the
    // best-value rooms below garbage rows and silently break the page.
    await renderBedsTab();
    await pickSort("ppsf-asc");
    // ppsf: B=3, A=5, C=20 (sorted asc), then D & E (null) at the bottom.
    expect(getRoomOrder()).toEqual(["r-B", "r-A", "r-C", "r-D", "r-E"]);
  });

  it("sorts Rent high → low with rent=0 rooms at the bottom", async () => {
    await renderBedsTab();
    await pickSort("rent-desc");
    // rent: C=1000, D=800, B=600, A=500, then E (rent=0 → null).
    expect(getRoomOrder()).toEqual(["r-C", "r-D", "r-B", "r-A", "r-E"]);
  });

  it("sorts Rent low → high with rent=0 rooms still at the bottom", async () => {
    await renderBedsTab();
    await pickSort("rent-asc");
    // rent: A=500, B=600, D=800, C=1000, then E (rent=0 → null).
    expect(getRoomOrder()).toEqual(["r-A", "r-B", "r-D", "r-C", "r-E"]);
  });

  it("sorts Sqft high → low with sqft=0 rooms at the bottom", async () => {
    await renderBedsTab();
    await pickSort("sqft-desc");
    // sqft: B=200, E=150, A=100, C=50, then D (sqft=0 → null).
    expect(getRoomOrder()).toEqual(["r-B", "r-E", "r-A", "r-C", "r-D"]);
  });

  it("sorts Sqft low → high with sqft=0 rooms still at the bottom", async () => {
    await renderBedsTab();
    await pickSort("sqft-asc");
    // sqft: C=50, A=100, E=150, B=200, then D (sqft=0 → null).
    expect(getRoomOrder()).toEqual(["r-C", "r-A", "r-E", "r-B", "r-D"]);
  });

  it("picking a non-default sort persists that choice to localStorage", async () => {
    await renderBedsTab();
    expect(window.localStorage.getItem(BEDS_SORT_STORAGE_KEY)).toBeNull();

    await pickSort("rent-desc");
    expect(window.localStorage.getItem(BEDS_SORT_STORAGE_KEY)).toBe("rent-desc");

    // Switching to a different non-default sort overwrites the key
    // rather than accumulating stale values.
    await pickSort("sqft-asc");
    expect(window.localStorage.getItem(BEDS_SORT_STORAGE_KEY)).toBe("sqft-asc");
  });

  it("picking 'Default' again removes the localStorage key entirely (doesn't leave 'default' behind)", async () => {
    await renderBedsTab();
    await pickSort("ppsf-desc");
    expect(window.localStorage.getItem(BEDS_SORT_STORAGE_KEY)).toBe("ppsf-desc");

    await pickSort("default");
    // The wrapper deliberately removes the key when the user is back to
    // default so storage doesn't accumulate "default" sentinels.
    expect(window.localStorage.getItem(BEDS_SORT_STORAGE_KEY)).toBeNull();
  });

  it("hydrates from a pre-set localStorage value on first render", async () => {
    // Simulate a returning user whose previous session left "rent-desc"
    // in storage. The page must apply it before the first paint of the
    // room cards — not on a follow-up effect — so the user never sees
    // their cards reflow.
    window.localStorage.setItem(BEDS_SORT_STORAGE_KEY, "rent-desc");

    await renderBedsTab();

    expect(getRoomOrder()).toEqual(["r-C", "r-D", "r-B", "r-A", "r-E"]);
    // The Select also reflects the hydrated value via its data-current
    // attribute (the mock wires `value` → data-current).
    const wrapper = container.querySelector(
      '[data-testid="select-beds-sort"]',
    ) as HTMLElement | null;
    expect(wrapper?.getAttribute("data-current")).toBe("rent-desc");
  });

  it("ignores an unknown / corrupted localStorage value and falls back to default", async () => {
    // A regression that widened the validation to accept any string
    // would let a stale or hand-edited value crash the comparator
    // (switch falls through to `null` for every room → all-null bucket
    // → sort is a no-op, but the Select would still display garbage).
    // The page's readPersistedBedsSort must reject unknowns.
    window.localStorage.setItem(BEDS_SORT_STORAGE_KEY, "not-a-real-sort");

    await renderBedsTab();

    expect(getRoomOrder()).toEqual(["r-A", "r-B", "r-C", "r-D", "r-E"]);
    const wrapper = container.querySelector(
      '[data-testid="select-beds-sort"]',
    ) as HTMLElement | null;
    expect(wrapper?.getAttribute("data-current")).toBe("default");
  });
});

// ── Tests: occupant delete affordance inside a bed row ──────────────────
describe("Property detail — Beds tab occupant delete", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeFreshState();
    // Seed a single occupied bed so the inline occupant cells render
    // (and therefore the delete-occupant trash button does too).
    state.beds = [
      {
        id: "b1",
        propertyId: "p1",
        bedNumber: 1,
        roomId: "r1",
        status: "Occupied",
        occupantId: "occ-1",
      },
    ];
    state.occupants = [
      {
        id: "occ-1",
        name: "Pat Smith",
        email: "pat@example.com",
        phone: "555-0100",
        bedId: "b1",
        propertyId: "p1",
        moveInDate: "2025-01-01",
        moveOutDate: null,
        status: "Active",
        chargePerBed: 500,
        billingFrequency: "Monthly",
        employeeId: "EMP-1",
        company: "Acme Co",
      },
    ];
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

  it("renders a delete-occupant trash button beside the occupant name", async () => {
    await renderBedsTab();
    const btn = container.querySelector(
      '[data-testid="button-delete-occupant-occ-1"]',
    );
    expect(btn).not.toBeNull();
  });

  it("clicking the trash opens a confirm dialog and Confirm fires deleteOccupant", async () => {
    await renderBedsTab();

    const trash = container.querySelector(
      '[data-testid="button-delete-occupant-occ-1"]',
    ) as HTMLButtonElement;
    await act(async () => {
      trash.click();
    });

    // The confirm dialog renders into a portal off `document`, not the
    // test container, so query off `document`.
    const confirm = document.querySelector(
      '[data-testid="button-confirm-delete-confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirm, "confirm dialog should be open after clicking the trash").not.toBeNull();
    expect(mocks.deleteOccupant).not.toHaveBeenCalled();

    await act(async () => {
      confirm!.click();
    });

    expect(mocks.deleteOccupant).toHaveBeenCalledTimes(1);
    expect(mocks.deleteOccupant).toHaveBeenCalledWith("occ-1");
  });
});
