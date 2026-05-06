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
import type { Logger } from "pino";

export const PATRIOT_BARABOO_CUSTOMER_ID = "cust-kfi-baraboo";
export const PATRIOT_BARABOO_PROPERTY_ID = "prop-patriot-baraboo-1850-pine";
export const patriotBarabooLeaseId = (unit: string): string =>
  `lease-patriot-baraboo-u${unit}`;

const KFI_CUSTOMER_NAME_DEFAULT = "KFI Staffing – Baraboo, WI";
const KFI_CUSTOMER_NAME_PATTERN = "KFI Staffing%";
const PATRIOT_ADDRESS = "1850 W. Pine St.";
const PATRIOT_CITY = "Baraboo";
const PATRIOT_STATE = "WI";
const PATRIOT_ZIP = "53913";
const PATRIOT_LEASE_START = "2025-09-30";
const PATRIOT_LEASE_END = "2026-08-31";
const PATRIOT_RENT = 1675;
const PATRIOT_DEPOSIT = 1675;

function buildCustomerRow(id: string): InsertCustomerRow {
  return {
    id,
    name: KFI_CUSTOMER_NAME_DEFAULT,
    contactName: "Valeria Alderman",
    email: "",
    phone: "",
    notes:
      "KFI Staffing corporate housing at 1850 W. Pine St., Baraboo, WI. " +
      "Five active 12-month leases (units 509, 510, 512, 811, 812) " +
      "managed by Patriot Properties for owner JCW Baraboo LLC. " +
      "Term 2025-09-30 → 2026-08-31, then month-to-month.",
  };
}

function buildPropertyRow(
  id: string,
  customerId: string,
): InsertPropertyRow {
  return {
    id,
    customerId,
    name: "1850 W. Pine St. – Baraboo, WI",
    address: PATRIOT_ADDRESS,
    city: PATRIOT_CITY,
    state: PATRIOT_STATE,
    zip: PATRIOT_ZIP,
    totalBeds: 0,
    monthlyRent: PATRIOT_RENT * 5,
    chargePerBed: 0,
    status: "Active",
    landlordName: "Patriot Properties",
    landlordEmail: "",
    landlordPhone: "(608) 849-6500",
    paymentMethod: "ACH",
    paymentRecipient: "JCW Baraboo LLC",
    paymentDueDay: 1,
    paymentNotes:
      "Owner/payee: JCW Baraboo LLC. Manager: Patriot Properties, " +
      "204 Moravian Valley Rd Suite N, Waunakee, WI 53597, (608) 849-6500.",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes:
      "5 active KFI Staffing units (509, 510, 512, 811, 812) at this address; " +
      "each $1,675/mo base rent + $10.50 LLI + $4.50 insurance compliance " +
      "admin = $1,690 billed. Term 2025-09-30 → 2026-08-31, then " +
      "month-to-month. Up to 4 adults per unit. KFI to notify Patriot " +
      "Properties of any tenant changes. List_of_Tenants PDF was " +
      "image-only and could not be parsed — re-upload a typed roster to " +
      "attach individual occupants.",
    furnishings: [],
  };
}

interface PatriotBarabooLeaseSpec {
  unit: string;
  source: string;
}

// Verbatim filenames of the source lease PDFs from Task #292.
const PATRIOT_BARABOO_LEASES: readonly PatriotBarabooLeaseSpec[] = [
  { unit: "509", source: "Lease_Agreement_-_509_1778107818114.pdf" },
  { unit: "510", source: "Lease_Agreement_-_510_1778107818114.pdf" },
  { unit: "512", source: "Lease_Agreement_-_512_1778107818114.pdf" },
  { unit: "811", source: "Lease_Agreement_-_811_1778107818114.pdf" },
  { unit: "812", source: "Lease_Agreement_-_812_1778107818114.pdf" },
];

function unitMarker(unit: string): string {
  return `Unit ${unit} —`;
}

