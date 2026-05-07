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
import {
  computeLeaseStatus as sharedComputeLeaseStatus,
  todayIso as sharedTodayIso,
} from "./lease-status";
import { repointFallbackToEndClient } from "./seed-fallback-repoint";
import type { Logger } from "pino";

// Re-export from the shared helper so callers (and the existing test that
// imports `computeLeaseStatus` from this module) keep working unchanged.
export const computeLeaseStatus = sharedComputeLeaseStatus;

export const PARK_PLACE_CUSTOMER_ID = "cust-kfi-park-place";
export const PARK_PLACE_PROPERTY_ID = "prop-park-place-plymouth";
export const parkPlaceLeaseId = (unit: string): string =>
  `lease-park-place-u${unit}`;

const KFI_CUSTOMER_NAME_DEFAULT = "KFI Staffing – Plymouth, MN";
const KFI_CUSTOMER_NAME_PATTERN = "KFI Staffing%";
/**
 * Real downstream end-client per the master file (Task #328). Park Place
 * Apartments at 14550 34th Ave N, Plymouth MN 55447 is the corporate
 * housing block for `Cardinal CG at Spring Green, WI` (master row 1,
 * which lists "Park Place Apartments / 14550 34th Ave N, Playmouth, MN
 * 55447" in its hint columns alongside that client name). The pattern is
 * deliberately narrow ("Cardinal CG at Spring Green%") so we don't
 * accidentally repoint to the unrelated `Cardinal CG - Northfield`
 * customer (master row with Owatonna, MN address).
 */
const PARK_PLACE_END_CLIENT_NAME_PATTERN = "Cardinal CG at Spring Green%";

const PARK_PLACE_ADDRESS = "14550 34th Ave N";
const PARK_PLACE_CITY = "Plymouth";
const PARK_PLACE_STATE = "MN";
const PARK_PLACE_ZIP = "55447";

interface ParkPlaceLeaseSpec {
  unit: string;
  dwellingAddress: string;
  startDate: string;
  endDate: string;
  monthlyTotal: number;
  monthlyRent: number;
  parkingSpace: string;
  source: string;
  isRenewal?: boolean;
}

// Verbatim filenames of the source lease PDFs from Task #289. For unit
// 605-102, the original Jun 2024 – May 2025 RENTCafe PDF is intentionally
// omitted; only the Jun 1 – Nov 30 2025 renewal is seeded.
const PARK_PLACE_LEASES: readonly ParkPlaceLeaseSpec[] = [
  {
    unit: "500-118",
    dwellingAddress: "14500 34th Ave N Apt 118",
    startDate: "2024-12-01",
    endDate: "2025-11-30",
    monthlyTotal: 1816,
    monthlyRent: 1777,
    parkingSpace: "500-118-SSI",
    source: "Lease_Agreement_-_Park_Place_Apartments_500-118_1778107787031.pdf",
  },
  {
    unit: "500-218",
    dwellingAddress: "14500 34th Ave N Apt 218",
    startDate: "2024-12-01",
    endDate: "2025-11-30",
    monthlyTotal: 1765,
    monthlyRent: 1726,
    parkingSpace: "500-218-VSI",
    source: "Lease_Agreement_-_Park_Place_Apartments_500-218_1778107787031.pdf",
  },
  {
    unit: "600-127",
    dwellingAddress: "14600 34th Ave N Apt 127",
    startDate: "2024-12-01",
    endDate: "2025-11-30",
    monthlyTotal: 1785,
    monthlyRent: 1746,
    parkingSpace: "600-127-SVR",
    source: "Lease_Agreement_-_Park_Place_Apartments_600-127_1778107787031.pdf",
  },
  {
    unit: "600-216",
    dwellingAddress: "14600 34th Ave N Apt 216",
    startDate: "2024-12-01",
    endDate: "2025-11-30",
    monthlyTotal: 1765,
    monthlyRent: 1726,
    parkingSpace: "600-216-VSM",
    source: "Lease_Agreement_-_Park_Place_Apartments_600-216_1778107787031.pdf",
  },
  {
    unit: "600-315",
    dwellingAddress: "14600 34th Ave N Apt 315",
    startDate: "2024-12-01",
    endDate: "2025-11-30",
    monthlyTotal: 1821,
    monthlyRent: 1782,
    parkingSpace: "600-315-FST",
    source: "Lease_Agreement_-_Park_Place_Apartments_600-315_1778107787031.pdf",
  },
  {
    unit: "600-342",
    dwellingAddress: "14600 34th Ave N Apt 342",
    startDate: "2024-12-01",
    endDate: "2025-11-30",
    monthlyTotal: 1790,
    monthlyRent: 1751,
    parkingSpace: "600-342-FKV",
    source: "Lease_Agreement_-_Park_Place_Apartments_600-342_1778107787031.pdf",
  },
  {
    unit: "605-102",
    dwellingAddress: "14605 34th Ave N Apt 102",
    startDate: "2025-06-01",
    endDate: "2025-11-30",
    monthlyTotal: 2276,
    monthlyRent: 2235,
    parkingSpace: "605-102-SLV",
    source: "Lease_Agreement_-_Park_Place_Apartments_605-102_1778107787031.pdf",
    isRenewal: true,
  },
  {
    unit: "605-201",
    dwellingAddress: "14605 34th Ave N Apt 201",
    startDate: "2024-12-01",
    endDate: "2025-11-30",
    monthlyTotal: 1765,
    monthlyRent: 1726,
    parkingSpace: "605-201-VLS",
    source: "Lease_Agreement_-_Park_Place_Apartments_605-201_1778107787031.pdf",
  },
  {
    unit: "605-218",
    dwellingAddress: "14605 34th Ave N Apt 218",
    startDate: "2024-12-01",
    endDate: "2025-11-30",
    monthlyTotal: 1785,
    monthlyRent: 1746,
    parkingSpace: "605-218-VSI",
    source: "Lease_Agreement_-_Park_Place_Apartments_605-218_1778107787031.pdf",
  },
];

