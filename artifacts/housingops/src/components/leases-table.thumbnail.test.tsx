import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { LeasesTable } from "./leases-table";
import type { Lease, Property } from "@/data/mockData";

// These tests pin down the source-PDF thumbnail column added in Task #344
// to the leases-table:
//   1. Rows whose lease records a source PDF render an <img> pointing at
//      the api-server's thumbnail endpoint with the filename URL-encoded.
//   2. The thumbnail is wrapped in an anchor that opens the lease detail
//      page with `?focus=preview` (and threads the `from=` origin) so the
//      inline PDF preview is pre-expanded by the lease-detail page.
//   3. Rows with no source PDF render no thumbnail link / image at all.
//   4. The thumbnail anchor stops propagation so clicking it doesn't ALSO
//      trigger the row-as-button navigation that would clobber the
//      `focus=preview` query string.

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

const leaseWithPdf: Lease = {
  id: "l-with-pdf",
  propertyId: "p1",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  monthlyRent: 1200,
  securityDeposit: 1200,
  status: "Active",
  notes:
    "KFI Staffing LLC. Source: Yellow_House-_6454_Us-30,_Jeannette,_PA_15644_-_2026_KFI_STAFF_1778107208478.pdf",
  clauses: "",
  buyoutAvailable: false,
  buyoutCost: null,
  weeklyCost: 0,
  vendor: "",
  needsReview: false,
} as unknown as Lease;

const leaseWithoutPdf: Lease = {
  ...leaseWithPdf,
  id: "l-no-pdf",
  notes: "Plain notes, no source PDF stamped here.",
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

describe("LeasesTable — source PDF thumbnail column (Task #344)", () => {
  it("renders a thumbnail <img> pointing at the api-server thumbnail endpoint for leases with a source PDF", async () => {
    await render(
      <LeasesTable
        leases={[leaseWithPdf]}
        properties={[property]}
        onDelete={() => {}}
        originPath="/leases"
      />,
    );
    const img = container.querySelector(
      `[data-testid="img-lease-source-thumbnail-${leaseWithPdf.id}"]`,
    ) as HTMLImageElement | null;
    expect(img).not.toBeNull();
    const src = img!.getAttribute("src") ?? "";
    expect(src).toContain("/api/attached-assets/");
    // Filename punctuation must be URL-encoded so the api-server's strict
    // SAFE_FILENAME_RE accepts the param after Express decoding.
    expect(src).toContain("%2C");
    expect(src).toContain("/thumbnail");
    expect(src).toContain("w=");
    // Lazy-load + async decode keep many thumbnails cheap on long lists.
    expect(img!.getAttribute("loading")).toBe("lazy");
    expect(img!.getAttribute("decoding")).toBe("async");
  });

  it("wraps the thumbnail in a link that jumps to the lease detail with ?focus=preview and threads originPath via from=", async () => {
    await render(
      <LeasesTable
        leases={[leaseWithPdf]}
        properties={[property]}
        onDelete={() => {}}
        originPath="/properties/p1?tab=leases"
      />,
    );
    const link = container.querySelector(
      `[data-testid="link-lease-source-thumbnail-${leaseWithPdf.id}"]`,
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    const href = link!.getAttribute("href") ?? "";
    expect(href).toContain(`/leases/${leaseWithPdf.id}`);
    expect(href).toContain("focus=preview");
    // originPath must be encoded so the `?tab=leases` portion of the
    // origin doesn't bleed into the lease-detail query string.
    expect(href).toContain("from=%2Fproperties%2Fp1%3Ftab%3Dleases");
  });

  it("falls back to a PDF icon when the thumbnail image fails to load", async () => {
    await render(
      <LeasesTable
        leases={[leaseWithPdf]}
        properties={[property]}
        onDelete={() => {}}
      />,
    );
    const img = container.querySelector(
      `[data-testid="img-lease-source-thumbnail-${leaseWithPdf.id}"]`,
    ) as HTMLImageElement | null;
    expect(img).not.toBeNull();
    // Simulate a render failure on the server (or a missing PDF on disk):
    // the api-server returns a 5xx, which fires the <img> onError handler.
    await act(async () => {
      img!.dispatchEvent(new Event("error"));
    });
    expect(
      container.querySelector(
        `[data-testid="icon-lease-source-thumbnail-fallback-${leaseWithPdf.id}"]`,
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        `[data-testid="img-lease-source-thumbnail-${leaseWithPdf.id}"]`,
      ),
    ).toBeNull();
  });

  it("renders nothing in the thumbnail cell for leases with no source PDF", async () => {
    await render(
      <LeasesTable
        leases={[leaseWithoutPdf]}
        properties={[property]}
        onDelete={() => {}}
      />,
    );
    expect(
      container.querySelector(
        `[data-testid="img-lease-source-thumbnail-${leaseWithoutPdf.id}"]`,
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        `[data-testid="link-lease-source-thumbnail-${leaseWithoutPdf.id}"]`,
      ),
    ).toBeNull();
  });

  it("clicking the thumbnail link navigates to the lease detail's ?focus=preview URL exactly once (no row-handler clobber)", async () => {
    const { hook, history } = memoryLocation({ path: "/leases", record: true });
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Router hook={hook}>
          <LeasesTable
            leases={[leaseWithPdf]}
            properties={[property]}
            onDelete={() => {}}
            originPath="/leases"
          />
        </Router>,
      );
    });
    const startLen = history.length;
    const link = container.querySelector(
      `[data-testid="link-lease-source-thumbnail-${leaseWithPdf.id}"]`,
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    await act(async () => {
      link!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    // Exactly one new history entry; the row's onClick must not also push
    // a `/leases/<id>` entry that would clobber the focus=preview query.
    expect(history.length).toBe(startLen + 1);
    const last = history[history.length - 1];
    expect(last).toContain(`/leases/${leaseWithPdf.id}`);
    expect(last).toContain("focus=preview");
  });
});
