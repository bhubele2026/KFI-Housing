import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildXlsxBuffer, colLetter, type ExportColumn } from "./xlsx-export";

/**
 * Guards the live-formula export path used by the assistant
 * `export_reconciliation` tool (Task #689). The Totals sheet has to
 * contain real Excel formulas (cells with an `f` attribute) — not
 * pre-computed numbers — so an operator who edits a data row sees the
 * totals recalc on open.
 */
describe("buildXlsxBuffer — export_reconciliation totals formulas", () => {
  const columns: ExportColumn[] = [
    { key: "customer", header: "Customer" },
    { key: "property", header: "Property" },
    { key: "expectedRent", header: "Expected rent", format: "currency" },
    { key: "paidRent", header: "Paid rent", format: "currency" },
    { key: "variance", header: "Variance", format: "currency" },
  ];
  const rows = [
    {
      customer: "Acme",
      property: "123 Main",
      expectedRent: 1500,
      paidRent: 1500,
      variance: 0,
    },
    {
      customer: "Beta",
      property: "456 Oak",
      expectedRent: 2000,
      paidRent: 1800,
      variance: -200,
    },
  ];

  it("renders the Totals sheet with =SUM live formulas, not baked-in numbers", () => {
    const col = (k: string) => colLetter(columns.findIndex((c) => c.key === k));
    const buf = buildXlsxBuffer({
      title: "Reconciliation 2026-05",
      filterDesc: "Month=2026-05",
      columns,
      rows,
      summary: {
        name: "Totals",
        rows: [
          { label: "Properties", value: rows.length },
          {
            label: "Expected rent",
            formula: `=SUM(${col("expectedRent")}5:${col("expectedRent")}{lastRow})`,
          },
          {
            label: "Paid rent",
            formula: `=SUM(${col("paidRent")}5:${col("paidRent")}{lastRow})`,
          },
          {
            label: "Variance",
            formula: `=SUM(${col("variance")}5:${col("variance")}{lastRow})`,
          },
        ],
      },
    });

    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);

    const wb = XLSX.read(buf, { type: "buffer", cellFormula: true });
    expect(wb.SheetNames).toContain("Totals");
    const totals = wb.Sheets["Totals"]!;

    // Row 1 is "Properties" / static; rows 2–4 must have an `f` attr.
    const expectedRentCell = totals["B2"] as { f?: string; v?: unknown } | undefined;
    const paidRentCell = totals["B3"] as { f?: string; v?: unknown } | undefined;
    const varianceCell = totals["B4"] as { f?: string; v?: unknown } | undefined;
    expect(expectedRentCell?.f).toMatch(/^=SUM\([A-Z]+5:[A-Z]+6\)$/);
    expect(paidRentCell?.f).toMatch(/^=SUM\([A-Z]+5:[A-Z]+6\)$/);
    expect(varianceCell?.f).toMatch(/^=SUM\([A-Z]+5:[A-Z]+6\)$/);

    // {lastRow} must be substituted with the literal last data row.
    expect(expectedRentCell?.f).toContain(":");
    expect(expectedRentCell?.f).not.toContain("{lastRow}");
  });

  it("data cells in formula-bearing columns still parse as numbers", () => {
    const buf = buildXlsxBuffer({
      title: "t",
      filterDesc: "",
      columns: [
        { key: "x", header: "X", format: "currency" },
        {
          key: "doubled",
          header: "Doubled",
          format: "currency",
          formula: (r) => `=A${r}*2`,
        },
      ],
      rows: [{ x: 10 }, { x: 20 }],
    });
    const wb = XLSX.read(buf, { type: "buffer", cellFormula: true });
    const ws = wb.Sheets[wb.SheetNames[0]!]!;
    const b5 = ws["B5"] as { f?: string; t?: string } | undefined;
    const b6 = ws["B6"] as { f?: string; t?: string } | undefined;
    expect(b5?.f).toBe("=A5*2");
    expect(b6?.f).toBe("=A6*2");
    expect(b5?.t).toBe("n");
  });
});