function unitMarker(unit: string): string {
  return `Unit ${unit} —`;
}

const todayIso = sharedTodayIso;

function buildCustomerRow(id: string): InsertCustomerRow {
  return {
    id,
    name: KFI_CUSTOMER_NAME_DEFAULT,
    contactName: "",
    email: "",
    phone: "",
    notes:
      "KFI Staffing corporate housing at Park Place Apartments " +
      "(14550 34th Ave N, Plymouth, MN 55447). Nine units across the " +
      "500/600/605 buildings; original 12-month leases ran 2024-12-01 " +
      "→ 2025-11-30 (Unit 605-102 renewed Jun 1 – Nov 30 2025).",
  };
}

function buildPropertyRow(
  id: string,
  customerId: string,
): InsertPropertyRow {
  const baseRentTotal = PARK_PLACE_LEASES.reduce(
    (sum, l) => sum + l.monthlyRent,
    0,
  );
  return {
    id,
    customerId,
    name: "Park Place Apartments – Plymouth, MN",
    address: PARK_PLACE_ADDRESS,
    city: PARK_PLACE_CITY,
    state: PARK_PLACE_STATE,
    zip: PARK_PLACE_ZIP,
    totalBeds: 0,
    monthlyRent: baseRentTotal,
    chargePerBed: 0,
    status: "Active",
    landlordName: "Centerspace LP",
    landlordEmail: "",
    landlordPhone: "",
    paymentMethod: "ACH",
    paymentRecipient: "Centerspace LP",
    paymentDueDay: 1,
    paymentNotes:
      "Rent due 1st of month. Late fee 8% of unpaid monthly rent if not " +
      "paid in full by close of business on the 3rd. NSF fee $30.",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes:
      "9 KFI Staffing units at Park Place (Plymouth, MN): " +
      "500-118, 500-218, 600-127, 600-216, 600-315, 600-342, " +
      "605-102, 605-201, 605-218. Buildings 14500 / 14600 / 14605 " +
      "34th Ave N share the Park Place community office at " +
      "14550 34th Ave N. Landlord/manager: Centerspace LP " +
      "(800 LaSalle Plaza Suite 1600, Minneapolis, MN). Original " +
      "12-month leases ran 2024-12-01 → 2025-11-30; Unit 605-102 " +
      "was renewed Jun 1 – Nov 30 2025 (the original Jun 2024 – " +
      "May 2025 PDF is superseded and not loaded).",
    furnishings: [],
  };
}

function buildClauses(spec: ParkPlaceLeaseSpec): string {
  const renewalNote = spec.isRenewal
    ? " Renewal lease — supersedes the original Jun 2024 – May 2025 PDF."
    : "";
  return [
    `Tenant: KFI Staffing, Unit ${spec.unit} at ${spec.dwellingAddress}, Plymouth, MN 55447 (Park Place community).`,
    `Term: ${spec.startDate} → ${spec.endDate}, then automatic month-to-month unless either party gives 60 days' written notice.${renewalNote}`,
    `Total monthly payment: $${spec.monthlyTotal.toFixed(2)} (apartment rent $${spec.monthlyRent.toFixed(2)} + parking $30.00 + utility billing admin $6.00 + pest control $1.00, plus elected RUBS-allocated water/sewer/stormwater/trash/gas variable charges).`,
    `Parking/garage space: ${spec.parkingSpace} ($30.00/mo).`,
    "Rent due 1st of month. Late fee 8% of unpaid monthly rent if balance not paid in full by close of business on the 3rd. NSF fee $30.",
    "Renters insurance required: $100,000 personal liability minimum, Centerspace LP listed as Additional Interest. Non-compliance fee $20/mo.",
    "Required one-time fees per Basic Terms: Apartment Deposit $400, Administrative Fee $150, Application Fee $50/person, Corporate Lease Setup Fee $375, Utility Account Activation/Deactivation $15 each.",
    "Landlord/manager: Centerspace LP, 800 LaSalle Plaza Suite 1600, Minneapolis, MN.",
    `Source document: ${spec.source}`,
  ].join(" ");
}

