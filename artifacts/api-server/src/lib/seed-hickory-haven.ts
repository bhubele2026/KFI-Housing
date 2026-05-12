import { and, eq, like } from "drizzle-orm";
import {
  db,
  customersTable,
  propertiesTable,
  leasesTable,
  roomsTable,
  bedsTable,
  occupantsTable,
  type InsertCustomerRow,
  type InsertPropertyRow,
  type InsertLeaseRow,
  type InsertRoomRow,
  type InsertBedRow,
  type InsertOccupantRow,
} from "@workspace/db";
import { logger as defaultLogger } from "./logger";
import { normalizeOccupantRow, normalizeBedRow } from "./db-row-normalizers";
import { computeLeaseStatus, todayIso } from "./lease-status";
import { repointFallbackToEndClient } from "./seed-fallback-repoint";
import type { Logger } from "pino";

/**
 * Hickory Haven Apartments — 600 W Hickory St, Gilman, WI 54433.
 *
 * Four active KFI Staffing leases (Task #294), one per apartment (6, 8,
 * 11, 12). Modeled the same way as Patriot Baraboo (Task #292):
 * a single property record for the building, four lease rows
 * differentiated by a "Unit N —" marker in `notes` for dedupe.
 *
 * Task #568 layered on the bedroom + occupant roster from the source
 * sheet (`attached_assets/image_1778608080549.png`): six bedrooms
 * across the four apartments, ten beds total, seven currently occupied
 * by WB Manufacturing crew. Bedrooms are modeled as `rooms` rows
 * (the app treats `roomsTable` as the bedroom unit — see
 * `computeRoomTotals` in `mockData.ts` and the property-detail
 * "Rooms in use" / "Beds occupied" / "Beds available" stats),
 * named `Apt {unit} — Bedroom {n}` so the apartment grouping is
 * visible without changing the schema.
 *
 * Idempotent: customer reused if any "KFI Staffing%" already
 * exists, property reconciled by (customerId, address, zip), each
 * lease reconciled by (propertyId, startDate, endDate, "Unit N —"
 * marker), each room reconciled by (propertyId, name), each bed by
 * (propertyId, roomId, bedNumber), each occupant by (propertyId,
 * name). Never UPDATEs existing rows so operator edits survive — the
 * one exception is back-filling `beds.occupantId` when the bed exists
 * with no occupant AND we just inserted the matching occupant
 * (mirrors Patriot Baraboo's behaviour).
 */

export const HICKORY_HAVEN_CUSTOMER_ID = "cust-kfi-hickory-haven";
export const HICKORY_HAVEN_PROPERTY_ID = "prop-hickory-haven-600-hickory";
export const hickoryHavenLeaseId = (unit: string): string =>
  `lease-hickory-haven-u${unit}`;
export const hickoryHavenRoomId = (unit: string, bedroom: number): string =>
  `room-hickory-haven-u${unit}-br${bedroom}`;
export const hickoryHavenBedId = (
  unit: string,
  bedroom: number,
  slot: number,
): string => `bed-hickory-haven-u${unit}-br${bedroom}-s${slot}`;
export const hickoryHavenOccupantId = (
  unit: string,
  bedroom: number,
  slot: number,
): string => `occ-hickory-haven-u${unit}-br${bedroom}-s${slot}`;

const KFI_CUSTOMER_NAME_DEFAULT = "KFI Staffing – Hickory Haven, WI";
const KFI_CUSTOMER_NAME_PATTERN = "KFI Staffing%";
/**
 * Real downstream end-client per master file row 8 (`WB Manufactoring -
 * Thorp, WI`, sic — typo preserved verbatim from the master file).
 * The pattern intentionally accepts BOTH spellings (`WB Manufact%`) so
 * the seed attaches the property to either the typo'd master-file
 * customer (`WB Manufactoring`) or the corrected name (`WB
 * Manufacturing`) — whichever exists. The master file pins units 6,
 * 8, 11, 12 — exactly the four units this seed manages — to WB, so
 * the property is attached directly to WB on a fresh seed when a WB
 * customer already exists, and otherwise repointed when one shows up
 * later (Task #328 / #568).
 */
const HICKORY_HAVEN_END_CLIENT_NAME_PATTERN = "WB Manufact%";
/** End-client name stamped onto seeded occupants' `company` column. */
const HICKORY_HAVEN_END_CLIENT = "WB Manufacturing";

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

