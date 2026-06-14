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
 * Sunset Place Apartments — 216 Sunset Place, Neillsville, WI 54456.
 *
 * WB Manufacturing crew housing leased from Lisenby Properties LLC and
 * managed through the Lanyard vendor. Source: the executed lease PDFs
 * harvested from SharePoint `Housing Master File and Leases/Leases/WB
 * Manufacturing - Thorp, WI - Lanyard - Sunset Place Apts` (the folder
 * is labeled Thorp but every lease document states Neillsville).
 *
 * Modeled exactly like seed-hickory-haven / seed-greenock-manor: one
 * property record for the building, one lease row per unit, dedup by a
 * "Unit N —" marker in `notes`. Idempotent — customer reconciled by
 * name LIKE 'KFI Staffing%' (or the real WB end-client when present),
 * property by (customerId, address, zip), each lease by (propertyId,
 * startDate, endDate, "Unit N —" marker). Never UPDATEs existing rows
 * so operator edits survive.
 *
 * Units 132 and 134 (ADA) are seeded with needsReview=true because
 * their lease PDFs were not machine-readable — rent/deposit are unknown
 * and must be filled in by an operator. Units 148 → 106 and 221 → 132
 * are mid-transfer per the June 2026 move-in instructions (#D5CYJY);
 * the outgoing 148/221 leases are kept (operator can mark Expired once
 * the transfers complete).
 */

export const SUNSET_PLACE_CUSTOMER_ID = "cust-kfi-sunset-place";
export const SUNSET_PLACE_PROPERTY_ID = "prop-sunset-place-neillsville";
export const sunsetPlaceLeaseId = (unit: string): string =>
  `lease-sunset-place-u${unit}`;

const KFI_CUSTOMER_NAME_DEFAULT = "KFI Staffing – Sunset Place, WI";
const KFI_CUSTOMER_NAME_PATTERN = "KFI Staffing%";
/**
 * Real downstream end-client. Master file pins Sunset Place to
 * `WB Manufactoring - Thorp, WI` (sic). Pattern accepts both the
 * typo'd master-file spelling and the corrected one (matches the
 * Hickory Haven convention, Task #328 / #294).
 */
const SUNSET_PLACE_END_CLIENT_NAME_PATTERN = "WB Manufact%";

const SUNSET_ADDRESS = "216 Sunset Place";
const SUNSET_CITY = "Neillsville";
const SUNSET_STATE = "WI";
const SUNSET_ZIP = "54456";
const SUNSET_WEEKLY_COST = 115;
const SUNSET_VENDOR = "Lanyard";

interface SunsetLeaseSpec {
  unit: string;
  startDate: string;
  endDate: string;
  /** null when the lease PDF was unreadable and rent is unknown. */
  monthlyRent: number | null;
  securityDeposit: number | null;
  source: string;
  extraNote?: string;
}

const SUNSET_PLACE_LEASES: readonly SunsetLeaseSpec[] = [
  {
    unit: "148",
    startDate: "2026-05-28",
    endDate: "2026-11-30",
    monthlyRent: 989,
    securityDeposit: 989,
    source: "Fully Executed Lease - 216 Sunset Place, 148.pdf",
    extraNote: "Transferring to Unit 106 on 2026-07-08 (#D5CYJY).",
  },
  {
    unit: "221",
    startDate: "2026-05-28",
    endDate: "2026-11-30",
    monthlyRent: 1169,
    securityDeposit: 1169,
    source: "Lease - WB - 216 Sunset Place, Unit 221.pdf",
    extraNote: "Transferred to Unit 132 on 2026-06-12 (#D5CYJY).",
  },
  {
    unit: "117",
    startDate: "2026-06-01",
    endDate: "2027-03-31",
    monthlyRent: 1109,
    securityDeposit: 1109,
    source: "Lease Agreement - Sunset Place Apartments Unit 117.pdf",
  },
  {
    unit: "215",
    startDate: "2026-06-01",
    endDate: "2027-03-31",
    monthlyRent: 1309,
    securityDeposit: 1309,
    source: "Lease Agreement - Sunset Place Apartments Unit 215.pdf",
  },
  {
    unit: "106",
    startDate: "2026-07-08",
    endDate: "2026-11-30",
    monthlyRent: 939,
    securityDeposit: 939,
    source: "Sunset Place Lease - 106.pdf",
    extraNote: "Receives transfer from Unit 148.",
  },
  {
    unit: "132",
    startDate: "2026-06-12",
    endDate: "2026-11-30",
    monthlyRent: null,
    securityDeposit: null,
    source: "Sunset Place Lease - 132.pdf",
    extraNote:
      "Receives transfer from Unit 221. Lease PDF not machine-readable — rent/deposit need manual entry.",
  },
  {
    unit: "134",
    startDate: "",
    endDate: "",
    monthlyRent: null,
    securityDeposit: null,
    source: "Lease Agreement - Sunset Place Apartments Unit 134 ADA.pdf",
    extraNote: "ADA unit. Lease PDF not machine-readable — terms need manual entry.",
  },
];

const TOTAL_MONTHLY_RENT = SUNSET_PLACE_LEASES.reduce(
  (sum, lease) => sum + (lease.monthlyRent ?? 0),
  0,
);

function buildCustomerRow(id: string): InsertCustomerRow {
  return {
    id,
    name: KFI_CUSTOMER_NAME_DEFAULT,
    contactName: "",
    email: "",
    phone: "",
    notes:
      "KFI Staffing crew housing at Sunset Place Apartments, 216 Sunset Place, " +
      "Neillsville, WI 54456, for WB Manufacturing. Landlord: Lisenby Properties " +
      "LLC. Vendor: Lanyard. Housing Request #D5CYJY.",
  };
}

function buildPropertyRow(id: string, customerId: string): InsertPropertyRow {
  return {
    id,
    customerId,
    name: "Sunset Place Apartments – Neillsville, WI",
    address: SUNSET_ADDRESS,
    city: SUNSET_CITY,
    state: SUNSET_STATE,
    zip: SUNSET_ZIP,
    totalBeds: 0,
    monthlyRent: TOTAL_MONTHLY_RENT,
    chargePerBed: 0,
    status: "Active",
    landlordName: "Lisenby Properties LLC",
    landlordEmail: "",
    landlordPhone: "",
    paymentMethod: "ACH",
    paymentRecipient: "Lisenby Properties LLC",
    paymentDueDay: 1,
    paymentNotes:
      "Rent due 1st of month. Vendor billing via Lanyard. Some units include " +
      "landlord-provided internet/cable/garbage.",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes:
      "WB Manufacturing housing (Housing Request #D5CYJY). Units 148, 221, 117, " +
      "215, 106 have executed leases; units 132 and 134 (ADA) need manual rent " +
      "entry (lease PDFs were not machine-readable). Units 148→106 and 221→132 " +
      "are mid-transfer per June 2026 move-in instructions. Landlord: Lisenby " +
      "Properties LLC. Source: SharePoint Housing Master File and Leases.",
    furnishings: [],
  };
}

function unitMarker(unit: string): string {
  return `Unit ${unit} —`;
}

function buildClauses(spec: SunsetLeaseSpec): string {
  const parts = [
    `Tenant: KFI Staffing, Unit ${spec.unit} at 216 Sunset Place, Neillsville, WI 54456.`,
  ];
  if (spec.startDate && spec.endDate) {
    parts.push(`Term: ${spec.startDate} → ${spec.endDate} (fixed term).`);
  }
  if (spec.monthlyRent !== null) {
    parts.push(`Monthly rent: $${spec.monthlyRent.toFixed(2)}, due 1st of month.`);
  }
  if (spec.securityDeposit !== null) {
    parts.push(`Security deposit: $${spec.securityDeposit.toFixed(2)}.`);
  }
  parts.push(
    "Early termination: 60 days' written notice.",
    "Vendor: Lanyard. Landlord: Lisenby Properties LLC.",
  );
  if (spec.extraNote) parts.push(spec.extraNote);
  parts.push(`Source document: ${spec.source}.`);
  return parts.join(" ");
}

function buildLeaseRow(
  id: string,
  propertyId: string,
  spec: SunsetLeaseSpec,
  today: string,
): InsertLeaseRow {
  const needsReview = spec.monthlyRent === null;
  const status = needsReview
    ? "Upcoming"
    : computeLeaseStatus(spec.startDate, spec.endDate, today);
  const rentNote =
    spec.monthlyRent !== null
      ? `$${spec.monthlyRent.toFixed(2)}/mo.`
      : "Rent unknown — needs manual entry.";
  return {
    id,
    propertyId,
    unit: spec.unit,
    startDate: spec.startDate,
    endDate: spec.endDate,
    monthlyRent: spec.monthlyRent ?? 0,
    securityDeposit: spec.securityDeposit ?? 0,
    status,
    weeklyCost: SUNSET_WEEKLY_COST,
    vendor: SUNSET_VENDOR,
    needsReview,
    noticePeriodDays: 60,
    notes:
      `${unitMarker(spec.unit)} KFI Staffing lease at Sunset Place Apartments, ` +
      `${rentNote}${spec.extraNote ? ` ${spec.extraNote}` : ""} Source: ${spec.source}`,
    clauses: buildClauses(spec),
    buyoutAvailable: false,
    buyoutCost: null,
  };
}

export interface SeedSunsetPlaceResult {
  customerInserted: boolean;
  propertyInserted: boolean;
  leasesInserted: number;
  customerId: string;
  repointedToEndClient: boolean;
  fallbackCustomerDeleted: boolean;
}

export interface SeedSunsetPlaceDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
  now: () => Date;
}

