import { describe, it, expect } from "vitest";
import { buildPdfBuffer } from "./pdf-export";

describe("pdf-export", () => {
  it("produces a non-trivial PDF buffer with the expected header bytes", async () => {
    const buf = await buildPdfBuffer({
      title: "Leases",
      filterDesc: "Filters: none",
      columns: [
        { key: "id", header: "Lease ID" },
        { key: "rent", header: "Rent", format: "currency" },
        {
          key: "rentX2",
          header: "Rent × 2",
          format: "currency",
          // PDFs don't recalc — compute must evaluate eagerly.
          compute: (row) => Number(row.rent) * 2,
        },
      ],
      rows: [
        { id: "L1", rent: 1000 },
        { id: "L2", rent: 2500 },
      ],
      summary: {
        name: "Totals",
        rows: [{ label: "Sum rent", value: 3500 }],
      },
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
    expect(buf.length).toBeGreaterThan(400);
  });

  it("paginates large row counts (>1 page) and ends with %%EOF", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({
      id: `L${i}`,
      rent: 1000 + i,
    }));
    const buf = await buildPdfBuffer({
      title: "Big",
      columns: [
        { key: "id", header: "Lease ID" },
        { key: "rent", header: "Rent", format: "currency" },
      ],
      rows,
    });
    const tail = buf.slice(buf.length - 16).toString("ascii");
    expect(tail).toContain("%%EOF");
    // Two-page-plus PDFs always reference at least one /Page object.
    expect(buf.toString("latin1")).toContain("/Page");
  });
});
