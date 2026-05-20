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

// Minimal Select stub — render the trigger inline and each SelectItem as
// a button keyed on its value. None of the assertions below depend on a
// Select, but the review stage renders the lease-status Select and would
// otherwise crash trying to portal under jsdom.
vi.mock("@/components/ui/select", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Select: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    SelectContent: Pass,
    SelectGroup: Pass,
    SelectItem: ({ children, value }: { children?: ReactNode; value: string }) => (
      <button type="button" data-value={value}>{children}</button>
    ),
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
