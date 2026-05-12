import { and, eq, isNull, like } from "drizzle-orm";
import {
  db,
  customersTable,
  propertiesTable,
  roomsTable,
  bedsTable,
  occupantsTable,
  type InsertCustomerRow,
  type InsertPropertyRow,
  type InsertRoomRow,
  type InsertBedRow,
  type InsertOccupantRow,
} from "@workspace/db";
import { logger as defaultLogger } from "./logger";
import { normalizeOccupantRow, normalizeBedRow } from "./db-row-normalizers";
import type { Logger } from "pino";

/**
 * Seed for Park Place Apartments (Plymouth, MN) under the Landscape
 * Structures customer. Six units (500-118, 600-127, 600-315, 600-342,
 * 605-201, 605-218) are leased to house Landscape Structures crews;
 * each unit has 2 bedrooms × 2 beds = 4 beds, 22 of which are occupied
 * (2 vacant: Apt 315 Bedroom 2 bed 2, Apt 342 Bedroom 2 bed 1).
 *
 * Source-of-truth for the roster + personIds is the Landscape Structures
 * block in `seed-housing-deductions.ts:173-192` plus the spreadsheet
 * image referenced in Task #569. Joseph Bullock and Noe Morales are not
 * yet in payroll, so they are seeded with an empty `employeeId`.
 *
 * No lease records are created here — the source PDFs are not on hand.
 * The property is set up with `monthlyRent: 0` and a note explaining
 * that leases are pending.
 */

export const LANDSCAPE_PARK_PLACE_CUSTOMER_ID =
  "cust-landscape-structures";
export const LANDSCAPE_PARK_PLACE_PROPERTY_ID =
  "prop-park-place-landscape";

const LANDSCAPE_CUSTOMER_NAME_DEFAULT = "Landscape Structures";
const LANDSCAPE_CUSTOMER_NAME_PATTERN = "Landscape Structures%";

const LANDSCAPE_PARK_PLACE_ADDRESS = "14550 34th Ave N";
const LANDSCAPE_PARK_PLACE_CITY = "Plymouth";
const LANDSCAPE_PARK_PLACE_STATE = "MN";
const LANDSCAPE_PARK_PLACE_ZIP = "55447";

const LANDSCAPE_CHARGE_PER_BED = 125;

export const landscapeRoomId = (unit: string, room: 1 | 2): string =>
  `room-landscape-pp-${unit}-r${room}`;
export const landscapeBedId = (
  unit: string,
  room: 1 | 2,
  bed: 1 | 2,
): string => `bed-landscape-pp-${unit}-r${room}-b${bed}`;
export const landscapeOccupantId = (
  unit: string,
  room: 1 | 2,
  bed: 1 | 2,
): string => `occ-landscape-pp-${unit}-r${room}-b${bed}`;

interface LandscapeOccupantSpec {
  unit: string;
  room: 1 | 2;
  bed: 1 | 2;
  /** Display name (mixed case as it should appear on the roster). */
  name: string;
  /** Empty string when no payroll personId is known yet. */
  employeeId: string;
}

/**
 * Per-unit roster from the spreadsheet image attached to Task #569.
 * Slots 1/2 share Bedroom 1, slots 3/4 share Bedroom 2. Vacant beds
 * are simply omitted from the list (Apt 315 r2-b2, Apt 342 r2-b1).
 *
 * personIds are sourced from `seed-housing-deductions.ts:173-192`.
 * Joseph Bullock (Apt 118) and Noe Morales (Apt 127) are not yet on
 * the payroll roster — they are seeded with `employeeId: ""`.
 */
