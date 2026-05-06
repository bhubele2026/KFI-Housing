import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { LeasesTable } from "./leases-table";
import type { Lease, Property, RoomNightLog } from "@/data/mockData";

// Pin down the hotel-rate "at risk" pill added in task #319: the leases
// list surfaces a "Below min" or "No log yet" badge in the Status cell
// for any hotel-rate lease (`monthlyRoomNightMin > 0`) whose latest
// month is short of — or missing — its room-night minimum. Mirrors
// the warning that already exists on the lease-detail Room-Night Log
// section so operators don't have to drill into each lease.

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
  name: "Ridge Motor Inn",
  address: "1 Ridge Rd",
  city: "Baraboo",
  state: "WI",
  zip: "53913",
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

function makeHotelLease(id: string, monthlyRoomNightMin: number): Lease {
  return {
    id,
    propertyId: "p1",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    monthlyRent: 0,
    securityDeposit: 0,
    status: "Active",
    notes: "",
    clauses: "",
    buyoutAvailable: false,
    buyoutCost: null,
    rateType: "room-night",
    nightlyRate: 80,
    guaranteedRooms: 4,
    monthlyRoomNightMin,
    longStayTaxExempt: false,
  } as unknown as Lease;
}

function makeMonthlyLease(id: string): Lease {
  return {
    id,
    propertyId: "p1",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    monthlyRent: 1500,
    securityDeposit: 0,
    status: "Active",
    notes: "",
    clauses: "",
    buyoutAvailable: false,
    buyoutCost: null,
    rateType: "monthly",
    monthlyRoomNightMin: 0,
  } as unknown as Lease;
}

function log(leaseId: string, month: string, roomNights: number): RoomNightLog {
  return { id: `rnl-${leaseId}-${month}`, leaseId, month, roomNights, notes: "" };
}

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

describe("LeasesTable — hotel-rate room-night risk pill", () => {
  it("renders 'No log yet' for hotel-rate leases with no room-night logs", async () => {
    const lease = makeHotelLease("l-missing", 30);
    await render(
      <LeasesTable
        leases={[lease]}
        properties={[property]}
        onDelete={() => {}}
        roomNightLogs={[]}
      />,
    );
    const badge = container.querySelector(
      '[data-testid="badge-lease-room-night-risk-l-missing"]',
    );
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("No log yet");
  });

  it("renders 'Below min · X/Y' when the latest log is short", async () => {
    const lease = makeHotelLease("l-short", 30);
    await render(
      <LeasesTable
        leases={[lease]}
        properties={[property]}
        onDelete={() => {}}
        roomNightLogs={[
          log("l-short", "2026-04", 25),
          log("l-short", "2026-05", 12),
        ]}
      />,
    );
    const badge = container.querySelector(
      '[data-testid="badge-lease-room-night-risk-l-short"]',
    );
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("Below min");
    expect(badge!.textContent).toContain("12/30");
  });

  it("does NOT render the pill when the latest log meets the minimum", async () => {
    const lease = makeHotelLease("l-ok", 30);
    await render(
      <LeasesTable
        leases={[lease]}
        properties={[property]}
        onDelete={() => {}}
        roomNightLogs={[log("l-ok", "2026-05", 31)]}
      />,
    );
    expect(
      container.querySelector(
        '[data-testid="badge-lease-room-night-risk-l-ok"]',
      ),
    ).toBeNull();
  });

  it("does NOT render the pill on monthly (non-hotel) leases", async () => {
    const lease = makeMonthlyLease("l-monthly");
    await render(
      <LeasesTable
        leases={[lease]}
        properties={[property]}
        onDelete={() => {}}
        roomNightLogs={[]}
      />,
    );
    expect(
      container.querySelector(
        '[data-testid="badge-lease-room-night-risk-l-monthly"]',
      ),
    ).toBeNull();
  });

  it("defaults roomNightLogs to [] so callers that omit the prop never trip the pill", async () => {
    // Per-property Leases tab and the by-customer accordion mount the
    // table without wiring logs through. Hotel-rate leases there should
    // simply not show the pill (no false 'No log yet' alarm).
    const lease = makeHotelLease("l-no-prop", 30);
    await render(
      <LeasesTable
        leases={[lease]}
        properties={[property]}
        onDelete={() => {}}
      />,
    );
    expect(
      container.querySelector(
        '[data-testid="badge-lease-room-night-risk-l-no-prop"]',
      ),
    ).toBeNull();
  });
});
