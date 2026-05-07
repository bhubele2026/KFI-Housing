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
import {
  normalizeCustomerRow,
  normalizePropertyRow,
  normalizeLeaseRow,
} from "./db-row-normalizers";
import type { Logger } from "pino";

/**
 * Active leases extracted from the lease PDFs attached to the project but
 * never yet loaded into the DB. Mirrors `seed-adient.ts`: idempotent,
 * natural-key reconciled, generally insert-only — the one exception is a
 * narrow backfill of address columns when an existing row was previously
 * seeded with a blank address and the spec now carries a confirmed one
 * (see Task #298). Only readable,
 * currently-active leases are seeded — image-only / signature-page-only /
 * empty-placeholder PDFs are intentionally skipped (see Task #287).
 */

const KFI_WEBSTER_CUSTOMER_ID = "cust-kfi-webster";
const AUTOZONE_JEANNETTE_CUSTOMER_ID = "cust-autozone-jeannette";
const KFI_STAFFING_LLC_CUSTOMER_ID = "cust-kfi-staffing-llc";

const ZIELSDORF_PROPERTY_ID = "prop-zielsdorf-webster";
const AUTOZONE_HOUSE_PROPERTY_ID = "prop-autozone-6481-us30";
const YELLOW_HOUSE_PROPERTY_ID = "prop-yellow-house-6454-us30";
const RIDGE_MOTOR_INN_PROPERTY_ID = "prop-ridge-motor-inn";