const LANDSCAPE_PARK_PLACE_ROSTER: readonly LandscapeOccupantSpec[] = [
  // 500-118
  { unit: "500-118", room: 1, bed: 1, name: "Julio Orgonez",      employeeId: "2002940" },
  { unit: "500-118", room: 1, bed: 2, name: "Raymundo Leija",     employeeId: "2002939" },
  { unit: "500-118", room: 2, bed: 1, name: "Ethan Davis",        employeeId: "2002636" },
  { unit: "500-118", room: 2, bed: 2, name: "Joseph Bullock",     employeeId: ""        },
  // 600-127
  { unit: "600-127", room: 1, bed: 1, name: "Alfred A Beserra",   employeeId: "2004710" },
  { unit: "600-127", room: 1, bed: 2, name: "Jordan Torres",      employeeId: "2002938" },
  { unit: "600-127", room: 2, bed: 1, name: "Erasmo Garza",       employeeId: "2002379" },
  { unit: "600-127", room: 2, bed: 2, name: "Noe Morales",        employeeId: ""        },
  // 600-315 (Bedroom 2 bed 2 vacant)
  { unit: "600-315", room: 1, bed: 1, name: "Abel A Guzman",      employeeId: "2005096" },
  { unit: "600-315", room: 1, bed: 2, name: "Luis Rodriguez Rivera", employeeId: "2001894" },
  { unit: "600-315", room: 2, bed: 1, name: "Nicholas R Franklin", employeeId: "2004544" },
  // 600-342 (Bedroom 2 bed 1 vacant)
  { unit: "600-342", room: 1, bed: 1, name: "Jose Molina",        employeeId: "2002031" },
  { unit: "600-342", room: 1, bed: 2, name: "David Davis",        employeeId: "2002373" },
  { unit: "600-342", room: 2, bed: 2, name: "Marcos Antonio Lara", employeeId: "2002820" },
  // 605-201
  { unit: "605-201", room: 1, bed: 1, name: "Evarado Delgado",    employeeId: "2004070" },
  { unit: "605-201", room: 1, bed: 2, name: "Jonathan Reynosa",   employeeId: "2002442" },
  { unit: "605-201", room: 2, bed: 1, name: "Sebastian Villarreal", employeeId: "2005166" },
  { unit: "605-201", room: 2, bed: 2, name: "Tyrek J Patterson",  employeeId: "2004786" },
  // 605-218
  { unit: "605-218", room: 1, bed: 1, name: "Eduardo Campos",     employeeId: "2000822" },
  { unit: "605-218", room: 1, bed: 2, name: "Gabriel J Womack",   employeeId: "2005111" },
  { unit: "605-218", room: 2, bed: 1, name: "Gilbert Bustos Jr",  employeeId: "2002861" },
  { unit: "605-218", room: 2, bed: 2, name: "Justin DeAngelis",   employeeId: "2005110" },
];

const LANDSCAPE_PARK_PLACE_UNITS: readonly string[] = Array.from(
  new Set(LANDSCAPE_PARK_PLACE_ROSTER.map((r) => r.unit)),
);

const TOTAL_BEDS = LANDSCAPE_PARK_PLACE_UNITS.length * 4; // 24

function buildCustomerRow(id: string): InsertCustomerRow {
  return {
    id,
    name: LANDSCAPE_CUSTOMER_NAME_DEFAULT,
    contactName: "",
    email: "",
    phone: "",
    notes:
      "Landscape Structures corporate housing. Six units at Park Place " +
      "Apartments (14550 34th Ave N, Plymouth MN 55447) hosting 22 active " +
      "occupants on weekly $125 payroll deductions.",
  };
}

function buildPropertyRow(
  id: string,
  customerId: string,
): InsertPropertyRow {
  return {
    id,
    customerId,
    name: "Park Place Apartments – Plymouth, MN (Landscape Structures)",
    address: LANDSCAPE_PARK_PLACE_ADDRESS,
    city: LANDSCAPE_PARK_PLACE_CITY,
    state: LANDSCAPE_PARK_PLACE_STATE,
    zip: LANDSCAPE_PARK_PLACE_ZIP,
    totalBeds: TOTAL_BEDS,
    monthlyRent: 0,
    chargePerBed: LANDSCAPE_CHARGE_PER_BED,
    status: "Active",
    landlordName: "Centerspace LP",
    landlordEmail: "",
    landlordPhone: "",
    paymentMethod: "ACH",
    paymentRecipient: "Centerspace LP",
    paymentDueDay: 1,
    paymentNotes: "",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes:
      "6 Landscape Structures units at Park Place (Plymouth, MN): " +
      "500-118, 600-127, 600-315, 600-342, 605-201, 605-218. Buildings " +
      "14500 / 14600 / 14605 34th Ave N share the Park Place community " +
      "office at 14550 34th Ave N. Each unit has 2 bedrooms × 2 beds; " +
      "22 of 24 beds are currently occupied (vacant: Apt 315 Bedroom 2 " +
      "bed 2, Apt 342 Bedroom 2 bed 1). Lease records are pending — the " +
      "source PDFs are not yet on hand, so monthlyRent is set to 0 and " +
      "no lease rows are seeded; occupants are billed via the weekly " +
      "$125 housing deduction (see seed-housing-deductions.ts).",
    furnishings: [],
  };
}

