// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require("pdfkit") as typeof import("pdfkit");
import { formatCellForPdf, type ExportColumn, type SummarySheet } from "./xlsx-export";

export interface BuildPdfOpts {
  title: string;
  filterDesc?: string;
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
  summary?: SummarySheet;
}

const MARGIN = 36; // 0.5in
const MIN_FONT = 8;
const HEADER_FONT = 9;
const TITLE_FONT = 14;
const META_FONT = 9;

/**
 * Render a paginated PDF of the same column spec + rows the Excel
 * builder consumes. Letter landscape with 0.5in margins, repeated
 * column headers on each page, "Page N of M" footer, and a totals
 * block on the last page. Formula columns are pre-evaluated via
 * `column.compute`; PDFs don't recalc.
 *
 * When the column set is too wide to fit at the minimum font size we
 * drop the highest-`priority` columns first and append a note row so
 * the operator knows to use the xlsx export for the full data set.
 */
export async function buildPdfBuffer(opts: BuildPdfOpts): Promise<Buffer> {
  const { title, filterDesc, rows, summary } = opts;

  const doc = new PDFDocument({
    size: "LETTER",
    layout: "landscape",
    margin: MARGIN,
    bufferPages: true,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on("end", () => resolve()));

  const pageWidth = doc.page.width - 2 * MARGIN;

  // Pick the column set + widths that fit at MIN_FONT, dropping the
  // highest-priority columns first if necessary.
  const sorted = opts.columns
    .map((c, i) => ({ c, i }))
    .slice()
    .sort((a, b) => (b.c.priority ?? 0) - (a.c.priority ?? 0));
  let active = opts.columns.slice();
  let droppedCount = 0;
  let widths = measureWidths(active, rows, pageWidth);
  while (widths === null && active.length > 1) {
    const drop = sorted.shift();
    if (!drop) break;
    active = active.filter((c) => c !== drop.c);
    droppedCount++;
    widths = measureWidths(active, rows, pageWidth);
  }
  if (!widths) {
    widths = active.map(() => pageWidth / Math.max(active.length, 1));
  }

  const renderHeader = () => {
    const top = MARGIN;
    doc.fontSize(TITLE_FONT).font("Helvetica-Bold").text(title, MARGIN, top, {
      width: pageWidth * 0.65,
      align: "left",
    });
    doc
      .fontSize(META_FONT)
      .font("Helvetica")
      .text(new Date().toISOString().slice(0, 19) + "Z", MARGIN, top, {
        width: pageWidth,
        align: "right",
      });
    if (filterDesc) {
      doc
        .fontSize(META_FONT)
        .font("Helvetica-Oblique")
        .fillColor("#666")
        .text(filterDesc, MARGIN, top + 18, { width: pageWidth })
        .fillColor("#000");
    }
    const headerY = top + (filterDesc ? 36 : 22);
    // Column headers
    let x = MARGIN;
    doc.fontSize(HEADER_FONT).font("Helvetica-Bold");
    active.forEach((col, i) => {
      doc.text(col.header, x + 2, headerY, {
        width: widths[i] - 4,
        ellipsis: true,
      });
      x += widths[i];
    });
    doc
      .moveTo(MARGIN, headerY + 14)
      .lineTo(MARGIN + pageWidth, headerY + 14)
      .stroke();
    return headerY + 18;
  };

  let y = renderHeader();
  const bottomLimit = doc.page.height - MARGIN - 18; // leave room for footer

  doc.fontSize(MIN_FONT).font("Helvetica");
  for (const row of rows) {
    if (y > bottomLimit - 12) {
      doc.addPage();
      y = renderHeader();
      doc.fontSize(MIN_FONT).font("Helvetica");
    }
    let x = MARGIN;
    active.forEach((col, i) => {
      let value: unknown;
      if (col.compute) value = col.compute(row);
      else value = row[col.key];
      const text = formatCellForPdf(value, col.format);
      doc.text(text, x + 2, y, { width: widths[i] - 4, ellipsis: true });
      x += widths[i];
    });
    y += 12;
  }

  if (droppedCount > 0) {
    if (y > bottomLimit - 14) {
      doc.addPage();
      y = renderHeader();
    }
    doc
      .fontSize(MIN_FONT)
      .font("Helvetica-Oblique")
      .fillColor("#888")
      .text(
        `(${droppedCount} column${droppedCount === 1 ? "" : "s"} omitted — use Excel export for full data)`,
        MARGIN,
        y + 4,
        { width: pageWidth },
      )
      .fillColor("#000");
    y += 18;
  }

  if (summary) {
    if (y > bottomLimit - (summary.rows.length + 2) * 12) {
      doc.addPage();
      y = renderHeader();
    }
    y += 8;
    doc.fontSize(HEADER_FONT).font("Helvetica-Bold").text(summary.name, MARGIN, y);
    y += 14;
    doc.fontSize(MIN_FONT).font("Helvetica");
    for (const sr of summary.rows) {
      const v = sr.value !== undefined ? sr.value : sr.formula ?? "";
      doc.text(sr.label, MARGIN, y, { width: pageWidth * 0.5 });
      doc.text(String(v), MARGIN + pageWidth * 0.5, y, {
        width: pageWidth * 0.5,
        align: "left",
      });
      y += 12;
    }
  }

  // Page footers: "Page N of M" centered. Use bufferedPageRange so M is
  // known after layout completes.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const footerY = doc.page.height - MARGIN + 4;
    doc
      .fontSize(8)
      .font("Helvetica")
      .text(`Page ${i + 1} of ${range.count}`, MARGIN, footerY, {
        width: pageWidth,
        align: "center",
      });
  }

  doc.end();
  await done;
  return Buffer.concat(chunks);
}

function measureWidths(
  cols: ExportColumn[],
  rows: Array<Record<string, unknown>>,
  totalWidth: number,
): number[] | null {
  // Cheap heuristic: pretend ~5pt avg char width at MIN_FONT and pick
  // widths from max(header, sample-data). Cap min at 40pt; bail if the
  // sum exceeds totalWidth so the caller can drop a column.
  const approxCharW = 4.5;
  const sample = rows.slice(0, 25);
  const raw = cols.map((c) => {
    let max = c.header.length;
    for (const r of sample) {
      const v = c.compute ? c.compute(r) : r[c.key];
      const s = v == null ? "" : String(v);
      if (s.length > max) max = s.length;
    }
    return Math.min(Math.max(max, 8), 36) * approxCharW + 8;
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum > totalWidth) {
    // try a proportional shrink down to minimum 40pt each
    const minSum = cols.length * 40;
    if (minSum > totalWidth) return null;
    const scale = totalWidth / sum;
    const shrunk = raw.map((w) => Math.max(w * scale, 40));
    const newSum = shrunk.reduce((a, b) => a + b, 0);
    if (newSum > totalWidth + 1) return null;
    return shrunk;
  }
  // pad proportionally so columns fill the page
  const pad = (totalWidth - sum) / cols.length;
  return raw.map((w) => w + pad);
}
