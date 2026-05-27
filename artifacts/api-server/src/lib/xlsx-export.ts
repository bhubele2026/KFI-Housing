// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require("xlsx") as typeof import("xlsx");

export type CellFormat =
  | "currency"
  | "date"
  | "percent"
  | "number"
  | "int"
  | "text";

/**
 * One output column. `key` reads from the row object; `format` drives
 * both the Excel `z` number-format and the PDF cell formatter.
 *
 * When `formula` is set the Excel cell stores a real `=...` formula
 * (not a pre-computed value), letting the operator edit other cells
 * and see totals/diffs recalc. `compute` is the same value evaluated
 * eagerly for PDFs (which don't recalc).
 *
 * `priority` lets PDF rendering drop low-priority columns when not
 * everything fits on the page — higher number = dropped sooner.
 */
export interface ExportColumn {
  key: string;
  header: string;
  format?: CellFormat;
  width?: number;
  priority?: number;
  /** Excel formula for this column, given the data row index (1-based, row 5 = first data row). */
  formula?: (dataRowIndex: number) => string;
  /** PDF/value-side equivalent of `formula` — evaluated against the row at export time. */
  compute?: (row: Record<string, unknown>) => unknown;
}

/**
 * Optional second "Totals" sheet appended after the data sheet. Each
 * row is `[label, formulaOrValue]`. Formulas may contain `{lastRow}`
 * which is string-replaced with the actual last data row before write
 * so callers don't have to know the row count up front.
 */
export interface SummarySheet {
  name: string;
  rows: Array<{ label: string; formula?: string; value?: string | number }>;
}

export interface BuildXlsxOpts {
  title: string;
  filterDesc?: string;
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
  summary?: SummarySheet;
  sheetName?: string;
}

const Z_BY_FORMAT: Record<CellFormat, string | undefined> = {
  currency: '"$"#,##0.00;[Red]-"$"#,##0.00',
  date: "yyyy-mm-dd",
  percent: "0.0%",
  number: "#,##0.00",
  int: "#,##0",
  text: undefined,
};

/** Excel column letter for a 0-based index. AA, AB, ... supported. */
export function colLetter(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function inferCell(
  value: unknown,
  format: CellFormat | undefined,
): { v: unknown; t: string } {
  if (value === null || value === undefined || value === "") {
    return { v: "", t: "s" };
  }
  if (format === "date") {
    return { v: String(value), t: "s" };
  }
  if (
    format === "currency" ||
    format === "number" ||
    format === "int" ||
    format === "percent"
  ) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return { v: "", t: "s" };
    return { v: n, t: "n" };
  }
  if (typeof value === "number") return { v: value, t: "n" };
  if (typeof value === "boolean") return { v: value, t: "b" };
  return { v: String(value), t: "s" };
}

/**
 * Build an `.xlsx` Buffer from a column spec + row list. Layout:
 *   row 1: title (bold, merged across all columns)
 *   row 2: filter description (italic gray)
 *   row 3: blank
 *   row 4: bold header row
 *   row 5+: data (with formulas where `column.formula` is set)
 *
 * Adds an optional second "summary" sheet whose formulas may use
 * `{lastRow}` as a placeholder for the data sheet's last data row.
 *
 * SheetJS (community build) has limited cell-style support, so we
 * prioritise FORMULAS + NUMBER FORMATS — the acceptance criterion in
 * Task #681 is that Excel cells recalc when edited, not that the
 * header is pixel-perfect.
 */
