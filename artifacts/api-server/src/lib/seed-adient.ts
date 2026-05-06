import { and, eq, like } from "drizzle-orm";
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
import { computeLeaseStatus, todayIso } from "./lease-status";
import type { Logger } from "pino";

export const ADIENT_CUSTOMER_ID = "cust-adient";
export const ADIENT_PROPERTY_ID = "prop-adient-versailles";
export const adientLeaseId = (unit: number): string =>
  `lease-adient-versailles-u${unit}`;

const ADIENT_CUSTOMER_NAME = "Adient";
const ADIENT_ADDRESS = "308 Fairgrounds Rd";
const ADIENT_CITY = "Versailles";
const ADIENT_STATE = "MO";
const ADIENT_ZIP = "65084";
const ADIENT_LEASE_START = "2025-05-01";
const ADIENT_LEASE_END = "2025-10-31";

function buildCustomerRow(id: string): InsertCustomerRow {
  return {
    id,
    name: ADIENT_CUSTOMER_NAME,
    contactName: "",
    email: "",
    phone: "",
    notes:
      "KFI Staffing crew housing at the Versailles, MO property. Historical 2024 " +
      "leases for Units 3, 4, 6, 7, 8, 19, 20 are NOT loaded — only the current " +
      "5/1/2025 renewals are tracked here. See the property record for the full " +
      "history note.",
  };
}

function buildPropertyRow(
  id: string,
  customerId: string,
): InsertPropertyRow {
  return {
    id,
    customerId,
    name: "308 Fairgrounds Rd – Versailles, MO",
    address: ADIENT_ADDRESS,
    city: ADIENT_CITY,
    state: ADIENT_STATE,
    zip: ADIENT_ZIP,
    totalBeds: 0,
    monthlyRent: 5000,
    chargePerBed: 0,
    status: "Active",
    landlordName: "Dunn Property Management LLC",
    landlordEmail: "",
    landlordPhone: "",
    paymentMethod: "ACH",
    paymentRecipient: "Dunn Property Management LLC",
    paymentDueDay: 1,
    paymentNotes: "",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes:
      "5 active KFI Staffing units (3, 4, 7, 8, 19) at this address; each $1,000/mo, " +
      "term 2025-05-01 → 2025-10-31. Utilities (trash, lawn, electric, water) " +
      "included; tenant pays cable/internet (no satellite dish). Auto-converts to " +
      "month-to-month after 10/31/2025 unless either party gives 30-day notice. " +
      "STALE ENTRY FLAG: any prior portfolio reference to an Econolodge Hotel / " +
      "Jefferson City record for this customer is superseded — this is the live " +
      "property of record. See the KFI Staffing Versailles & Eldon Reservation " +
      "Summary for occupant-level detail. History (NOT loaded as separate lease " +
      "rows): 2024 originals (Units 3, 4, 20: 5/2/2024; Units 6, 7, 8: 5/14/2024; " +
      "Unit 19: 7/8/2024) and the 8/22/2024 swap amendments (#8 ↔ #20) are all " +
      "superseded by these 5/1/2025 renewals.",
    furnishings: [],
  };
}

interface AdientLeaseSpec {
  unit: number;
  deposit: number;
  source: string;
}

// Verbatim filenames of the source lease PDFs from Task #283.
const ADIENT_LEASES: readonly AdientLeaseSpec[] = [
  { unit: 3,  deposit: 0,    source: "Lease_Agreement_-_308_Fairground_Unit_3_1778105368416.pdf" },
  { unit: 4,  deposit: 1000, source: "Lease_Agreement_-_308_Fairground_Unit_4_1778105368416.pdf" },
  { unit: 7,  deposit: 0,    source: "Lease_Agreement_-_308_Fairground_Unit_7_1778105368416.pdf" },
  { unit: 8,  deposit: 1000, source: "Lease_Agreement_-_308_Fairground_Unit_8_1778105368417.pdf" },
  { unit: 19, deposit: 1000, source: "Lease_Agreement_-_308_Fairground_Unit_19_1778105368416.pdf" },
];

// Per-unit text marker used both when writing the notes and when looking
// up an existing lease via SQL LIKE.
function unitMarker(unit: number): string {
  return `Unit ${unit} —`;
}

function buildAdientClauses(spec: AdientLeaseSpec): string {
  return [
    `Tenant: KFI Staffing (corporate housing for Adient employees), Unit ${spec.unit}.`,
    "Late fee: $100 if rent unpaid after the 5th of the month at 4:00 PM.",
    "Returned check fee: $100.",
    "Landlord covers trash, lawn care, electric, and water.",
    "Tenant pays cable and internet (no satellite dish allowed).",
    "Quarterly inspections and HVAC filter changes by landlord with 24-hour notice.",
    "Auto-converts to month-to-month after 10/31/2025 unless either party gives 30-day notice.",
    "No assignment or sublet without written landlord consent.",
    `Source document: ${spec.source}`,
    "History: 2024 originals (Units 3, 4, 20: 5/2/2024; Units 6, 7, 8: 5/14/2024; Unit 19: 7/8/2024) and the 8/22/2024 swap amendments (#8 ↔ #20) are superseded by this 5/1/2025 renewal.",
  ].join(" ");
}