function buildRoomRow(
  unit: string,
  room: 1 | 2,
  propertyId: string,
): InsertRoomRow {
  return {
    id: landscapeRoomId(unit, room),
    propertyId,
    name: `Apt ${unit} Bedroom ${room}`,
    sqft: 0,
    bathrooms: 0,
    monthlyRent: 0,
  };
}

function buildBedRow(
  unit: string,
  room: 1 | 2,
  bed: 1 | 2,
  propertyId: string,
  occupantId: string | null,
): InsertBedRow {
  return {
    id: landscapeBedId(unit, room, bed),
    propertyId,
    bedNumber: bed,
    roomId: landscapeRoomId(unit, room),
    status: occupantId ? "Occupied" : "Vacant",
    occupantId,
  };
}

function buildOccupantRow(
  spec: LandscapeOccupantSpec,
  propertyId: string,
): InsertOccupantRow {
  return {
    id: landscapeOccupantId(spec.unit, spec.room, spec.bed),
    name: spec.name,
    email: "",
    phone: "",
    bedId: landscapeBedId(spec.unit, spec.room, spec.bed),
    propertyId,
    moveInDate: "",
    moveOutDate: null,
    status: "Active",
    chargePerBed: LANDSCAPE_CHARGE_PER_BED,
    billingFrequency: "Weekly",
    employeeId: spec.employeeId,
    company: LANDSCAPE_CUSTOMER_NAME_DEFAULT,
  };
}

export interface SeedParkPlaceLandscapeResult {
  customerInserted: boolean;
  propertyInserted: boolean;
  roomsInserted: number;
  bedsInserted: number;
  occupantsInserted: number;
  customerId: string;
  propertyId: string;
}

export interface SeedParkPlaceLandscapeDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
}

/**
 * Idempotently seed the Landscape Structures customer (reused if any
 * `name LIKE 'Landscape Structures%'` row already exists), the Park
 * Place property at 14550 34th Ave N, Plymouth MN 55447, plus 12 rooms
 * (2 per unit), 24 beds (4 per unit), and 22 occupants. Reconciles by
 * natural keys — never UPDATEs operator-edited rows. The only mutation
 * we ever issue against pre-existing rows is back-filling
 * `beds.occupantId` when the bed exists with no occupant AND we just
 * inserted the matching occupant.
 */
