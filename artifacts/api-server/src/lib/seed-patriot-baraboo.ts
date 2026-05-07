import { and, eq, isNull, like } from "drizzle-orm";
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
import {
  applyInsuranceCertificates,
  type InsuranceCertificateSpec,
} from "./seed-insurance-certificates";
import type { Logger } from "pino";

/**
 * Insurance certificates on file for 1850 W. Pine St., Baraboo (Task #334).
 * Currently empty: the source ACORD 25 cert PDF is not attached to the
 * project. The wiring is in place — operators receiving the cert by
 * email should either POST it to `/api/insurance-certificates`
 * directly, or, when the PDF is later attached, drop a single
 * `{ id, carrier, policyNumber, … }` entry below and it will replay
 * idempotently across resets. Each lease for these units already
 * captures the `insurance compliance admin` line item in its clauses
 * (see `buildClauses` above) so the link to the cert is documented.
 */
interface PatriotBarabooCertificateSpec {
  id: string;
  carrier: string;
  policyNumber: string;
  insuredName: string;
  coverageStart: string;
  coverageEnd: string;
  documentUrl: string;
  notes: string;
}
const PATRIOT_BARABOO_CERTIFICATES: readonly PatriotBarabooCertificateSpec[] =
  [];

export const PATRIOT_BARABOO_CUSTOMER_ID = "cust-kfi-baraboo";
export const PATRIOT_BARABOO_PROPERTY_ID = "prop-patriot-baraboo-1850-pine";
export const patriotBarabooLeaseId = (unit: string): string =>
  `lease-patriot-baraboo-u${unit}`;
export const patriotBarabooRoomId = (unit: string): string =>
  `room-patriot-baraboo-u${unit}`;
export const patriotBarabooBedId = (unit: string, slot: number): string =>
  `bed-patriot-baraboo-u${unit}-b${slot}`;
export const patriotBarabooOccupantId = (unit: string, slot: number): string =>
  `occ-patriot-baraboo-u${unit}-b${slot}`;

const KFI_CUSTOMER_NAME_DEFAULT = "KFI Staffing – Baraboo, WI";
const KFI_CUSTOMER_NAME_PATTERN = "KFI Staffing%";
/**
 * Real downstream end-client for this property, per master file row 3
 * (`Milwaukee Valve` at 1850 W. Pine St., Baraboo, WI). Matched LIKE so
 * either the master-file form or any city/region suffix
 * (e.g. `"Milwaukee Valve - Baraboo, WI"`) resolves to the same
 * customer (Task #328).
 */
const PATRIOT_BARABOO_END_CLIENT_NAME_PATTERN = "Milwaukee Valve%";
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
      "Properties of any tenant changes. End-client: Milwaukee Valve. " +
      "Occupant roster sourced from the Housing Master File 2026 " +
      "(MV.Baraboo,WI sheet); each unit hot-beds 4 adults across two " +
      "bedrooms (Days shift 5am–2pm, Nights shift 2pm–midnight).",
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
  status: "Active" | "Expired" | "Upcoming",
): InsertLeaseRow {
  return {
    id,
    propertyId,
    startDate: PATRIOT_LEASE_START,
    endDate: PATRIOT_LEASE_END,
    monthlyRent: PATRIOT_RENT,
    securityDeposit: PATRIOT_DEPOSIT,
    status,
    notes:
      `${unitMarker(spec.unit)} 12-month corporate lease; KFI to notify ` +
      `Patriot Properties of any tenant changes. Total billed $1,690 ` +
      `($1,675 rent + $10.50 LLI + $4.50 insurance admin). ` +
      `Source: ${spec.source}`,
    clauses: buildClauses(spec),
    buyoutAvailable: false,
    buyoutCost: null,
    unit: spec.unit,
  };
}

/**
 * Per-unit occupant roster sourced from the Housing Master File 2026
 * (sheet `MV.Baraboo,WI`). Each unit physically has two bedrooms; the
 * crew hot-beds across two shifts, so the lease's 4-adult cap shows up
 * here as 4 occupants per unit. Slot 1/2 share bedroom A (sheet "Bed
 * 1"), slot 3/4 share bedroom B (sheet "Bed 2"). Move-in dates are the
 * Excel serials from the master sheet (45931 → 2025-09-30, 45934 →
 * 2025-10-03).
 */
