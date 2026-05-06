import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { LeasesTable } from "./leases-table";
import type { Lease, Property } from "@/data/mockData";

// These tests pin down the "Needs review" surfaces added in task #301:
//   1. Flagged leases render an amber badge in the Status cell.
//   2. The badge tooltip surfaces the importer's reason from the lease's
//      notes (the "Needs review: …" sentence baked in by buildLeaseNotes).
//   3. A per-row "Fix" quick-action links to the lease detail page with
//      `?focus=rent` so the rent inline editor opens pre-focused.

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

const flaggedProperty: Property = {
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

const flaggedLease: Lease = {
  id: "l-flagged",
  propertyId: "p1",
  startDate: "2025-01-01",
  endDate: "",
  monthlyRent: 0,
  securityDeposit: 0,
  status: "Upcoming",
  notes:
    'Vendor: Adient. Weekly cost (raw): $69.23???. Needs review: weekly cost not numeric: "$69.23???". Source: master file row 12.',
  clauses: "",
  buyoutAvailable: false,
  buyoutCost: null,
  weeklyCost: 0,
  vendor: "Adient",
  needsReview: true,
};

const cleanLease: Lease = {
  ...flaggedLease,
  id: "l-clean",
  notes: "",
  vendor: "",
  needsReview: false,
};

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

async function render(ui: ReactNode, initialPath = "/leases") {
  const { hook } = memoryLocation({ path: initialPath });
  await act(async () => {
    root = createRoot(container);
    root.render(<Router hook={hook}>{ui}</Router>);
  });
}

describe("LeasesTable — needs-review surfaces", () => {
  it("renders an amber 'Needs review' badge only on flagged leases", async () => {
    await render(
      <LeasesTable
        leases={[flaggedLease, cleanLease]}
        properties={[flaggedProperty]}
        onDelete={() => {}}
        originPath="/leases"
      />,
    );
    expect(
      container.querySelector(
        '[data-testid="badge-lease-needs-review-l-flagged"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="badge-lease-needs-review-l-clean"]',
      ),
    ).toBeNull();
  });

  it("shows the importer's 'Needs review:' reason in the badge tooltip", async () => {
    await render(
      <LeasesTable
        leases={[flaggedLease]}
        properties={[flaggedProperty]}
        onDelete={() => {}}
      />,
    );
    const badge = container.querySelector(
      '[data-testid="badge-lease-needs-review-l-flagged"]',
    );
    expect(badge).not.toBeNull();
    // Title comes from the "Needs review: …" sentence the importer writes
    // into the lease's notes — keeping the tooltip in lockstep with the
    // server-side reason text rather than a UI-side guess.
    expect(badge!.getAttribute("title")).toContain(
      'weekly cost not numeric: "$69.23???"',
    );
  });

  it("renders a per-row Fix link pointing at /leases/<id>?focus=rent for flagged leases", async () => {
    await render(
      <LeasesTable
        leases={[flaggedLease, cleanLease]}
        properties={[flaggedProperty]}
        onDelete={() => {}}
        originPath="/leases"
      />,
    );
    const fixBtn = container.querySelector(
      '[data-testid="button-fix-lease-l-flagged"]',
    );
    expect(fixBtn).not.toBeNull();
    // Clean lease has no Fix shortcut — flag is the only signal that the
    // operator needs to drop into the quick-fix form.
    expect(
      container.querySelector('[data-testid="button-fix-lease-l-clean"]'),
    ).toBeNull();
    const anchor = fixBtn!.closest("a");
    expect(anchor).not.toBeNull();
    const href = anchor!.getAttribute("href") ?? "";
    expect(href).toContain("/leases/l-flagged");
    expect(href).toContain("focus=rent");
    // originPath threads through so the lease-detail Back link returns to
    // wherever the operator launched the Fix from.
    expect(href).toContain("from=%2Fleases");
  });
});