function buildLeaseRow(
  id: string,
  propertyId: string,
  spec: ParkPlaceLeaseSpec,
  status: "Active" | "Expired" | "Upcoming",
): InsertLeaseRow {
  const renewalSuffix = spec.isRenewal
    ? " Renewal — supersedes original Jun 2024 – May 2025 PDF."
    : "";
  return {
    id,
    propertyId,
    startDate: spec.startDate,
    endDate: spec.endDate,
    monthlyRent: spec.monthlyRent,
    securityDeposit: 400,
    status,
    notes:
      `${unitMarker(spec.unit)} ${spec.dwellingAddress}. Total billed ` +
      `$${spec.monthlyTotal.toFixed(2)}/mo (rent $${spec.monthlyRent.toFixed(2)} ` +
      `+ parking ${spec.parkingSpace} $30 + utility admin $6 + pest $1).` +
      `${renewalSuffix} Source: ${spec.source}`,
    clauses: buildClauses(spec),
    buyoutAvailable: false,
    buyoutCost: null,
    unit: spec.unit,
  };
}

export interface SeedParkPlaceResult {
  customerInserted: boolean;
  propertyInserted: boolean;
  leasesInserted: number;
  /** Customer the property is attached to after this run. */
  customerId: string;
  /** True when the property was repointed from a KFI Staffing fallback to
   *  the real Cardinal CG (Spring Green) end-client during this run. */
  repointedToEndClient: boolean;
  /** True when the now-orphaned `cust-kfi-park-place` fallback customer
   *  was deleted during this run. */
  fallbackCustomerDeleted: boolean;
}

export interface SeedParkPlaceDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
  now: () => Date;
}

/**
 * Idempotently seed the KFI Staffing customer (reused if any
 * "KFI Staffing%" customer already exists), the Park Place property at
 * 14550 34th Ave N, Plymouth MN 55447, and one lease per unit (9 units).
 * For unit 605-102, only the latest signed PDF (the Jun 1 – Nov 30 2025
 * renewal) is seeded; the original Jun 2024 – May 2025 PDF is treated as
 * superseded. Reconciles by natural keys: customer by name LIKE
 * 'KFI Staffing%', property by (customerId, address, zip), lease by
 * (propertyId, startDate, source-PDF marker in notes). Lease status is
 * computed from term dates vs `now()`, never hard-coded. Never UPDATEs
 * existing rows.
 */
export async function seedParkPlaceIfMissing(
  deps: Partial<SeedParkPlaceDeps> = {},
): Promise<SeedParkPlaceResult> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;
  const now = (deps.now ?? (() => new Date()))();
  const today = todayIso(now);

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
      customerId = PARK_PLACE_CUSTOMER_ID;
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
          eq(propertiesTable.address, PARK_PLACE_ADDRESS),
          eq(propertiesTable.zip, PARK_PLACE_ZIP),
        ),
      )
      .limit(1);

    let propertyId: string;
    let propertyInserted = false;
    if (existingProperty.length > 0) {
      propertyId = existingProperty[0]!.id;
    } else {
      propertyId = PARK_PLACE_PROPERTY_ID;
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
              eq(propertiesTable.address, PARK_PLACE_ADDRESS),
              eq(propertiesTable.zip, PARK_PLACE_ZIP),
            ),
          )
          .limit(1);
        if (reread.length > 0) propertyId = reread[0]!.id;
      }
    }

    let leasesInserted = 0;
    for (const spec of PARK_PLACE_LEASES) {
      const existing = await tx
        .select({ id: leasesTable.id })
        .from(leasesTable)
        .where(
          and(
            eq(leasesTable.propertyId, propertyId),
            eq(leasesTable.startDate, spec.startDate),
            like(leasesTable.notes, `%${spec.source}%`),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;

      const status = computeLeaseStatus(spec.startDate, spec.endDate, today);
      const inserted = await tx
        .insert(leasesTable)
        .values(
          buildLeaseRow(parkPlaceLeaseId(spec.unit), propertyId, spec, status),
        )
        .onConflictDoNothing()
        .returning({ id: leasesTable.id });
      if (inserted.length > 0) leasesInserted += 1;
    }

    // Task #328: repoint AWAY from any KFI Staffing fallback customer to
    // the real Cardinal CG (Spring Green) end-client when present, and
    // clean up the orphaned fallback customer.
    const repoint = await repointFallbackToEndClient({
      tx,
      propertyId,
      currentCustomerId: customerId,
      endClientNamePattern: PARK_PLACE_END_CLIENT_NAME_PATTERN,
      fallbackNamePattern: KFI_CUSTOMER_NAME_PATTERN,
      fallbackCustomerId: PARK_PLACE_CUSTOMER_ID,
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
    log.info(result, "Park Place KFI seed applied.");
  }
  return result;
}

export const PARK_PLACE_UNITS = PARK_PLACE_LEASES.map((l) => l.unit);
