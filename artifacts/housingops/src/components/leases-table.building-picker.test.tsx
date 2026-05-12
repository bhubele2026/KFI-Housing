import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { LeasesTable } from "./leases-table";
import type { Lease, Property, Building } from "@/data/mockData";

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
  rentFrequency: "Monthly",
} as unknown as Property;

const buildings: Building[] = [
  { id: "b1", propertyId: "p1", name: "Building A" } as Building,
  { id: "b2", propertyId: "p1", name: "Building B" } as Building,
];

const unassignedLease: Lease = {
  id: "l-1",
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
  buildingId: null,
} as unknown as Lease;

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

describe("LeasesTable — inline building picker (Task #591)", () => {
  it("renders the building label as a clickable button when onUpdateLease is wired", async () => {
    await render(
      <LeasesTable
        leases={[unassignedLease]}
        properties={[property]}
        buildings={buildings}
        onDelete={() => {}}
        onUpdateLease={() => {}}
      />,
    );
    const trigger = container.querySelector(
      '[data-testid="lease-building-label-l-1"]',
    ) as HTMLElement | null;
    expect(trigger).not.toBeNull();
    expect(trigger!.tagName).toBe("BUTTON");
    expect(trigger!.textContent).toContain("Building unassigned");
  });

  it("falls back to a read-only span when onUpdateLease is omitted", async () => {
    await render(
      <LeasesTable
        leases={[unassignedLease]}
        properties={[property]}
        buildings={buildings}
        onDelete={() => {}}
      />,
    );
    const label = container.querySelector(
      '[data-testid="lease-building-label-l-1"]',
    ) as HTMLElement | null;
    expect(label).not.toBeNull();
    expect(label!.tagName).toBe("SPAN");
  });

  it("clicking the badge opens a picker and selecting a building calls onUpdateLease with that id", async () => {
    const onUpdateLease = vi.fn();
    await render(
      <LeasesTable
        leases={[unassignedLease]}
        properties={[property]}
        buildings={buildings}
        onDelete={() => {}}
        onUpdateLease={onUpdateLease}
      />,
    );
    const trigger = container.querySelector(
      '[data-testid="lease-building-label-l-1"]',
    ) as HTMLElement | null;
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger!.click();
    });

    // Popover content is portalled into document.body
    const option = document.body.querySelector(
      '[data-testid="building-picker-option-b2"]',
    ) as HTMLElement | null;
    expect(option).not.toBeNull();

    await act(async () => {
      option!.click();
    });

    expect(onUpdateLease).toHaveBeenCalledTimes(1);
    expect(onUpdateLease).toHaveBeenCalledWith("l-1", { buildingId: "b2" });
  });

  it("clicking the 'Unassigned' option clears the buildingId", async () => {
    const onUpdateLease = vi.fn();
    const assigned: Lease = { ...unassignedLease, buildingId: "b1" } as Lease;
    await render(
      <LeasesTable
        leases={[assigned]}
        properties={[property]}
        buildings={buildings}
        onDelete={() => {}}
        onUpdateLease={onUpdateLease}
      />,
    );
    const trigger = container.querySelector(
      '[data-testid="lease-building-label-l-1"]',
    ) as HTMLElement | null;
    expect(trigger!.textContent).toContain("Building A");

    await act(async () => {
      trigger!.click();
    });

    const unassign = document.body.querySelector(
      '[data-testid="building-picker-option-unassigned"]',
    ) as HTMLElement | null;
    expect(unassign).not.toBeNull();

    await act(async () => {
      unassign!.click();
    });

    expect(onUpdateLease).toHaveBeenCalledWith("l-1", { buildingId: null });
  });
});