function buildClauses(spec: PatriotBarabooLeaseSpec): string {
  return [
    `Tenant: KFI Staffing (corporate housing), Unit ${spec.unit} at 1850 W. Pine St., Baraboo, WI 53913.`,
    "Signer: Valeria Alderman on behalf of KFI Staffing.",
    "Base monthly rent: $1,675.00. Total billed: $1,690.00 ($1,675 rent + $10.50 LLI + $4.50 insurance compliance admin).",
    "Concession: $1,675 off first month rent; LLI fee waived with proof of renter's insurance.",
    "Security deposit: $1,675.00.",
    "Late fee: 5% of monthly rent after a 5-day grace period.",
    "NSF / returned check fee: $35.00. Paper check processing fee: $25.00.",
    "Occupancy: up to 4 adults, 0 minors.",
    "Term: 2025-09-30 → 2026-08-31, then month-to-month.",
    "Move-in: 2025-09-30.",
    "Manager: Patriot Properties, 204 Moravian Valley Rd Suite N, Waunakee, WI 53597, (608) 849-6500.",
    "Owner (payee): JCW Baraboo LLC.",
    `Source document: ${spec.source}`,
  ].join(" ");
}

function buildLeaseRow(
  id: string,
  propertyId: string,
  spec: PatriotBarabooLeaseSpec,
): InsertLeaseRow {
  return {
    id,
    propertyId,
    startDate: PATRIOT_LEASE_START,
    endDate: PATRIOT_LEASE_END,
    monthlyRent: PATRIOT_RENT,
    securityDeposit: PATRIOT_DEPOSIT,
    status: "Active",
    notes:
      `${unitMarker(spec.unit)} 12-month corporate lease; KFI to notify ` +
      `Patriot Properties of any tenant changes. Total billed $1,690 ` +
      `($1,675 rent + $10.50 LLI + $4.50 insurance admin). ` +
      `Source: ${spec.source}`,
    clauses: buildClauses(spec),
    buyoutAvailable: false,
    buyoutCost: null,
  };
}

export interface SeedPatriotBarabooResult {
  customerInserted: boolean;
  propertyInserted: boolean;
  leasesInserted: number;
}

export interface SeedPatriotBarabooDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
}

/**
 * Idempotently seed the KFI Staffing customer (reused if any "KFI
 * Staffing%" customer already exists), the 1850 W. Pine St. Baraboo
 * property, and 5 active leases for units 509, 510, 512, 811, 812.
 * Reconciles by natural keys: customer by name LIKE 'KFI Staffing%',
 * property by (customerId, address, zip), lease by
 * (propertyId, startDate, endDate, "Unit N —" marker in notes). Never
 * UPDATEs existing rows.
 */
export async function seedPatriotBarabooIfMissing(
  deps: Partial<SeedPatriotBarabooDeps> = {},
): Promise<SeedPatriotBarabooResult> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;

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
      customerId = PATRIOT_BARABOO_CUSTOMER_ID;
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
          eq(propertiesTable.address, PATRIOT_ADDRESS),
          eq(propertiesTable.zip, PATRIOT_ZIP),
        ),
      )
      .limit(1);

    let propertyId: string;
    let propertyInserted = false;
    if (existingProperty.length > 0) {
      propertyId = existingProperty[0]!.id;
    } else {
      propertyId = PATRIOT_BARABOO_PROPERTY_ID;
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
              eq(propertiesTable.address, PATRIOT_ADDRESS),
              eq(propertiesTable.zip, PATRIOT_ZIP),
            ),
          )
          .limit(1);
        if (reread.length > 0) propertyId = reread[0]!.id;
      }
    }

    let leasesInserted = 0;
    for (const spec of PATRIOT_BARABOO_LEASES) {
      const existing = await tx
        .select({ id: leasesTable.id })
        .from(leasesTable)
        .where(
          and(
            eq(leasesTable.propertyId, propertyId),
            eq(leasesTable.startDate, PATRIOT_LEASE_START),
            eq(leasesTable.endDate, PATRIOT_LEASE_END),
            like(leasesTable.notes, `%${unitMarker(spec.unit)}%`),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;

      const inserted = await tx
        .insert(leasesTable)
        .values(
          buildLeaseRow(patriotBarabooLeaseId(spec.unit), propertyId, spec),
        )
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
    log.info(result, "Patriot Baraboo seed applied.");
  }
  return result;
}
