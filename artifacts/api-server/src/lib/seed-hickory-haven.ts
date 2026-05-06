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

/**
 * Hickory Haven Apartments — 600 W Hickory St, Gilman, WI 54433.
 *
 * Four active KFI Staffing leases (Task #294), one per unit (6, 8,
 * 11, 12). Modeled the same way as Patriot Baraboo (Task #292):
 * a single property record for the building, four lease rows
 * differentiated by a "Unit N —" marker in `notes` for dedupe.
 *
 * Idempotent: customer reused if any "KFI Staffing%" already
 * exists, property reconciled by (customerId, address, zip), each
 * lease reconciled by (propertyId, startDate, endDate, "Unit N —"
 * marker). Never UPDATEs existing rows so operator edits survive.
 */

export const HICKORY_HAVEN_CUSTOMER_ID = "cust-kfi-hickory-haven";
export const HICKORY_HAVEN_PROPERTY_ID = "prop-hickory-haven-600-hickory";
export const hickoryHavenLeaseId = (unit: string): string =>
  `lease-hickory-haven-u${unit}`;

const KFI_CUSTOMER_NAME_DEFAULT = "KFI Staffing – Hickory Haven, WI";
const KFI_CUSTOMER_NAME_PATTERN = "KFI Staffing%";

const HICKORY_ADDRESS = "600 W Hickory St";
const HICKORY_CITY = "Gilman";
const HICKORY_STATE = "WI";
const HICKORY_ZIP = "54433";

interface HickoryHavenLeaseSpec {
  unit: string;
  startDate: string;
  endDate: string;
  monthlyRent: number;
  securityDeposit: number;
  proratedRent: number | null;
  source: string;
}

const HICKORY_HAVEN_LEASES: readonly HickoryHavenLeaseSpec[] = [
  {
    unit: "6",
    startDate: "2026-02-27",
    endDate: "2026-08-31",
    monthlyRent: 1075,
    securityDeposit: 1075,
    proratedRent: null,
    source: "Lease_Agreement_-_Unit_6_1778107900898.pdf",
  },
  {
    unit: "8",
    startDate: "2026-02-27",
    endDate: "2026-08-31",
    monthlyRent: 900,
    securityDeposit: 900,
    proratedRent: null,
    source: "Lease_Agreement_-_Unit_8_1778107900898.pdf",
  },
  {
    unit: "11",
    startDate: "2026-03-13",
    endDate: "2026-08-31",
    monthlyRent: 900,
    securityDeposit: 900,
    proratedRent: 551.61,
    source: "Lease_Agreement_-_Unit_11_1778107900898.pdf",
  },
  {
    unit: "12",
    startDate: "2026-03-13",
    endDate: "2026-08-31",
    monthlyRent: 1075,
    securityDeposit: 1075,
    proratedRent: 658.87,
    source: "Lease_Agreement_-_Unit_12_1778107900898.pdf",
  },
];

const TOTAL_MONTHLY_RENT = HICKORY_HAVEN_LEASES.reduce(
  (sum, lease) => sum + lease.monthlyRent,
  0,
);

function buildCustomerRow(id: string): InsertCustomerRow {
  return {
    id,
    name: KFI_CUSTOMER_NAME_DEFAULT,
    contactName: "",
    email: "hickory@lanyardstays.com",
    phone: "(646) 298-3419",
    notes:
      "KFI Staffing crew housing at Hickory Haven Apartments, 600 W Hickory St, " +
      "Gilman, WI 54433. Four active leases (units 6, 8, 11, 12) signed " +
      "Feb–Mar 2026 through 2026-08-31. Landlord: Hickory Haven Apartments LLC " +
      "(jnagelpcc@gmail.com, (715) 290-0025).",
  };
}

