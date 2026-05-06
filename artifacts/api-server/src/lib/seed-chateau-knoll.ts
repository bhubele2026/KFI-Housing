import { and, eq, like, lt, or } from "drizzle-orm";
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

export const CHATEAU_KNOLL_CUSTOMER_ID = "cust-kfi-corporate";
export const CHATEAU_KNOLL_PROPERTY_ID = "prop-chateau-knoll-bettendorf";
export const chateauKnollLeaseId = (unit: string): string =>
  `lease-chateau-knoll-u${unit}`;

const CHATEAU_CUSTOMER_NAME = "KFI Staffing — Corporate";
const CHATEAU_ADDRESS = "2900 Middle Rd";
const CHATEAU_CITY = "Bettendorf";
const CHATEAU_STATE = "IA";
const CHATEAU_ZIP = "52722";
const CHATEAU_LANDLORD = "Chateau Knoll, LLC";

interface ChateauLeaseSpec {
  unit: string;
  startDate: string;
  endDate: string;
  baseRent: number;
  monthlyRent: number;
  securityDeposit: number;
  source: string;
  /** True when the 01/22/2026 LOI puts KFI Staffing on the hook for rent,
   *  utilities, and damages for this unit. */
  loiKfiResponsible: boolean;
}

const CHATEAU_LEASES: readonly ChateauLeaseSpec[] = [
  {
    unit: "1407",
    startDate: "2026-02-12",
    endDate: "2026-08-11",
    baseRent: 1350,
    monthlyRent: 1543,
    securityDeposit: 200,
    source: "Chateau_Knoll_Lease_-_1407_1778107759430.pdf",
    loiKfiResponsible: false,
  },
  {
    unit: "1506",
    startDate: "2026-02-12",
    endDate: "2026-08-11",
    baseRent: 1388,
    monthlyRent: 1581,
    securityDeposit: 200,
    source: "Chateau_Knoll_Lease_-_1506_1778107759431.pdf",
    loiKfiResponsible: false,
  },
  {
    unit: "2108",
    startDate: "2026-01-23",
    endDate: "2026-07-31",
    baseRent: 1468,
    monthlyRent: 1661,
    securityDeposit: 200,
    source: "Chateau_Knoll_Lease_-_2108_1778107759430.pdf",
    loiKfiResponsible: true,
  },
  {
    unit: "3512",
    startDate: "2026-01-23",
    endDate: "2026-07-31",
    baseRent: 1353,
    monthlyRent: 1546,
    securityDeposit: 200,
    source: "Chateau_Knoll_Lease_-_3512_1778107759431.pdf",
    loiKfiResponsible: true,
  },
  {
    unit: "3524",
    startDate: "2026-01-23",
    endDate: "2026-07-31",
    baseRent: 1353,
    monthlyRent: 1546,
    securityDeposit: 200,
    source: "Chateau_Knoll_Lease_-_3524_1778107759431.pdf",
    loiKfiResponsible: true,
  },
  {
    unit: "3604",
    startDate: "2026-01-23",
    endDate: "2026-07-31",
    baseRent: 1585,
    monthlyRent: 1793,
    securityDeposit: 200,
    source: "Chateau_Knoll_Lease_-_3604_1778107759430.pdf",
    loiKfiResponsible: true,
  },
];

const CHATEAU_TOTAL_BEDS = CHATEAU_LEASES.length;

function unitMarker(unit: string): string {
  return `Unit ${unit} —`;
}

function buildCustomerRow(id: string): InsertCustomerRow {
  return {
    id,
    name: CHATEAU_CUSTOMER_NAME,
    contactName: "Valerie Alderman",
    email: "valderman@kfistaffing.com",
    phone: "",
    notes:
      "KFI Staffing corporate housing accounts. Used as the customer of " +
      "record for Chateau Knoll (Bettendorf, IA) corporate leases until " +
      "the master-file import assigns a downstream client.",
  };
}

