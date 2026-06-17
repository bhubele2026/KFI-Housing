import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { LeasesTable } from "./leases-table";
import type { Lease, Property } from "@/data/mockData";

// Pins down the blank-date triage surfaces added in task #363:
//   1. Leases missing a start or end date render an amber "Needs dates"
//      badge in the Status cell.
//   2. A per-row "Fix dates" quick-action links to the lease detail
//      page with `?focus=dates` (and threads the origin path through)
//      so the Start Date inline editor opens pre-focused.

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

const blankDateLease: Lease = {
  id: "l-blank",
  propertyId: "p1",
  // Start blank but END present — the only case that now triggers the
  // "Needs dates" badge. (A lease with no end date is month-to-month,
  // not a date gap, so it is no longer flagged.)
  startDate: "",
  endDate: "2025-12-31",
  monthlyRent: 0,
  securityDeposit: 0,
  status: "Upcoming",
  notes: "",
  clauses: "",
  buyoutAvailable: false,
  buyoutCost: null,
  weeklyCost: 0,
  vendor: "",
  needsReview: false,
};

const datedLease: Lease = {
  ...blankDateLease,
  id: "l-dated",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  status: "Active",
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

describe("LeasesTable — needs-dates surfaces (task #363)", () => {
  it("renders an amber 'Needs dates' badge only on rows missing a start or end date, and the badge itself links to the edit flow", async () => {
    await render(
      <LeasesTable
        leases={[blankDateLease, datedLease]}
        properties={[property]}
        onDelete={() => {}}
        originPath="/leases"
      />,
    );
    const badge = container.querySelector(
      '[data-testid="badge-lease-needs-dates-l-blank"]',
    );
    expect(badge).not.toBeNull();
    // Badge is itself a link so a single click takes the operator into
    // the lease-detail edit flow with the Start Date editor pre-focused
    // — satisfies the task requirement that "clicking the badge takes
    // the operator into an edit flow".
    const href = badge!.getAttribute("href") ?? "";
    expect(href).toContain("/leases/l-blank");
    expect(href).toContain("focus=dates");
    expect(href).toContain("from=%2Fleases");
    expect(
      container.querySelector('[data-testid="badge-lease-needs-dates-l-dated"]'),
    ).toBeNull();
  });

  it("renders a per-row Fix-dates link pointing at /leases/<id>?focus=dates with the origin threaded through", async () => {
    await render(
      <LeasesTable
        leases={[blankDateLease, datedLease]}
        properties={[property]}
        onDelete={() => {}}
        originPath="/leases"
      />,
    );
    const fixBtn = container.querySelector(
      '[data-testid="button-fix-lease-dates-l-blank"]',
    );
    expect(fixBtn).not.toBeNull();
    // Dated rows have nothing to triage — the action stays hidden.
    expect(
      container.querySelector('[data-testid="button-fix-lease-dates-l-dated"]'),
    ).toBeNull();
    const anchor = fixBtn!.closest("a");
    expect(anchor).not.toBeNull();
    const href = anchor!.getAttribute("href") ?? "";
    expect(href).toContain("/leases/l-blank");
    expect(href).toContain("focus=dates");
    expect(href).toContain("from=%2Fleases");
  });

  it("does NOT flag a month-to-month (no end date) lease as needs-dates", async () => {
    const monthToMonth: Lease = {
      ...blankDateLease,
      id: "l-half",
      startDate: "2025-01-01",
      endDate: "",
    };
    await render(
      <LeasesTable
        leases={[monthToMonth]}
        properties={[property]}
        onDelete={() => {}}
        originPath="/leases"
      />,
    );
    // No end date = month-to-month (intentional), so the amber
    // "Needs dates" badge must NOT appear — only a genuinely incomplete
    // fixed-term lease (start blank + end present) is flagged.
    expect(
      container.querySelector('[data-testid="badge-lease-needs-dates-l-half"]'),
    ).toBeNull();
  });
});
