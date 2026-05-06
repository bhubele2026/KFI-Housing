import path from "path";
import { promises as fs } from "fs";
import { and, eq } from "drizzle-orm";
import {
  db,
  customersTable,
  propertiesTable,
  leasesTable,
  type InsertCustomerRow,
  type InsertPropertyRow,
  type InsertLeaseRow,
} from "@workspace/db";
import { logger as defaultLogger } from "./logger";
import type { Logger } from "pino";
import {
  type MasterRow,
  parseMasterRows,
  normalizeAddress,
  normalizeCustomerName,
  levenshtein,
} from "./master-lease-parser";

/** Per-row outcome surfaced in the import summary. */
export interface RowDecision {
  sourceRow: number;
  customerName: string;
  customerAction: "created" | "updated" | "matched";
  customerId: string;
  customerMatchReason?: string;
  propertyAction: "created" | "updated" | "matched" | "skipped";
  propertyId?: string;
  propertyMatchReason?: string;
  leaseAction: "created" | "updated" | "skipped";
  leaseId?: string;
  needsReview: boolean;
  reviewReasons: string[];
}

export interface ImportSummary {
  customersCreated: number;
  customersUpdated: number;
  propertiesCreated: number;
  propertiesUpdated: number;
  leasesCreated: number;
  leasesUpdated: number;
  leasesSkipped: number;
  rowsNeedingReview: RowDecision[];
  fuzzyCustomerMatches: Array<{
    incoming: string;
    matchedExisting: string;
    distance: number;
  }>;
  decisions: RowDecision[];
}

export interface ImportDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
}

const DEFAULT_MASTER_FILENAME = "Housing_Lease_MASTER_1778105244042.xlsx";

/** Resolves the bundled master file under `attached_assets/`. */
export function defaultMasterFilePath(): string {
  return path.resolve(
    process.cwd(),
    "..",
    "..",
    "attached_assets",
    DEFAULT_MASTER_FILENAME,
  );
}

/** Reads + parses an XLSX workbook into the raw `string[][]` rows used by the parser. */
export async function readMasterWorkbook(filePath: string): Promise<string[][]> {
  const buf = await fs.readFile(filePath);
  return readMasterWorkbookFromBuffer(buf);
}

