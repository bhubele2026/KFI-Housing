import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

const selectHandlers = new Map<
  string,
  { value: string; onValueChange: (v: string) => void }
>();

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
    if (testid) selectHandlers.set(testid, { value, onValueChange });
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
    { id: "p1", customerId: "c1", name: "Maple" },
    { id: "p2", customerId: "c1", name: "Oak" },
  ],
  beds: [
    { id: "b1", propertyId: "p1", bedNumber: 1, status: "Occupied" },
    { id: "b2", propertyId: "p2", bedNumber: 2, status: "Occupied" },
    { id: "b3", propertyId: "p1", bedNumber: 3, status: "Occupied" },
  ],
  leases: [],
  utilities: [],
  occupants: [
    {
      id: "o1",
      propertyId: "p1",
      bedId: "b1",
      name: "Alice Johnson",
      email: "",
      phone: "",
      company: "",
      employeeId: "",
      moveInDate: "2024-01-15",
      moveOutDate: null,
      chargePerBed: 1500,
      billingFrequency: "Monthly",
      status: "Active",
    },
    {
      id: "o2",
      propertyId: "p2",
      bedId: "b2",
      name: "Bob Lee",
      email: "",
      phone: "",
      company: "",
      employeeId: "",
      moveInDate: "",
      moveOutDate: null,
      chargePerBed: 2000,
      billingFrequency: "Monthly",
      status: "Active",
    },
    {
      id: "o3",
      propertyId: "p1",
      bedId: "b3",
      name: "Carol Smith",
      email: "",
      phone: "",
      company: "",
      employeeId: "",
      moveInDate: null,
      moveOutDate: null,
      chargePerBed: 1800,
      billingFrequency: "Monthly",
      status: "Active",
    },
  ],
  customers: [{ id: "c1", name: "Acme Co" }],
  isLoading: false,
  deleteOccupant: () => {},
  updateOccupant: () => {},
});

type MockData = ReturnType<typeof baseMockData>;
const mockData: MockData = baseMockData();

vi.mock("@/context/data-store", () => ({
  useData: () => mockData,
}));

function resetMockData() {
  const fresh = baseMockData();
  (Object.keys(fresh) as Array<keyof MockData>).forEach((k) => {
    (mockData as Record<string, unknown>)[k as string] = (fresh as Record<string, unknown>)[k as string];
  });
}

import Occupants from "./occupants";

const FILTER_TESTID = "select-move-in-filter";

describe("Occupants Needs review filter", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    selectHandlers.clear();
    resetMockData();
    window.history.replaceState({}, "", "/occupants");
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

  async function renderAt(url: string) {
    window.history.replaceState({}, "", url);
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

  function getFilterCurrent(): string | null {
    const el = container.querySelector(`[data-testid="${FILTER_TESTID}"]`);
    return el ? el.getAttribute("data-current") : null;
  }

  function getHandler() {
    const h = selectHandlers.get(FILTER_TESTID);
    if (!h) throw new Error(`No handler captured for ${FILTER_TESTID}`);
    return h;
  }

  it("shows every occupant when there is no needsReview param", async () => {
    await renderAt("/occupants");

    expect(getFilterCurrent()).toBe("All");
    const names = getRowNames();
    expect(names).toEqual(["Alice Johnson", "Bob Lee", "Carol Smith"]);
  });

  it("filters down to occupants missing a move-in date when ?needsReview=1 is set", async () => {
    await renderAt("/occupants?needsReview=1");

    expect(getFilterCurrent()).toBe("NeedsReview");
    // Bob has "" moveInDate, Carol has null — both should appear; Alice
    // (has a date) should be filtered out.
    const names = getRowNames();
    expect(names).toEqual(["Bob Lee", "Carol Smith"]);
  });

  it("toggling the Move-in filter to Needs review writes ?needsReview=1 to the URL", async () => {
    await renderAt("/occupants");

    expect(window.location.search).toBe("");

    await act(async () => {
      getHandler().onValueChange("NeedsReview");
    });

    expect(window.location.pathname).toBe("/occupants");
    expect(new URLSearchParams(window.location.search).get("needsReview")).toBe("1");
    // Table is now filtered.
    expect(getRowNames()).toEqual(["Bob Lee", "Carol Smith"]);
  });

  it("toggling back to All removes ?needsReview from the URL", async () => {
    await renderAt("/occupants?needsReview=1");

    expect(getFilterCurrent()).toBe("NeedsReview");

    await act(async () => {
      getHandler().onValueChange("All");
    });

    expect(window.location.pathname).toBe("/occupants");
    expect(window.location.search).toBe("");
    expect(getRowNames()).toEqual(["Alice Johnson", "Bob Lee", "Carol Smith"]);
  });
});
