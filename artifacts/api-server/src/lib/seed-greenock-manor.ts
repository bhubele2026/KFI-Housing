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
import { repointFallbackToEndClient } from "./seed-fallback-repoint";
import type { Logger } from "pino";

/**
 * Idempotent seed for the 6 active Greenock Manor (Mick's Properties LLC,
 * McKeesport PA) leases attached to Task #293. Reconciles by natural keys:
 * customer by name LIKE 'KFI Staffing%', property by
 * (customerId, address, zip), lease by (propertyId, startDate, endDate,
 * "Unit N —" marker in notes). Never UPDATEs existing rows.
 *
 * Expired Janet Johnson 918 Zimmer Hill Road leases and the original
 * 12/01/2024 Unit 32 lease (superseded by the 12/01/2025 amendment) are
 * intentionally skipped — see the task description for the full list.
 */

export const GREENOCK_MANOR_CUSTOMER_ID = "cust-kfi-greenock-manor";
export const GREENOCK_MANOR_PROPERTY_ID = "prop-greenock-manor-mckeesport";
export const greenockManorLeaseId = (unit: string): string =>
  `lease-greenock-manor-u${unit}`;

const KFI_CUSTOMER_NAME_DEFAULT = "KFI Staffing – Greenock Manor, PA";
const KFI_CUSTOMER_NAME_PATTERN = "KFI Staffing%";
/**
 * Real downstream end-client per master file row 30 (`Shuster's - Irwin,
 * PA`). The master file pins units 32, 36, 42, 48, 49, 52 — exactly the
 * six units this seed manages — to Shuster's, so the property as a
 * whole is repointed to Shuster's when present (Task #328).
 */
const GREENOCK_MANOR_END_CLIENT_NAME_PATTERN = "Shuster's%";

const PROPERTY_NAME = "Greenock Manor – McKeesport, PA";
const PROPERTY_ADDRESS = "900 Seneca Court";
const PROPERTY_CITY = "McKeesport";
const PROPERTY_STATE = "PA";
const PROPERTY_ZIP = "15135";

const LANDLORD_NAME = "Mick's Properties, LLC";
const LANDLORD_PHONE = "(412) 208-4262";
const LANDLORD_ADDRESS_NOTE =
  "446 Chapeldale Dr, Apollo, PA 15613";

interface GreenockLeaseSpec {
  unit: string;
  street: string;
  signer: string;
  startDate: string;
  endDate: string;
  monthlyRent: number;
  securityDeposit: number;
  source: string;
  extraNote?: string;
}

const LEASES: readonly GreenockLeaseSpec[] = [
  {
    unit: "52",
    street: "924 Seneca Court",
    signer: "KFI Staffing",
    startDate: "2026-03-20",
    endDate: "2027-03-19",
    monthlyRent: 950,
    securityDeposit: 950,
    source: "Lease_Agreement_-_Greenock_Manor_Unit_52_1778107866271.pdf",
  },
  {
    unit: "32",
    street: "900 Seneca Court",
    signer: "Valerie Alderman (KFI Staffing)",
    startDate: "2025-12-01",
    endDate: "2026-11-30",
    monthlyRent: 950,
    securityDeposit: 895,
    source:
      "Lease_Agreement_-_Greenock_Manor_Unit_32_-_11_30_26_1778107866271.pdf",
    extraNote:
      "Amended lease: original 12/01/2024 start was superseded by this 12/01/2025 → 11/30/2026 amendment.",
  },
  {
    unit: "36",
    street: "900 Seneca Court",
    signer: "Valerie Alderman (KFI Staffing)",
    startDate: "2025-11-01",
    endDate: "2026-10-31",
    monthlyRent: 950,
    securityDeposit: 895,
    source:
      "Lease_Agreement_-_Greenock_Manor_Unit_36_-_10_31_26.pdf_1778107866271.pdf",
  },
  {
    unit: "42",
    street: "900 Seneca Court",
    signer: "KFI Staffing",
    startDate: "2026-02-06",
    endDate: "2026-12-31",
    monthlyRent: 950,
    securityDeposit: 950,
    source:
      "Lease_Agreement_-_Greenock_Manor_Unit_42_12-31-26_1778107866272.pdf",
  },
  {
    unit: "48",
    street: "900 Seneca Court",
    signer: "Valerie Alderman (KFI Staffing)",
    startDate: "2025-11-01",
    endDate: "2026-10-31",
    monthlyRent: 950,
    securityDeposit: 895,
    source:
      "Lease_Agreement_-_Greenock_Manor_Unit_48_-_10_31_26_1778107866272.pdf",
  },
  {
    unit: "49",
    street: "900 Seneca Court",
    signer: "Valerie Alderman (KFI Staffing)",
    startDate: "2025-11-01",
    endDate: "2026-10-31",
    monthlyRent: 950,
    securityDeposit: 895,
    source:
      "Lease_Agreement_-_Greenock_Manor_Unit_49_-_10_31_26_1778107866271.pdf_",
    extraNote:
      "Source PDF was image-only and could not be parsed; values transcribed from Task #293 description (renewed/active version).",
  },
];