interface PatriotBarabooOccupantSpec {
  unit: string;
  slot: 1 | 2 | 3 | 4;
  name: string;
  moveInDate: string;
  shift: "Days" | "Nights";
}

const PATRIOT_BARABOO_ROSTER: readonly PatriotBarabooOccupantSpec[] = [
  // Unit 509
  { unit: "509", slot: 1, name: "Eladio Ramos Jr",         moveInDate: "2025-10-03", shift: "Days" },
  { unit: "509", slot: 2, name: "Lawrence Cortez",         moveInDate: "2025-10-03", shift: "Nights" },
  { unit: "509", slot: 3, name: "Pedro Garcia",            moveInDate: "2025-10-03", shift: "Days" },
  { unit: "509", slot: 4, name: "Jonathan Ariola",         moveInDate: "2025-10-03", shift: "Nights" },
  // Unit 510
  { unit: "510", slot: 1, name: "Claudio Alvarado",        moveInDate: "2025-10-03", shift: "Days" },
  { unit: "510", slot: 2, name: "Juan Lozada Lugo",        moveInDate: "2025-10-03", shift: "Nights" },
  { unit: "510", slot: 3, name: "Carlos Galvez Garcia",    moveInDate: "2025-10-03", shift: "Days" },
  { unit: "510", slot: 4, name: "Jacob Zepeda",            moveInDate: "2025-10-03", shift: "Nights" },
  // Unit 512
  { unit: "512", slot: 1, name: "Alexander A Marrero",     moveInDate: "2025-09-30", shift: "Days" },
  { unit: "512", slot: 2, name: "Alexis Perez",            moveInDate: "2025-09-30", shift: "Nights" },
  { unit: "512", slot: 3, name: "Xavior R Robinson",       moveInDate: "2025-09-30", shift: "Days" },
  { unit: "512", slot: 4, name: "Dorian Kyles",            moveInDate: "2025-09-30", shift: "Nights" },
  // Unit 811
  { unit: "811", slot: 1, name: "Moices Bernal",           moveInDate: "2025-09-30", shift: "Days" },
  { unit: "811", slot: 2, name: "Jacob C Ferguson",        moveInDate: "2025-09-30", shift: "Nights" },
  { unit: "811", slot: 3, name: "Gabriel Romero",          moveInDate: "2025-09-30", shift: "Days" },
  { unit: "811", slot: 4, name: "Ricco Antonio Lorenzana", moveInDate: "2025-09-30", shift: "Nights" },
  // Unit 812
  { unit: "812", slot: 1, name: "Abein Flores",            moveInDate: "2025-10-03", shift: "Days" },
  { unit: "812", slot: 2, name: "Antonio Hernandez",       moveInDate: "2025-10-03", shift: "Nights" },
  { unit: "812", slot: 3, name: "Jose Castro",             moveInDate: "2025-10-03", shift: "Days" },
  { unit: "812", slot: 4, name: "Ismael Meza",             moveInDate: "2025-10-03", shift: "Nights" },
];

export const PATRIOT_BARABOO_END_CLIENT = "Milwaukee Valve";
const PATRIOT_BARABOO_CHARGE_PER_BED = PATRIOT_RENT / 4; // 418.75

function buildRoomRow(unit: string, propertyId: string): InsertRoomRow {
  return {
    id: patriotBarabooRoomId(unit),
    propertyId,
    name: `Unit ${unit}`,
    sqft: 0,
    bathrooms: 0,
    monthlyRent: PATRIOT_RENT,
  };
}

function buildBedRow(
  spec: PatriotBarabooOccupantSpec,
  propertyId: string,
  occupantId: string | null,
): InsertBedRow {
  return {
    id: patriotBarabooBedId(spec.unit, spec.slot),
    propertyId,
    bedNumber: spec.slot,
    roomId: patriotBarabooRoomId(spec.unit),
    status: occupantId ? "Occupied" : "Vacant",
    occupantId,
  };
}

