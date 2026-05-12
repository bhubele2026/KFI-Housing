import { and, eq, like } from "drizzle-orm";
import {
  db,
  customersTable,
  propertiesTable,
  leasesTable,
  roomsTable,
  bedsTable,
  occupantsTable,
  type InsertPropertyRow,
  type InsertLeaseRow,
  type InsertRoomRow,
  type InsertBedRow,
  type InsertOccupantRow,
} from "@workspace/db";
import { logger as defaultLogger } from "./logger";
import {
  normalizeOccupantRow,
  normalizeBedRow,
  normalizeLeaseRow,
  normalizePropertyRow,
} from "./db-row-normalizers";
import type { Logger } from "pino";

export const PENDA_NEW_PINERY_PROPERTY_ID = "prop-penda-2900-new-pinery";
export const PENDA_NEW_PINERY_LEASE_ID = "lease-penda-2900-new-pinery";
export const pendaNewPineryRoomId = (room: string): string =>
  `room-penda-np-${room}`;
export const pendaNewPineryBedId = (room: string, slot: 1 | 2): string =>
  `bed-penda-np-${room}-b${slot}`;
export const pendaNewPineryOccupantId = (room: string, slot: 1 | 2): string =>
  `occ-penda-np-${room}-b${slot}`;

const PENDA_CUSTOMER_NAME_PATTERN = "Penda%";
const PENDA_ADDRESS = "2900 New Pinery Rd";
const PENDA_CITY = "Portage";
const PENDA_STATE = "WI";
const PENDA_ZIP = "53901";

const PENDA_CHARGE_PER_BED = 175;
const PENDA_BILLING_FREQUENCY = "Weekly" as const;

interface PendaOccupantSpec {
  room: string;
  slot: 1 | 2;
  name: string;
  employeeId: string;
}

/**
 * Full room roster for 2900 New Pinery Rd. Order matches the source
 * spreadsheet (sheet-order, not numeric). Rooms not appearing in
 * `PENDA_OCCUPANTS` keep both beds vacant. Room 305 and Room 215 each
 * have only Bed 1 occupied; Bed 2 stays vacant.
 */
const PENDA_ROOMS: readonly string[] = [
  "303",
  "305",
  "205",
  "134",
  "149",
  "216",
  "215",
  "247",
  "122",
  "232",
  "113",
  "236",
  "248",
  "242",
];

const PENDA_OCCUPANTS: readonly PendaOccupantSpec[] = [
  { room: "305", slot: 1, name: "Bucky Lee Gonzalez", employeeId: "" },
  { room: "205", slot: 1, name: "Ryan Fiegen", employeeId: "" },
  { room: "205", slot: 2, name: "Brandon Johnson", employeeId: "" },
  { room: "134", slot: 1, name: "Jasmine Arce", employeeId: "" },
  { room: "134", slot: 2, name: "Thalia Romero", employeeId: "" },
  { room: "149", slot: 1, name: "Zabdi X Rodriguez", employeeId: "2004956" },
  { room: "149", slot: 2, name: "John Tyler Clark", employeeId: "2004954" },
  { room: "216", slot: 1, name: "Brandon Morgan", employeeId: "" },
  { room: "216", slot: 2, name: "Diego Martinez", employeeId: "" },
  { room: "215", slot: 1, name: "Jared Novak", employeeId: "" },
  { room: "247", slot: 1, name: "Jordan T. Smith", employeeId: "" },
  { room: "247", slot: 2, name: "Trey Grant", employeeId: "" },
  { room: "122", slot: 1, name: "Jonathan P Wheeler", employeeId: "" },
  { room: "122", slot: 2, name: "Cody Troy Smith", employeeId: "" },
];

function buildPropertyRow(
  id: string,
  customerId: string,
): InsertPropertyRow {
  return {
    id,
    customerId,
    name: "2900 New Pinery Rd – Portage, WI",
    address: PENDA_ADDRESS,
    city: PENDA_CITY,
    state: PENDA_STATE,
    zip: PENDA_ZIP,
    totalBeds: PENDA_ROOMS.length * 2,
    monthlyRent: 0,
    chargePerBed: PENDA_CHARGE_PER_BED,
    status: "Active",
    landlordName: "",
    landlordEmail: "",
    landlordPhone: "",
    paymentMethod: "",
    paymentRecipient: "",
    paymentDueDay: 1,
    paymentNotes: "",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes:
      `Penda Corp crew housing — ${PENDA_ROOMS.length} rooms × 2 beds = ` +
      `${PENDA_ROOMS.length * 2} beds. Per-bed weekly charge of ` +
      `$${PENDA_CHARGE_PER_BED} matches the Penda Corp payroll housing ` +
      `deduction. Rent and term not in source — needs review.`,
    furnishings: [],
  };
}

