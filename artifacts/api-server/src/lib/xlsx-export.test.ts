import { describe, it, expect } from "vitest";
import { buildXlsxBuffer, colLetter, formatCellForPdf } from "./xlsx-export";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require("xlsx") as typeof import("xlsx");

describe("xlsx-export", () => {
  describe("colLetter", () => {
    it("maps 0-based indices to Excel column letters (A..Z, then AA..)", () => {
      expect(colLetter(0)).toBe("A");
      expect(colLetter(1)).toBe("B");
      expect(colLetter(25)).toBe("Z");
      expect(colLetter(26)).toBe("AA");
      expect(colLetter(27)).toBe("AB");
    });
  });

  describe("formatCellForPdf", () => {
    it("formats currency with sign, $, and two decimals; renders blank for non-finite", () => {
      expect(formatCellForPdf(1234.5, "currency")).toBe("$1,234.50");
      expect(formatCellForPdf(-99, "currency")).toBe("-$99.00");
      expect(formatCellForPdf("not a number", "currency")).toBe("");
    });
    it("renders percent and int per their number formats", () => {
      expect(formatCellForPdf(0.125, "percent")).toBe("12.5%");
      expect(formatCellForPdf(12000, "int")).toBe("12,000");
    });
    it("returns empty for null/undefined/blank regardless of format", () => {
      expect(formatCellForPdf(null, "currency")).toBe("");
      expect(formatCellForPdf(undefined, "date")).toBe("");
      expect(formatCellForPdf("", "text")).toBe("");
    });
  });

  describe("buildXlsxBuffer", () => {
    it("produces a parseable .xlsx with title, headers, data, formulas, and a Totals sheet", () => {
      const buf = buildXlsxBuffer({
        title: "Leases",
        filterDesc: "Filters: customer=custA",
        columns: [
          { key: "id", header: "Lease ID" },
          { key: "rent", header: "Rent", format: "currency" },
          {
            key: "rentX2",
            header: "Rent × 2",
            format: "currency",
            // Reference column B on the same data row — Excel must
            // re-evaluate this when the operator edits the rent cell.
            formula: (r) => `B${r}*2`,
          },
        ],
        rows: [
          { id: "L1", rent: 1000 },
          { id: "L2", rent: 2500 },
        ],
        summary: {
          name: "Totals",
          rows: [
            { label: "Count", formula: `COUNTA(Data!A5:A{lastRow})` },
            { label: "Sum rent", formula: `SUM(Data!B5:B{lastRow})` },
          ],
        },
      });
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(500);

      const wb = XLSX.read(buf, { type: "buffer", cellFormula: true });
      expect(wb.SheetNames).toEqual(["Data", "Totals"]);

      const data = wb.Sheets["Data"];
      expect((data["A1"] as any).v).toBe("Leases");
      expect((data["A2"] as any).v).toContain("custA");
      expect((data["A4"] as any).v).toBe("Lease ID");
      expect((data["A5"] as any).v).toBe("L1");
      expect((data["B5"] as any).v).toBe(1000);
      // The formula cell must store an `=...` expression (LIVE), not a value.
      expect((data["C5"] as any).f).toBe("B5*2");
      expect((data["C6"] as any).f).toBe("B6*2");

      const totals = wb.Sheets["Totals"];
      // {lastRow} placeholder must be substituted with the real last data row (6).
      expect((totals["B1"] as any).f).toBe("COUNTA(Data!A5:A6)");
      expect((totals["B2"] as any).f).toBe("SUM(Data!B5:B6)");
    });

    it("still emits a valid sheet (no formula cells) when rows is empty", () => {
      const buf = buildXlsxBuffer({
        title: "Empty",
        columns: [{ key: "id", header: "ID" }],
        rows: [],
      });
      const wb = XLSX.read(buf, { type: "buffer" });
      expect(wb.SheetNames).toContain("Data");
      expect((wb.Sheets["Data"]["A4"] as any).v).toBe("ID");
    });
  });
});
