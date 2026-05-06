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
 * Active leases extracted from the lease PDFs attached to the project but
 * never yet loaded into the DB. Mirrors `seed-adient.ts`: idempotent,
 * natural-key reconciled, never UPDATEs existing rows. Only readable,
 * currently-active leases are seeded — image-only / signature-page-only /
 * empty-placeholder PDFs are intentionally skipped (see Task #287).
 */

const KFI_WEBSTER_CUSTOMER_ID = "cust-kfi-webster";
const AUTOZONE_JEANNETTE_CUSTOMER_ID = "cust-autozone-jeannette";

const ZIELSDORF_PROPERTY_ID = "prop-zielsdorf-webster";
const AUTOZONE_HOUSE_PROPERTY_ID = "prop-autozone-6481-us30";
const YELLOW_HOUSE_PROPERTY_ID = "prop-yellow-house-6454-us30";

const ZIELSDORF_LEASE_ID = "lease-zielsdorf-2025-08-29";
const AUTOZONE_HOUSE_LEASE_ID = "lease-6481-us30-2026-05-01";
const YELLOW_HOUSE_LEASE_ID = "lease-6454-us30-2026-03-05";

interface CustomerSpec {
  id: string;
  name: string;
  notes: string;
}

const CUSTOMERS: readonly CustomerSpec[] = [
  {
    id: KFI_WEBSTER_CUSTOMER_ID,
    name: "KFI Staffing – Webster, WI",
    notes:
      "KFI Staffing crew housing in Webster, WI (no third-party employer named in the lease — attribute directly to KFI). " +
      "Seeded from attached lease PDF; see property record for landlord and term details.",
  },
  {
    id: AUTOZONE_JEANNETTE_CUSTOMER_ID,
    name: "AutoZone – Jeannette, PA",
    notes:
      "KFI Staffing crew housing for AutoZone employees in Jeannette, PA. " +
      "Two George DeLallo Company houses on US-30 ('AutoZone house' at 6481 and 'Yellow House' at 6454).",
  },
];

interface PropertySpec {
  id: string;
  customerId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  monthlyRent: number;
  landlordName: string;
  landlordEmail: string;
  landlordPhone: string;
  paymentMethod: string;
  paymentRecipient: string;
  paymentDueDay: number;
  paymentNotes: string;
  notes: string;
}

const PROPERTIES: readonly PropertySpec[] = [
  {
    id: ZIELSDORF_PROPERTY_ID,
    customerId: KFI_WEBSTER_CUSTOMER_ID,
    name: "7112 Zielsdorf Drive – Webster, WI",
    address: "7112 Zielsdorf Drive",
    city: "Webster",
    state: "WI",
    zip: "54893",
    monthlyRent: 4000,
    landlordName: "Eureka Land Investments",
    landlordEmail: "anderson.melissa.b@gmail.com",
    landlordPhone: "715-557-1794",
    paymentMethod: "ACH",
    paymentRecipient: "Eureka Land Investments",
    paymentDueDay: 1,
    paymentNotes:
      "ACH / direct deposit to Eureka Land Investments; rent due 1st of month. Late fee $100 flat after 7 days; NSF fee $50.",
    notes:
      "Landlord contact: Melissa Anderson 715-557-1794 (anderson.melissa.b@gmail.com). " +
      "Maintenance: Kyle Anderson 715-557-1795 (kyle.oscar.anderson@gmail.com). " +
      "Tenant pays all utilities; separate gas + electric meters; 4 keys issued.",
  },
  {
    id: AUTOZONE_HOUSE_PROPERTY_ID,
    customerId: AUTOZONE_JEANNETTE_CUSTOMER_ID,
    name: "6481 US-30 – Jeannette, PA (AutoZone house)",
    address: "6481 US-30",
    city: "Jeannette",
    state: "PA",
    zip: "15644",
    monthlyRent: 1800,
    landlordName: "George DeLallo Company, Inc.",
    landlordEmail: "",
    landlordPhone: "",
    paymentMethod: "Check",
    paymentRecipient: "George DeLallo Company, Inc.",
    paymentDueDay: 1,
    paymentNotes:
      "Rent due 1st of month. Late fee 5% of unpaid amount per day delinquent.",
    notes:
      "AutoZone employee housing; $1,800/mo base equivalent to $300 per occupied bed. " +
      "Tenant pays all utilities (heat, water, electric, A/C, internet). " +
      "Tenant insurance required: $300,000 personal property + $1,000,000 liability, landlord named additional insured.",
  },
  {
    id: YELLOW_HOUSE_PROPERTY_ID,
    customerId: AUTOZONE_JEANNETTE_CUSTOMER_ID,
    name: "6454 US-30 – Jeannette, PA (Yellow House)",
    address: "6454 US-30",
    city: "Jeannette",
    state: "PA",
    zip: "15644",
    monthlyRent: 2400,
    landlordName: "George DeLallo Company, Inc.",
    landlordEmail: "",
    landlordPhone: "",
    paymentMethod: "Check",
    paymentRecipient: "George DeLallo Company, Inc.",
    paymentDueDay: 1,
    paymentNotes:
      "Rent due 1st of month. Late fee 5% of unpaid amount per day delinquent.",
    notes:
      "AutoZone employee housing ('Yellow House'). Tenant pays all utilities. " +
      "Same insurance + house-rule clauses as 6481 US-30 (sister property under same landlord).",
  },
];

interface LeaseSpec {
  id: string;
  propertyId: string;
  startDate: string;
  endDate: string;
  monthlyRent: number;
  securityDeposit: number;
  source: string;
  notes: string;
  clauses: string;
}

const LEASES: readonly LeaseSpec[] = [
  {
    id: ZIELSDORF_LEASE_ID,
    propertyId: ZIELSDORF_PROPERTY_ID,
    startDate: "2025-08-29",
    endDate: "2026-08-31",
    monthlyRent: 4000,
    securityDeposit: 4000,
    source: "Zielsdorf_Dr_Lease_Agreement_09Sep2025_1778107193593.pdf",
    notes:
      "7112 Zielsdorf Dr, Webster WI — KFI Staffing crew house. Tenant pays all utilities; 4 keys issued. " +
      "Source: Zielsdorf_Dr_Lease_Agreement_09Sep2025_1778107193593.pdf",
    clauses: [
      "Term: 2025-08-29 → 2026-08-31.",
      "Monthly rent: $4,000.00, due 1st of month via ACH / direct deposit to Eureka Land Investments.",
      "Security deposit: $4,000.00.",
      "Late fee: $100 flat if rent unpaid after 7 days. NSF / returned check fee: $50.",
      "Tenant pays all utilities; separate gas + electric meters.",
      "Landlord: Eureka Land Investments — Melissa Anderson, 715-557-1794, anderson.melissa.b@gmail.com.",
      "Maintenance contact: Kyle Anderson, 715-557-1795, kyle.oscar.anderson@gmail.com.",
      "4 keys issued at move-in.",
      "No smoking; no pets without written landlord consent.",
      "Source document: Zielsdorf_Dr_Lease_Agreement_09Sep2025_1778107193593.pdf " +
        "(duplicate of Wisconsin_Lease_Agreement-_Webster_1778107193593.pdf).",
    ].join(" "),
  },
  {
    id: AUTOZONE_HOUSE_LEASE_ID,
    propertyId: AUTOZONE_HOUSE_PROPERTY_ID,
    startDate: "2026-05-01",
    endDate: "2026-11-01",
    monthlyRent: 1800,
    securityDeposit: 0,
    source:
      "Auto_Zone_-_6481_US-30_Jeannette_PA_15644_-_2026_KFI_STAFFING__1778107208478.pdf",
    notes:
      "6481 US-30, Jeannette PA — KFI Staffing housing for AutoZone. $1,800/mo base ($300/bed). " +
      "Tenant pays all utilities. Source: Auto_Zone_-_6481_US-30_Jeannette_PA_15644_-_2026_KFI_STAFFING__1778107208478.pdf",
    clauses: [
      "Tenant: KFI Staffing (housing for AutoZone employees).",
      "Term: 2026-05-01 → 2026-11-01, with month-to-month option starting 2026-11-01.",
      "Monthly rent: $1,800.00 base, equivalent to $300 per occupied bed; due 1st of month.",
      "Late fee: 5% of unpaid amount per day delinquent.",
      "Tenant pays all utilities (heat, water, electric, A/C, internet).",
      "Tenant insurance required: $300,000 personal property + $1,000,000 liability; landlord named additional insured.",
      "No smoking inside; no pets without written landlord consent.",
      "Default / termination: standard PA residential default and notice provisions apply.",
      "Landlord: George DeLallo Company, Inc.",
      "Source document: Auto_Zone_-_6481_US-30_Jeannette_PA_15644_-_2026_KFI_STAFFING__1778107208478.pdf.",
    ].join(" "),
  },
  {
    id: YELLOW_HOUSE_LEASE_ID,
    propertyId: YELLOW_HOUSE_PROPERTY_ID,
    startDate: "2026-03-05",
    endDate: "2026-09-05",
    monthlyRent: 2400,
    securityDeposit: 0,
    source:
      "Yellow_House-_6454_Us-30,_Jeannette,_PA_15644_-_2026_KFI_STAFF_1778107208478.pdf",
    notes:
      "6454 US-30, Jeannette PA ('Yellow House') — KFI Staffing housing for AutoZone. Tenant pays all utilities. " +
      "Source: Yellow_House-_6454_Us-30,_Jeannette,_PA_15644_-_2026_KFI_STAFF_1778107208478.pdf",
    clauses: [
      "Tenant: KFI Staffing (housing for AutoZone employees).",
      "Term: 2026-03-05 → 2026-09-05, with month-to-month option after.",
      "Monthly rent: $2,400.00; due 1st of month.",
      "Late fee: 5% of unpaid amount per day delinquent.",
      "Tenant pays all utilities (heat, water, electric, A/C, internet).",
      "Tenant insurance required: $300,000 personal property + $1,000,000 liability; landlord named additional insured.",
      "No smoking inside; no pets without written landlord consent.",
      "Default / termination: standard PA residential default and notice provisions apply.",
      "Landlord: George DeLallo Company, Inc.",
      "Source document: Yellow_House-_6454_Us-30,_Jeannette,_PA_15644_-_2026_KFI_STAFF_1778107208478.pdf.",
    ].join(" "),
  },
];

function buildCustomerRow(spec: CustomerSpec): InsertCustomerRow {
  return {
    id: spec.id,
    name: spec.name,
    contactName: "",
    email: "",
    phone: "",
    notes: spec.notes,
  };
}

function buildPropertyRow(
  spec: PropertySpec,
  customerId: string,
): InsertPropertyRow {
  return {
    id: spec.id,
    customerId,
    name: spec.name,
    address: spec.address,
    city: spec.city,
    state: spec.state,
    zip: spec.zip,
    totalBeds: 0,
    monthlyRent: spec.monthlyRent,
    chargePerBed: 0,
    status: "Active",
    landlordName: spec.landlordName,
    landlordEmail: spec.landlordEmail,
    landlordPhone: spec.landlordPhone,
    paymentMethod: spec.paymentMethod,
    paymentRecipient: spec.paymentRecipient,
    paymentDueDay: spec.paymentDueDay,
    paymentNotes: spec.paymentNotes,
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes: spec.notes,
    furnishings: [],
  };
}

function buildLeaseRow(spec: LeaseSpec, propertyId: string): InsertLeaseRow {
  return {
    id: spec.id,
    propertyId,
    startDate: spec.startDate,
    endDate: spec.endDate,
    monthlyRent: spec.monthlyRent,
    securityDeposit: spec.securityDeposit,
    status: "Active",
    notes: spec.notes,
    clauses: spec.clauses,
    buyoutAvailable: false,
    buyoutCost: null,
  };
}

export interface SeedAttachedLeasesResult {
  customersInserted: number;
  propertiesInserted: number;
  leasesInserted: number;
}

export interface SeedAttachedLeasesDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
}