export function buildXlsxBuffer(opts: BuildXlsxOpts): Buffer {
  const { title, filterDesc, columns, rows, summary, sheetName } = opts;
  const colCount = columns.length;
  const ws: Record<string, unknown> = {};
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];

  // Row 1 — title
  ws["A1"] = { v: title, t: "s", s: { font: { bold: true, sz: 14 } } };
  if (colCount > 1) {
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } });
  }

  // Row 2 — filter description
  if (filterDesc) {
    ws["A2"] = {
      v: filterDesc,
      t: "s",
      s: { font: { italic: true, color: { rgb: "808080" } } },
    };
    if (colCount > 1) {
      merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } });
    }
  }

  // Row 4 — headers
  for (let c = 0; c < colCount; c++) {
    const addr = `${colLetter(c)}4`;
    ws[addr] = {
      v: columns[c].header,
      t: "s",
      s: { font: { bold: true }, border: { bottom: { style: "medium" } } },
    };
  }

  // Row 5+ — data
  const firstDataRow = 5;
  rows.forEach((row, rIdx) => {
    const sheetRow = firstDataRow + rIdx;
    columns.forEach((col, cIdx) => {
      const addr = `${colLetter(cIdx)}${sheetRow}`;
      if (col.formula) {
        // Excel re-evaluates the formula on open, but a number cell with
        // no cached `<v>` round-trips as a missing cell through readers
        // that don't run a recalc (SheetJS included). Seed a placeholder
        // 0 so the formula cell survives parse → re-export workflows.
        const cell: Record<string, unknown> = {
          t: "n",
          f: col.formula(sheetRow),
          v: 0,
        };
        const z = col.format ? Z_BY_FORMAT[col.format] : undefined;
        if (z) cell.z = z;
        ws[addr] = cell;
        return;
      }
      const cell = inferCell(row[col.key], col.format) as Record<string, unknown>;
      const z = col.format ? Z_BY_FORMAT[col.format] : undefined;
      if (z) cell.z = z;
      ws[addr] = cell;
    });
  });

  const lastRow = firstDataRow + Math.max(rows.length - 1, 0);
  const lastCol = colLetter(Math.max(colCount - 1, 0));
  ws["!ref"] = `A1:${lastCol}${Math.max(lastRow, 4)}`;
  ws["!merges"] = merges;
  ws["!freeze"] = { xSplit: 0, ySplit: 4 };
  // SheetJS uses !cols[].wch (characters); we cap so a giant value
  // doesn't blow the sheet width out.
  ws["!cols"] = columns.map((col) => {
    const header = col.header?.length ?? 8;
    let maxData = header;
    for (const r of rows) {
      const v = r[col.key];
      const s = v == null ? "" : String(v);
      if (s.length > maxData) maxData = s.length;
    }
    return { wch: Math.min(Math.max(col.width ?? maxData + 2, 10), 50) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws as never, sheetName ?? "Data");

  if (summary) {
    const sws: Record<string, unknown> = {};
    summary.rows.forEach((sr, i) => {
      const r = i + 1;
      sws[`A${r}`] = { v: sr.label, t: "s", s: { font: { bold: true } } };
      if (sr.formula !== undefined) {
        const f = sr.formula.replace(/\{lastRow\}/g, String(lastRow));
        sws[`B${r}`] = { t: "n", f, v: 0 };
      } else if (sr.value !== undefined) {
        if (typeof sr.value === "number") {
          sws[`B${r}`] = { v: sr.value, t: "n" };
        } else {
          sws[`B${r}`] = { v: sr.value, t: "s" };
        }
      } else {
        sws[`B${r}`] = { v: "", t: "s" };
      }
    });
    sws["!ref"] = `A1:B${Math.max(summary.rows.length, 1)}`;
    sws["!cols"] = [{ wch: 32 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, sws as never, summary.name);
  }

  const out = XLSX.write(wb, {
    type: "buffer",
    bookType: "xlsx",
    cellStyles: true,
  });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as Uint8Array);
}

/** Format a raw value the same way the xlsx number-format would render it. */
export function formatCellForPdf(
  value: unknown,
  format: CellFormat | undefined,
): string {
  if (value === null || value === undefined || value === "") return "";
  if (format === "currency") {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    const sign = n < 0 ? "-" : "";
    return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (format === "percent") {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return `${(n * 100).toFixed(1)}%`;
  }
  if (format === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (format === "int") {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return String(value);
}
