import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer, { MulterError } from "multer";
import { db, occupantsTable, customersTable, propertiesTable } from "@workspace/db";
import { normalizeOccupantRow } from "../lib/db-row-normalizers";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const MAX_XLSX_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_XLSX_BYTES, files: 1 },
});

function uploadXlsx(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
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

// Canonical column names accepted in the template header. Operators may
// rearrange columns; we look each one up by name (case-insensitive,
// trimmed). Only `name` and `moveInDate` are required.
const COLUMNS = [
  "name",
  "email",
  "phone",
  "employeeId",
  "company",
  "customer",
  "property",
  "moveInDate",
  "moveOutDate",
  "chargePerBed",
  "billingFrequency",
  "shift",
  "status",
] as const;
type ColumnKey = (typeof COLUMNS)[number];

// Header label aliases — the friendlier labels we ship in the
// downloadable template, plus a few common variants operators tend to
// type. All comparisons are case-insensitive after trim.
// Aliases are intentionally narrow: each one points at an unambiguous
// label so we don't silently mis-bind a column when an operator pastes
// a workbook that happens to carry an unrelated field with a similar
// name (e.g. a generic "Address" or "Charge" column should not be
// auto-bound to Property / ChargePerBed). Add new aliases conservatively.
const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  name: ["name", "occupant name", "full name"],
  email: ["email", "email address"],
  phone: ["phone", "phone number"],
  employeeId: ["employee id", "employeeid", "person id", "personid"],
  company: ["company", "employer"],
  customer: ["customer", "customer name"],
  property: ["property", "property name"],
  moveInDate: ["move-in date", "move in date"],
  moveOutDate: ["move-out date", "move out date"],
  chargePerBed: ["charge per bed", "chargeperbed"],
  billingFrequency: ["billing frequency", "billingfrequency"],
  shift: ["shift"],
  status: ["status"],
};

function findHeaderRow(
  rows: string[][],
): { rowIndex: number; cols: Partial<Record<ColumnKey, number>> } | null {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const lower = row.map((c) => c.trim().toLowerCase());
    const cols: Partial<Record<ColumnKey, number>> = {};
    for (const key of COLUMNS) {
      for (const alias of HEADER_ALIASES[key]) {
        const idx = lower.indexOf(alias);
        if (idx >= 0) {
          cols[key] = idx;
          break;
        }
      }
    }
    // We require at least Name + Move-In Date to consider this a header row.
    if (cols.name !== undefined && cols.moveInDate !== undefined) {
      return { rowIndex: i, cols };
    }
  }
  return null;
}

function cell(
  row: string[],
  cols: Partial<Record<ColumnKey, number>>,
  key: ColumnKey,
): string {
  const idx = cols[key];
  if (idx === undefined) return "";
  return (row[idx] ?? "").trim();
}

const STRICT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Accept "YYYY-MM-DD", "M/D/YYYY", "MM/DD/YYYY", or an Excel-serial
// (the xlsx lib already converts most dates to strings via raw:false,
// but we belt-and-braces here too).
function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (STRICT_DATE_RE.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const mo = m[1].padStart(2, "0");
    const d = m[2].padStart(2, "0");
    let y = m[3];
    if (y.length === 2) y = "20" + y;
    return `${y}-${mo}-${d}`;
  }
  // Excel serial date (days since 1899-12-30)
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + n * 86_400_000;
    const dt = new Date(ms);
    if (!Number.isNaN(dt.getTime())) {
      return dt.toISOString().slice(0, 10);
    }
  }
  return null;
}