function buildOccupantRow(
  spec: PatriotBarabooOccupantSpec,
  propertyId: string,
): InsertOccupantRow {
  return {
    id: patriotBarabooOccupantId(spec.unit, spec.slot),
    name: spec.name,
    email: "",
    phone: "",
    bedId: patriotBarabooBedId(spec.unit, spec.slot),
    propertyId,
    moveInDate: spec.moveInDate,
    moveOutDate: null,
    status: "Active",
    chargePerBed: PATRIOT_BARABOO_CHARGE_PER_BED,
    billingFrequency: "Monthly",
    employeeId: "",
    company: PATRIOT_BARABOO_END_CLIENT,
    shift: spec.shift,
  };
}

export interface SeedPatriotBarabooResult {
  customerInserted: boolean;
  propertyInserted: boolean;
  leasesInserted: number;
  roomsInserted: number;
  bedsInserted: number;
  occupantsInserted: number;
  /** Number of insurance certificate rows newly inserted on this run.
   *  Always 0 today (PATRIOT_BARABOO_CERTIFICATES is empty); see
   *  comment on that array for the documented intake path. */
  certificatesInserted: number;
  /** Customer the property is attached to after this run. Either the
   *  Milwaukee Valve end-client (when found) or a KFI Staffing fallback. */
  customerId: string;
  /** True when the property was repointed from a KFI Staffing fallback to
   *  the real Milwaukee Valve end-client during this run. */
  repointedToEndClient: boolean;
  /** True when the now-orphaned `cust-kfi-baraboo` fallback customer was
   *  deleted during this run. */
  fallbackCustomerDeleted: boolean;
}

