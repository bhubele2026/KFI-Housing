import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { LeasesTable } from "./leases-table";
import type { Lease, Property } from "@/data/mockData";

vi.mock("@/components/ui/alert-dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    AlertDialog: Pass,
    AlertDialogTrigger: Pass,
    AlertDialogContent: () => null,
    AlertDialogHeader: Pass,
    AlertDialogTitle: Pass,
    AlertDialogDescription: Pass,
    AlertDialogFooter: Pass,
    AlertDialogAction: Pass,
    AlertDialogCancel: Pass,
    AlertDialogPortal: Pass,
    AlertDialogOverlay: () => null,
  };
});

const property: Property = {
  id: "p1",
  customerId: "c1",
  name: "Maple",
  address: "1 Maple Way",
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
  rentFrequency: "Monthly",
} as unknown as Property;

const baseLease: Lease = {
  id: "l-base",
  propertyId: "p1",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  monthlyRent: 0,
  securityDeposit: 0,
  status: "Active",
  notes: "",
  clauses: "",
  buyoutAvailable: false,
  buyoutCost: null,
  weeklyCost: 0,
  vendor: "",
  needsReview: false,
};

const flagged1: Lease = { ...baseLease, id: "l-1", needsReview: true };
const flagged2: Lease = { ...baseLease, id: "l-2", needsReview: true };
const clean: Lease = { ...baseLease, id: "l-clean", needsReview: false };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container.remove();
});

async function render(ui: ReactNode) {
  const { hook } = memoryLocation({ path: "/leases" });
  await act(async () => {
    root = createRoot(container);
    root.render(<Router hook={hook}>{ui}</Router>);
  });
}

function clickCheckbox(testId: string) {
  const cb = container.querySelector(
    `[data-testid="${testId}"]`,
  ) as HTMLElement | null;
  expect(cb).not.toBeNull();
  cb!.click();
}

describe("LeasesTable — bulk 'Mark selected as reviewed' (Task #360)", () => {
  it("hides the checkbox column and toolbar when no onBulkMarkReviewed is wired", async () => {
    await render(
      <LeasesTable
        leases={[flagged1, flagged2, clean]}
        properties={[property]}
        onDelete={() => {}}
      />,
    );
    expect(
      container.querySelector('[data-testid="checkbox-select-all-flagged-leases"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="checkbox-select-lease-l-1"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="leases-bulk-toolbar"]'),
    ).toBeNull();
  });

  it("renders per-row checkboxes only on flagged rows when onBulkMarkReviewed is wired", async () => {
    await render(
      <LeasesTable
        leases={[flagged1, flagged2, clean]}
        properties={[property]}
        onDelete={() => {}}
        onBulkMarkReviewed={() => {}}
      />,
    );
    expect(
      container.querySelector('[data-testid="checkbox-select-lease-l-1"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="checkbox-select-lease-l-2"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="checkbox-select-lease-l-clean"]'),
    ).toBeNull();
  });

  it("shows the bulk toolbar with the count and calls the handler with selected ids, then clears selection", async () => {
    const onBulk = vi.fn();
    await render(
      <LeasesTable
        leases={[flagged1, flagged2, clean]}
        properties={[property]}
        onDelete={() => {}}
        onBulkMarkReviewed={onBulk}
      />,
    );
    // Toolbar hidden when no rows selected
    expect(
      container.querySelector('[data-testid="leases-bulk-toolbar"]'),
    ).toBeNull();

    await act(async () => {
      clickCheckbox("checkbox-select-lease-l-1");
    });
    await act(async () => {
      clickCheckbox("checkbox-select-lease-l-2");
    });

    const count = container.querySelector(
      '[data-testid="text-bulk-selected-count"]',
    );
    expect(count?.textContent).toBe("2 selected");

    const btn = container.querySelector(
      '[data-testid="button-bulk-mark-reviewed"]',
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("Mark 2 as reviewed");

    await act(async () => {
      btn!.click();
    });

    expect(onBulk).toHaveBeenCalledTimes(1);
    expect(onBulk.mock.calls[0][0].sort()).toEqual(["l-1", "l-2"]);

    // Selection clears, toolbar disappears
    expect(
      container.querySelector('[data-testid="leases-bulk-toolbar"]'),
    ).toBeNull();
  });

  it("master checkbox toggles every flagged row at once", async () => {
    const onBulk = vi.fn();
    await render(
      <LeasesTable
        leases={[flagged1, flagged2, clean]}
        properties={[property]}
        onDelete={() => {}}
        onBulkMarkReviewed={onBulk}
      />,
    );
    await act(async () => {
      clickCheckbox("checkbox-select-all-flagged-leases");
    });
    const count = container.querySelector(
      '[data-testid="text-bulk-selected-count"]',
    );
    expect(count?.textContent).toBe("2 selected");

    const btn = container.querySelector(
      '[data-testid="button-bulk-mark-reviewed"]',
    ) as HTMLButtonElement;
    await act(async () => {
      btn.click();
    });
    expect(onBulk).toHaveBeenCalledWith(expect.arrayContaining(["l-1", "l-2"]));
    expect(onBulk.mock.calls[0][0]).toHaveLength(2);
  });

  it("'Clear' button drops the selection without calling the handler", async () => {
    const onBulk = vi.fn();
    await render(
      <LeasesTable
        leases={[flagged1, flagged2]}
        properties={[property]}
        onDelete={() => {}}
        onBulkMarkReviewed={onBulk}
      />,
    );
    await act(async () => {
      clickCheckbox("checkbox-select-lease-l-1");
    });
    expect(
      container.querySelector('[data-testid="leases-bulk-toolbar"]'),
    ).not.toBeNull();
    const clearBtn = container.querySelector(
      '[data-testid="button-clear-bulk-selection"]',
    ) as HTMLButtonElement;
    await act(async () => {
      clearBtn.click();
    });
    expect(
      container.querySelector('[data-testid="leases-bulk-toolbar"]'),
    ).toBeNull();
    expect(onBulk).not.toHaveBeenCalled();
  });

  it("hides the master checkbox when no flagged rows are present", async () => {
    await render(
      <LeasesTable
        leases={[clean]}
        properties={[property]}
        onDelete={() => {}}
        onBulkMarkReviewed={() => {}}
      />,
    );
    expect(
      container.querySelector('[data-testid="checkbox-select-all-flagged-leases"]'),
    ).toBeNull();
  });
});
