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

const baseMockData = () => ({
  properties: [
    { id: "p1", customerId: "c1", name: "Maple, Apt 1" },
    { id: "p2", customerId: "c1", name: "Oak" },
    { id: "p3", customerId: "c2", name: "Pine" },
  ],
  beds: [],
  leases: [],
  utilities: [
    { id: "u1", propertyId: "p1", type: "Electric", company: "Austin Energy", accountNumber: "AE-1100", monthlyCost: 1200, notes: "Avg, last 6mo" },
    { id: "u2", propertyId: "p2", type: "Water",    company: "City Water",    accountNumber: "CW-22",   monthlyCost: 95,   notes: "" },
    { id: "u3", propertyId: "p3", type: "Internet", company: "Spectrum",      accountNumber: "SP-310",  monthlyCost: 2500, notes: "1Gbps" },
  ],
  occupants: [],
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

import Utilities from "./utilities";
import { CustomerScopeProvider } from "@/context/customer-scope";

const CUSTOMER_FILTER = "select-utilities-customer-filter";
const DOWNLOAD_BTN = "button-download-utilities-csv";

function UtilitiesUnderTest() {
  return (
    <CustomerScopeProvider>
      <Utilities />
    </CustomerScopeProvider>
  );
}

describe("Utilities CSV download", () => {
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
    window.history.replaceState({}, "", "/utilities");
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
      root.render(<UtilitiesUnderTest />);
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

  it("exports headers and numeric monthlyCost (no $ or comma formatting)", async () => {
    await renderPage();
    await clickDownload();

    expect(anchorClicks).toHaveLength(1);
    expect(anchorClicks[0].download).toMatch(/^housingops-utilities-.*\.csv$/);
    expect(anchorClicks[0].href).toBe("blob:mock-url");

    const lines = readCsvLines();
    expect(lines[0]).toBe(
      "Property,Customer,Type,Company,Account #,Monthly Cost,Notes",
    );

    // 1 header + 3 utility rows
    expect(lines).toHaveLength(4);

    // p1 "Maple, Apt 1" and notes "Avg, last 6mo" both contain commas and
    // must be wrapped in quotes so they stay one cell each.
    expect(lines[1]).toBe(
      '"Maple, Apt 1",Acme Co,Electric,Austin Energy,AE-1100,1200,"Avg, last 6mo"',
    );
    expect(lines[2]).toBe("Oak,Acme Co,Water,City Water,CW-22,95,");
    expect(lines[3]).toBe("Pine,Globex,Internet,Spectrum,SP-310,2500,1Gbps");

    // Sanity: cells must NOT contain "$" formatting anywhere in the file
    // (nor a thousands separator inside the 1200 / 2500 numbers).
    expect(capturedBlobText!).not.toContain("$");
    expect(capturedBlobText!).not.toContain("1,200");
    expect(capturedBlobText!).not.toContain("2,500");
  });

  it("only exports rows for the active customer filter", async () => {
    await renderPage();
    const handler = selectHandlers.get(CUSTOMER_FILTER);
    if (!handler) throw new Error("missing customer select handler");
    await act(async () => {
      handler.onValueChange("c1");
    });

    await clickDownload();
    const lines = readCsvLines();

    // Header still includes Customer (we keep it for round-trippable exports).
    expect(lines[0]).toBe(
      "Property,Customer,Type,Company,Account #,Monthly Cost,Notes",
    );
    // 1 header + 2 c1 rows (Pine belongs to c2 and is filtered out).
    expect(lines).toHaveLength(3);
    expect(capturedBlobText!).not.toContain("Pine");
    expect(capturedBlobText!).not.toContain("Globex");
  });

  it("disables the Download button when there are no utilities at all", async () => {
    mockData.utilities = [];

    await renderPage();
    const btn = getDownloadButton();
    expect(btn.disabled).toBe(true);

    await clickDownload();
    expect(anchorClicks).toHaveLength(0);
    expect(capturedBlobText).toBeNull();
  });

  it("disables the Download button when the active filter hides every utility", async () => {
    // Remove every utility belonging to c1 so filtering by c1 produces an
    // empty visible list while raw utilities remain non-empty.
    mockData.utilities = mockData.utilities.filter(
      (u) => u.propertyId !== "p1" && u.propertyId !== "p2",
    );

    await renderPage();
    const handler = selectHandlers.get(CUSTOMER_FILTER);
    if (!handler) throw new Error("missing customer select handler");
    await act(async () => {
      handler.onValueChange("c1");
    });

    const btn = getDownloadButton();
    expect(btn.disabled).toBe(true);
    await clickDownload();
    expect(anchorClicks).toHaveLength(0);
    expect(capturedBlobText).toBeNull();
  });
});
