import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// Coverage for Task #608 — the unified UploadLeasePdfDialog now hosts the
// property-detail Add Lease flow, with the property pre-locked. Two paths
// matter for that wiring:
//
//   1. Manual entry — operator picks "Enter the lease details manually",
//      fills the required fields, and saves. The lease must land on the
//      locked property without going through the PDF parser at all.
//   2. PDF upload happy path — operator drops a PDF, we mock importLeasePdf
//      to resolve, the review form shows the locked-property header, and
//      saving forwards the resolved fields into addLease pinned to the
//      locked property.
//
// Both regressions would silently break the operator's primary entry point
// for adding a lease from a property's Leases tab.

vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

// Stub the PDF import client so the dialog's upload path never touches
// the network. The default implementation resolves with a deterministic
// extraction result the review form can render and the test can assert on.
const importLeasePdfMock = vi.fn();
vi.mock("@/lib/lease-pdf-import", async () => {
  const actual = await vi.importActual<typeof import("@/lib/lease-pdf-import")>(
    "@/lib/lease-pdf-import",
  );
  return {
    ...actual,
    importLeasePdf: (file: File) => importLeasePdfMock(file),
  };
});

// Tooltip / Popover portals aren't relevant here and complicate teardown.
vi.mock("@/components/ui/tooltip", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Tooltip: Pass,
    TooltipTrigger: Pass,
    TooltipContent: () => null,
    TooltipProvider: Pass,
  };
});

vi.mock("@/components/ui/popover", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Popover: Pass, PopoverTrigger: Pass, PopoverContent: () => null };
});

// Select is stubbed so it doesn't try to portal under jsdom, but we still
// route `onValueChange` from the parent Select down to its SelectItem
// children via context. That way tests can drive a real selection by
// clicking the SelectItem button (used by the multi-building tests below
// to pick a building from the dropdown).
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const SelectChangeCtx = React.createContext<((value: string) => void) | null>(
    null,
  );
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Select: ({
      children,
      onValueChange,
    }: {
      children?: ReactNode;
      onValueChange?: (value: string) => void;
    }) => (
      <SelectChangeCtx.Provider value={onValueChange ?? null}>
        <div>{children}</div>
      </SelectChangeCtx.Provider>
    ),
    SelectContent: Pass,
    SelectGroup: Pass,
    SelectItem: ({ children, value }: { children?: ReactNode; value: string }) => {
      const onChange = React.useContext(SelectChangeCtx);
      return (
        <button
          type="button"
          data-value={value}
          onClick={() => onChange?.(value)}
        >
          {children}
        </button>
      );
    },
    SelectLabel: Pass,
    SelectScrollDownButton: Pass,
    SelectScrollUpButton: Pass,
    SelectSeparator: Pass,
    SelectTrigger: Pass,
    SelectValue: Pass,
  };
});

const LOCKED_PROPERTY = {
  id: "p1",
  customerId: "c1",
  name: "Maple House",
  address: "1 Maple Way",
  city: "Austin",
  state: "TX",
  zip: "78701",
};

const addLeaseMock = vi.fn(() => Promise.resolve());
const dataStoreState = {
  properties: [LOCKED_PROPERTY],
  customers: [{ id: "c1", name: "Acme" }],
  addLease: addLeaseMock,
  addProperty: vi.fn(),
  addCustomer: vi.fn(),
  updateProperty: vi.fn(),
};

vi.mock("@/context/data-store", () => ({
  useData: () => dataStoreState,
  RoomInUseError: class RoomInUseError extends Error {},
}));

import { UploadLeasePdfDialog } from "./upload-lease-pdf-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function openDialog(): Promise<void> {
  const trigger = document.body.querySelector(
    '[data-testid="button-upload-lease-pdf"]',
  ) as HTMLButtonElement | null;
  // When the caller supplies its own `trigger` prop the default
  // testid won't exist — fall back to the first button in the
  // container in that case (tests below only use the default trigger).
  const target =
    trigger ??
    (document.body.querySelector("button") as HTMLButtonElement | null);
  if (!target) throw new Error("No dialog trigger found");
  await act(async () => {
    target.click();
  });
}