export async function seedSunsetPlaceIfMissing(
  deps: Partial<SeedSunsetPlaceDeps> = {},
): Promise<SeedSunsetPlaceResult> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;
  const today = todayIso((deps.now ?? (() => new Date()))());

  const result = await database.transaction(async (tx) => {
    const existingEndClient = await tx
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(like(customersTable.name, SUNSET_PLACE_END_CLIENT_NAME_PATTERN))
      .limit(1);
    const existingFallback = await tx
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(like(customersTable.name, KFI_CUSTOMER_NAME_PATTERN))
      .limit(1);

    let customerId: string;
    let customerInserted = false;
    if (existingEndClient.length > 0) {
      customerId = existingEndClient[0]!.id;
    } else if (existingFallback.length > 0) {
      customerId = existingFallback[0]!.id;
    } else {
      customerId = SUNSET_PLACE_CUSTOMER_ID;
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
          eq(propertiesTable.address, SUNSET_ADDRESS),
          eq(propertiesTable.zip, SUNSET_ZIP),
        ),
      )
      .limit(1);

    let propertyId: string;
    let propertyInserted = false;
    if (existingProperty.length > 0) {
      propertyId = existingProperty[0]!.id;
    } else {
      propertyId = SUNSET_PLACE_PROPERTY_ID;
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
              eq(propertiesTable.address, SUNSET_ADDRESS),
              eq(propertiesTable.zip, SUNSET_ZIP),
            ),
          )
          .limit(1);
        if (reread.length > 0) propertyId = reread[0]!.id;
      }
    }

    let leasesInserted = 0;
    for (const spec of SUNSET_PLACE_LEASES) {
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
        .values(buildLeaseRow(sunsetPlaceLeaseId(spec.unit), propertyId, spec, today))
        .onConflictDoNothing()
        .returning({ id: leasesTable.id });
      if (inserted.length > 0) leasesInserted += 1;
    }

    const repoint = await repointFallbackToEndClient({
      tx,
      propertyId,
      currentCustomerId: customerId,
      endClientNamePattern: SUNSET_PLACE_END_CLIENT_NAME_PATTERN,
      fallbackNamePattern: KFI_CUSTOMER_NAME_PATTERN,
      fallbackCustomerId: SUNSET_PLACE_CUSTOMER_ID,
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
    log.info(result, "Sunset Place seed applied.");
  }
  return result;
}
