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
    { id: "p1", customerId: "c1", name: "Maple, Apt 1" },
    { id: "p2", customerId: "c1", name: "Oak" },
  ],
  beds: [
    { id: "b1", propertyId: "p1", bedNumber: 1, status: "Occupied" },
    { id: "b2", propertyId: "p2", bedNumber: 2, status: "Occupied" },
  ],
  leases: [],
  utilities: [],
  occupants: [
    {
      id: "o1",
      propertyId: "p1",
      bedId: "b1",
      name: "Alice Johnson",
      email: "alice@example.com",
      phone: "555-1234",
      company: "Acme",
      employeeId: "E-100",
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
      email: "bob@example.com",
      phone: "555-9999",
      company: "Globex",
      employeeId: "E-200",
      moveInDate: "2024-03-01",
      moveOutDate: "2024-09-30",
      chargePerBed: 2400,
      billingFrequency: "Monthly",
      status: "Former",
    },
  ],
  customers: [
    { id: "c1", name: "Acme Co" },
  ],
  isLoading: false,
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

const DOWNLOAD_BTN = "button-download-occupants-csv";

describe("Occupants CSV download", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let capturedBlobText: string | null = null;
  let createObjectURLSpy: ReturnType<typeof vi.spyOn> | null = null;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn> | null = null;
  let anchorClicks: Array<{ download: string; href: string }> = [];
  let originalCreateElement: typeof document.createElement;
  let originalBlob: typeof Blob;

  beforeEach(() => {
    selectHandlers.clear();
    resetMockData();
    container = document.createElement("div");
    document.body.appendChild(container);

    capturedBlobText = null;
    anchorClicks = [];

    originalBlob = globalThis.Blob;
    class CapturingBlob extends originalBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        if (parts) {
          capturedBlobText = parts
            .map((p) => (typeof p === "string" ? p : ""))
            .join("");
        }
      }
    }
    (globalThis as unknown as { Blob: typeof Blob }).Blob = CapturingBlob;

    createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      const el = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === "a") {
        const anchor = el as HTMLAnchorElement;
        anchor.click = () => {
          anchorClicks.push({ download: anchor.download, href: anchor.href });
        };
      }
      return el;
    });
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
    createObjectURLSpy?.mockRestore();
    revokeObjectURLSpy?.mockRestore();
    if (originalBlob) {
      (globalThis as unknown as { Blob: typeof Blob }).Blob = originalBlob;
    }
    vi.restoreAllMocks();
  });

  async function renderPage() {
    await act(async () => {
      root = createRoot(container);
      root.render(<Occupants />);
    });
  }

  function getDownloadButton(): HTMLButtonElement {
    const el = container.querySelector(`[data-testid="${DOWNLOAD_BTN}"]`);
    if (!el) throw new Error(`Could not find ${DOWNLOAD_BTN}`);
    return el as HTMLButtonElement;
  }

  async function clickDownload() {
    const btn = getDownloadButton();
    await act(async () => {
      btn.click();
    });
  }

  function readCsvLines(): string[] {
    if (capturedBlobText == null) throw new Error("Download did not produce a Blob");
    return capturedBlobText.replace(/^\uFEFF/, "").split("\r\n");
  }

  it("exports headers and numeric chargePerBed (no $ or comma formatting)", async () => {
    await renderPage();
    await clickDownload();

    expect(anchorClicks).toHaveLength(1);
    expect(anchorClicks[0].download).toMatch(/^housingops-occupants-.*\.csv$/);
    expect(anchorClicks[0].href).toBe("blob:mock-url");

    const lines = readCsvLines();
    expect(lines[0]).toBe(
      "Name,Email,Phone,Company,Employee ID,Property,Bed,Move In,Move Out,Charge per Bed,Billing Frequency,Shift,Status",
    );

    // 1 header + 2 occupant rows
    expect(lines).toHaveLength(3);

    // p1's name "Maple, Apt 1" has a comma so the cell must be quoted as one field.
    expect(lines[1]).toBe(
      'Alice Johnson,alice@example.com,555-1234,Acme,E-100,"Maple, Apt 1",Bed 1,2024-01-15,,1500,Monthly,,Active',
    );
    expect(lines[2]).toBe(
      "Bob Lee,bob@example.com,555-9999,Globex,E-200,Oak,Bed 2,2024-03-01,2024-09-30,2400,Monthly,,Former",
    );

    // Sanity: cells must NOT contain "$" formatting anywhere in the file.
    expect(capturedBlobText!).not.toContain("$");
  });

  it("only exports the rows visible after filtering", async () => {
    await renderPage();

    // Narrow to "Alice" via the free-text search input.
    const searchInput = container.querySelector('input[placeholder="Search occupants..."]') as
      | HTMLInputElement
      | null;
    if (!searchInput) throw new Error("could not find search input");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(searchInput, "Alice");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await clickDownload();
    const lines = readCsvLines();
    // 1 header + 1 matching occupant
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Alice Johnson");
    expect(capturedBlobText!).not.toContain("Bob Lee");
  });

  it("disables the Download button when there are no visible occupants", async () => {
    mockData.occupants = [];

    await renderPage();
    const btn = getDownloadButton();
    expect(btn.disabled).toBe(true);

    await clickDownload();
    expect(anchorClicks).toHaveLength(0);
    expect(capturedBlobText).toBeNull();
  });

  it("filters by shift and exports the shift value in the CSV", async () => {
    mockData.occupants = [
      { ...mockData.occupants[0], shift: "Days" },
      { ...mockData.occupants[1], shift: "Nights", status: "Active" },
      {
        id: "o3",
        propertyId: "p1",
        bedId: null,
        name: "Carol Day",
        email: "carol@example.com",
        phone: "555-0000",
        company: "Acme",
        employeeId: "E-300",
        moveInDate: "2024-05-01",
        moveOutDate: null,
        chargePerBed: 1500,
        billingFrequency: "Monthly",
        status: "Active",
        shift: null,
      },
    ] as MockData["occupants"];

    await renderPage();

    // Narrow to only "Days" shift via the shift filter.
    const shiftHandler = selectHandlers.get("select-shift-filter");
    if (!shiftHandler) throw new Error("shift filter not registered");
    await act(async () => {
      shiftHandler.onValueChange("Days");
    });

    await clickDownload();
    const lines = readCsvLines();
    // 1 header + 1 matching occupant (Alice on Days shift).
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(",Shift,");
    expect(lines[1]).toContain("Alice Johnson");
    expect(lines[1]).toMatch(/,Days,Active$/);
    expect(capturedBlobText!).not.toContain("Bob Lee");
    expect(capturedBlobText!).not.toContain("Carol Day");
  });

  it("filters by Unassigned shift", async () => {
    mockData.occupants = [
      { ...mockData.occupants[0], shift: "Days" },
      { ...mockData.occupants[1], shift: null, status: "Active" },
    ] as MockData["occupants"];

    await renderPage();

    const shiftHandler = selectHandlers.get("select-shift-filter");
    if (!shiftHandler) throw new Error("shift filter not registered");
    await act(async () => {
      shiftHandler.onValueChange("Unassigned");
    });

    await clickDownload();
    const lines = readCsvLines();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Bob Lee");
    expect(capturedBlobText!).not.toContain("Alice Johnson");
  });

  it("disables the Download button when active filters hide every occupant", async () => {
    await renderPage();

    // Type a search string that matches nothing.
    const searchInput = container.querySelector('input[placeholder="Search occupants..."]') as
      | HTMLInputElement
      | null;
    if (!searchInput) throw new Error("could not find search input");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(searchInput, "zzz-no-such-occupant");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const btn = getDownloadButton();
    expect(btn.disabled).toBe(true);
    await clickDownload();
    expect(anchorClicks).toHaveLength(0);
    expect(capturedBlobText).toBeNull();
  });
});