export interface SeedPatriotBarabooDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
  now: () => Date;
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
  const today = todayIso((deps.now ?? (() => new Date()))());
  const status = computeLeaseStatus(PATRIOT_LEASE_START, PATRIOT_LEASE_END, today);

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
          buildLeaseRow(patriotBarabooLeaseId(spec.unit), propertyId, spec, status),
        )
        .onConflictDoNothing()
        .returning({ id: leasesTable.id });
      if (inserted.length > 0) leasesInserted += 1;
    }

    // Rooms: one per unit. Reconcile by (propertyId, name) so an
    // operator-created "Unit 509" room is reused instead of duplicated.
    let roomsInserted = 0;
    const roomIdByUnit = new Map<string, string>();
    for (const spec of PATRIOT_BARABOO_LEASES) {
      const roomName = `Unit ${spec.unit}`;
      const existing = await tx
        .select({ id: roomsTable.id })
        .from(roomsTable)
        .where(
          and(
            eq(roomsTable.propertyId, propertyId),
            eq(roomsTable.name, roomName),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        roomIdByUnit.set(spec.unit, existing[0]!.id);
        continue;
      }
      const row = buildRoomRow(spec.unit, propertyId);
      const inserted = await tx
        .insert(roomsTable)
        .values(row)
        .onConflictDoNothing()
        .returning({ id: roomsTable.id });
      if (inserted.length > 0) {
        roomsInserted += 1;
        roomIdByUnit.set(spec.unit, row.id);
      } else {
        const reread = await tx
          .select({ id: roomsTable.id })
          .from(roomsTable)
          .where(
            and(
              eq(roomsTable.propertyId, propertyId),
              eq(roomsTable.name, roomName),
            ),
          )
          .limit(1);
        if (reread.length > 0) roomIdByUnit.set(spec.unit, reread[0]!.id);
      }
    }

    // Occupants + beds: walk the roster. Reconcile occupants by
    // (propertyId, name) so an operator-typed person isn't duplicated;
    // reconcile beds by (propertyId, roomId, bedNumber) so an
    // operator-created bed is reused. The only UPDATE we ever issue is
    // back-filling `beds.occupantId` when the bed exists with no
    // occupant AND we just inserted the matching occupant — that's the
    // attachment the task is fundamentally about, and it never
    // overwrites an existing tenant assignment.
    let bedsInserted = 0;
    let occupantsInserted = 0;
    for (const spec of PATRIOT_BARABOO_ROSTER) {
      const roomId = roomIdByUnit.get(spec.unit);
      if (!roomId) continue;

      // Resolve the bed first so a freshly-inserted occupant can be tied
      // to a pre-existing operator bed (different id) instead of our
      // deterministic placeholder. If the operator bed is already
      // assigned to someone else, leave the roster occupant unassigned
      // (bedId = null) so leasing can resolve the conflict — never
      // point two occupants at the same bed.
      const existingBed = await tx
        .select({ id: bedsTable.id, occupantId: bedsTable.occupantId })
        .from(bedsTable)
        .where(
          and(
            eq(bedsTable.propertyId, propertyId),
            eq(bedsTable.roomId, roomId),
            eq(bedsTable.bedNumber, spec.slot),
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
          : patriotBarabooBedId(spec.unit, spec.slot);

      const existingOcc = await tx
        .select({ id: occupantsTable.id })
        .from(occupantsTable)
        .where(
          and(
            eq(occupantsTable.propertyId, propertyId),
            eq(occupantsTable.name, spec.name),
          ),
        )
        .limit(1);

      let occupantId: string;
      let occupantWasInserted = false;
      if (existingOcc.length > 0) {
        occupantId = existingOcc[0]!.id;
        // Backfill shift on previously-seeded occupants that pre-date
        // the shift column (task #315). Only fill when shift IS NULL so
        // we never overwrite an operator-edited value.
        await tx
          .update(occupantsTable)
          // Defence-in-depth (Task #417): mirror the API write path
          // so a future off-list shift value coerces here too.
          .set(normalizeOccupantRow({ shift: spec.shift }))
          .where(
            and(
              eq(occupantsTable.id, occupantId),
              isNull(occupantsTable.shift),
            ),
          );
      } else {
        const row = { ...buildOccupantRow(spec, propertyId), bedId };
        const inserted = await tx
          .insert(occupantsTable)
          // Defence-in-depth (Task #417).
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
                eq(occupantsTable.name, spec.name),
              ),
            )
            .limit(1);
          occupantId = reread.length > 0 ? reread[0]!.id : row.id;
        }
      }

      if (existingBed.length > 0) {
        // Bed already exists. Only fill in occupantId if it is still
        // unset and we just inserted this occupant — never overwrite an
        // operator-assigned tenant.
        if (
          occupantWasInserted &&
          (existingBed[0]!.occupantId === null ||
            existingBed[0]!.occupantId === "")
        ) {
          await tx
            .update(bedsTable)
            // Defence-in-depth (Task #417).
            .set(normalizeBedRow({ occupantId, status: "Occupied" }))
            .where(eq(bedsTable.id, existingBed[0]!.id));
        }
        continue;
      }

      const bedRow = {
        ...buildBedRow(spec, propertyId, occupantId),
        roomId,
      };
      const insertedBed = await tx
        .insert(bedsTable)
        // Defence-in-depth (Task #417).
        .values(normalizeBedRow(bedRow))
        .onConflictDoNothing()
        .returning({ id: bedsTable.id });
      if (insertedBed.length > 0) bedsInserted += 1;
    }

    // Insurance certificates: empty by design today; see
    // PATRIOT_BARABOO_CERTIFICATES comment.
    const certSpecs: InsuranceCertificateSpec[] =
      PATRIOT_BARABOO_CERTIFICATES.map((spec) => ({
        id: spec.id,
        propertyId,
        carrier: spec.carrier,
        policyNumber: spec.policyNumber,
        insuredName: spec.insuredName,
        coverageStart: spec.coverageStart,
        coverageEnd: spec.coverageEnd,
        documentUrl: spec.documentUrl,
        notes: spec.notes,
      }));
    const certificatesInserted = await applyInsuranceCertificates(
      tx,
      certSpecs,
    );

    // Task #328: repoint AWAY from any KFI Staffing fallback customer
    // to the real Milwaukee Valve end-client when the master-file
    // import has created it; clean up the orphaned fallback customer.
    const repoint = await repointFallbackToEndClient({
      tx,
      propertyId,
      currentCustomerId: customerId,
      endClientNamePattern: PATRIOT_BARABOO_END_CLIENT_NAME_PATTERN,
      fallbackNamePattern: KFI_CUSTOMER_NAME_PATTERN,
      fallbackCustomerId: PATRIOT_BARABOO_CUSTOMER_ID,
    });

    return {
      customerInserted,
      propertyInserted,
      leasesInserted,
      roomsInserted,
      bedsInserted,
      occupantsInserted,
      certificatesInserted,
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
    result.certificatesInserted > 0 ||
    result.repointedToEndClient ||
    result.fallbackCustomerDeleted
  ) {
    log.info(result, "Patriot Baraboo seed applied.");
  }
  return result;
}
