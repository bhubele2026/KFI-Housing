import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AddBuildingDialog } from "./add-building-dialog";
import type { Building, Lease } from "@/data/mockData";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? <>{children}</> : null,
    DialogTrigger: Pass,
    DialogContent: Pass,
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
  return {
    Select: ({
      children,
      value,
      onValueChange,
    }: {
      children?: ReactNode;
      value: string;
      onValueChange: (v: string) => void;
    }) => (
      <select
        data-testid="select-mock"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
      >
        {children}
      </select>
    ),
    SelectTrigger: Pass,
    SelectValue: Pass,
    SelectContent: Pass,
    SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function $<T extends HTMLElement = HTMLElement>(testId: string): T {
  const el = container.querySelector(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`Missing [data-testid="${testId}"]`);
  return el as T;
}

function maybe(testId: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${testId}"]`);
}

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const property = { id: "p1", defaultNoticePeriodDays: 30 };

function fillBuilding() {
  type($<HTMLInputElement>("input-add-building-name"), "North Wing");
  type($<HTMLInputElement>("input-add-building-address"), "123 Main St");
}

function fillLease() {
  type($<HTMLInputElement>("input-add-lease-start-building-dialog"), "2026-01-01");
  type($<HTMLInputElement>("input-add-lease-end-building-dialog"), "2026-12-31");
  type($<HTMLInputElement>("input-add-lease-rent-building-dialog"), "1500");
}

describe("AddBuildingDialog", () => {
  it("happy path: creates building then lease wired to that building", async () => {
    const addBuilding = vi.fn(
      async (b: Building): Promise<Building> => ({ ...b, id: "bldg-saved-1" }),
    );
    const addLease = vi.fn(async (_l: Lease) => {});
    const onOpenChange = vi.fn();

    await act(async () => {
      root.render(
        <AddBuildingDialog
          open
          onOpenChange={onOpenChange}
          property={property}
          defaultBuildingName="Building 2"
          addBuilding={addBuilding}
          addLease={addLease}
        />,
      );
    });

    fillBuilding();
    fillLease();

    await act(async () => {
      click($("button-save-building-and-lease"));
    });
    // Let the awaited promises resolve.
    await act(async () => {});

    expect(addBuilding).toHaveBeenCalledTimes(1);
    expect(addBuilding.mock.calls[0]![0]).toMatchObject({
      propertyId: "p1",
      name: "North Wing",
      address: "123 Main St",
    });
    expect(addLease).toHaveBeenCalledTimes(1);
    const lease = addLease.mock.calls[0]![0];
    expect(lease.propertyId).toBe("p1");
    expect(lease.buildingId).toBe("bldg-saved-1");
    expect(lease.monthlyRent).toBe(1500);
    expect(lease.noticePeriodDays).toBe(30);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("building-only path: switches modes and creates only the building", async () => {
    const addBuilding = vi.fn(
      async (b: Building): Promise<Building> => ({ ...b, id: "bldg-h-1" }),
    );
    const addLease = vi.fn();
    const onOpenChange = vi.fn();

    await act(async () => {
      root.render(
        <AddBuildingDialog
          open
          onOpenChange={onOpenChange}
          property={property}
          defaultBuildingName="Hotel Block"
          addBuilding={addBuilding}
          addLease={addLease}
        />,
      );
    });

    // First click of "Add building without a lease" hides the lease
    // section and rebrands the button to "Create building only".
    click($("button-add-building-without-lease"));
    expect(maybe("add-building-lease-section")).toBeNull();
    expect(maybe("input-add-lease-start-building-dialog")).toBeNull();

    // Building name comes from the default, no need to retype it.
    await act(async () => {
      click($("button-add-building-without-lease"));
    });
    await act(async () => {});

    expect(addBuilding).toHaveBeenCalledTimes(1);
    expect(addBuilding.mock.calls[0]![0].name).toBe("Hotel Block");
    expect(addLease).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("partial failure: keeps the building and lets the operator retry just the lease", async () => {
    const addBuilding = vi.fn(
      async (b: Building): Promise<Building> => ({ ...b, id: "bldg-keep-1" }),
    );
    let leaseAttempts = 0;
    const addLease = vi.fn(async () => {
      leaseAttempts += 1;
      if (leaseAttempts === 1) throw new Error("boom");
    });
    const onOpenChange = vi.fn();

    await act(async () => {
      root.render(
        <AddBuildingDialog
          open
          onOpenChange={onOpenChange}
          property={property}
          defaultBuildingName="Building 2"
          addBuilding={addBuilding}
          addLease={addLease}
        />,
      );
    });

    fillBuilding();
    fillLease();

    await act(async () => {
      click($("button-save-building-and-lease"));
    });
    await act(async () => {});

    // First attempt: building saved, lease failed → dialog stays open,
    // error visible, building fields locked.
    expect(addBuilding).toHaveBeenCalledTimes(1);
    expect(addLease).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect($("add-building-error").textContent).toMatch(/lease/i);
    expect($<HTMLInputElement>("input-add-building-name").disabled).toBe(true);

    // Retry — should not re-create the building.
    await act(async () => {
      click($("button-save-building-and-lease"));
    });
    await act(async () => {});

    expect(addBuilding).toHaveBeenCalledTimes(1);
    expect(addLease).toHaveBeenCalledTimes(2);
    // Both lease attempts target the same building id we got back the
    // first time around.
    expect(addLease.mock.calls[1]![0].buildingId).toBe("bldg-keep-1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