describe("UploadLeasePdfDialog — locked-property flows (Task #608)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    addLeaseMock.mockClear();
    importLeasePdfMock.mockReset();
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
    // Radix Dialog portals into document.body — wipe anything left behind
    // so the next test starts from a clean DOM.
    document
      .querySelectorAll('[role="dialog"], [data-radix-portal]')
      .forEach((el) => el.remove());
  });

  async function mountDialog(): Promise<void> {
    await act(async () => {
      root = createRoot(container);
      root.render(<UploadLeasePdfDialog propertyId="p1" />);
    });
  }

  it("manual-entry path saves a new lease against the locked property without touching the PDF importer", async () => {
    await mountDialog();
    await openDialog();

    const manualLink = document.body.querySelector(
      '[data-testid="button-enter-lease-manually"]',
    ) as HTMLButtonElement | null;
    expect(manualLink).not.toBeNull();

    await act(async () => {
      manualLink!.click();
    });

    // Manual entry jumps straight to the review stage with a synthetic
    // queue item that has no PDF. The "Manual entry — no PDF" badge is
    // the breadcrumb that tells the operator (and us) which branch is
    // active.
    expect(document.body.textContent).toContain("Manual entry — no PDF");

    // The locked-property header replaces the property picker and pins
    // the lease to Maple House.
    const lockedHeader = document.body.querySelector(
      '[data-testid="pdf-locked-property"]',
    );
    expect(lockedHeader).not.toBeNull();
    expect(lockedHeader!.textContent).toContain("Maple House");

    // Fill the required lease fields — start date, end date, monthly rent.
    // The Save button stays disabled until canSaveReviewing flips true,
    // so this also indirectly exercises the lockedPropertyId branch of
    // that gating function.
    const startInput = document.body.querySelector(
      '[data-testid="input-pdf-lease-start"]',
    ) as HTMLInputElement;
    const endInput = document.body.querySelector(
      '[data-testid="input-pdf-lease-end"]',
    ) as HTMLInputElement;
    const rentInput = document.body.querySelector(
      '[data-testid="input-pdf-lease-rent"]',
    ) as HTMLInputElement;
    expect(startInput).not.toBeNull();
    expect(endInput).not.toBeNull();
    expect(rentInput).not.toBeNull();

    await act(async () => {
      setNativeInputValue(startInput, "2026-06-01");
      setNativeInputValue(endInput, "2027-05-31");
      setNativeInputValue(rentInput, "2400");
    });

    const saveBtn = document.body.querySelector(
      '[data-testid="button-confirm-pdf-import"]',
    ) as HTMLButtonElement;
    expect(saveBtn).not.toBeNull();
    expect(saveBtn.disabled).toBe(false);

    await act(async () => {
      saveBtn.click();
    });

    // The lease must hit the data store pinned to the locked property with
    // the values the operator just typed. The PDF importer must not have
    // been called at all — manual entry skips parsing.
    expect(importLeasePdfMock).not.toHaveBeenCalled();
    expect(addLeaseMock).toHaveBeenCalledTimes(1);
    const savedLease = addLeaseMock.mock.calls[0][0] as Record<string, unknown>;
    expect(savedLease.propertyId).toBe("p1");
    expect(savedLease.startDate).toBe("2026-06-01");
    expect(savedLease.endDate).toBe("2027-05-31");
    expect(savedLease.monthlyRent).toBe(2400);
    // Manual entry inherits "Active" as the default status and carries no
    // clauses or buyout cost — confirms the blank-draft seed didn't leak
    // PDF-only defaults.
    expect(savedLease.status).toBe("Active");
    expect(savedLease.buyoutAvailable).toBe(false);
    expect(savedLease.buyoutCost).toBeNull();
  });

  it("PDF upload happy path lands the operator on a locked-property review form and saves the parsed lease", async () => {
    importLeasePdfMock.mockResolvedValue({
      extracted: {
        propertyName: "Whatever the PDF said",
        propertyAddress: null,
        city: null,
        state: null,
        zip: null,
        landlordName: "Alice Landlord",
        startDate: "2026-07-01",
        endDate: "2027-06-30",
        monthlyRent: 1800,
        securityDeposit: 1800,
        notes: "",
        clauses: "",
        buyoutAvailable: false,
        buyoutCost: null,
        confidence: "high",
      },
      fixups: [],
      // Even when the matcher suggests a different property, the locked
      // dialog must ignore it and pin to Maple House.
      topMatch: null,
      candidates: [],
    });

    await mountDialog();
    await openDialog();

    // Push a fake PDF through the hidden file input — equivalent to a
    // drop, but easier to drive than a real DataTransfer under jsdom.
    const fileInput = document.body.querySelector(
      '[data-testid="input-lease-pdf-file"]',
    ) as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    const file = new File(["%PDF-1.4 fake"], "lease.pdf", {
      type: "application/pdf",
    });
    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        configurable: true,
        value: [file],
      });
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Let the import promise resolve and the queue → needs-review update settle.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(importLeasePdfMock).toHaveBeenCalledTimes(1);
    expect(importLeasePdfMock.mock.calls[0][0]).toBe(file);

    // Find the Review button on the queue row and click it to advance to
    // the review stage. The id is dynamic so match on the data-testid prefix.
    const reviewBtn = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[data-testid^="button-review-"]',
      ),
    )[0];
    expect(reviewBtn).toBeDefined();

    await act(async () => {
      reviewBtn.click();
    });

    // The review form must show the locked-property header — the operator
    // explicitly chose Maple House as the destination, regardless of what
    // the parser suggested.
    const lockedHeader = document.body.querySelector(
      '[data-testid="pdf-locked-property"]',
    );
    expect(lockedHeader).not.toBeNull();
    expect(lockedHeader!.textContent).toContain("Maple House");

    // The parsed lease fields are pre-filled — confirms the extracted
    // payload flowed through leaseDraftFromExtracted into the form.
    const rentInput = document.body.querySelector(
      '[data-testid="input-pdf-lease-rent"]',
    ) as HTMLInputElement;
    expect(rentInput.value).toBe("1800");

    const saveBtn = document.body.querySelector(
      '[data-testid="button-confirm-pdf-import"]',
    ) as HTMLButtonElement;
    expect(saveBtn).not.toBeNull();
    expect(saveBtn.disabled).toBe(false);

    await act(async () => {
      saveBtn.click();
    });

    expect(addLeaseMock).toHaveBeenCalledTimes(1);
    const saved = addLeaseMock.mock.calls[0][0] as Record<string, unknown>;
    // Locked branch: lease lands on p1 with parsed dates / rent intact.
    expect(saved.propertyId).toBe("p1");
    expect(saved.startDate).toBe("2026-07-01");
    expect(saved.endDate).toBe("2027-06-30");
    expect(saved.monthlyRent).toBe(1800);
    expect(saved.securityDeposit).toBe(1800);
  });
});