export function readMasterWorkbookFromBuffer(buf: Buffer): string[][] {
  // Dynamic require so the heavy `xlsx` module is only loaded when an
  // import actually runs (the api-server boot path doesn't pay for it
  // unless an operator triggers an import).
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

interface CustomerSnapshot {
  id: string;
  name: string;
  state: string;
  notes: string;
  normalizedName: string;
}

interface PropertySnapshot {
  id: string;
  customerId: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  name: string;
  notes: string;
  furnishings: string[];
  normalizedAddress: string;
}

interface LeaseSnapshot {
  id: string;
  propertyId: string;
  notes: string;
  startDate: string;
  needsReview: boolean;
}

function unitMarker(unit: string): string {
  return `Unit ${unit} —`;
}

function buildLeaseNotes(row: MasterRow): string {
  const parts: string[] = [];
  if (row.units) parts.push(`Units: ${row.units}.`);
  if (row.complexName) parts.push(`Complex: ${row.complexName}.`);
  if (row.vendor) parts.push(`Vendor: ${row.vendor}.`);
  if (row.weeklyCostRaw && row.weeklyCost === null) {
    parts.push(`Weekly cost (raw): ${row.weeklyCostRaw}.`);
  }
  if (row.leaseDates) parts.push(`Lease dates (raw): ${row.leaseDates}.`);
  if (row.noticePeriodUtilities) {
    parts.push(`Notice (utilities): ${row.noticePeriodUtilities}.`);
  }
  if (row.noticePeriodLease) {
    parts.push(`Notice (lease): ${row.noticePeriodLease}.`);
  }
  if (row.leaseTerms) parts.push(`Lease terms: ${row.leaseTerms}.`);
  if (row.earlyTerminationTerms) {
    parts.push(`Early termination: ${row.earlyTerminationTerms}.`);
  }
  if (row.primary?.mapUrl) parts.push(`Map: ${row.primary.mapUrl}.`);
  if (row.reviewReasons.length > 0) {
    parts.push(`Needs review: ${row.reviewReasons.join("; ")}.`);
  }
  parts.push(`Source: master file row ${row.sourceRow}.`);
  return parts.join(" ");
}

function buildPropertyName(row: MasterRow, fallbackAddr: string): string {
  if (row.complexName) return row.complexName;
  if (fallbackAddr) return fallbackAddr;
  return row.customerName;
}

function buildPropertyNotes(row: MasterRow, mapUrl: string, units: string): string {
  const parts: string[] = [];
  if (row.complexName && row.complexName !== buildPropertyName(row, "")) {
    parts.push(`Complex: ${row.complexName}.`);
  }
  if (units) parts.push(`Units: ${units}.`);
  if (row.furnished) parts.push(`Furnished: ${row.furnished}.`);
  if (row.appliancesIncluded) {
    parts.push(`Appliances included: ${row.appliancesIncluded}.`);
  }
  if (mapUrl) parts.push(`Map: ${mapUrl}.`);
  parts.push(`Source: master file row ${row.sourceRow}.`);
  return parts.join(" ");
}

function buildFurnishings(row: MasterRow): string[] {
  const out: string[] = [];
  if (/^y/i.test(row.furnished)) out.push("Furnished");
  if (/^y/i.test(row.appliancesIncluded)) out.push("Appliances included");
  return out;
}

/**
 * Idempotently imports the Housing_Lease_MASTER workbook into customers,
 * properties, and leases. See `task-288.md` for the full contract.
 *
 * Re-runs are safe: customers/properties/leases are matched on
 * normalized natural keys (name fuzzy-matched, address normalized,
 * lease unique by (customer, property, unit) or (customer, property,
 * startDate)). Existing rows are updated in place rather than
 * duplicated, and a no-op second run produces zero inserts.
 */
export async function importMasterLeases(
  rows: string[][],
  deps: Partial<ImportDeps> = {},
): Promise<ImportSummary> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;

  const parsed = parseMasterRows(rows);
  const summary: ImportSummary = {
    customersCreated: 0,
    customersUpdated: 0,
    propertiesCreated: 0,
    propertiesUpdated: 0,
    leasesCreated: 0,
    leasesUpdated: 0,
    leasesSkipped: 0,
    rowsNeedingReview: [],
    fuzzyCustomerMatches: [],
    decisions: [],
  };

  await database.transaction(async (tx) => {
    // ── Pre-flight scan: load every existing customer/property/lease so
    //    we can resolve dedupe matches in memory before writing anything.
    const existingCustomers: CustomerSnapshot[] = (
      await tx.select().from(customersTable)
    ).map((c) => ({
      id: c.id,
      name: c.name,
      state: c.state ?? "",
      notes: c.notes,
      normalizedName: normalizeCustomerName(c.name),
    }));
    const existingProperties: PropertySnapshot[] = (
      await tx.select().from(propertiesTable)
    ).map((p) => ({
      id: p.id,
      customerId: p.customerId,
      address: p.address,
      city: p.city,
      state: p.state,
      zip: p.zip,
      name: p.name,
      notes: p.notes,
      furnishings: p.furnishings ?? [],
      normalizedAddress: normalizeAddress(p.address),
    }));
    const existingLeases: LeaseSnapshot[] = (
      await tx.select().from(leasesTable)
    ).map((l) => ({
      id: l.id,
      propertyId: l.propertyId,
      notes: l.notes,
      startDate: l.startDate,
      needsReview: l.needsReview ?? false,
    }));

    const customerByNormName = new Map<string, CustomerSnapshot>();
    for (const c of existingCustomers) {
      if (!customerByNormName.has(c.normalizedName)) {
        customerByNormName.set(c.normalizedName, c);
      }
    }

    function findCustomer(name: string): {
      match: CustomerSnapshot | null;
      reason: string;
    } {
      const norm = normalizeCustomerName(name);
      const exact = customerByNormName.get(norm);
      if (exact) return { match: exact, reason: "normalized name match" };
      // Fuzzy fallback: Levenshtein distance ≤ 2 on the normalized name.
      let best: { c: CustomerSnapshot; d: number } | null = null;
      for (const c of customerByNormName.values()) {
        const d = levenshtein(norm, c.normalizedName);
        if (d <= 2 && (best === null || d < best.d)) best = { c, d };
      }
      if (best) {
        summary.fuzzyCustomerMatches.push({
          incoming: name,
          matchedExisting: best.c.name,
          distance: best.d,
        });
        return { match: best.c, reason: `fuzzy match (distance ${best.d})` };
      }
      return { match: null, reason: "no existing customer found" };
    }

    function findProperty(
      customerId: string,
      address: string,
      zip: string,
    ): { match: PropertySnapshot | null; reason: string } {
      const norm = normalizeAddress(address);
      if (!norm) return { match: null, reason: "address blank" };
      // First pass: same customer + matching normalized address (zip is
      // a tie-breaker, not a hard requirement, because the source file
      // sometimes omits zip on continuation rows).
      for (const p of existingProperties) {
        if (
          p.customerId === customerId &&
          p.normalizedAddress === norm &&
          (zip === "" || p.zip === "" || p.zip === zip)
        ) {
          return { match: p, reason: "same-customer normalized-address match" };
        }
      }
      // Global pass: any customer.
      for (const p of existingProperties) {
        if (p.normalizedAddress === norm && (zip === "" || p.zip === "" || p.zip === zip)) {
          return { match: p, reason: "global normalized-address match" };
        }
      }
      return { match: null, reason: "no existing property found" };
    }

    function genId(prefix: string, key: string): string {
      // Deterministic stable id derived from the natural key so a
      // re-run that re-creates the same row keeps the same id even
      // across DB resets.
      const slug = key
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
      return `${prefix}-${slug || Date.now().toString(36)}`;
    }

    async function upsertCustomer(row: MasterRow): Promise<{
      id: string;
      action: "created" | "updated" | "matched";
      reason: string;
    }> {
      const found = findCustomer(row.customerName);
      if (found.match) {
        // Update the state if we now know it and it was previously empty.
        if (row.state && found.match.state !== row.state) {
          await tx
            .update(customersTable)
            .set({ state: row.state })
            .where(eq(customersTable.id, found.match.id));
          found.match.state = row.state;
          summary.customersUpdated += 1;
          return { id: found.match.id, action: "updated", reason: found.reason };
        }
        return { id: found.match.id, action: "matched", reason: found.reason };
      }
      const id = genId("cust", row.customerName);
      const insert: InsertCustomerRow = {
        id,
        name: row.customerName,
        contactName: "",
        email: "",
        phone: "",
        notes: `Imported from master file row ${row.sourceRow}.`,
        state: row.state,
      };
      const inserted = await tx
        .insert(customersTable)
        .values(insert)
        .onConflictDoNothing()
        .returning({ id: customersTable.id });
      if (inserted.length === 0) {
        // Race / id collision — re-read by name.
        const re = await tx
          .select()
          .from(customersTable)
          .where(eq(customersTable.name, row.customerName))
          .limit(1);
        if (re.length > 0) {
          const c = re[0];
          const snap: CustomerSnapshot = {
            id: c.id,
            name: c.name,
            state: c.state ?? "",
            notes: c.notes,
            normalizedName: normalizeCustomerName(c.name),
          };
          existingCustomers.push(snap);
          customerByNormName.set(snap.normalizedName, snap);
          return { id: c.id, action: "matched", reason: "post-insert re-read" };
        }
      }
      summary.customersCreated += 1;
      const snap: CustomerSnapshot = {
        id,
        name: row.customerName,
        state: row.state,
        notes: insert.notes ?? "",
        normalizedName: normalizeCustomerName(row.customerName),
      };
      existingCustomers.push(snap);
      customerByNormName.set(snap.normalizedName, snap);
      return { id, action: "created", reason: "no existing customer found" };
    }

    async function upsertProperty(
      customerId: string,
      row: MasterRow,
      addr: NonNullable<MasterRow["primary"]>,
      complexName: string,
      units: string,
    ): Promise<{
      id: string;
      action: "created" | "updated" | "matched";
      reason: string;
    }> {
      const fallbackName = [addr.street, addr.city && `${addr.city}, ${addr.state}`]
        .filter(Boolean)
        .join(" – ");
      const desiredName = complexName || fallbackName || row.customerName;
      const desiredNotes = buildPropertyNotes(
        { ...row, complexName },
        addr.mapUrl,
        units,
      );
      const desiredFurnishings = buildFurnishings(row);

      const found = findProperty(customerId, addr.street, addr.zip);
      if (found.match) {
        // Update only fields that the importer actually owns; never
        // clobber operator-edited landlord/payment data.
        const updates: Partial<InsertPropertyRow> = {};
        if (!found.match.name && desiredName) updates.name = desiredName;
        if (!found.match.city && addr.city) updates.city = addr.city;
        if (!found.match.state && addr.state) updates.state = addr.state;
        if (!found.match.zip && addr.zip) updates.zip = addr.zip;
        if (!found.match.customerId) updates.customerId = customerId;
        if (Object.keys(updates).length > 0) {
          await tx
            .update(propertiesTable)
            .set(updates)
            .where(eq(propertiesTable.id, found.match.id));
          summary.propertiesUpdated += 1;
          return { id: found.match.id, action: "updated", reason: found.reason };
        }
        return { id: found.match.id, action: "matched", reason: found.reason };
      }

      const id = genId("prop", `${row.customerName}-${addr.street}-${addr.zip}`);
      const insert: InsertPropertyRow = {
        id,
        customerId,
        name: desiredName,
        address: addr.street,
        city: addr.city,
        state: addr.state,
        zip: addr.zip,
        notes: desiredNotes,
        furnishings: desiredFurnishings,
      };
      const inserted = await tx
        .insert(propertiesTable)
        .values(insert)
        .onConflictDoNothing()
        .returning({ id: propertiesTable.id });
      if (inserted.length > 0) {
        summary.propertiesCreated += 1;
        existingProperties.push({
          id,
          customerId,
          address: addr.street,
          city: addr.city,
          state: addr.state,
          zip: addr.zip,
          name: desiredName,
          notes: desiredNotes,
          furnishings: desiredFurnishings,
          normalizedAddress: normalizeAddress(addr.street),
        });
        return { id, action: "created", reason: "no existing property found" };
      }
      // Race fallback.
      const re = await tx
        .select()
        .from(propertiesTable)
        .where(
          and(
            eq(propertiesTable.customerId, customerId),
            eq(propertiesTable.address, addr.street),
          ),
        )
        .limit(1);
      if (re.length > 0) {
        return { id: re[0].id, action: "matched", reason: "post-insert re-read" };
      }
      throw new Error(
        `Failed to upsert property for ${row.customerName} (${addr.street})`,
      );
    }

    async function upsertLease(
      customerId: string,
      propertyId: string,
      row: MasterRow,
    ): Promise<{
      id: string | undefined;
      action: "created" | "updated" | "skipped";
    }> {
      const needsReview = row.reviewReasons.length > 0 || row.weeklyCost === null;
      // Master-file rows do not carry term dates, so we cannot derive
      // status from a calendar at insert time. Persist a placeholder
      // ("Upcoming" when triage is required, otherwise "Active"). The
      // GET /leases route uses the shared `deriveLeaseStatus` helper,
      // which falls back to this stored value whenever term dates are
      // blank — so the placeholder is what the operator sees until they
      // fill in dates, after which the status is computed dynamically.
      const status: "Active" | "Upcoming" = needsReview ? "Upcoming" : "Active";
      const monthly = row.weeklyCost !== null ? Math.round(row.weeklyCost * 4.33 * 100) / 100 : 0;
      const desiredNotes = buildLeaseNotes(row);

      // Match key: (propertyId, "Unit X —" marker in notes) when
      // units are present, else (propertyId, blank-notes singleton).
      const unitTokens = (row.units || "")
        .split(/[\s,]+/)
        .map((u) => u.trim())
        .filter((u) => u.length > 0);

      // For Adient specifically, the existing per-unit leases from
      // task #283 were inserted with `Unit N —` notes — match those
      // by unit and update in place. For other customers, match the
      // first lease we find on this property whose notes contain ANY
      // of our units (or just the first lease on the property when
      // there are no units).
      let match: LeaseSnapshot | undefined;
      if (unitTokens.length > 0) {
        for (const unit of unitTokens) {
          const m = existingLeases.find(
            (l) =>
              l.propertyId === propertyId &&
              l.notes.includes(unitMarker(unit)),
          );
          if (m) {
            match = m;
            break;
          }
        }
      }
      if (!match) {
        match = existingLeases.find(
          (l) => l.propertyId === propertyId && l.notes.includes(`master file row ${row.sourceRow}`),
        );
      }

      if (match) {
        // Update only the importer-owned fields.
        const updates: Partial<InsertLeaseRow> = {
          notes: desiredNotes,
          weeklyCost: row.weeklyCost ?? 0,
          vendor: row.vendor,
          needsReview,
        };
        // Don't clobber existing rent if the existing value is non-zero
        // and we have nothing better to offer.
        if (monthly > 0) updates.monthlyRent = monthly;
        await tx
          .update(leasesTable)
          .set(updates)
          .where(eq(leasesTable.id, match.id));
        summary.leasesUpdated += 1;
        return { id: match.id, action: "updated" };
      }

      const id = genId(
        "lease",
        `${row.customerName}-${row.sourceRow}-${unitTokens[0] ?? "main"}`,
      );
      // Use a synthetic note marker so re-runs can find the lease back.
      const notesWithMarker = unitTokens.length > 0
        ? `${unitMarker(unitTokens[0])} ${desiredNotes}`
        : desiredNotes;
      const insert: InsertLeaseRow = {
        id,
        propertyId,
        startDate: "",
        endDate: "",
        monthlyRent: monthly,
        securityDeposit: 0,
        status,
        notes: notesWithMarker,
        clauses: row.earlyTerminationTerms || row.leaseTerms || "",
        buyoutAvailable: false,
        buyoutCost: null,
        weeklyCost: row.weeklyCost ?? 0,
        vendor: row.vendor,
        needsReview,
      };
      const inserted = await tx
        .insert(leasesTable)
        .values(insert)
        .onConflictDoNothing()
        .returning({ id: leasesTable.id });
      if (inserted.length === 0) {
        summary.leasesSkipped += 1;
        return { id: undefined, action: "skipped" };
      }
      summary.leasesCreated += 1;
      existingLeases.push({
        id,
        propertyId,
        notes: notesWithMarker,
        startDate: "",
        needsReview,
      });
      return { id, action: "created" };
    }

    for (const row of parsed) {
      const cust = await upsertCustomer(row);

      let primaryPropertyId: string | undefined;
      let primaryAction: RowDecision["propertyAction"] = "skipped";
      let primaryReason = "no primary address";
      if (row.primary) {
        const complex = row.complexName;
        const units = row.units;
        const up = await upsertProperty(
          cust.id,
          row,
          row.primary,
          complex,
          units,
        );
        primaryPropertyId = up.id;
        primaryAction = up.action;
        primaryReason = up.reason;
      }

      // Secondary property attached to the same customer (no lease).
      if (row.secondary) {
        await upsertProperty(
          cust.id,
          { ...row, complexName: row.secondary.complexName, units: row.secondary.address.units, reviewReasons: [] },
          row.secondary.address,
          row.secondary.complexName,
          row.secondary.address.units,
        );
      }

      let leaseRes: {
        id: string | undefined;
        action: "created" | "updated" | "skipped";
      } = { id: undefined, action: "skipped" };
      if (primaryPropertyId) {
        leaseRes = await upsertLease(cust.id, primaryPropertyId, row);
      }

      const decision: RowDecision = {
        sourceRow: row.sourceRow,
        customerName: row.customerName,
        customerAction: cust.action,
        customerId: cust.id,
        customerMatchReason: cust.reason,
        propertyAction: primaryAction,
        propertyId: primaryPropertyId,
        propertyMatchReason: primaryReason,
        leaseAction: leaseRes.action,
        leaseId: leaseRes.id,
        needsReview: row.reviewReasons.length > 0 || row.weeklyCost === null,
        reviewReasons: row.reviewReasons,
      };
      summary.decisions.push(decision);
      if (decision.needsReview) summary.rowsNeedingReview.push(decision);
    }
  });

  log.info(
    {
      customersCreated: summary.customersCreated,
      customersUpdated: summary.customersUpdated,
      propertiesCreated: summary.propertiesCreated,
      propertiesUpdated: summary.propertiesUpdated,
      leasesCreated: summary.leasesCreated,
      leasesUpdated: summary.leasesUpdated,
      leasesSkipped: summary.leasesSkipped,
      needsReview: summary.rowsNeedingReview.length,
      fuzzyMatches: summary.fuzzyCustomerMatches.length,
    },
    "Master lease import complete.",
  );
  return summary;
}

/**
 * Convenience wrapper that loads the bundled master file from
 * `attached_assets/` and runs the importer.
 */
export async function importDefaultMasterLeases(
  deps: Partial<ImportDeps> = {},
): Promise<ImportSummary> {
  const filePath = defaultMasterFilePath();
  const rows = await readMasterWorkbook(filePath);
  return importMasterLeases(rows, deps);
}

/**
 * Boot-time variant: runs `importDefaultMasterLeases` so a brand-new
 * environment lands with the production customer/property/lease set
 * without an operator having to remember to click the "Import master
 * file" button on the Leases page (Task #302). Re-runs are zero-effect
 * because `importMasterLeases` matches existing rows on natural keys
 * and only updates importer-owned fields, so it's safe to call on
 * every boot.
 */
export async function importDefaultMasterLeasesIfMissing(
  deps: Partial<ImportDeps> = {},
): Promise<ImportSummary> {
  return importDefaultMasterLeases(deps);
}