function buildPropertyRow(
  id: string,
  customerId: string,
): InsertPropertyRow {
  return {
    id,
    customerId,
    name: "Hickory Haven Apartments – Gilman, WI",
    address: HICKORY_ADDRESS,
    city: HICKORY_CITY,
    state: HICKORY_STATE,
    zip: HICKORY_ZIP,
    totalBeds: 0,
    monthlyRent: TOTAL_MONTHLY_RENT,
    chargePerBed: 0,
    status: "Active",
    landlordName: "Hickory Haven Apartments LLC",
    landlordEmail: "jnagelpcc@gmail.com",
    landlordPhone: "(715) 290-0025",
    paymentMethod: "ACH",
    paymentRecipient: "Hickory Haven Apartments LLC",
    paymentDueDay: 1,
    paymentNotes:
      "Rent due 1st of month; daily late fee $50 starting 5 days after due date. " +
      "NSF / returned check fee: $20. Mailing address: W15430 Old Hwy 194, " +
      "Sheldon, WI 54766.",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes:
      "4 active KFI Staffing units (6, 8, 11, 12) at this address. " +
      "Units 6 & 12: $1,075/mo each. Units 8 & 11: $900/mo each. " +
      "Units 6 & 8 term 2026-02-27 → 2026-08-31; units 11 & 12 term " +
      "2026-03-13 → 2026-08-31 with prorated first-month rent. " +
      "Tenant pays electricity, internet, cable/satellite, phone; landlord " +
      "covers gas, water, sewer, trash, snow removal, landscaping. " +
      "Certificate of Liability Insurance on file from M3 Insurance / " +
      "Philadelphia Indemnity covering units 6 & 8 (policy PHPK2653492, " +
      "term 2026-02-04 → 2027-02-04). Source PDF: " +
      "Hickory_Heavens_Apartments_KFI_Staffing_LLC_2627_All_Lines_(GL_1778107900898.pdf.",
    furnishings: [],
  };
}

function unitMarker(unit: string): string {
  return `Unit ${unit} —`;
}

function buildClauses(spec: HickoryHavenLeaseSpec): string {
  const parts = [
    `Tenant: KFI Staffing, Unit ${spec.unit} at 600 W Hickory St, Gilman, WI 54433.`,
    `Term: ${spec.startDate} → ${spec.endDate} (fixed term).`,
    `Monthly rent: $${spec.monthlyRent.toFixed(2)}, due 1st of month.`,
    `Security deposit: $${spec.securityDeposit.toFixed(2)}.`,
  ];
  if (spec.proratedRent !== null) {
    parts.push(`Prorated first-month rent: $${spec.proratedRent.toFixed(2)}.`);
  }
  parts.push(
    "Late fee: daily $50 starting 5 days after the due date.",
    "NSF / returned check fee: $20.",
    "Tenant pays electricity, internet, cable/satellite, and phone; landlord pays gas, water, sewer/septic, trash, snow removal, and landscaping.",
    "No smoking on the premises; no pets without written landlord consent.",
    "Early termination: 60 days' written notice; tenant pays a termination fee of one month's rent (or the maximum allowable by law).",
    "Landlord: Hickory Haven Apartments LLC, jnagelpcc@gmail.com, (715) 290-0025, mailing W15430 Old Hwy 194, Sheldon, WI 54766.",
    `Source document: ${spec.source}.`,
  );
  return parts.join(" ");
}

function buildLeaseRow(
  id: string,
  propertyId: string,
  spec: HickoryHavenLeaseSpec,
): InsertLeaseRow {
  const proratedNote =
    spec.proratedRent !== null
      ? ` Prorated first month: $${spec.proratedRent.toFixed(2)}.`
      : "";
  return {
    id,
    propertyId,
    startDate: spec.startDate,
    endDate: spec.endDate,
    monthlyRent: spec.monthlyRent,
    securityDeposit: spec.securityDeposit,
    status: "Active",
    notes:
      `${unitMarker(spec.unit)} KFI Staffing fixed-term lease at Hickory Haven ` +
      `Apartments, $${spec.monthlyRent.toFixed(2)}/mo.${proratedNote} ` +
      `Source: ${spec.source}`,
    clauses: buildClauses(spec),
    buyoutAvailable: false,
    buyoutCost: null,
  };
}

export interface SeedHickoryHavenResult {
  customerInserted: boolean;
  propertyInserted: boolean;
  leasesInserted: number;
}

export interface SeedHickoryHavenDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
}

export async function seedHickoryHavenIfMissing(
  deps: Partial<SeedHickoryHavenDeps> = {},
): Promise<SeedHickoryHavenResult> {
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
      customerId = HICKORY_HAVEN_CUSTOMER_ID;
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
          eq(propertiesTable.address, HICKORY_ADDRESS),
          eq(propertiesTable.zip, HICKORY_ZIP),
        ),
      )
      .limit(1);

    let propertyId: string;
    let propertyInserted = false;
    if (existingProperty.length > 0) {
      propertyId = existingProperty[0]!.id;
    } else {
      propertyId = HICKORY_HAVEN_PROPERTY_ID;
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
              eq(propertiesTable.address, HICKORY_ADDRESS),
              eq(propertiesTable.zip, HICKORY_ZIP),
            ),
          )
          .limit(1);
        if (reread.length > 0) propertyId = reread[0]!.id;
      }
    }

    let leasesInserted = 0;
    for (const spec of HICKORY_HAVEN_LEASES) {
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
        .values(buildLeaseRow(hickoryHavenLeaseId(spec.unit), propertyId, spec))
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
    log.info(result, "Hickory Haven seed applied.");
  }
  return result;
}