/**
 * Per-apartment bedroom layout from the Task #568 source sheet
 * (`attached_assets/image_1778608080549.png`). Each entry creates one
 * `rooms` row plus `capacity` `beds` rows under it. Bedroom numbers
 * within an apartment start at 1 and match the "Bedroom #" column in
 * the sheet. Apartment 11 is a studio in the source ("0-Studio") but
 * still has one shared sleeping area with capacity 2 — modeled as a
 * single Bedroom 1 so the bed count lines up.
 */
interface HickoryHavenBedroomSpec {
  unit: string;
  bedroom: number;
  capacity: number;
}

const HICKORY_HAVEN_BEDROOMS: readonly HickoryHavenBedroomSpec[] = [
  { unit: "6", bedroom: 1, capacity: 2 },
  { unit: "6", bedroom: 2, capacity: 1 },
  { unit: "8", bedroom: 1, capacity: 2 },
  { unit: "11", bedroom: 1, capacity: 2 },
  { unit: "12", bedroom: 1, capacity: 2 },
  { unit: "12", bedroom: 2, capacity: 1 },
];

/**
 * Currently-placed WB Manufacturing crew, one entry per occupied bed.
 * Vacant beds are derived from the bedroom capacity (capacity − number
 * of roster entries for that bedroom). Names match the
 * `seed-housing-deductions` payroll roster verbatim so that downstream
 * seeder picks them up by name and stamps `employeeId`,
 * `chargePerBed`, and `billingFrequency`.
 *
 * Total: 7 occupied beds across 5 distinct bedrooms — matches the
 * source sheet's "5 rooms in use, 7 occupied beds, 3 beds available"
 * footer (10 total beds − 7 occupied = 3 available).
 */
interface HickoryHavenOccupantSpec {
  unit: string;
  bedroom: number;
  slot: number;
  name: string;
}

const HICKORY_HAVEN_ROSTER: readonly HickoryHavenOccupantSpec[] = [
  { unit: "6",  bedroom: 1, slot: 1, name: "Gilberto Lara" },
  { unit: "8",  bedroom: 1, slot: 1, name: "Andrew Castaneda" },
  { unit: "8",  bedroom: 1, slot: 2, name: "Dennis Jordan" },
  { unit: "11", bedroom: 1, slot: 1, name: "Martin Hust" },
  { unit: "12", bedroom: 1, slot: 1, name: "Isaiah Young" },
  { unit: "12", bedroom: 1, slot: 2, name: "Jacob Novak" },
  { unit: "12", bedroom: 2, slot: 1, name: "Sterlin Adams" },
];

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
  today: string,
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
    status: computeLeaseStatus(spec.startDate, spec.endDate, today),
    notes:
      `${unitMarker(spec.unit)} KFI Staffing fixed-term lease at Hickory Haven ` +
      `Apartments, $${spec.monthlyRent.toFixed(2)}/mo.${proratedNote} ` +
      `Source: ${spec.source}`,
    clauses: buildClauses(spec),
    buyoutAvailable: false,
    buyoutCost: null,
  };
}

function bedroomRoomName(spec: HickoryHavenBedroomSpec): string {
  return `Apt ${spec.unit} — Bedroom ${spec.bedroom}`;
}

function buildRoomRow(
  spec: HickoryHavenBedroomSpec,
  propertyId: string,
): InsertRoomRow {
  return {
    id: hickoryHavenRoomId(spec.unit, spec.bedroom),
    propertyId,
    name: bedroomRoomName(spec),
    sqft: 0,
    bathrooms: 0,
    monthlyRent: 0,
  };
}

function buildBedRow(
  propertyId: string,
  roomId: string,
  unit: string,
  bedroom: number,
  slot: number,
  occupantId: string | null,
): InsertBedRow {
  return {
    id: hickoryHavenBedId(unit, bedroom, slot),
    propertyId,
    bedNumber: slot,
    roomId,
    status: occupantId ? "Occupied" : "Vacant",
    occupantId,
  };
}

function buildOccupantRow(
  spec: HickoryHavenOccupantSpec,
  propertyId: string,
  bedId: string | null,
): InsertOccupantRow {
  return {
    id: hickoryHavenOccupantId(spec.unit, spec.bedroom, spec.slot),
    name: spec.name,
    email: "",
    phone: "",
    bedId,
    propertyId,
    moveInDate: "",
    moveOutDate: null,
    status: "Active",
    chargePerBed: 0,
    billingFrequency: "Weekly",
    employeeId: "",
    company: HICKORY_HAVEN_END_CLIENT,
  };
}