export async function seedParkPlaceLandscapeIfMissing(
  deps: Partial<SeedParkPlaceLandscapeDeps> = {},
): Promise<SeedParkPlaceLandscapeResult> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;

  const result = await database.transaction(async (tx) => {
    // 1. Customer
    const existingCustomer = await tx
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(like(customersTable.name, LANDSCAPE_CUSTOMER_NAME_PATTERN))
      .limit(1);

    let customerId: string;
    let customerInserted = false;
    if (existingCustomer.length > 0) {
      customerId = existingCustomer[0]!.id;
    } else {
      customerId = LANDSCAPE_PARK_PLACE_CUSTOMER_ID;
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
          .where(like(customersTable.name, LANDSCAPE_CUSTOMER_NAME_PATTERN))
          .limit(1);
        if (reread.length > 0) customerId = reread[0]!.id;
      }
    }

    // 2. Property — reconcile by (customerId, address, zip).
    const existingProperty = await tx
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(
        and(
          eq(propertiesTable.customerId, customerId),
          eq(propertiesTable.address, LANDSCAPE_PARK_PLACE_ADDRESS),
          eq(propertiesTable.zip, LANDSCAPE_PARK_PLACE_ZIP),
        ),
      )
      .limit(1);

    let propertyId: string;
    let propertyInserted = false;
    if (existingProperty.length > 0) {
      propertyId = existingProperty[0]!.id;
    } else {
      propertyId = LANDSCAPE_PARK_PLACE_PROPERTY_ID;
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
              eq(propertiesTable.address, LANDSCAPE_PARK_PLACE_ADDRESS),
              eq(propertiesTable.zip, LANDSCAPE_PARK_PLACE_ZIP),
            ),
          )
          .limit(1);
        if (reread.length > 0) propertyId = reread[0]!.id;
      }
    }

    // 3. Rooms — 2 per unit, reconciled by (propertyId, name).
    let roomsInserted = 0;
    const roomIdByKey = new Map<string, string>();
    for (const unit of LANDSCAPE_PARK_PLACE_UNITS) {
      for (const room of [1, 2] as const) {
        const roomName = `Apt ${unit} Bedroom ${room}`;
        const row = buildRoomRow(unit, room, propertyId);
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
          roomIdByKey.set(`${unit}|${room}`, existing[0]!.id);
          continue;
        }
        const inserted = await tx
          .insert(roomsTable)
          .values(row)
          .onConflictDoNothing()
          .returning({ id: roomsTable.id });
        if (inserted.length > 0) {
          roomsInserted += 1;
          roomIdByKey.set(`${unit}|${room}`, row.id);
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
          if (reread.length > 0)
            roomIdByKey.set(`${unit}|${room}`, reread[0]!.id);
        }
      }
    }

    // 4. Beds + occupants. Walk every (unit, room, bed) slot so vacant
    //    beds are seeded too. Same conflict-handling pattern as the
    //    Patriot Baraboo seed.
    let bedsInserted = 0;
    let occupantsInserted = 0;

    const occupantByKey = new Map<string, LandscapeOccupantSpec>();
    for (const spec of LANDSCAPE_PARK_PLACE_ROSTER) {
      occupantByKey.set(
        `${spec.unit}|${spec.room}|${spec.bed}`,
        spec,
      );
    }

    for (const unit of LANDSCAPE_PARK_PLACE_UNITS) {
      for (const room of [1, 2] as const) {
        const roomId = roomIdByKey.get(`${unit}|${room}`);
        if (!roomId) continue;

        for (const bed of [1, 2] as const) {
          const occupantSpec = occupantByKey.get(
            `${unit}|${room}|${bed}`,
          );

          const existingBed = await tx
            .select({
              id: bedsTable.id,
              occupantId: bedsTable.occupantId,
            })
            .from(bedsTable)
            .where(
              and(
                eq(bedsTable.propertyId, propertyId),
                eq(bedsTable.roomId, roomId),
                eq(bedsTable.bedNumber, bed),
              ),
            )
            .limit(1);

          if (!occupantSpec) {
            // Vacant bed — only insert if missing.
            if (existingBed.length === 0) {
              const inserted = await tx
                .insert(bedsTable)
                .values(
                  normalizeBedRow({
                    ...buildBedRow(unit, room, bed, propertyId, null),
                    roomId,
                  }),
                )
                .onConflictDoNothing()
                .returning({ id: bedsTable.id });
              if (inserted.length > 0) bedsInserted += 1;
            }
            continue;
          }

          const bedAlreadyTaken =
            existingBed.length > 0 &&
            existingBed[0]!.occupantId !== null &&
            existingBed[0]!.occupantId !== "";
          const targetBedId: string | null = bedAlreadyTaken
            ? null
            : existingBed.length > 0
              ? existingBed[0]!.id
              : landscapeBedId(unit, room, bed);

          const existingOcc = await tx
            .select({ id: occupantsTable.id })
            .from(occupantsTable)
            .where(
              and(
                eq(occupantsTable.propertyId, propertyId),
                eq(occupantsTable.name, occupantSpec.name),
              ),
            )
            .limit(1);

          let occupantId: string;
          let occupantWasInserted = false;
          if (existingOcc.length > 0) {
            occupantId = existingOcc[0]!.id;
            // Backfill employeeId for previously-seeded rows that
            // pre-date the personId being known. Only when the column
            // is currently empty so we never overwrite operator edits.
            if (occupantSpec.employeeId !== "") {
              await tx
                .update(occupantsTable)
                .set(
                  normalizeOccupantRow({
                    employeeId: occupantSpec.employeeId,
                  }),
                )
                .where(
                  and(
                    eq(occupantsTable.id, occupantId),
                    eq(occupantsTable.employeeId, ""),
                  ),
                );
            }
          } else {
            const row = {
              ...buildOccupantRow(occupantSpec, propertyId),
              bedId: targetBedId,
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
                    eq(occupantsTable.name, occupantSpec.name),
                  ),
                )
                .limit(1);
              occupantId = reread.length > 0 ? reread[0]!.id : row.id;
            }
          }

          if (existingBed.length > 0) {
            // Only attach the freshly-inserted occupant if the bed has
            // nobody assigned yet.
            if (
              occupantWasInserted &&
              (existingBed[0]!.occupantId === null ||
                existingBed[0]!.occupantId === "")
            ) {
              await tx
                .update(bedsTable)
                .set(
                  normalizeBedRow({
                    occupantId,
                    status: "Occupied",
                  }),
                )
                .where(eq(bedsTable.id, existingBed[0]!.id));
            }
            continue;
          }

          const insertedBed = await tx
            .insert(bedsTable)
            .values(
              normalizeBedRow({
                ...buildBedRow(unit, room, bed, propertyId, occupantId),
                roomId,
              }),
            )
            .onConflictDoNothing()
            .returning({ id: bedsTable.id });
          if (insertedBed.length > 0) bedsInserted += 1;
        }
      }
    }

    // Defence-in-depth: ensure occupants previously inserted with a
    // `bedId` of null (because their bed was taken at insert time) get
    // re-attached when the deterministic bed becomes free on a later
    // run. We only fill rows where bedId IS NULL so operator-set bed
    // assignments are preserved.
    for (const spec of LANDSCAPE_PARK_PLACE_ROSTER) {
      const targetBedId = landscapeBedId(spec.unit, spec.room, spec.bed);
      const bedRow = await tx
        .select({ id: bedsTable.id, occupantId: bedsTable.occupantId })
        .from(bedsTable)
        .where(eq(bedsTable.id, targetBedId))
        .limit(1);
      if (bedRow.length === 0) continue;
      if (
        bedRow[0]!.occupantId !== null &&
        bedRow[0]!.occupantId !== ""
      )
        continue;
      const occRow = await tx
        .select({ id: occupantsTable.id })
        .from(occupantsTable)
        .where(
          and(
            eq(occupantsTable.propertyId, propertyId),
            eq(occupantsTable.name, spec.name),
            isNull(occupantsTable.bedId),
          ),
        )
        .limit(1);
      if (occRow.length === 0) continue;
      await tx
        .update(occupantsTable)
        .set(normalizeOccupantRow({ bedId: targetBedId }))
        .where(eq(occupantsTable.id, occRow[0]!.id));
      await tx
        .update(bedsTable)
        .set(normalizeBedRow({ occupantId: occRow[0]!.id, status: "Occupied" }))
        .where(eq(bedsTable.id, targetBedId));
    }

    return {
      customerInserted,
      propertyInserted,
      roomsInserted,
      bedsInserted,
      occupantsInserted,
      customerId,
      propertyId,
    };
  });

  if (
    result.customerInserted ||
    result.propertyInserted ||
    result.roomsInserted > 0 ||
    result.bedsInserted > 0 ||
    result.occupantsInserted > 0
  ) {
    log.info(result, "Park Place Landscape Structures seed applied.");
  }
  return result;
}

export const PARK_PLACE_LANDSCAPE_UNITS = LANDSCAPE_PARK_PLACE_UNITS;
