import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer, { MulterError } from "multer";
import {
  seedHousingDeductions,
  type HousingDeductionRow,
} from "../lib/seed-housing-deductions";
import { isSaturdayDate } from "../lib/pay-week";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const MAX_XLSX_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_XLSX_BYTES, files: 1 },
});

function uploadXlsx(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: `Workbook is too large. Maximum size is ${Math.round(
            MAX_XLSX_BYTES / (1024 * 1024),
          )} MB.`,
        });
        return;
      }
      res.status(400).json({ error: `Upload rejected: ${err.message}` });
      return;
    }
    next(err);
  });
}

// Reads the first sheet of an xlsx and returns the rows of strings.
function readWorkbookFromBuffer(buf: Buffer): string[][] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx") as typeof import("xlsx");
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: "",
  }) as unknown[][];
  return rows.map((r) => r.map((cell) => (cell == null ? "" : String(cell))));
}

// Locate the header row (first row that contains all four required
// column labels, case-insensitive). Returns the row index and a map
// from canonical field → column index. The bundled payroll export's
// columns are: Customer, Person, Person Id, Adjustment, Deduction.
// We use Adjustment (the recurring weekly rate), not Deduction (the
// actual taken on a given run, which can include catch-up balances).
const REQUIRED = ["customer", "person", "person id", "adjustment"] as const;
type RequiredCol = (typeof REQUIRED)[number];

function findHeaderRow(
  rows: string[][],
): { rowIndex: number; cols: Record<RequiredCol, number> } | null {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const lower = row.map((c) => c.trim().toLowerCase());
    const cols: Partial<Record<RequiredCol, number>> = {};
    for (const name of REQUIRED) {
      const idx = lower.indexOf(name);
      if (idx >= 0) cols[name] = idx;
    }
    if (Object.keys(cols).length === REQUIRED.length) {
      return {
        rowIndex: i,
        cols: cols as Record<RequiredCol, number>,
      };
    }
  }
  return null;
}

function parseAmount(raw: string): number | null {
  if (!raw) return null;
  // Strip dollar signs, commas, parens, whitespace. Treat parentheses
  // as positive (the export uses them on a few rows).
  const cleaned = raw.replace(/[$,()\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseDeductionsWorkbook(
  rows: string[][],
): { rows: HousingDeductionRow[]; skipped: number } {
  const header = findHeaderRow(rows);
  if (!header) return { rows: [], skipped: 0 };
  const out: HousingDeductionRow[] = [];
  let skipped = 0;
  for (let i = header.rowIndex + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const customer = (r[header.cols.customer] ?? "").trim();
    const name = (r[header.cols.person] ?? "").trim();
    const personId = (r[header.cols["person id"]] ?? "").trim();
    const weekly = parseAmount((r[header.cols.adjustment] ?? "").trim());
    if (!customer && !name && !personId && weekly === null) continue;
    if (!customer || !name || !personId || weekly === null || weekly <= 0) {
      skipped++;
      continue;
    }
    out.push({ customer, name, personId, weekly });
  }
  return { rows: out, skipped };
}

router.post(
  "/payroll/import-deductions",
  uploadXlsx,
  async (req, res): Promise<void> => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Missing 'file' field in upload." });
        return;
      }
      if (
        file.mimetype &&
        !file.mimetype.includes("spreadsheet") &&
        !file.mimetype.includes("excel") &&
        file.mimetype !== "application/octet-stream"
      ) {
        res
          .status(415)
          .json({ error: `Expected an .xlsx workbook, got ${file.mimetype}.` });
        return;
      }
      const payWeekEndDate =
        typeof req.query.payWeekEndDate === "string" &&
        isSaturdayDate(req.query.payWeekEndDate)
          ? req.query.payWeekEndDate
          : null;
      if (!payWeekEndDate) {
        res.status(400).json({
          error:
            "Missing or invalid payWeekEndDate query parameter (expected a Saturday YYYY-MM-DD).",
        });
        return;
      }
      const sheetRows = readWorkbookFromBuffer(file.buffer);
      const parsed = parseDeductionsWorkbook(sheetRows);
      if (parsed.rows.length === 0) {
        res.status(400).json({
          error:
            "No deduction rows found. Expected columns: Customer, Person, Person Id, Adjustment.",
          skippedRows: parsed.skipped,
        });
        return;
      }
      const result = await seedHousingDeductions({
        logger,
        rows: parsed.rows,
        payWeekEndDate,
      });
      res.json({
        payWeekEndDate: result.payWeekEndDate,
        deductionsImported: result.snapshotsWritten,
        totalAmount: result.snapshotsTotalAmount,
        unmatchedCount: result.unmatched.length,
        lowConfidenceCount: result.lowConfidenceMatches.length,
        skippedRows: parsed.skipped,
        unmatched: result.unmatched,
        lowConfidenceMatches: result.lowConfidenceMatches,
      });
    } catch (err) {
      logger.error({ err }, "Payroll deduction import failed");
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  },
);

export default router;