export interface SeedHickoryHavenResult {
  customerInserted: boolean;
  propertyInserted: boolean;
  leasesInserted: number;
  roomsInserted: number;
  bedsInserted: number;
  occupantsInserted: number;
  /** Customer the property is attached to after this run. */
  customerId: string;
  /** True when the property was repointed from a KFI Staffing fallback to
   *  the real WB Manufactoring end-client during this run. */
  repointedToEndClient: boolean;
  /** True when the now-orphaned `cust-kfi-hickory-haven` fallback
   *  customer was deleted during this run. */
  fallbackCustomerDeleted: boolean;
}

export interface SeedHickoryHavenDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
  now: () => Date;
}

export async function seedHickoryHavenIfMissing(
  deps: Partial<SeedHickoryHavenDeps> = {},
): Promise<SeedHickoryHavenResult> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;
  const today = todayIso((deps.now ?? (() => new Date()))());

  const result = await database.transaction(async (tx) => {
    // Prefer the real WB Manufacturing end-client when it already
    // exists (master-file row 8 pins units 6, 8, 11, 12 to WB), so a
    // fresh seed attaches the property directly to WB without going
    // through the KFI Staffing fallback. Only when no WB customer is
    // present yet do we fall back to creating the deterministic KFI
    // Staffing per-property fallback customer; the repoint step at
    // the end of the transaction will swap to WB the moment the real
    // customer shows up later.
    const existingEndClient = await tx
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(like(customersTable.name, HICKORY_HAVEN_END_CLIENT_NAME_PATTERN))
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
        .values(buildLeaseRow(hickoryHavenLeaseId(spec.unit), propertyId, spec, today))
        .onConflictDoNothing()
        .returning({ id: leasesTable.id });
      if (inserted.length > 0) leasesInserted += 1;
    }

    // Bedrooms (Task #568): one `rooms` row per bedroom in the source
    // sheet. Reconcile by (propertyId, name) so an operator-created
    // bedroom with the same "Apt N — Bedroom M" name is reused
    // instead of duplicated.
    let roomsInserted = 0;
    const roomIdByKey = new Map<string, string>();
    for (const spec of HICKORY_HAVEN_BEDROOMS) {
      const key = `${spec.unit}/${spec.bedroom}`;
      const name = bedroomRoomName(spec);
      const existing = await tx
        .select({ id: roomsTable.id })
        .from(roomsTable)
        .where(
          and(
            eq(roomsTable.propertyId, propertyId),
            eq(roomsTable.name, name),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        roomIdByKey.set(key, existing[0]!.id);
        continue;
      }
      const row = buildRoomRow(spec, propertyId);
      const inserted = await tx
        .insert(roomsTable)
        .values(row)
        .onConflictDoNothing()
        .returning({ id: roomsTable.id });
      if (inserted.length > 0) {
        roomsInserted += 1;
        roomIdByKey.set(key, row.id);
      } else {
        const reread = await tx
          .select({ id: roomsTable.id })
          .from(roomsTable)
          .where(
            and(
              eq(roomsTable.propertyId, propertyId),
              eq(roomsTable.name, name),
            ),
          )
          .limit(1);
        if (reread.length > 0) roomIdByKey.set(key, reread[0]!.id);
      }
    }

    // Occupants + beds (Task #568). Walk every (apartment, bedroom,
    // slot) — placed slots are taken from `HICKORY_HAVEN_ROSTER`,
    // empty slots get a vacant bed up to the bedroom's capacity.
    // Reconcile occupants by (propertyId, name) and beds by
    // (propertyId, roomId, bedNumber); the only UPDATE we ever issue
    // is back-filling `beds.occupantId` when the bed exists with no
    // occupant AND we just inserted the matching occupant — never
    // overwrites an operator tenant assignment. Mirrors the
    // Patriot Baraboo seeder's logic.
    const occupantBySlot = new Map<string, HickoryHavenOccupantSpec>();
    for (const occ of HICKORY_HAVEN_ROSTER) {
      occupantBySlot.set(`${occ.unit}/${occ.bedroom}/${occ.slot}`, occ);
    }

    let bedsInserted = 0;
    let occupantsInserted = 0;
    for (const bedroomSpec of HICKORY_HAVEN_BEDROOMS) {
      const roomId = roomIdByKey.get(`${bedroomSpec.unit}/${bedroomSpec.bedroom}`);
      if (!roomId) continue;

      for (let slot = 1; slot <= bedroomSpec.capacity; slot++) {
        const occSpec = occupantBySlot.get(
          `${bedroomSpec.unit}/${bedroomSpec.bedroom}/${slot}`,
        );

        const existingBed = await tx
          .select({ id: bedsTable.id, occupantId: bedsTable.occupantId })
          .from(bedsTable)
          .where(
            and(
              eq(bedsTable.propertyId, propertyId),
              eq(bedsTable.roomId, roomId),
              eq(bedsTable.bedNumber, slot),
            ),
          )
          .limit(1);
        const bedAlreadyTaken =
          existingBed.length > 0 &&
          existingBed[0]!.occupantId !== null &&
          existingBed[0]!.occupantId !== "";
        const bedId: string | null = bedAlreadyTaken
          ? null
          : existingBed.length > 0
            ? existingBed[0]!.id
            : hickoryHavenBedId(
                bedroomSpec.unit,
                bedroomSpec.bedroom,
                slot,
              );

        let occupantId: string | null = null;
        let occupantWasInserted = false;
        if (occSpec) {
          const existingOcc = await tx
            .select({ id: occupantsTable.id })
            .from(occupantsTable)
            .where(
              and(
                eq(occupantsTable.propertyId, propertyId),
                eq(occupantsTable.name, occSpec.name),
              ),
            )
            .limit(1);
          if (existingOcc.length > 0) {
            occupantId = existingOcc[0]!.id;
          } else {
            const row = buildOccupantRow(occSpec, propertyId, bedId);
            const inserted = await tx
              .insert(occupantsTable)
              .values(normalizeOccupantRow(row))
              .onConflictDoNothing()
              .returning({ id: occupantsTable.id });
            if (inserted.length > 0) {
              occupantId = row.id;
              occupantsInserted += 1;
              occupantWasInserted = true;
            } else {
              const reread = await tx
                .select({ id: occupantsTable.id })
                .from(occupantsTable)
                .where(
                  and(
                    eq(occupantsTable.propertyId, propertyId),
                    eq(occupantsTable.name, occSpec.name),
                  ),
                )
                .limit(1);
              occupantId = reread.length > 0 ? reread[0]!.id : row.id;
            }
          }
        }

        if (existingBed.length > 0) {
          if (
            occupantWasInserted &&
            occupantId &&
            (existingBed[0]!.occupantId === null ||
              existingBed[0]!.occupantId === "")
          ) {
            await tx
              .update(bedsTable)
              .set(normalizeBedRow({ occupantId, status: "Occupied" }))
              .where(eq(bedsTable.id, existingBed[0]!.id));
          }
          continue;
        }

        const bedRow = buildBedRow(
          propertyId,
          roomId,
          bedroomSpec.unit,
          bedroomSpec.bedroom,
          slot,
          occupantId,
        );
        const insertedBed = await tx
          .insert(bedsTable)
          .values(normalizeBedRow(bedRow))
          .onConflictDoNothing()
          .returning({ id: bedsTable.id });
        if (insertedBed.length > 0) bedsInserted += 1;
      }
    }

    // Task #328: repoint AWAY from any KFI Staffing fallback customer
    // to the real WB Manufactoring end-client when present, and clean
    // up the orphaned fallback customer.
    const repoint = await repointFallbackToEndClient({
      tx,
      propertyId,
      currentCustomerId: customerId,
      endClientNamePattern: HICKORY_HAVEN_END_CLIENT_NAME_PATTERN,
      fallbackNamePattern: KFI_CUSTOMER_NAME_PATTERN,
      fallbackCustomerId: HICKORY_HAVEN_CUSTOMER_ID,
    });

    return {
      customerInserted,
      propertyInserted,
      leasesInserted,
      roomsInserted,
      bedsInserted,
      occupantsInserted,
      customerId: repoint.customerId,
      repointedToEndClient: repoint.repointedToEndClient,
      fallbackCustomerDeleted: repoint.fallbackCustomerDeleted,
    };
  });

  if (
    result.customerInserted ||
    result.propertyInserted ||
    result.leasesInserted > 0 ||
    result.roomsInserted > 0 ||
    result.bedsInserted > 0 ||
    result.occupantsInserted > 0 ||
    result.repointedToEndClient ||
    result.fallbackCustomerDeleted
  ) {
    log.info(result, "Hickory Haven seed applied.");
  }
  return result;
}