function unitMarker(unit: string): string {
  return `Unit ${unit} —`;
}

function buildCustomerRow(id: string): InsertCustomerRow {
  return {
    id,
    name: KFI_CUSTOMER_NAME_DEFAULT,
    contactName: "Valerie Alderman",
    email: "valderman@kfistaffing.com",
    phone: "",
    notes:
      "KFI Staffing corporate housing at Greenock Manor (Mick's Properties LLC), " +
      "McKeesport, PA 15135. Six active leases across 900 Seneca Court " +
      "(units 32, 36, 42, 48, 49) and 924 Seneca Court (unit 52).",
  };
}

function buildPropertyRow(
  id: string,
  customerId: string,
): InsertPropertyRow {
  return {
    id,
    customerId,
    name: PROPERTY_NAME,
    address: PROPERTY_ADDRESS,
    city: PROPERTY_CITY,
    state: PROPERTY_STATE,
    zip: PROPERTY_ZIP,
    totalBeds: 0,
    monthlyRent: 950 * 6,
    chargePerBed: 0,
    status: "Active",
    landlordName: LANDLORD_NAME,
    landlordEmail: "",
    landlordPhone: LANDLORD_PHONE,
    paymentMethod: "Check",
    paymentRecipient: LANDLORD_NAME,
    paymentDueDay: 1,
    paymentNotes:
      `Manager: ${LANDLORD_NAME}, ${LANDLORD_ADDRESS_NOTE}, ${LANDLORD_PHONE}. ` +
      "Rent due 1st of month; 10% late fee after the 5th, additional 5% after the 20th. " +
      "$40 NSF / returned-check fee.",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes:
      "Greenock Manor complex managed by Mick's Properties LLC. Six active " +
      "KFI Staffing units: 900 Seneca Court #32, #36, #42, #48, #49 and " +
      "924 Seneca Court #52, all McKeesport, PA 15135. 2BR/1BA apartments " +
      "with range, fridge, dishwasher; landlord pays water/sewage/trash, " +
      "tenant pays all other utilities.",
    furnishings: [],
  };
}

function buildClauses(spec: GreenockLeaseSpec): string {
  return [
    `Tenant: ${spec.signer} (KFI Staffing corporate housing).`,
    `Unit: ${spec.street} - Apt. ${spec.unit}, McKeesport, PA 15135.`,
    `Term: ${spec.startDate} → ${spec.endDate} (12-month lease, auto-renews if no 60-day notice).`,
    `Monthly rent: $${spec.monthlyRent.toFixed(2)}, due 1st of month.`,
    `Security deposit: $${spec.securityDeposit.toFixed(2)}.`,
    "Late fee: 10% of rent after the 5th, additional 5% after the 20th. NSF / returned check fee: $40.",
    "Utilities: landlord pays water/sewage/trash; tenant pays all others (must be transferred within 1 day or $50 fee).",
    "Appliances included: range, fridge, dishwasher.",
    "Move-out: 60-day notice required; lease forfeit + remaining-rent liability if broken early.",
    `Landlord: ${LANDLORD_NAME}, ${LANDLORD_ADDRESS_NOTE}, ${LANDLORD_PHONE}.`,
    `Source document: ${spec.source}.`,
  ].join(" ");
}