// Coverage for Task #620 — when the locked property has more than one
// building, the review form must render a Building picker (showBuildingPicker
// branch) and forward the chosen buildingId through to addLease. The
// pre-existing tests above only exercise the single/no-building case, so a
// regression that hid the picker or dropped the buildingId would slip past.
describe("UploadLeasePdfDialog — multi-building locked property (Task #620)", () => {
  const BUILDINGS = [
    { id: "b1", propertyId: "p1", name: "Building A",
      address: "", city: "", state: "", zip: "", notes: "" },
    { id: "b2", propertyId: "p1", name: "Building B",
      address: "", city: "", state: "", zip: "", notes: "" },
    // Different property — must be filtered out of the picker.
    { id: "b3", propertyId: "p2", name: "Other Property Building",
      address: "", city: "", state: "", zip: "", notes: "" },
  ];

  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    addLeaseMock.mockClear();
    importLeasePdfMock.mockReset();
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
    document
      .querySelectorAll('[role="dialog"], [data-radix-portal]')
      .forEach((el) => el.remove());
  });

  async function mountDialogWithBuildings(): Promise<void> {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <UploadLeasePdfDialog propertyId="p1" buildings={BUILDINGS} />,
      );
    });
  }

  async function openManualEntryAndFillRequiredFields(): Promise<void> {
    await openDialog();
    const manualLink = document.body.querySelector(
      '[data-testid="button-enter-lease-manually"]',
    ) as HTMLButtonElement | null;
    expect(manualLink).not.toBeNull();
    await act(async () => {
      manualLink!.click();
    });
    const startInput = document.body.querySelector(
      '[data-testid="input-pdf-lease-start"]',
    ) as HTMLInputElement;
    const endInput = document.body.querySelector(
      '[data-testid="input-pdf-lease-end"]',
    ) as HTMLInputElement;
    const rentInput = document.body.querySelector(
      '[data-testid="input-pdf-lease-rent"]',
    ) as HTMLInputElement;
    await act(async () => {
      setNativeInputValue(startInput, "2026-06-01");
      setNativeInputValue(endInput, "2027-05-31");
      setNativeInputValue(rentInput, "2400");
    });
  }

  it("renders the Building picker and forwards the chosen buildingId to addLease", async () => {
    await mountDialogWithBuildings();
    await openManualEntryAndFillRequiredFields();

    // The picker is only rendered when showBuildingPicker is true (i.e.
    // 2+ buildings on the locked property). The trigger's data-testid is
    // dropped by our Pass-through SelectTrigger stub, so detect the
    // picker via its Label and the SelectItem buttons it renders. With
    // our Select mock each SelectItem is rendered as a button keyed by
    // value, so we can assert on data-value directly.
    const buildingLabel = document.body.querySelector(
      'label[for="pdf-lease-building"]',
    );
    expect(buildingLabel).not.toBeNull();
    expect(buildingLabel!.textContent).toContain("Building");

    const buildingButtons = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("[data-value]"),
    );
    const values = buildingButtons.map((b) => b.getAttribute("data-value"));
    expect(values).toContain("b1");
    expect(values).toContain("b2");
    // Buildings under other properties must not leak into the picker.
    expect(values).not.toContain("b3");
    // The "All buildings" sentinel is also rendered as an option.
    expect(values).toContain("__all__");

    // Pick Building B by clicking its SelectItem button — the upgraded
    // Select mock wires this through to the parent Select's onValueChange.
    const pickB = buildingButtons.find(
      (b) => b.getAttribute("data-value") === "b2",
    )!;
    await act(async () => {
      pickB.click();
    });

    const saveBtn = document.body.querySelector(
      '[data-testid="button-confirm-pdf-import"]',
    ) as HTMLButtonElement;
    expect(saveBtn).not.toBeNull();
    expect(saveBtn.disabled).toBe(false);

    await act(async () => {
      saveBtn.click();
    });

    expect(addLeaseMock).toHaveBeenCalledTimes(1);
    const saved = addLeaseMock.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.propertyId).toBe("p1");
    expect(saved.buildingId).toBe("b2");
  });

  it("saves with buildingId: null when no building is chosen", async () => {
    await mountDialogWithBuildings();
    await openManualEntryAndFillRequiredFields();

    // Picker is rendered, but the operator leaves it on the default
    // "All buildings" option. We expect that to land as buildingId: null
    // on the persisted lease (empty-string buildingId is normalized to
    // null when the queue item is handed to addLease).
    // Picker is rendered (detected via its Label since our SelectTrigger
    // stub drops the data-testid).
    expect(
      document.body.querySelector('label[for="pdf-lease-building"]'),
    ).not.toBeNull();

    const saveBtn = document.body.querySelector(
      '[data-testid="button-confirm-pdf-import"]',
    ) as HTMLButtonElement;
    await act(async () => {
      saveBtn.click();
    });

    expect(addLeaseMock).toHaveBeenCalledTimes(1);
    const saved = addLeaseMock.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.propertyId).toBe("p1");
    expect(saved.buildingId).toBeNull();
  });
});