/**
 * Idempotently seed the customers, properties, and active leases extracted
 * from attached PDFs. Reconciles by natural keys: customer by name,
 * property by `(customerId, address, zip)`, lease by `(propertyId,
 * startDate, endDate, source-PDF marker in notes)`. Never UPDATEs
 * existing rows.
 */
export async function seedAttachedLeasesIfMissing(
  deps: Partial<SeedAttachedLeasesDeps> = {},
): Promise<SeedAttachedLeasesResult> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;

  const result = await database.transaction(async (tx) => {
    const customerIdByKey = new Map<string, string>();
    let customersInserted = 0;
    for (const spec of CUSTOMERS) {
      const existing = await tx
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(eq(customersTable.name, spec.name))
        .limit(1);
      if (existing.length > 0) {
        customerIdByKey.set(spec.id, existing[0]!.id);
        continue;
      }
      const inserted = await tx
        .insert(customersTable)
        .values(buildCustomerRow(spec))
        .onConflictDoNothing()
        .returning({ id: customersTable.id });
      if (inserted.length > 0) {
        customersInserted += 1;
        customerIdByKey.set(spec.id, spec.id);
      } else {
        const reread = await tx
          .select({ id: customersTable.id })
          .from(customersTable)
          .where(eq(customersTable.name, spec.name))
          .limit(1);
        if (reread.length > 0) customerIdByKey.set(spec.id, reread[0]!.id);
      }
    }

    const propertyIdByKey = new Map<string, string>();
    let propertiesInserted = 0;
    for (const spec of PROPERTIES) {
      const customerId = customerIdByKey.get(spec.customerId);
      if (!customerId) continue;
      const existing = await tx
        .select({ id: propertiesTable.id })
        .from(propertiesTable)
        .where(
          and(
            eq(propertiesTable.customerId, customerId),
            eq(propertiesTable.address, spec.address),
            eq(propertiesTable.zip, spec.zip),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        propertyIdByKey.set(spec.id, existing[0]!.id);
        continue;
      }
      const inserted = await tx
        .insert(propertiesTable)
        .values(buildPropertyRow(spec, customerId))
        .onConflictDoNothing()
        .returning({ id: propertiesTable.id });
      if (inserted.length > 0) {
        propertiesInserted += 1;
        propertyIdByKey.set(spec.id, spec.id);
      } else {
        const reread = await tx
          .select({ id: propertiesTable.id })
          .from(propertiesTable)
          .where(
            and(
              eq(propertiesTable.customerId, customerId),
              eq(propertiesTable.address, spec.address),
              eq(propertiesTable.zip, spec.zip),
            ),
          )
          .limit(1);
        if (reread.length > 0) propertyIdByKey.set(spec.id, reread[0]!.id);
      }
    }

    let leasesInserted = 0;
    for (const spec of LEASES) {
      const propertyId = propertyIdByKey.get(spec.propertyId);
      if (!propertyId) continue;
      const existing = await tx
        .select({ id: leasesTable.id })
        .from(leasesTable)
        .where(
          and(
            eq(leasesTable.propertyId, propertyId),
            eq(leasesTable.startDate, spec.startDate),
            eq(leasesTable.endDate, spec.endDate),
            like(leasesTable.notes, `%${spec.source}%`),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;

      const inserted = await tx
        .insert(leasesTable)
        .values(buildLeaseRow(spec, propertyId))
        .onConflictDoNothing()
        .returning({ id: leasesTable.id });
      if (inserted.length > 0) leasesInserted += 1;
    }

    return { customersInserted, propertiesInserted, leasesInserted };
  });

  if (
    result.customersInserted > 0 ||
    result.propertiesInserted > 0 ||
    result.leasesInserted > 0
  ) {
    log.info(result, "Attached-lease PDF seed applied.");
  }
  return result;
}

export const SEED_ATTACHED_LEASES_IDS = {
  customers: {
    kfiWebster: KFI_WEBSTER_CUSTOMER_ID,
    autozoneJeannette: AUTOZONE_JEANNETTE_CUSTOMER_ID,
  },
  properties: {
    zielsdorf: ZIELSDORF_PROPERTY_ID,
    autozoneHouse: AUTOZONE_HOUSE_PROPERTY_ID,
    yellowHouse: YELLOW_HOUSE_PROPERTY_ID,
  },
  leases: {
    zielsdorf: ZIELSDORF_LEASE_ID,
    autozoneHouse: AUTOZONE_HOUSE_LEASE_ID,
    yellowHouse: YELLOW_HOUSE_LEASE_ID,
  },
} as const;