function buildLeaseRow(id: string, propertyId: string): InsertLeaseRow {
  return {
    id,
    propertyId,
    startDate: "",
    endDate: "",
    monthlyRent: 0,
    securityDeposit: 0,
    status: "Active",
    notes:
      "Penda Corp lease — 2900 New Pinery Rd, Portage WI. " +
      "Rent and term not in source — needs review.",
    clauses: "",
    buyoutAvailable: false,
    buyoutCost: null,
    needsReview: true,
  };
}

function buildRoomRow(roomName: string, propertyId: string): InsertRoomRow {
  return {
    id: pendaNewPineryRoomId(roomName),
    propertyId,
    name: `Room ${roomName}`,
    sqft: 0,
    bathrooms: 0,
    monthlyRent: 0,
  };
}

function buildBedRow(
  room: string,
  slot: 1 | 2,
  propertyId: string,
  occupantId: string | null,
): InsertBedRow {
  return {
    id: pendaNewPineryBedId(room, slot),
    propertyId,
    bedNumber: slot,
    roomId: pendaNewPineryRoomId(room),
    status: occupantId ? "Occupied" : "Vacant",
    occupantId,
  };
}

function buildOccupantRow(
  spec: PendaOccupantSpec,
  propertyId: string,
): InsertOccupantRow {
  return {
    id: pendaNewPineryOccupantId(spec.room, spec.slot),
    name: spec.name,
    email: "",
    phone: "",
    bedId: pendaNewPineryBedId(spec.room, spec.slot),
    propertyId,
    moveInDate: "",
    moveOutDate: null,
    status: "Active",
    chargePerBed: PENDA_CHARGE_PER_BED,
    billingFrequency: PENDA_BILLING_FREQUENCY,
    employeeId: spec.employeeId,
    company: "Penda Corp",
  };
}

export interface SeedPendaNewPineryResult {
  customerMatched: boolean;
  propertyInserted: boolean;
  leaseInserted: boolean;
  roomsInserted: number;
  bedsInserted: number;
  occupantsInserted: number;
}

export interface SeedPendaNewPineryDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
}

/**
 * Idempotently seed the Penda Corp 2900 New Pinery Rd property in
 * Portage, WI. Reconciles by natural keys:
 *  - Customer: `name LIKE 'Penda%'` — never INSERTs the customer.
 *    Skips with a warning if no Penda customer exists yet.
 *  - Property: `(customerId, address, zip)`.
 *  - Lease: `(propertyId, "Penda Corp lease — 2900 New Pinery Rd"
 *    marker in notes)`.
 *  - Rooms: `(propertyId, name)`.
 *  - Beds: `(propertyId, roomId, bedNumber)`.
 *  - Occupants: `(propertyId, name)`.
 *
 * Re-runs are zero-effect. The only UPDATE this seeder ever issues is
 * back-filling `beds.occupantId` when the bed exists with no occupant
 * AND we just inserted the matching occupant — never overwriting an
 * operator-assigned tenant.
 */