function parseNumber(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeFrequency(raw: string): "Weekly" | "Biweekly" | "Monthly" {
  const s = raw.trim().toLowerCase();
  if (s.startsWith("week")) return "Weekly";
  if (s.startsWith("bi")) return "Biweekly";
  return "Monthly";
}

function normalizeStatus(raw: string): "Active" | "Former" {
  return raw.trim().toLowerCase() === "former" ? "Former" : "Active";
}

function makeOccupantId(): string {
  // Same shape as the demo seed data uses: occ-<rand>.
  const rand = Math.random().toString(36).slice(2, 10);
  return `occ-${rand}`;
}

router.post(
  "/occupants/import-xlsx",
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
      const sheetRows = readWorkbookFromBuffer(file.buffer);
      const header = findHeaderRow(sheetRows);
      if (!header) {
        res.status(400).json({
          error:
            "Could not find a header row. Required columns: Name, Move-In Date. Download the template for the expected layout.",
        });
        return;
      }

      // Snapshot customers + properties + existing occupants once so we
      // resolve names without running a query per row, AND can dedupe
      // against rows already in the DB. Matches are case-insensitive on
      // trimmed names; properties are scoped to the matched customer
      // when both are provided.
      const allCustomers = await db
        .select({ id: customersTable.id, name: customersTable.name })
        .from(customersTable);
      const allProperties = await db
        .select({
          id: propertiesTable.id,
          name: propertiesTable.name,
          customerId: propertiesTable.customerId,
        })
        .from(propertiesTable);
      const existingOccupants = await db
        .select({
          id: occupantsTable.id,
          name: occupantsTable.name,
          employeeId: occupantsTable.employeeId,
          moveInDate: occupantsTable.moveInDate,
        })
        .from(occupantsTable);
      // Dedupe key strategy:
      //   * If the row carries a non-empty employeeId, that alone is
      //     the natural key (operators don't want two records for the
      //     same person on different move-ins).
      //   * Otherwise fall back to (name + moveInDate) which catches
      //     accidental re-uploads of the same workbook.
      // Both keys are case-insensitive and trimmed.
      const seenEmployeeIds = new Set<string>();
      const seenNameMoveIn = new Set<string>();
      for (const o of existingOccupants) {
        if (o.employeeId && o.employeeId.trim()) {
          seenEmployeeIds.add(o.employeeId.trim().toLowerCase());
        }
        seenNameMoveIn.add(
          `${(o.name ?? "").trim().toLowerCase()}|${o.moveInDate ?? ""}`,
        );
      }

      const customerByName = new Map<string, string>();
      for (const c of allCustomers) {
        customerByName.set(c.name.trim().toLowerCase(), c.id);
      }
      const propertiesByCustomer = new Map<
        string,
        Array<{ id: string; name: string }>
      >();
      const propertiesByName = new Map<string, string>();
      for (const p of allProperties) {
        const list = propertiesByCustomer.get(p.customerId) ?? [];
        list.push({ id: p.id, name: p.name });
        propertiesByCustomer.set(p.customerId, list);
        propertiesByName.set(p.name.trim().toLowerCase(), p.id);
      }

      const created: Array<{ id: string; name: string }> = [];
      const skipped: Array<{ row: number; name: string; reason: string }> = [];

      for (let i = header.rowIndex + 1; i < sheetRows.length; i++) {
        const row = sheetRows[i] ?? [];
        const name = cell(row, header.cols, "name");
        // Treat fully-empty rows as spacers, not errors.
        const allEmpty =
          !name &&
          !cell(row, header.cols, "email") &&
          !cell(row, header.cols, "phone") &&
          !cell(row, header.cols, "moveInDate");
        if (allEmpty) continue;

        if (!name) {
          skipped.push({ row: i + 1, name: "", reason: "Missing Name." });
          continue;
        }
        const moveInRaw = cell(row, header.cols, "moveInDate");
        const moveInDate = parseDate(moveInRaw);
        if (!moveInDate) {
          skipped.push({
            row: i + 1,
            name,
            reason: `Missing or invalid Move-In Date (got "${moveInRaw}"). Use YYYY-MM-DD.`,
          });
          continue;
        }
        const moveOutDate = parseDate(cell(row, header.cols, "moveOutDate"));

        const customerName = cell(row, header.cols, "customer");
        const propertyName = cell(row, header.cols, "property");
        let customerId: string | null = null;
        if (customerName) {
          customerId = customerByName.get(customerName.toLowerCase()) ?? null;
          if (!customerId) {
            skipped.push({
              row: i + 1,
              name,
              reason: `Customer "${customerName}" not found. Create the customer first or fix the spelling.`,
            });
            continue;
          }
        }
        let propertyId: string | null = null;
        if (propertyName) {
          if (customerId) {
            const scoped = propertiesByCustomer.get(customerId) ?? [];
            const match = scoped.find(
              (p) => p.name.trim().toLowerCase() === propertyName.toLowerCase(),
            );
            propertyId = match ? match.id : null;
          } else {
            propertyId = propertiesByName.get(propertyName.toLowerCase()) ?? null;
          }
          if (!propertyId) {
            skipped.push({
              row: i + 1,
              name,
              reason: `Property "${propertyName}" not found${
                customerName ? ` under customer "${customerName}"` : ""
              }.`,
            });
            continue;
          }
        }

        // Dedupe — skip rows that already exist (or were already
        // queued earlier in this same upload).
        const employeeId = cell(row, header.cols, "employeeId");
        const empKey = employeeId.trim().toLowerCase();
        const nameKey = `${name.trim().toLowerCase()}|${moveInDate}`;
        if (empKey && seenEmployeeIds.has(empKey)) {
          skipped.push({
            row: i + 1,
            name,
            reason: `Already exists — an occupant with Employee Id "${employeeId}" is already in the system.`,
          });
          continue;
        }
        if (!empKey && seenNameMoveIn.has(nameKey)) {
          skipped.push({
            row: i + 1,
            name,
            reason: `Already exists — an occupant named "${name}" with the same move-in date is already in the system.`,
          });
          continue;
        }

        const chargePerBed = parseNumber(cell(row, header.cols, "chargePerBed")) ?? 0;
        const billingFrequency = normalizeFrequency(
          cell(row, header.cols, "billingFrequency"),
        );
        const status = normalizeStatus(cell(row, header.cols, "status"));
        const shiftRaw = cell(row, header.cols, "shift");

        const normalized = normalizeOccupantRow({
          id: makeOccupantId(),
          name,
          email: cell(row, header.cols, "email"),
          phone: cell(row, header.cols, "phone"),
          bedId: null,
          propertyId,
          moveInDate,
          moveOutDate,
          status,
          chargePerBed,
          billingFrequency,
          employeeId,
          company: cell(row, header.cols, "company"),
          chargeSource: "",
          chargeSourceCustomer: "",
          chargeSourcePersonId: "",
          shift: shiftRaw ? shiftRaw : null,
        });

        try {
          const [insertedRow] = await db
            .insert(occupantsTable)
            .values(normalized)
            .returning({ id: occupantsTable.id, name: occupantsTable.name });
          created.push({ id: insertedRow.id, name: insertedRow.name });
          // Mark this row as "now seen" so a duplicate further down in
          // the same workbook is skipped instead of inserted twice.
          if (empKey) seenEmployeeIds.add(empKey);
          seenNameMoveIn.add(nameKey);
        } catch (err) {
          // Log full DB error server-side; surface a generic, safe
          // message to the client so we don't leak schema/internal
          // details to operators.
          logger.error(
            { err, row: i + 1, name },
            "Occupant xlsx import: row insert failed",
          );
          skipped.push({
            row: i + 1,
            name,
            reason: "Could not save this row. Check the server logs for details.",
          });
        }
      }

      res.json({
        created: created.length,
        skipped: skipped.length,
        skippedDetails: skipped,
        createdIds: created.map((c) => c.id),
      });
    } catch (err) {
      // Log full error context server-side; client gets a sanitized
      // message so we don't leak internal/schema details.
      logger.error({ err }, "Occupant xlsx import failed");
      res.status(500).json({
        error:
          "Could not process the workbook. Please verify it matches the template and try again.",
      });
    }
  },
);

export default router;