function buildPropertyRow(
  id: string,
  customerId: string,
): InsertPropertyRow {
  return {
    id,
    customerId,
    name: "Chateau Knoll Apartments – Bettendorf, IA",
    address: CHATEAU_ADDRESS,
    city: CHATEAU_CITY,
    state: CHATEAU_STATE,
    zip: CHATEAU_ZIP,
    totalBeds: CHATEAU_TOTAL_BEDS,
    monthlyRent: CHATEAU_LEASES.reduce((s, l) => s + l.monthlyRent, 0),
    chargePerBed: 0,
    status: "Active",
    landlordName: CHATEAU_LANDLORD,
    landlordEmail: "",
    landlordPhone: "563-332-8421",
    paymentMethod: "",
    paymentRecipient: "Chateau Knoll, LLC",
    paymentDueDay: 1,
    paymentNotes:
      "Rent due 1st of month. Late fee $20/day up to $100 (rents > $700).",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes:
      "Six active KFI Staffing corporate leases at Chateau Knoll Apartments " +
      "(units 1407, 1506, 2108, 3512, 3524, 3604). Leasing office at 2900 " +
      "Middle Rd, Bettendorf IA 52722; individual units are in the same " +
      "complex. Water RUBS 100% / Gas RUBS 100% / Utility Reimbursement " +
      "Admin Fee $3.95 per unit. A renter's insurance certificate is on " +
      "file (not loaded as a structured record). Source documents: six " +
      "Chateau_Knoll_Lease_-_<unit>_1778107759*.pdf files plus " +
      "LOI_-_Chateau_Knoll_1778107759431.pdf. The image-only PDFs " +
      "Lease_buyout_procedure_-_Chateau_Knoll and BGCK_Letter were not " +
      "imported (no extractable text).",
    furnishings: [],
  };
}

function buildLeaseClauses(spec: ChateauLeaseSpec): string {
  const parts: string[] = [
    `Lessor: Chateau Knoll, LLC DBA Chateau Knoll Apartments. Lessee: KFI Staffing.`,
    `Leased premises: ${spec.unit} Chateau Knoll, Bettendorf, IA 52722.`,
    `Term: ${spec.startDate} → ${spec.endDate} (noon to noon).`,
    `Base rent: $${spec.baseRent.toLocaleString("en-US")}.00/mo. ` +
      `Total monthly charges (incl. short-term rent + gas + garbage): ` +
      `$${spec.monthlyRent.toLocaleString("en-US")}.00.`,
    `Security deposit: $${spec.securityDeposit}.00.`,
    "Water RUBS: 100%. Gas RUBS: 100%. Utility Reimbursement Admin Fee: $3.95.",
    "Late fee: $20/day up to $100/mo (rents over $700). NSF fee: $50.",
    "60-day written notice required before lease end to renew or vacate; " +
      "otherwise 2 months' rent as liquidated damages plus other holdover remedies.",
    "No assignment or sublet without written landlord consent. " +
      "No satellite dishes without written consent ($50 fee).",
    `Source document: ${spec.source}.`,
  ];
  if (spec.loiKfiResponsible) {
    parts.push(
      "Per the 01/22/2026 LOI from KFI Staffing (Valerie Alderman), KFI " +
        "Staffing is responsible for all expenses including monthly rent, " +
        "applicable utilities, and damages on behalf of the occupants for " +
        "this unit. (LOI source: LOI_-_Chateau_Knoll_1778107759431.pdf.)",
    );
  }
  return parts.join(" ");
}

function buildLeaseNotes(spec: ChateauLeaseSpec): string {
  const base =
    `${unitMarker(spec.unit)} ${spec.source}. ` +
    `Base rent $${spec.baseRent.toLocaleString("en-US")}/mo, total monthly ` +
    `$${spec.monthlyRent.toLocaleString("en-US")}, deposit $${spec.securityDeposit}. ` +
    `Water RUBS 100%, Gas RUBS 100%, Utility Reimbursement Admin Fee $3.95.`;
  if (spec.loiKfiResponsible) {
    return (
      base +
      " Per 01/22/2026 LOI: KFI Staffing is responsible for rent, utilities, " +
      "and damages for this unit."
    );
  }
  return base;
}

