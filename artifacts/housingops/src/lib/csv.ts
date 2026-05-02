// Lightweight CSV helpers used by the per-page "Download CSV" actions.
//
// The output is RFC 4180-style (CRLF line endings, double-quoted fields with
// embedded quotes doubled) and prefixed with a UTF-8 BOM so Excel reliably
// detects the encoding when the file is opened directly. Google Sheets and
// modern Excel both handle this format cleanly.

export type CsvCellValue = string | number | boolean | null | undefined;

export interface CsvColumn<Row> {
  header: string;
  value: (row: Row) => CsvCellValue;
}

const NEEDS_QUOTING = /[",\r\n]/;
// Cells starting with these characters are interpreted as formulas by Excel /
// Google Sheets / LibreOffice. Prefixing the cell with a single quote tells
// the spreadsheet to treat the value as literal text instead. Tab (\t) and
// carriage return (\r) are also treated as formula leaders by some tools.
const FORMULA_LEADERS = /^[=+\-@\t\r]/;

function escapeCell(value: CsvCellValue): string {
  if (value === null || value === undefined) return "";
  let str = typeof value === "string" ? value : String(value);
  if (typeof value === "string" && FORMULA_LEADERS.test(str)) {
    str = `'${str}`;
  }
  if (NEEDS_QUOTING.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Serialize an array of rows into a CSV string using the given columns. */
export function toCsv<Row>(rows: readonly Row[], columns: readonly CsvColumn<Row>[]): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => escapeCell(c.header)).join(","));
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(c.value(row))).join(","));
  }
  return lines.join("\r\n");
}

/** Append a YYYY-MM-DD-HH-MM-SS timestamp to a base filename. */
export function timestampedCsvName(base: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${base}-${stamp}.csv`;
}

/**
 * Trigger a browser download for the given CSV string. A UTF-8 BOM is
 * prepended so Excel correctly detects non-ASCII characters.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