export async function seedPendaNewPineryIfMissing(
  deps: Partial<SeedPendaNewPineryDeps> = {},
): Promise<SeedPendaNewPineryResult> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;

  const result = await database.transaction(async (tx) => {
    const existingCustomer = await tx
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(like(customersTable.name, PENDA_CUSTOMER_NAME_PATTERN))
      .limit(1);

    if (existingCustomer.length === 0) {
      log.warn(
        "Penda New Pinery seed: skipping — no Penda customer found, run master import first",
      );
      return {
        customerMatched: false,
        propertyInserted: false,
        leaseInserted: false,
        roomsInserted: 0,
        bedsInserted: 0,
        occupantsInserted: 0,
      };
    }
    const customerId = existingCustomer[0]!.id;

    // Property
    const existingProperty = await tx
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(
        and(
          eq(propertiesTable.customerId, customerId),
          eq(propertiesTable.address, PENDA_ADDRESS),
          eq(propertiesTable.zip, PENDA_ZIP),
        ),
      )
      .limit(1);

    let propertyId: string;
    let propertyInserted = false;
    if (existingProperty.length > 0) {
      propertyId = existingProperty[0]!.id;
    } else {
      propertyId = PENDA_NEW_PINERY_PROPERTY_ID;
      const inserted = await tx
        .insert(propertiesTable)
        .values(normalizePropertyRow(buildPropertyRow(propertyId, customerId)))
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
              eq(propertiesTable.address, PENDA_ADDRESS),
              eq(propertiesTable.zip, PENDA_ZIP),
            ),
          )
          .limit(1);
        if (reread.length > 0) propertyId = reread[0]!.id;
      }
    }

    // Lease
    const leaseMarker = "Penda Corp lease — 2900 New Pinery Rd";
    const existingLease = await tx
      .select({ id: leasesTable.id })
      .from(leasesTable)
      .where(
        and(
          eq(leasesTable.propertyId, propertyId),
          like(leasesTable.notes, `%${leaseMarker}%`),
        ),
      )
      .limit(1);

    let leaseInserted = false;
    if (existingLease.length === 0) {
      const inserted = await tx
        .insert(leasesTable)
        .values(
          normalizeLeaseRow(buildLeaseRow(PENDA_NEW_PINERY_LEASE_ID, propertyId)),
        )
        .onConflictDoNothing()
        .returning({ id: leasesTable.id });
      leaseInserted = inserted.length > 0;
    }

    // Rooms
    let roomsInserted = 0;
    const roomIdByName = new Map<string, string>();
    for (const room of PENDA_ROOMS) {
      const roomName = `Room ${room}`;
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
        roomIdByName.set(room, existing[0]!.id);
        continue;
      }
      const row = buildRoomRow(room, propertyId);
      const inserted = await tx
        .insert(roomsTable)
        .values(row)
        .onConflictDoNothing()
        .returning({ id: roomsTable.id });
      if (inserted.length > 0) {
        roomsInserted += 1;
        roomIdByName.set(room, row.id);
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
        if (reread.length > 0) roomIdByName.set(room, reread[0]!.id);
      }
    }

    // Occupants + beds: walk the full room/slot grid so vacant beds
    // are created too. For occupied slots, reconcile the occupant by
    // (propertyId, name) and only ever back-fill bed.occupantId when
    // the bed had no occupant AND we just inserted that occupant.
    let bedsInserted = 0;
    let occupantsInserted = 0;

    const occupantBySlot = new Map<string, PendaOccupantSpec>();
    for (const occ of PENDA_OCCUPANTS) {
      occupantBySlot.set(`${occ.room}-${occ.slot}`, occ);
    }

    for (const room of PENDA_ROOMS) {
      const roomId = roomIdByName.get(room);
      if (!roomId) continue;
      for (const slot of [1, 2] as const) {
        const occSpec = occupantBySlot.get(`${room}-${slot}`);

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

        let occupantId: string | null = null;
        let occupantWasInserted = false;

        if (occSpec) {
          const bedIdForOccupant: string | null = bedAlreadyTaken
            ? null
            : existingBed.length > 0
              ? existingBed[0]!.id
              : pendaNewPineryBedId(room, slot);

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
            // Backfill employeeId on previously-seeded occupants whose
            // payroll personId we now know — only when still blank, so
            // an operator-edited value is never overwritten.
            if (occSpec.employeeId !== "") {
              await tx
                .update(occupantsTable)
                .set(normalizeOccupantRow({ employeeId: occSpec.employeeId }))
                .where(
                  and(
                    eq(occupantsTable.id, occupantId),
                    eq(occupantsTable.employeeId, ""),
                  ),
                );
            }
          } else {
            const row = {
              ...buildOccupantRow(occSpec, propertyId),
              bedId: bedIdForOccupant,
            };
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
              .set(
                normalizeBedRow({ occupantId, status: "Occupied" }),
              )
              .where(eq(bedsTable.id, existingBed[0]!.id));
          }
          continue;
        }

        const bedRow = buildBedRow(room, slot, propertyId, occupantId);
        bedRow.roomId = roomId;
        const insertedBed = await tx
          .insert(bedsTable)
          .values(normalizeBedRow(bedRow))
          .onConflictDoNothing()
          .returning({ id: bedsTable.id });
        if (insertedBed.length > 0) bedsInserted += 1;
      }
    }

    return {
      customerMatched: true,
      propertyInserted,
      leaseInserted,
      roomsInserted,
      bedsInserted,
      occupantsInserted,
    };
  });

  if (
    result.propertyInserted ||
    result.leaseInserted ||
    result.roomsInserted > 0 ||
    result.bedsInserted > 0 ||
    result.occupantsInserted > 0
  ) {
    log.info(result, "Penda New Pinery seed applied.");
  }
  return result;
}