const ZIELSDORF_LEASE_ID = "lease-zielsdorf-2025-08-29";
const AUTOZONE_HOUSE_LEASE_ID = "lease-6481-us30-2026-05-01";
const YELLOW_HOUSE_LEASE_ID = "lease-6454-us30-2026-03-05";
const RIDGE_MOTOR_INN_LEASE_ID = "lease-ridge-motor-inn-2026-04-06";

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
      "OPERATOR-MANAGED (Task #361 audit): the 7112 Zielsdorf Drive lease " +
      "names KFI Staffing as the tenant directly with no third-party " +
      "downstream end-client. This row is intentionally a real KFI customer " +
      "rather than a per-property fallback — do NOT repoint it via " +
      "`repointFallbackToEndClient` in future audits. " +
      "Seeded from attached lease PDF; see property record for landlord and term details.",
  },
  {
    id: AUTOZONE_JEANNETTE_CUSTOMER_ID,
    name: "AutoZone – Jeannette, PA",
    notes:
      "KFI Staffing crew housing for AutoZone employees in Jeannette, PA. " +
      "Two George DeLallo Company houses on US-30 ('AutoZone house' at 6481 and 'Yellow House' at 6454).",
  },
  {
    id: KFI_STAFFING_LLC_CUSTOMER_ID,
    name: "KFI Staffing LLC",
    notes:
      "KFI Staffing LLC umbrella account for hotel/corporate-rate agreements " +
      "(e.g., The Ridge Motor Inn). Distinct from the per-property KFI crew " +
      "housing customers (Webster, Versailles, etc.). Account contact for " +
      "the Ridge Motor Inn agreement: Valerie Alderman, Logistics Mgr.",
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
  {
    id: RIDGE_MOTOR_INN_PROPERTY_ID,
    customerId: KFI_STAFFING_LLC_CUSTOMER_ID,
    name: "The Ridge Motor Inn",
    address: "2900 New Pinery Road",
    city: "Portage",
    state: "WI",
    zip: "53901",
    monthlyRent: 0,
    landlordName: "The Ridge Motor Inn (Dilip Patel, owner)",
    landlordEmail: "",
    landlordPhone: "",
    paymentMethod: "Invoice",
    paymentRecipient: "The Ridge Motor Inn",
    paymentDueDay: 1,
    paymentNotes:
      "Hotel corporate-rate agreement (not a fixed monthly rent). Billed per " +
      "room-night at $53.00/night for Double Queen rooms. Stays of 30+ days " +
      "are Long Stays and tax exempt.",
    notes:
      "Hotel corporate-rate agreement with KFI Staffing LLC — not a per-unit " +
      "apartment lease. Street address (2900 New Pinery Road, Portage, WI 53901) " +
      "was not stated in the source PDF; filled in from the operator-confirmed " +
      "public hotel address so the property pin can geocode on the portfolio map. " +
      "Source: The_Ridge_Motor_Inn_1778107885976.pdf",
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
  // Hotel-rate / room-night fields (task #299). Defaults assume a regular
  // monthly lease so existing entries don't have to spell them out.
  rateType?: "monthly" | "room-night";
  nightlyRate?: number;
  guaranteedRooms?: number;
  monthlyRoomNightMin?: number;
  longStayTaxExempt?: boolean;
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
  {
    id: RIDGE_MOTOR_INN_LEASE_ID,
    propertyId: RIDGE_MOTOR_INN_PROPERTY_ID,
    startDate: "2026-04-06",
    endDate: "2027-04-05",
    monthlyRent: 0,
    securityDeposit: 0,
    source: "The_Ridge_Motor_Inn_1778107885976.pdf",
    rateType: "room-night",
    nightlyRate: 53,
    guaranteedRooms: 10,
    monthlyRoomNightMin: 10,
    longStayTaxExempt: true,
    notes:
      "The Ridge Motor Inn — KFI Staffing LLC negotiated hotel rate agreement " +
      "(not a per-unit apartment lease). Initial Term 04/06/2026 – 04/05/2027, " +
      "renewable. $53.00/night Double Queen (single or double occupancy); " +
      "10 guaranteed available rooms; 10 revenue-producing room nights/month " +
      "minimum (account may lose volume discount if it falls below). " +
      "Stays of 30+ days are Long Stays and tax exempt. " +
      "Source: The_Ridge_Motor_Inn_1778107885976.pdf",
    clauses: [
      "Tenant / account: KFI Staffing LLC (signed by Valerie Alderman, Logistics Mgr, 03/19/2026).",
      "Hotel / landlord: The Ridge Motor Inn (signed by owner Dilip Patel, 03/15/2026).",
      "Agreement dated: March 12, 2026.",
      "Initial Term: 2026-04-06 → 2027-04-05, renewable.",
      "Negotiated rate: $53.00/night, Double Queen, single or double occupancy.",
      "Guaranteed available rooms: 10 minimum.",
      "Room-night minimum: 10 revenue-producing room nights/month (account may lose volume discount if it falls below).",
      "Stays of 30+ days are Long Stays and tax exempt.",
      "Amenities: free WiFi, weekly room cleaning, community room with kitchen appliances.",
      "Termination: either party may terminate with 30 days' written notice.",
      "Property street address is not stated in the PDF; backfilled from the operator-confirmed public hotel address (2900 New Pinery Road, Portage, WI 53901) so the property pin can geocode (Task #298).",
      "Source document: The_Ridge_Motor_Inn_1778107885976.pdf.",
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

function buildLeaseRow(
  spec: LeaseSpec,
  propertyId: string,
  today: string,
): InsertLeaseRow {
  return {
    id: spec.id,
    propertyId,
    startDate: spec.startDate,
    endDate: spec.endDate,
    monthlyRent: spec.monthlyRent,
    securityDeposit: spec.securityDeposit,
    status: computeLeaseStatus(spec.startDate, spec.endDate, today),
    notes: spec.notes,
    clauses: spec.clauses,
    buyoutAvailable: false,
    buyoutCost: null,
    rateType: spec.rateType ?? "monthly",
    nightlyRate: spec.nightlyRate ?? 0,
    guaranteedRooms: spec.guaranteedRooms ?? 0,
    monthlyRoomNightMin: spec.monthlyRoomNightMin ?? 0,
    longStayTaxExempt: spec.longStayTaxExempt ?? false,
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
  now: () => Date;
}

/**
 * Idempotently seed the customers, properties, and active leases extracted
 * from attached PDFs. Reconciles by natural keys: customer by name,
 * property by `(customerId, address, zip)`, lease by `(propertyId,
 * startDate, endDate, source-PDF marker in notes)`. Generally insert-only;
 * the one exception is a narrow backfill of property address columns when
 * an existing row was previously seeded with a blank address and the spec
 * now carries a confirmed one (see Task #298).
 */
export async function seedAttachedLeasesIfMissing(
  deps: Partial<SeedAttachedLeasesDeps> = {},
): Promise<SeedAttachedLeasesResult> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;
  const today = todayIso((deps.now ?? (() => new Date()))());

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
        .values(normalizeCustomerRow(buildCustomerRow(spec)))
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
      // Primary natural key: (customerId, address, zip).
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
      // Fallback for hotel-rate / address-TBD properties (e.g. The Ridge
      // Motor Inn): match by (customerId, name) so an operator/import that
      // already created the same property under a different ID — possibly
      // with a populated address, or seeded earlier with a blank address —
      // is still recognized and not duplicated. If the existing row was
      // seeded with a blank address and the spec now carries a confirmed
      // address (e.g. Task #298 backfilled the Ridge Motor Inn address),
      // backfill the address columns on the existing row so the property
      // pin can geocode on the portfolio map.
      const byName = await tx
        .select({
          id: propertiesTable.id,
          address: propertiesTable.address,
          zip: propertiesTable.zip,
        })
        .from(propertiesTable)
        .where(
          and(
            eq(propertiesTable.customerId, customerId),
            eq(propertiesTable.name, spec.name),
          ),
        )
        .limit(1);
      if (byName.length > 0) {
        const row = byName[0]!;
        if (
          spec.address !== "" &&
          spec.zip !== "" &&
          row.address === "" &&
          row.zip === ""
        ) {
          await tx
            .update(propertiesTable)
            .set(
              normalizePropertyRow({
                address: spec.address,
                city: spec.city,
                state: spec.state,
                zip: spec.zip,
              }),
            )
            .where(eq(propertiesTable.id, row.id));
        }
        propertyIdByKey.set(spec.id, row.id);
        continue;
      }
      const inserted = await tx
        .insert(propertiesTable)
        .values(normalizePropertyRow(buildPropertyRow(spec, customerId)))
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
      // Primary natural key: (propertyId, startDate, endDate, source-PDF
      // marker in notes) — pinpoints leases seeded by this importer.
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
      // Fallback: same property + same start date (tenant is implied by
      // the property's customerId). Catches the case where a prior import
      // (e.g. master-file #288) already created the same agreement under
      // a different ID and without our source-PDF marker in its notes.
      const byPropertyAndStart = await tx
        .select({ id: leasesTable.id })
        .from(leasesTable)
        .where(
          and(
            eq(leasesTable.propertyId, propertyId),
            eq(leasesTable.startDate, spec.startDate),
          ),
        )
        .limit(1);
      if (byPropertyAndStart.length > 0) continue;

      const inserted = await tx
        .insert(leasesTable)
        .values(normalizeLeaseRow(buildLeaseRow(spec, propertyId, today)))
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
    kfiStaffingLlc: KFI_STAFFING_LLC_CUSTOMER_ID,
  },
  properties: {
    zielsdorf: ZIELSDORF_PROPERTY_ID,
    autozoneHouse: AUTOZONE_HOUSE_PROPERTY_ID,
    yellowHouse: YELLOW_HOUSE_PROPERTY_ID,
    ridgeMotorInn: RIDGE_MOTOR_INN_PROPERTY_ID,
  },
  leases: {
    zielsdorf: ZIELSDORF_LEASE_ID,
    autozoneHouse: AUTOZONE_HOUSE_LEASE_ID,
    yellowHouse: YELLOW_HOUSE_LEASE_ID,
    ridgeMotorInn: RIDGE_MOTOR_INN_LEASE_ID,
  },
} as const;
