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

export const KOLBE_WAUSAU_CUSTOMER_ID = "cust-kfi-wausau";
export const KOLBE_WAUSAU_PROPERTY_ID = "prop-kolbe-wausau-s-8th-ave";
export const kolbeWausauLeaseId = (unit: string): string =>
  `lease-kolbe-wausau-apt${unit}`;

const KFI_CUSTOMER_NAME_DEFAULT = "KFI Staffing – Wausau, WI";
const KFI_CUSTOMER_NAME_PATTERN = "KFI Staffing%";
const KOLBE_ADDRESS = "1331 South 8th Ave";
const KOLBE_CITY = "Wausau";
const KOLBE_STATE = "WI";
const KOLBE_ZIP = "54401";

interface KolbeLeaseSpec {
  unit: string;
  buildingAddress: string;
  startDate: string;
  endDate: string;
  monthlyRent: number;
  securityDeposit: number;
  source: string;
}

const KOLBE_LEASES: readonly KolbeLeaseSpec[] = [
  {
    unit: "108",
    buildingAddress: "1341 South 8th Ave",
    startDate: "2026-05-01",
    endDate: "2026-10-31",
    monthlyRent: 1410,
    securityDeposit: 1000,
    source:
      "Lease_-1341_South_8th_Ave_Apt_1_Wausau,_WI_-_54401_kfi-staffin_1778107848648.pdf",
  },
  {
    unit: "200",
    buildingAddress: "1331 South 8th Ave",
    startDate: "2026-03-27",
    endDate: "2026-09-26",
    monthlyRent: 1849,
    securityDeposit: 1000,
    source:
      "Lease_-1331_South_8th_Ave_Apt_200_Wausau,_WI_-_54401_kfi-staff_1778107848648.pdf",
  },
];

function buildCustomerRow(id: string): InsertCustomerRow {
  return {
    id,
    name: KFI_CUSTOMER_NAME_DEFAULT,
    contactName: "",
    email: "",
    phone: "",
    notes:
      "KFI Staffing crew housing at Kolbe Apartments LLC in Wausau, WI " +
      "(1331 & 1341 South 8th Ave). Two active 6-month leases, Apt 108 " +
      "and Apt 200. Landlord/payee: Kolbe Apartments LLC; managed by " +
      "Lokre Companies (P.O. Box 215, Plover WI 54467, 715-342-9200).",
    state: KOLBE_STATE,
  };
}

function buildPropertyRow(
  id: string,
  customerId: string,
): InsertPropertyRow {
  return {
    id,
    customerId,
    name: "Kolbe Apartments – Wausau, WI",
    address: KOLBE_ADDRESS,
    city: KOLBE_CITY,
    state: KOLBE_STATE,
    zip: KOLBE_ZIP,
    totalBeds: 0,
    monthlyRent: 1410 + 1849,
    chargePerBed: 0,
    status: "Active",
    landlordName: "Kolbe Apartments LLC",
    landlordEmail: "",
    landlordPhone: "715-342-9200",
    paymentMethod: "Check",
    paymentRecipient: "Kolbe Apartments LLC",
    paymentDueDay: 1,
    paymentNotes:
      "Rent due 1st of month, payable to Kolbe Apartments LLC; pay via " +
      "online resident portal, mailed check, or drop box at the manager's " +
      "office. Late fee: $75 flat after the 5th. NSF / returned payment fee: $25.",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes:
      "Kolbe Apartments complex in Wausau, WI 54401. Two active KFI " +
      "Staffing units: Apt 108 at 1341 South 8th Ave ($1,410/mo, 05/01–" +
      "10/31/2026) and Apt 200 at 1331 South 8th Ave ($1,849/mo, 03/27–" +
      "09/26/2026). Landlord pays gas, water/sewer, internet, trash; " +
      "tenant pays electric (Wisconsin Public Service). Managed by Lokre " +
      "Companies, P.O. Box 215, Plover WI 54467, (715) 342-9200.",
    furnishings: [],
  };
}

