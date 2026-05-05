import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, isValidElement, type ReactNode } from "react";
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

vi.mock("framer-motion", () => {
  function Motion({
    children,
    initial: _i, animate: _a, exit: _e, transition: _t, variants: _v,
    whileHover: _wh, whileTap: _wt, whileFocus: _wf, whileDrag: _wd, whileInView: _wiv,
    layout: _l, layoutId: _li,
    ...rest
  }: Record<string, unknown> & { children?: ReactNode }) {
    return <div {...rest}>{children}</div>;
  }
  const motion = new Proxy({}, { get: () => Motion });
  return { motion };
});

vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Stub, Bar: Stub, XAxis: Stub, YAxis: Stub,
    CartesianGrid: Stub, Tooltip: Stub, Legend: Stub, ResponsiveContainer: Stub,
  };
});

const baseMockData = () => ({
  properties: [
    { id: "p1", customerId: "c1", name: "Maple, Apt 1", totalBeds: 2 },
    { id: "p2", customerId: "c1", name: "Oak", totalBeds: 1 },
    { id: "p3", customerId: "c2", name: "Pine", totalBeds: 2 },
  ],
  beds: [
    { id: "b1", propertyId: "p1", status: "Occupied" },
    { id: "b2", propertyId: "p1", status: "Vacant" },
    { id: "b3", propertyId: "p2", status: "Occupied" },
    { id: "b4", propertyId: "p3", status: "Occupied" },
    { id: "b5", propertyId: "p3", status: "Vacant" },
  ],
  leases: [
    { id: "l1", propertyId: "p1", monthlyRent: 300, status: "Active" },
    { id: "l2", propertyId: "p2", monthlyRent: 200, status: "Active" },
    { id: "l3", propertyId: "p3", monthlyRent: 500, status: "Active" },
  ],
  utilities: [
    { id: "u1", propertyId: "p1", monthlyCost: 100 },
    { id: "u2", propertyId: "p2", monthlyCost: 50 },
    { id: "u3", propertyId: "p3", monthlyCost: 200 },
  ],
  occupants: [
    { id: "o1", propertyId: "p1", status: "Active", chargePerBed: 600, billingFrequency: "Monthly" },
    { id: "o2", propertyId: "p2", status: "Active", chargePerBed: 500, billingFrequency: "Monthly" },
    { id: "o3", propertyId: "p3", status: "Active", chargePerBed: 700, billingFrequency: "Monthly" },
    { id: "o4", propertyId: "p1", status: "Former", chargePerBed: 999, billingFrequency: "Monthly" },
  ],
  customers: [
    { id: "c1", name: "Acme Co" },
    { id: "c2", name: "Globex" },
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

import Finance from "./finance";
import { CustomerScopeProvider } from "@/context/customer-scope";

const CUSTOMER_FILTER = "select-finance-customer-filter";
const DOWNLOAD_BTN = "button-download-finance-csv";

function FinanceUnderTest() {
  return (
    <CustomerScopeProvider>
      <Finance />
    </CustomerScopeProvider>
  );
}

describe("Finance CSV download", () => {
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
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/finance");
    container = document.createElement("div");
    document.body.appendChild(container);

    capturedBlobText = null;
    anchorClicks = [];

    // jsdom's Blob.text() / Response(blob).text() don't read the body, so we
    // wrap the global Blob constructor and capture the text parts directly.
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
      root.render(<FinanceUnderTest />);
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

  it("exports headers and numeric values for every visible property (no $ or comma formatting)", async () => {
    await renderPage();
    await clickDownload();

    expect(anchorClicks).toHaveLength(1);
    expect(anchorClicks[0].download).toMatch(/^housingops-finance-.*\.csv$/);
    expect(anchorClicks[0].href).toBe("blob:mock-url");

    const lines = readCsvLines();
    expect(lines[0]).toBe(
      "Property,Customer,Occupied Beds,Total Beds,Revenue,Lease Cost,Utility Cost,Total Cost,Net Profit",
    );

    // 1 header + 3 property rows + 1 totals row
    expect(lines).toHaveLength(5);

    // p1 "Maple, Apt 1" has a comma so the cell must be quoted as one field.
    expect(lines[1]).toBe('"Maple, Apt 1",Acme Co,1,2,600,300,100,400,200');
    expect(lines[2]).toBe("Oak,Acme Co,1,1,500,200,50,250,250");
    expect(lines[3]).toBe("Pine,Globex,1,2,700,500,200,700,0");

    // Totals row: revenue 600+500+700=1800, lease 300+200+500=1000,
    // util 100+50+200=350, total cost 1350, profit 450. The Customer and
    // bed-count columns are intentionally blank.
    expect(lines[4]).toBe("Portfolio Total,,,,1800,1000,350,1350,450");

    // Sanity: cells must NOT contain "$" formatting anywhere in the file.
    expect(capturedBlobText!).not.toContain("$");
  });

  it("hides the Customer column when a customer filter is active", async () => {
    await renderPage();
    const handler = selectHandlers.get(CUSTOMER_FILTER);
    if (!handler) throw new Error("missing select handler");
    await act(async () => {
      handler.onValueChange("c1");
    });

    await clickDownload();
    const lines = readCsvLines();

    expect(lines[0]).toBe(
      "Property,Occupied Beds,Total Beds,Revenue,Lease Cost,Utility Cost,Total Cost,Net Profit",
    );
    expect(lines[0]).not.toContain("Customer");

    // Only c1's two properties should appear, plus the customer-scoped totals row.
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe('"Maple, Apt 1",1,2,600,300,100,400,200');
    expect(lines[2]).toBe("Oak,1,1,500,200,50,250,250");
    // Totals row labelled with the active customer name; bed-count cols are blank.
    // Revenue 600+500=1100, lease 300+200=500, util 100+50=150, total 650, profit 450.
    expect(lines[3]).toBe("Acme Co Total,,,1100,500,150,650,450");
  });

  it("disables the Download button when there are no visible properties", async () => {
    mockData.properties = [];
    mockData.beds = [];
    mockData.leases = [];
    mockData.utilities = [];
    mockData.occupants = [];

    await renderPage();
    const btn = getDownloadButton();
    expect(btn.disabled).toBe(true);

    await clickDownload();
    // No download should have been triggered.
    expect(anchorClicks).toHaveLength(0);
    expect(capturedBlobText).toBeNull();
  });

  it("disables the Download button when the active filter hides every property", async () => {
    // Remove c2's only property so filtering by c2 yields zero visible rows
    // while the underlying property list is still non-empty.
    mockData.properties = mockData.properties.filter((p) => p.customerId !== "c2");

    await renderPage();
    const handler = selectHandlers.get(CUSTOMER_FILTER);
    if (!handler) throw new Error("missing select handler");
    await act(async () => {
      handler.onValueChange("c2");
    });

    const btn = getDownloadButton();
    expect(btn.disabled).toBe(true);
    await clickDownload();
    expect(anchorClicks).toHaveLength(0);
    expect(capturedBlobText).toBeNull();
  });
});