function buildLeaseRow(
  id: string,
  propertyId: string,
  spec: ChateauLeaseSpec,
): InsertLeaseRow {
  return {
    id,
    propertyId,
    startDate: spec.startDate,
    endDate: spec.endDate,
    monthlyRent: spec.monthlyRent,
    securityDeposit: spec.securityDeposit,
    status: "Active",
    notes: buildLeaseNotes(spec),
    clauses: buildLeaseClauses(spec),
    buyoutAvailable: false,
    buyoutCost: null,
  };
}

export interface SeedChateauKnollResult {
  customerInserted: boolean;
  propertyInserted: boolean;
  /** Bumped totalBeds on a pre-existing Chateau Knoll property because
   *  it was below the 6 active KFI corporate beds we're seeding. */
  totalBedsBumped: boolean;
  leasesInserted: number;
  propertyId: string | null;
  unitsPresent: string[];
}

export interface SeedChateauKnollDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
}

/**
 * Idempotently seed the Chateau Knoll property + 6 active KFI Staffing
 * corporate leases (units 1407, 1506, 2108, 3512, 3524, 3604).
 *
 * Reconciliation strategy:
 *  - Customer: match by name (case where #288 master-file import has
 *    already created a downstream client for Chateau Knoll, an operator
 *    can repoint the property; we only INSERT the corporate fallback
 *    customer when no Chateau Knoll property already exists).
 *  - Property: match first by (address, zip) regardless of customer so
 *    a parallel #287/#288 import that landed it under another customer
 *    is reused, then by (customerId, address, zip).
 *  - Lease: match by (propertyId, startDate, endDate, "Unit N —" marker
 *    in notes). Existing rows are never UPDATEd.
 */