function unitMarker(unit: string): string {
  return `Apt ${unit} —`;
}

function buildClauses(spec: KolbeLeaseSpec): string {
  return [
    `Tenant: KFI Staffing LLC at ${spec.buildingAddress}, Apt ${spec.unit}, Wausau, WI 54401.`,
    `Landlord/payee: Kolbe Apartments LLC (managed by Lokre Companies, 715-342-9200).`,
    `Term: ${spec.startDate} → ${spec.endDate}; auto-converts to month-to-month if no 30-day notice.`,
    `Monthly rent: $${spec.monthlyRent.toFixed(2)}, due 1st of month; pay via portal, check, or drop box.`,
    `Security deposit: $${spec.securityDeposit.toFixed(2)}.`,
    "Late fee: $75 flat if rent unpaid by end of business on the 5th.",
    "NSF / returned payment fee: $25 plus any bank charges.",
    "Utilities: landlord pays gas, water/sewer, internet, trash. Tenant pays electric (Wisconsin Public Service).",
    "Appliances supplied: refrigerator, stove/oven, dishwasher, microwave.",
    "No smoking inside; pets only with written consent ($25/mo pet rent, max 2, dogs ≤75 lb).",
    `Source document: ${spec.source}`,
  ].join(" ");
}

function buildLeaseRow(
  id: string,
  propertyId: string,
  spec: KolbeLeaseSpec,
): InsertLeaseRow {
  return {
    id,
    propertyId,
    startDate: spec.startDate,
    endDate: spec.endDate,
    monthlyRent: spec.monthlyRent,
    securityDeposit: spec.securityDeposit,
    status: "Active",
    notes:
      `${unitMarker(spec.unit)} ${spec.buildingAddress}, Wausau WI 54401. ` +
      `KFI Staffing LLC; 6-month lease ${spec.startDate} → ${spec.endDate}. ` +
      `Source: ${spec.source}`,
    clauses: buildClauses(spec),
    buyoutAvailable: false,
    buyoutCost: null,
  };
}

export interface SeedKolbeWausauResult {
  customerInserted: boolean;
  propertyInserted: boolean;
  leasesInserted: number;
}

export interface SeedKolbeWausauDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
}

/**
 * Idempotently seed the KFI Staffing customer (reused if any "KFI
 * Staffing%" customer already exists), the Kolbe Apartments property
 * in Wausau WI, and two active leases (Apt 108 at 1341 S 8th Ave and
 * Apt 200 at 1331 S 8th Ave). Reconciles by natural keys: customer by
 * name LIKE 'KFI Staffing%', property by (customerId, address, zip),
 * lease by (propertyId, startDate, endDate, "Apt N —" marker in
 * notes). Never UPDATEs existing rows. Task #291.
 */
export async function seedKolbeWausauIfMissing(
  deps: Partial<SeedKolbeWausauDeps> = {},
): Promise<SeedKolbeWausauResult> {
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
      customerId = KOLBE_WAUSAU_CUSTOMER_ID;
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
          eq(propertiesTable.address, KOLBE_ADDRESS),
          eq(propertiesTable.zip, KOLBE_ZIP),
        ),
      )
      .limit(1);

    let propertyId: string;
    let propertyInserted = false;
    if (existingProperty.length > 0) {
      propertyId = existingProperty[0]!.id;
    } else {
      propertyId = KOLBE_WAUSAU_PROPERTY_ID;
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
              eq(propertiesTable.address, KOLBE_ADDRESS),
              eq(propertiesTable.zip, KOLBE_ZIP),
            ),
          )
          .limit(1);
        if (reread.length > 0) propertyId = reread[0]!.id;
      }
    }

    let leasesInserted = 0;
    for (const spec of KOLBE_LEASES) {
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
        .values(buildLeaseRow(kolbeWausauLeaseId(spec.unit), propertyId, spec))
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
    log.info(result, "Kolbe Wausau seed applied.");
  }
  return result;
}