function buildLeaseRow(
  id: string,
  propertyId: string,
  spec: AdientLeaseSpec,
  status: "Active" | "Expired" | "Upcoming",
): InsertLeaseRow {
  return {
    id,
    propertyId,
    startDate: ADIENT_LEASE_START,
    endDate: ADIENT_LEASE_END,
    monthlyRent: 1000,
    securityDeposit: spec.deposit,
    status,
    notes:
      `${unitMarker(spec.unit)} KFI Staffing (Adient). Utilities (trash/lawn/electric/water) ` +
      "included; tenant pays cable/internet. Late fee $100 after the 5th @ 4pm. " +
      "Auto-MTM after 10/31/2025.",
    clauses: buildAdientClauses(spec),
    buyoutAvailable: false,
    buyoutCost: null,
  };
}

export interface SeedAdientResult {
  customerInserted: boolean;
  propertyInserted: boolean;
  leasesInserted: number;
}

export interface SeedAdientDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
  now: () => Date;
}

/**
 * Idempotently seed the Adient customer + Versailles property + 5 active
 * leases for Units 3, 4, 7, 8, 19. Reconciles by natural keys: customer
 * by name, property by (customerId, address, zip), lease by
 * (propertyId, startDate, endDate, "Unit N —" marker in notes). Never
 * UPDATEs existing rows.
 */
export async function seedAdientIfMissing(
  deps: Partial<SeedAdientDeps> = {},
): Promise<SeedAdientResult> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;
  const today = todayIso((deps.now ?? (() => new Date()))());
  const status = computeLeaseStatus(ADIENT_LEASE_START, ADIENT_LEASE_END, today);

  const result = await database.transaction(async (tx) => {
    const existingCustomer = await tx
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(eq(customersTable.name, ADIENT_CUSTOMER_NAME))
      .limit(1);

    let customerId: string;
    let customerInserted = false;
    if (existingCustomer.length > 0) {
      customerId = existingCustomer[0]!.id;
    } else {
      customerId = ADIENT_CUSTOMER_ID;
      const inserted = await tx
        .insert(customersTable)
        .values(buildCustomerRow(customerId))
        .onConflictDoNothing()
        .returning({ id: customersTable.id });
      customerInserted = inserted.length > 0;
      if (!customerInserted) {
        const reread = await tx
          .select({ id: customersTable.id })
          .from(customersTable)
          .where(eq(customersTable.name, ADIENT_CUSTOMER_NAME))
          .limit(1);
        if (reread.length > 0) customerId = reread[0]!.id;
      }
    }

    const existingProperty = await tx
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(
        and(
          eq(propertiesTable.customerId, customerId),
          eq(propertiesTable.address, ADIENT_ADDRESS),
          eq(propertiesTable.zip, ADIENT_ZIP),
        ),
      )
      .limit(1);

    let propertyId: string;
    let propertyInserted = false;
    if (existingProperty.length > 0) {
      propertyId = existingProperty[0]!.id;
    } else {
      propertyId = ADIENT_PROPERTY_ID;
      const inserted = await tx
        .insert(propertiesTable)
        .values(buildPropertyRow(propertyId, customerId))
        .onConflictDoNothing()
        .returning({ id: propertiesTable.id });
      propertyInserted = inserted.length > 0;
      if (!propertyInserted) {
        const reread = await tx
          .select({ id: propertiesTable.id })
          .from(propertiesTable)
          .where(
            and(
              eq(propertiesTable.customerId, customerId),
              eq(propertiesTable.address, ADIENT_ADDRESS),
              eq(propertiesTable.zip, ADIENT_ZIP),
            ),
          )
          .limit(1);
        if (reread.length > 0) propertyId = reread[0]!.id;
      }
    }

    let leasesInserted = 0;
    for (const spec of ADIENT_LEASES) {
      const existing = await tx
        .select({ id: leasesTable.id })
        .from(leasesTable)
        .where(
          and(
            eq(leasesTable.propertyId, propertyId),
            eq(leasesTable.startDate, ADIENT_LEASE_START),
            eq(leasesTable.endDate, ADIENT_LEASE_END),
            like(leasesTable.notes, `%${unitMarker(spec.unit)}%`),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;

      const inserted = await tx
        .insert(leasesTable)
        .values(buildLeaseRow(adientLeaseId(spec.unit), propertyId, spec, status))
        .onConflictDoNothing()
        .returning({ id: leasesTable.id });
      if (inserted.length > 0) leasesInserted += 1;
    }

    return { customerInserted, propertyInserted, leasesInserted };
  });

  if (
    result.customerInserted ||
    result.propertyInserted ||
    result.leasesInserted > 0
  ) {
    log.info(result, "Adient seed applied.");
  }
  return result;
}