export async function seedChateauKnollIfMissing(
  deps: Partial<SeedChateauKnollDeps> = {},
): Promise<SeedChateauKnollResult> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;

  const result = await database.transaction(async (tx) => {
    // 1. Property reconciliation by (address, zip) first — this protects
    //    against #287/#288 having already created a Chateau Knoll record
    //    under a different customer.
    const existingByAddress = await tx
      .select({
        id: propertiesTable.id,
        customerId: propertiesTable.customerId,
        totalBeds: propertiesTable.totalBeds,
      })
      .from(propertiesTable)
      .where(
        and(
          eq(propertiesTable.address, CHATEAU_ADDRESS),
          eq(propertiesTable.zip, CHATEAU_ZIP),
        ),
      )
      .limit(1);

    let propertyId: string;
    let customerId: string;
    let propertyInserted = false;
    let customerInserted = false;
    let totalBedsBumped = false;

    if (existingByAddress.length > 0) {
      propertyId = existingByAddress[0]!.id;
      customerId = existingByAddress[0]!.customerId as string;

      // Reconcile totalBeds: per spec we must bump it to cover the six
      // KFI-corporate beds when an upstream import created the property
      // with a smaller capacity. Only this single field is touched so
      // operator edits to other fields are preserved.
      const updated = await tx
        .update(propertiesTable)
        .set({ totalBeds: CHATEAU_TOTAL_BEDS })
        .where(
          and(
            eq(propertiesTable.id, propertyId),
            lt(propertiesTable.totalBeds, CHATEAU_TOTAL_BEDS),
          ),
        )
        .returning({ id: propertiesTable.id });
      totalBedsBumped = updated.length > 0;
    } else {
      // 2. No existing property — find or create the corporate fallback
      //    customer, then insert the property under it.
      const existingCustomer = await tx
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(eq(customersTable.name, CHATEAU_CUSTOMER_NAME))
        .limit(1);

      if (existingCustomer.length > 0) {
        customerId = existingCustomer[0]!.id;
      } else {
        customerId = CHATEAU_KNOLL_CUSTOMER_ID;
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
            .where(eq(customersTable.name, CHATEAU_CUSTOMER_NAME))
            .limit(1);
          if (reread.length > 0) customerId = reread[0]!.id;
        }
      }

      propertyId = CHATEAU_KNOLL_PROPERTY_ID;
      const insertedProp = await tx
        .insert(propertiesTable)
        .values(buildPropertyRow(propertyId, customerId))
        .onConflictDoNothing()
        .returning({ id: propertiesTable.id });
      propertyInserted = insertedProp.length > 0;
      if (!propertyInserted) {
        const reread = await tx
          .select({ id: propertiesTable.id })
          .from(propertiesTable)
          .where(
            and(
              eq(propertiesTable.address, CHATEAU_ADDRESS),
              eq(propertiesTable.zip, CHATEAU_ZIP),
            ),
          )
          .limit(1);
        if (reread.length > 0) propertyId = reread[0]!.id;
      }
    }

    // 3. Lease upsert. Two-stage dedupe so a parallel #287/#288 import
    //    that wrote a semantically-identical lease (same unit, same
    //    rent, possibly without our exact "Unit N —" notes marker)
    //    isn't duplicated.
    let leasesInserted = 0;
    const unitsPresent: string[] = [];
    for (const spec of CHATEAU_LEASES) {
      const unitToken = `Unit ${spec.unit}`;
      const unitInTextOnThisProperty = and(
        eq(leasesTable.propertyId, propertyId),
        or(
          like(leasesTable.notes, `%${unitToken}%`),
          like(leasesTable.clauses, `%${unitToken}%`),
        ),
      );

      // Primary: same property, same dates, unit token in notes or clauses.
      const exact = await tx
        .select({ id: leasesTable.id })
        .from(leasesTable)
        .where(
          and(
            unitInTextOnThisProperty,
            eq(leasesTable.startDate, spec.startDate),
            eq(leasesTable.endDate, spec.endDate),
          ),
        )
        .limit(1);
      if (exact.length > 0) {
        unitsPresent.push(spec.unit);
        continue;
      }

      // Fallback: same property + unit token + matching monthlyRent.
      // Catches imports that normalized the dates differently or wrote
      // the unit number without our specific "Unit N —" marker.
      const fallback = await tx
        .select({ id: leasesTable.id })
        .from(leasesTable)
        .where(
          and(
            unitInTextOnThisProperty,
            eq(leasesTable.monthlyRent, spec.monthlyRent),
          ),
        )
        .limit(1);
      if (fallback.length > 0) {
        unitsPresent.push(spec.unit);
        continue;
      }

      const inserted = await tx
        .insert(leasesTable)
        .values(buildLeaseRow(chateauKnollLeaseId(spec.unit), propertyId, spec))
        .onConflictDoNothing()
        .returning({ id: leasesTable.id });
      if (inserted.length > 0) {
        leasesInserted += 1;
        unitsPresent.push(spec.unit);
      }
    }

    return {
      customerInserted,
      propertyInserted,
      totalBedsBumped,
      leasesInserted,
      propertyId,
      unitsPresent,
    };
  });

  if (
    result.customerInserted ||
    result.propertyInserted ||
    result.totalBedsBumped ||
    result.leasesInserted > 0
  ) {
    log.info(result, "Chateau Knoll seed applied.");
  }
  log.info(
    {
      propertyId: result.propertyId,
      activeLeaseCount: result.unitsPresent.length,
      units: result.unitsPresent,
    },
    "Chateau Knoll seed verification.",
  );
  return result;
}

export const SEED_CHATEAU_KNOLL_IDS = {
  customer: CHATEAU_KNOLL_CUSTOMER_ID,
  property: CHATEAU_KNOLL_PROPERTY_ID,
  leases: Object.fromEntries(
    CHATEAU_LEASES.map((l) => [l.unit, chateauKnollLeaseId(l.unit)]),
  ) as Record<string, string>,
} as const;
