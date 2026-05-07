import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

const selectHandlers = new Map<
  string,
  { value: string; onValueChange: (v: string) => void }
>();

const selectItems = new Map<string, string[]>();

vi.mock("@/components/ui/select", () => {
  function findTestId(node: unknown): string | null {
    if (node == null || typeof node === "string" || typeof node === "number") return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const id = findTestId(child);
        if (id) return id;
      }
      return null;
    }
    if (typeof node === "object" && "props" in (node as Record<string, unknown>)) {
      const props = (node as { props: Record<string, unknown> }).props;
      if (typeof props["data-testid"] === "string") return props["data-testid"] as string;
      if ("children" in props) return findTestId(props.children);
    }
    return null;
  }

  function collectValues(node: unknown, out: string[]): void {
    if (node == null || typeof node === "string" || typeof node === "number") return;
    if (Array.isArray(node)) {
      for (const child of node) collectValues(child, out);
      return;
    }
    if (typeof node === "object" && "props" in (node as Record<string, unknown>)) {
      const props = (node as { props: Record<string, unknown> }).props;
      if (typeof props["data-value"] === "string") out.push(props["data-value"] as string);
      if (typeof props["value"] === "string" && (node as { type?: unknown }).type !== undefined) {
        const t = (node as { type: unknown }).type;
        if (typeof t === "function" && (t as { name?: string }).name === "Item") {
          out.push(props["value"] as string);
        }
      }
      if ("children" in props) collectValues(props.children, out);
    }
  }

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
    if (testid) {
      selectHandlers.set(testid, { value, onValueChange });
      const values: string[] = [];
      collectValues(children, values);
      selectItems.set(testid, values);
    }
    return <div data-testid={testid ?? undefined} data-current={value} />;
  }

  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const Item = ({ value, children }: { value: string; children?: ReactNode }) => (
    <div data-value={value}>{children}</div>
  );

  return {
    Select,
    SelectContent: Passthrough,
    SelectGroup: Passthrough,
    SelectItem: Item,
    SelectLabel: Passthrough,
    SelectScrollDownButton: Passthrough,
    SelectScrollUpButton: Passthrough,
    SelectSeparator: Passthrough,
    SelectTrigger: Passthrough,
    SelectValue: Passthrough,
  };
});

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const baseMockData = () => ({
  properties: [
    { id: "p1", customerId: "c1", name: "Ridge", sharedWithCustomerIds: [] },
  ],
  beds: [
    { id: "b1", propertyId: "p1", bedNumber: 1, status: "Occupied" },
    { id: "b2", propertyId: "p1", bedNumber: 2, status: "Occupied" },
  ],
  leases: [],
  utilities: [],
  occupants: [
    {
      id: "o1",
      propertyId: "p1",
      bedId: "b1",
      name: "Alice",
      email: "",
      phone: "",
      company: "",
      employeeId: "",
      moveInDate: "2024-01-15",
      moveOutDate: null,
      chargePerBed: 1500,
      billingFrequency: "Monthly",
      status: "Active",
      shift: "Days",
    },
    {
      id: "o2",
      propertyId: "p1",
      bedId: "b2",
      name: "Bob",
      email: "",
      phone: "",
      company: "",
      employeeId: "",
      moveInDate: "2024-01-15",
      moveOutDate: null,
      chargePerBed: 1500,
      billingFrequency: "Monthly",
      status: "Active",
      shift: "Penda",
    },
  ],
  customers: [
    { id: "c1", name: "Ridge Motor Inn", customShifts: ["Penda", "TriEnda"] },
  ],
  isLoading: false,
  deleteOccupant: () => {},
  updateOccupant: () => {},
});

type MockData = ReturnType<typeof baseMockData>;
const mockData: MockData = baseMockData();

vi.mock("@/context/data-store", () => ({
  useData: () => mockData,
}));

vi.mock("@/context/customer-scope", () => ({
  ALL_CUSTOMERS: "__all__",
  useCustomerScope: () => ({ customerId: "__all__" }),
}));

import Occupants from "./occupants";

const FILTER_TESTID = "select-shift-filter";

describe("Occupants shift filter — Task #506 (per-customer customShifts)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    selectHandlers.clear();
    selectItems.clear();
    const fresh = baseMockData();
    (Object.keys(fresh) as Array<keyof MockData>).forEach((k) => {
      (mockData as Record<string, unknown>)[k as string] = (fresh as Record<string, unknown>)[k as string];
    });
    window.history.replaceState({}, "", "/occupants");
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      const r = root;
      await act(async () => { r.unmount(); });
      root = null;
    }
    container.remove();
  });

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(<Occupants />);
    });
  }

  function getRowNames(): string[] {
    return Array.from(container.querySelectorAll("tbody tr td:first-child")).map(
      (c) => (c.textContent ?? "").trim(),
    );
  }

  it("includes per-customer customShifts in the filter dropdown even at zero count", async () => {
    await render();
    const items = selectItems.get(FILTER_TESTID) ?? [];
    // Standard shifts are always present.
    expect(items).toEqual(expect.arrayContaining(["All", "Days", "Nights", "Overnights", "Unassigned"]));
    // Penda has 1 occupant; TriEnda has 0 — both must still be in the
    // dropdown because they are seeded on the customer.
    expect(items).toContain("Penda");
    expect(items).toContain("TriEnda");
  });

  it("filters occupants by a customer custom shift", async () => {
    await render();
    await act(async () => {
      selectHandlers.get(FILTER_TESTID)!.onValueChange("Penda");
    });
    expect(getRowNames()).toEqual(["Bob"]);
  });
});