function buildLeaseRow(
  id: string,
  propertyId: string,
  spec: GreenockLeaseSpec,
  today: string,
): InsertLeaseRow {
  const extra = spec.extraNote ? ` ${spec.extraNote}` : "";
  return {
    id,
    propertyId,
    startDate: spec.startDate,
    endDate: spec.endDate,
    monthlyRent: spec.monthlyRent,
    securityDeposit: spec.securityDeposit,
    status: computeLeaseStatus(spec.startDate, spec.endDate, today),
    notes:
      `${unitMarker(spec.unit)} ${spec.street} Apt. ${spec.unit}, ` +
      `McKeesport PA 15135 — KFI Staffing (signer: ${spec.signer}). ` +
      `12-month lease, $${spec.monthlyRent}/mo, ` +
      `$${spec.securityDeposit} deposit.${extra} ` +
      `Source: ${spec.source}`,
    clauses: buildClauses(spec),
    buyoutAvailable: false,
    buyoutCost: null,
  };
}

export interface SeedGreenockManorResult {
  customerInserted: boolean;
  propertyInserted: boolean;
  leasesInserted: number;
  /** Customer the property is attached to after this run. */
  customerId: string;
  /** True when the property was repointed from a KFI Staffing fallback to
   *  the real Shuster's end-client during this run. */
  repointedToEndClient: boolean;
  /** True when the now-orphaned `cust-kfi-greenock-manor` fallback
   *  customer was deleted during this run. */
  fallbackCustomerDeleted: boolean;
}

export interface SeedGreenockManorDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
  now: () => Date;
}

export async function seedGreenockManorIfMissing(
  deps: Partial<SeedGreenockManorDeps> = {},
): Promise<SeedGreenockManorResult> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;
  const today = todayIso((deps.now ?? (() => new Date()))());

  const result = await database.transaction(async (tx) => {
    const existingCustomer = await tx
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(like(customersTable.name, KFI_CUSTOMER_NAME_PATTERN))
      .limit(1);

    let customerId: string;
    let customerInserted = false;
    if (existingCustomer.length > 0) {
      customerId = existingCustomer[0]!.id;
    } else {
      customerId = GREENOCK_MANOR_CUSTOMER_ID;
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
          .where(like(customersTable.name, KFI_CUSTOMER_NAME_PATTERN))
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
          eq(propertiesTable.address, PROPERTY_ADDRESS),
          eq(propertiesTable.zip, PROPERTY_ZIP),
        ),
      )
      .limit(1);

    let propertyId: string;
    let propertyInserted = false;
    if (existingProperty.length > 0) {
      propertyId = existingProperty[0]!.id;
    } else {
      propertyId = GREENOCK_MANOR_PROPERTY_ID;
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
              eq(propertiesTable.address, PROPERTY_ADDRESS),
              eq(propertiesTable.zip, PROPERTY_ZIP),
            ),
          )
          .limit(1);
        if (reread.length > 0) propertyId = reread[0]!.id;
      }
    }

    let leasesInserted = 0;
    for (const spec of LEASES) {
      const existing = await tx
        .select({ id: leasesTable.id })
        .from(leasesTable)
        .where(
          and(
            eq(leasesTable.propertyId, propertyId),
            eq(leasesTable.startDate, spec.startDate),
            eq(leasesTable.endDate, spec.endDate),
            like(leasesTable.notes, `%${unitMarker(spec.unit)}%`),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;

      const inserted = await tx
        .insert(leasesTable)
        .values(buildLeaseRow(greenockManorLeaseId(spec.unit), propertyId, spec, today))
        .onConflictDoNothing()
        .returning({ id: leasesTable.id });
      if (inserted.length > 0) leasesInserted += 1;
    }

    // Task #328: repoint AWAY from any KFI Staffing fallback customer
    // to the real Shuster's end-client when present, and clean up the
    // orphaned fallback customer.
    const repoint = await repointFallbackToEndClient({
      tx,
      propertyId,
      currentCustomerId: customerId,
      endClientNamePattern: GREENOCK_MANOR_END_CLIENT_NAME_PATTERN,
      fallbackNamePattern: KFI_CUSTOMER_NAME_PATTERN,
      fallbackCustomerId: GREENOCK_MANOR_CUSTOMER_ID,
    });

    return {
      customerInserted,
      propertyInserted,
      leasesInserted,
      customerId: repoint.customerId,
      repointedToEndClient: repoint.repointedToEndClient,
      fallbackCustomerDeleted: repoint.fallbackCustomerDeleted,
    };
  });

  if (
    result.customerInserted ||
    result.propertyInserted ||
    result.leasesInserted > 0 ||
    result.repointedToEndClient ||
    result.fallbackCustomerDeleted
  ) {
    log.info(result, "Greenock Manor seed applied.");
  }
  return result;
}
