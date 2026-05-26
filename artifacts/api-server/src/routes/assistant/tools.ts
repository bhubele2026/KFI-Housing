import { randomUUID } from "node:crypto";
import { and, eq, ilike, or } from "drizzle-orm";
import {
  db,
  customersTable,
  propertiesTable,
  buildingsTable,
  roomsTable,
  bedsTable,
  occupantsTable,
  leasesTable,
  utilitiesTable,
  insuranceCertificatesTable,
  payrollDeductionsTable,
} from "@workspace/db";

export type ToolKind = "read" | "write";

export interface ToolDef {
  name: string;
  kind: ToolKind;
  description: string;
  input_schema: Record<string, unknown>;
  summarize: (input: any) => string;
  execute: (input: any) => Promise<unknown>;
}

const Str = { type: "string" } as const;
const StrOpt = { type: ["string", "null"] } as const;
const Num = { type: "number" } as const;
const NumOpt = { type: ["number", "null"] } as const;
const Bool = { type: "boolean" } as const;
const BoolOpt = { type: ["boolean", "null"] } as const;

function obj(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function newId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

async function listAll<T>(table: any): Promise<T[]> {
  return (await db.select().from(table)) as T[];
}

const tools: ToolDef[] = [];

// ─────────────────────────────────────────── READ tools ───────────

tools.push({
  name: "list_customers",
  kind: "read",
  description: "List all customers (companies that own properties).",
  input_schema: obj({}),
  summarize: () => "Listing customers",
  execute: async () => ({ customers: await listAll(customersTable) }),
});

tools.push({
  name: "list_properties",
  kind: "read",
  description:
    "List properties. Optional filter by customerId to scope to one customer.",
  input_schema: obj({ customerId: StrOpt }),
  summarize: (i) => `Listing properties${i.customerId ? ` for customer ${i.customerId}` : ""}`,
  execute: async (input) => {
    const rows = input.customerId
      ? await db
          .select()
          .from(propertiesTable)
          .where(eq(propertiesTable.customerId, input.customerId))
      : await db.select().from(propertiesTable);
    return { properties: rows };
  },
});

tools.push({
  name: "get_property",
  kind: "read",
  description: "Get one property by id.",
  input_schema: obj({ id: Str }, ["id"]),
  summarize: (i) => `Getting property ${i.id}`,
  execute: async (input) => {
    const [row] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, input.id));
    if (!row) throw new Error(`Property ${input.id} not found`);
    return row;
  },
});

tools.push({
  name: "find_property_by_name",
  kind: "read",
  description:
    "Search properties by name OR address substring (case-insensitive). Use this to resolve a property id when the user names it instead of pasting an id.",
  input_schema: obj({ query: Str }, ["query"]),
  summarize: (i) => `Searching properties for "${i.query}"`,
  execute: async (input) => {
    const q = `%${input.query}%`;
    const rows = await db
      .select()
      .from(propertiesTable)
      .where(or(ilike(propertiesTable.name, q), ilike(propertiesTable.address, q)))
      .limit(20);
    return { properties: rows };
  },
});

tools.push({
  name: "list_buildings",
  kind: "read",
  description: "List buildings. Optional filter by propertyId.",
  input_schema: obj({ propertyId: StrOpt }),
  summarize: (i) => `Listing buildings${i.propertyId ? ` for property ${i.propertyId}` : ""}`,
  execute: async (input) => {
    const rows = input.propertyId
      ? await db.select().from(buildingsTable).where(eq(buildingsTable.propertyId, input.propertyId))
      : await db.select().from(buildingsTable);
    return { buildings: rows };
  },
});

tools.push({
  name: "list_rooms",
  kind: "read",
  description: "List rooms. Optional filter by propertyId or buildingId.",
  input_schema: obj({ propertyId: StrOpt, buildingId: StrOpt }),
  summarize: (i) => `Listing rooms${i.propertyId ? ` for property ${i.propertyId}` : ""}`,
  execute: async (input) => {
    const conds = [] as any[];
    if (input.propertyId) conds.push(eq(roomsTable.propertyId, input.propertyId));
    if (input.buildingId) conds.push(eq(roomsTable.buildingId, input.buildingId));
    const rows = conds.length
      ? await db.select().from(roomsTable).where(and(...conds))
      : await db.select().from(roomsTable);
    return { rooms: rows };
  },
});

tools.push({
  name: "list_beds",
  kind: "read",
  description: "List beds. Optional filter by propertyId or roomId.",
  input_schema: obj({ propertyId: StrOpt, roomId: StrOpt }),
  summarize: (i) => `Listing beds${i.propertyId ? ` for property ${i.propertyId}` : ""}`,
  execute: async (input) => {
    const conds = [] as any[];
    if (input.propertyId) conds.push(eq(bedsTable.propertyId, input.propertyId));
    if (input.roomId) conds.push(eq(bedsTable.roomId, input.roomId));
    const rows = conds.length
      ? await db.select().from(bedsTable).where(and(...conds))
      : await db.select().from(bedsTable);
    return { beds: rows };
  },
});

tools.push({
  name: "list_occupants",
  kind: "read",
  description: "List occupants. Optional filter by propertyId or status (Active/Inactive).",
  input_schema: obj({ propertyId: StrOpt, status: StrOpt }),
  summarize: (i) => `Listing occupants${i.propertyId ? ` at ${i.propertyId}` : ""}`,
  execute: async (input) => {
    const conds = [] as any[];
    if (input.propertyId) conds.push(eq(occupantsTable.propertyId, input.propertyId));
    if (input.status) conds.push(eq(occupantsTable.status, input.status));
    const rows = conds.length
      ? await db.select().from(occupantsTable).where(and(...conds))
      : await db.select().from(occupantsTable);
    return { occupants: rows };
  },
});

tools.push({
  name: "find_occupant_by_name",
  kind: "read",
  description: "Search occupants by name substring (case-insensitive).",
  input_schema: obj({ query: Str }, ["query"]),
  summarize: (i) => `Searching occupants for "${i.query}"`,
  execute: async (input) => {
    const rows = await db
      .select()
      .from(occupantsTable)
      .where(ilike(occupantsTable.name, `%${input.query}%`))
      .limit(20);
    return { occupants: rows };
  },
});

tools.push({
  name: "list_leases",
  kind: "read",
  description: "List leases. Optional filter by propertyId.",
  input_schema: obj({ propertyId: StrOpt }),
  summarize: (i) => `Listing leases${i.propertyId ? ` for ${i.propertyId}` : ""}`,
  execute: async (input) => {
    const rows = input.propertyId
      ? await db.select().from(leasesTable).where(eq(leasesTable.propertyId, input.propertyId))
      : await db.select().from(leasesTable);
    return { leases: rows };
  },
});

tools.push({
  name: "list_utilities",
  kind: "read",
  description: "List utility accounts. Optional filter by propertyId.",
  input_schema: obj({ propertyId: StrOpt }),
  summarize: (i) => `Listing utilities${i.propertyId ? ` for ${i.propertyId}` : ""}`,
  execute: async (input) => {
    const rows = input.propertyId
      ? await db.select().from(utilitiesTable).where(eq(utilitiesTable.propertyId, input.propertyId))
      : await db.select().from(utilitiesTable);
    return { utilities: rows };
  },
});

tools.push({
  name: "list_insurance_certificates",
  kind: "read",
  description: "List insurance certificates. Optional filter by propertyId.",
  input_schema: obj({ propertyId: StrOpt }),
  summarize: (i) => `Listing insurance certificates${i.propertyId ? ` for ${i.propertyId}` : ""}`,
  execute: async (input) => {
    const rows = input.propertyId
      ? await db
          .select()
          .from(insuranceCertificatesTable)
          .where(eq(insuranceCertificatesTable.propertyId, input.propertyId))
      : await db.select().from(insuranceCertificatesTable);
    return { insuranceCertificates: rows };
  },
});

tools.push({
  name: "list_payroll_deductions",
  kind: "read",
  description: "List payroll housing deductions. Optional filter by occupantId or propertyId.",
  input_schema: obj({ occupantId: StrOpt, propertyId: StrOpt }),
  summarize: (i) => `Listing payroll deductions`,
  execute: async (input) => {
    const conds = [] as any[];
    if (input.occupantId) conds.push(eq(payrollDeductionsTable.occupantId, input.occupantId));
    if (input.propertyId) conds.push(eq(payrollDeductionsTable.propertyId, input.propertyId));
    const rows = conds.length
      ? await db.select().from(payrollDeductionsTable).where(and(...conds))
      : await db.select().from(payrollDeductionsTable).limit(200);
    return { payrollDeductions: rows };
  },
});

// ─────────────────────────────────────────── WRITE tools ──────────
// Each write tool's `execute` mutates the DB. The router gates calls
// behind a per-tool approval (a row in assistant_proposals) so the
// model can never write without an explicit user confirm.

// PROPERTIES
tools.push({
  name: "create_property",
  kind: "write",
  description: "Create a new property under a customer.",
  input_schema: obj(
    {
      customerId: Str,
      name: Str,
      address: StrOpt,
      city: StrOpt,
      state: StrOpt,
      zip: StrOpt,
      totalBeds: NumOpt,
      monthlyRent: NumOpt,
      status: StrOpt,
      propertyType: StrOpt,
      notes: StrOpt,
    },
    ["customerId", "name"],
  ),
  summarize: (i) => `Create property "${i.name}" for customer ${i.customerId}`,
  execute: async (input) => {
    const id = newId("p");
    const [row] = await db
      .insert(propertiesTable)
      .values({
        id,
        customerId: input.customerId,
        name: input.name,
        address: input.address ?? "",
        city: input.city ?? "",
        state: input.state ?? "",
        zip: input.zip ?? "",
        totalBeds: input.totalBeds ?? 0,
        monthlyRent: input.monthlyRent ?? 0,
        status: input.status ?? "Active",
        propertyType: input.propertyType ?? null,
        notes: input.notes ?? "",
      })
      .returning();
    return { property: row };
  },
});

tools.push({
  name: "update_property",
  kind: "write",
  description: "Update fields on a property. Only provided fields are changed.",
  input_schema: obj(
    {
      id: Str,
      name: StrOpt,
      address: StrOpt,
      city: StrOpt,
      state: StrOpt,
      zip: StrOpt,
      totalBeds: NumOpt,
      monthlyRent: NumOpt,
      status: StrOpt,
      notes: StrOpt,
      landlordName: StrOpt,
      landlordEmail: StrOpt,
      landlordPhone: StrOpt,
      paymentMethod: StrOpt,
      propertyType: StrOpt,
    },
    ["id"],
  ),
  summarize: (i) => `Update property ${i.id}`,
  execute: async (input) => {
    const { id, ...rest } = input;
    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined) update[k] = v;
    const [row] = await db
      .update(propertiesTable)
      .set(update)
      .where(eq(propertiesTable.id, id))
      .returning();
    if (!row) throw new Error(`Property ${id} not found`);
    return { property: row };
  },
});

tools.push({
  name: "delete_property",
  kind: "write",
  description: "Delete a property and all its rooms/beds/leases. Destructive.",
  input_schema: obj({ id: Str }, ["id"]),
  summarize: (i) => `Delete property ${i.id} (and dependent rooms/beds/leases)`,
  execute: async (input) => {
    await db.transaction(async (tx) => {
      await tx.delete(bedsTable).where(eq(bedsTable.propertyId, input.id));
      await tx.delete(roomsTable).where(eq(roomsTable.propertyId, input.id));
      await tx.delete(buildingsTable).where(eq(buildingsTable.propertyId, input.id));
      await tx.delete(leasesTable).where(eq(leasesTable.propertyId, input.id));
      await tx.delete(utilitiesTable).where(eq(utilitiesTable.propertyId, input.id));
      await tx.delete(propertiesTable).where(eq(propertiesTable.id, input.id));
    });
    return { ok: true };
  },
});

// BUILDINGS
tools.push({
  name: "create_building",
  kind: "write",
  description: "Create a building under a property.",
  input_schema: obj(
    {
      propertyId: Str,
      name: Str,
      address: StrOpt,
      city: StrOpt,
      state: StrOpt,
      zip: StrOpt,
      notes: StrOpt,
    },
    ["propertyId", "name"],
  ),
  summarize: (i) => `Create building "${i.name}" under property ${i.propertyId}`,
  execute: async (input) => {
    const id = newId("bld");
    const [row] = await db
      .insert(buildingsTable)
      .values({
        id,
        propertyId: input.propertyId,
        name: input.name,
        address: input.address ?? "",
        city: input.city ?? "",
        state: input.state ?? "",
        zip: input.zip ?? "",
        notes: input.notes ?? "",
      })
      .returning();
    return { building: row };
  },
});

tools.push({
  name: "update_building",
  kind: "write",
  description: "Update a building.",
  input_schema: obj(
    { id: Str, name: StrOpt, address: StrOpt, city: StrOpt, state: StrOpt, zip: StrOpt, notes: StrOpt },
    ["id"],
  ),
  summarize: (i) => `Update building ${i.id}`,
  execute: async (input) => {
    const { id, ...rest } = input;
    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined) update[k] = v;
    const [row] = await db.update(buildingsTable).set(update).where(eq(buildingsTable.id, id)).returning();
    if (!row) throw new Error(`Building ${id} not found`);
    return { building: row };
  },
});

tools.push({
  name: "delete_building",
  kind: "write",
  description: "Delete a building. Rooms pointing at it will become unassigned.",
  input_schema: obj({ id: Str }, ["id"]),
  summarize: (i) => `Delete building ${i.id}`,
  execute: async (input) => {
    await db.delete(buildingsTable).where(eq(buildingsTable.id, input.id));
    return { ok: true };
  },
});

// ROOMS
tools.push({
  name: "create_room",
  kind: "write",
  description: "Create a room in a property/building.",
  input_schema: obj(
    {
      propertyId: Str,
      buildingId: StrOpt,
      name: Str,
      sqft: NumOpt,
      bathrooms: NumOpt,
      monthlyRent: NumOpt,
    },
    ["propertyId", "name"],
  ),
  summarize: (i) => `Create room "${i.name}" in property ${i.propertyId}`,
  execute: async (input) => {
    const id = newId("r");
    const [row] = await db
      .insert(roomsTable)
      .values({
        id,
        propertyId: input.propertyId,
        buildingId: input.buildingId ?? "",
        name: input.name,
        sqft: input.sqft ?? 0,
        bathrooms: input.bathrooms ?? 0,
        monthlyRent: input.monthlyRent ?? 0,
      })
      .returning();
    return { room: row };
  },
});

tools.push({
  name: "update_room",
  kind: "write",
  description: "Update a room.",
  input_schema: obj(
    { id: Str, name: StrOpt, buildingId: StrOpt, sqft: NumOpt, bathrooms: NumOpt, monthlyRent: NumOpt },
    ["id"],
  ),
  summarize: (i) => `Update room ${i.id}`,
  execute: async (input) => {
    const { id, ...rest } = input;
    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined) update[k] = v;
    const [row] = await db.update(roomsTable).set(update).where(eq(roomsTable.id, id)).returning();
    if (!row) throw new Error(`Room ${id} not found`);
    return { room: row };
  },
});

tools.push({
  name: "delete_room",
  kind: "write",
  description: "Delete a room (and its beds).",
  input_schema: obj({ id: Str }, ["id"]),
  summarize: (i) => `Delete room ${i.id} and its beds`,
  execute: async (input) => {
    await db.transaction(async (tx) => {
      await tx.delete(bedsTable).where(eq(bedsTable.roomId, input.id));
      await tx.delete(roomsTable).where(eq(roomsTable.id, input.id));
    });
    return { ok: true };
  },
});

// BEDS
tools.push({
  name: "create_bed",
  kind: "write",
  description: "Create a bed in a room.",
  input_schema: obj(
    { propertyId: Str, roomId: Str, bedNumber: NumOpt },
    ["propertyId", "roomId"],
  ),
  summarize: (i) => `Create bed #${i.bedNumber ?? "auto"} in room ${i.roomId}`,
  execute: async (input) => {
    const id = newId("bed");
    let bedNumber = input.bedNumber;
    if (!bedNumber) {
      const existing = await db.select().from(bedsTable).where(eq(bedsTable.roomId, input.roomId));
      bedNumber = (existing.reduce((m, b) => Math.max(m, b.bedNumber ?? 0), 0) || 0) + 1;
    }
    const [row] = await db
      .insert(bedsTable)
      .values({
        id,
        propertyId: input.propertyId,
        roomId: input.roomId,
        bedNumber,
        status: "Vacant",
        cleaningStatus: "ready",
      })
      .returning();
    return { bed: row };
  },
});

tools.push({
  name: "update_bed",
  kind: "write",
  description: "Update bed metadata (bedNumber, cleaningStatus, roomId). To assign an occupant use assign_occupant_to_bed.",
  input_schema: obj(
    { id: Str, bedNumber: NumOpt, cleaningStatus: StrOpt, roomId: StrOpt },
    ["id"],
  ),
  summarize: (i) => `Update bed ${i.id}`,
  execute: async (input) => {
    const { id, ...rest } = input;
    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined) update[k] = v;
    const [row] = await db.update(bedsTable).set(update).where(eq(bedsTable.id, id)).returning();
    if (!row) throw new Error(`Bed ${id} not found`);
    return { bed: row };
  },
});

tools.push({
  name: "delete_bed",
  kind: "write",
  description: "Delete a bed. Fails if it is currently occupied.",
  input_schema: obj({ id: Str }, ["id"]),
  summarize: (i) => `Delete bed ${i.id}`,
  execute: async (input) => {
    const [bed] = await db.select().from(bedsTable).where(eq(bedsTable.id, input.id));
    if (!bed) throw new Error(`Bed ${input.id} not found`);
    if (bed.occupantId) throw new Error(`Bed ${input.id} is occupied — unassign first`);
    await db.delete(bedsTable).where(eq(bedsTable.id, input.id));
    return { ok: true };
  },
});

// OCCUPANTS
tools.push({
  name: "create_occupant",
  kind: "write",
  description: "Create a new occupant (person). Use assign_occupant_to_bed afterwards to place them.",
  input_schema: obj(
    {
      name: Str,
      email: StrOpt,
      phone: StrOpt,
      moveInDate: StrOpt,
      chargePerBed: NumOpt,
      billingFrequency: StrOpt,
      employeeId: StrOpt,
      company: StrOpt,
      shift: StrOpt,
    },
    ["name"],
  ),
  summarize: (i) => `Create occupant "${i.name}"`,
  execute: async (input) => {
    const id = newId("o");
    const [row] = await db
      .insert(occupantsTable)
      .values({
        id,
        name: input.name,
        email: input.email ?? "",
        phone: input.phone ?? "",
        moveInDate: input.moveInDate ?? "",
        chargePerBed: input.chargePerBed ?? 0,
        billingFrequency: input.billingFrequency ?? "Monthly",
        employeeId: input.employeeId ?? "",
        company: input.company ?? "",
        shift: input.shift ?? null,
        status: "Active",
      })
      .returning();
    return { occupant: row };
  },
});

tools.push({
  name: "update_occupant",
  kind: "write",
  description: "Update an occupant's fields (not bed placement — use move_occupant or assign_occupant_to_bed for that).",
  input_schema: obj(
    {
      id: Str,
      name: StrOpt,
      email: StrOpt,
      phone: StrOpt,
      moveInDate: StrOpt,
      moveOutDate: StrOpt,
      status: StrOpt,
      chargePerBed: NumOpt,
      billingFrequency: StrOpt,
      employeeId: StrOpt,
      company: StrOpt,
      shift: StrOpt,
      isLead: BoolOpt,
      keysIssued: NumOpt,
    },
    ["id"],
  ),
  summarize: (i) => `Update occupant ${i.id}`,
  execute: async (input) => {
    const { id, ...rest } = input;
    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined) update[k] = v;
    const [row] = await db.update(occupantsTable).set(update).where(eq(occupantsTable.id, id)).returning();
    if (!row) throw new Error(`Occupant ${id} not found`);
    return { occupant: row };
  },
});

tools.push({
  name: "delete_occupant",
  kind: "write",
  description: "Delete an occupant. The bed they sat on becomes vacant + needs_cleaning.",
  input_schema: obj({ id: Str }, ["id"]),
  summarize: (i) => `Delete occupant ${i.id}`,
  execute: async (input) => {
    await db.transaction(async (tx) => {
      const [occ] = await tx.select().from(occupantsTable).where(eq(occupantsTable.id, input.id));
      if (occ?.bedId) {
        await tx
          .update(bedsTable)
          .set({ occupantId: null, status: "Vacant", cleaningStatus: "needs_cleaning" })
          .where(eq(bedsTable.id, occ.bedId));
      }
      await tx.delete(occupantsTable).where(eq(occupantsTable.id, input.id));
    });
    return { ok: true };
  },
});

tools.push({
  name: "assign_occupant_to_bed",
  kind: "write",
  description: "Place an occupant in a bed. The bed must be vacant. If the occupant is already in another bed, that bed is vacated (set to needs_cleaning) first.",
  input_schema: obj({ occupantId: Str, bedId: Str }, ["occupantId", "bedId"]),
  summarize: (i) => `Assign occupant ${i.occupantId} to bed ${i.bedId}`,
  execute: async (input) => {
    return db.transaction(async (tx) => {
      const [bed] = await tx.select().from(bedsTable).where(eq(bedsTable.id, input.bedId));
      if (!bed) throw new Error(`Bed ${input.bedId} not found`);
      if (bed.occupantId && bed.occupantId !== input.occupantId) {
        throw new Error(`Bed ${input.bedId} already occupied by ${bed.occupantId}`);
      }
      const [occ] = await tx.select().from(occupantsTable).where(eq(occupantsTable.id, input.occupantId));
      if (!occ) throw new Error(`Occupant ${input.occupantId} not found`);
      if (occ.bedId && occ.bedId !== input.bedId) {
        await tx
          .update(bedsTable)
          .set({ occupantId: null, status: "Vacant", cleaningStatus: "needs_cleaning" })
          .where(eq(bedsTable.id, occ.bedId));
      }
      const [updatedBed] = await tx
        .update(bedsTable)
        .set({ occupantId: input.occupantId, status: "Occupied", cleaningStatus: "occupied" })
        .where(eq(bedsTable.id, input.bedId))
        .returning();
      const [updatedOcc] = await tx
        .update(occupantsTable)
        .set({ bedId: input.bedId, propertyId: bed.propertyId, status: "Active" })
        .where(eq(occupantsTable.id, input.occupantId))
        .returning();
      return { bed: updatedBed, occupant: updatedOcc };
    });
  },
});

tools.push({
  name: "move_occupant_to_bed",
  kind: "write",
  description: "Move an already-placed occupant from their current bed to a new bed (target must be vacant). Source bed becomes vacant + needs_cleaning.",
  input_schema: obj({ occupantId: Str, newBedId: Str }, ["occupantId", "newBedId"]),
  summarize: (i) => `Move occupant ${i.occupantId} to bed ${i.newBedId}`,
  execute: async (input) => {
    return db.transaction(async (tx) => {
      const [occ] = await tx.select().from(occupantsTable).where(eq(occupantsTable.id, input.occupantId));
      if (!occ) throw new Error(`Occupant ${input.occupantId} not found`);
      const [newBed] = await tx.select().from(bedsTable).where(eq(bedsTable.id, input.newBedId));
      if (!newBed) throw new Error(`Bed ${input.newBedId} not found`);
      if (newBed.occupantId && newBed.occupantId !== input.occupantId) {
        throw new Error(`Target bed ${input.newBedId} already occupied`);
      }
      if (occ.bedId && occ.bedId !== input.newBedId) {
        await tx
          .update(bedsTable)
          .set({ occupantId: null, status: "Vacant", cleaningStatus: "needs_cleaning" })
          .where(eq(bedsTable.id, occ.bedId));
      }
      const [updatedBed] = await tx
        .update(bedsTable)
        .set({ occupantId: input.occupantId, status: "Occupied", cleaningStatus: "occupied" })
        .where(eq(bedsTable.id, input.newBedId))
        .returning();
      const [updatedOcc] = await tx
        .update(occupantsTable)
        .set({ bedId: input.newBedId, propertyId: newBed.propertyId })
        .where(eq(occupantsTable.id, input.occupantId))
        .returning();
      return { bed: updatedBed, occupant: updatedOcc };
    });
  },
});

tools.push({
  name: "unassign_occupant",
  kind: "write",
  description: "Remove an occupant from their current bed (does not delete the occupant). Bed becomes vacant + needs_cleaning.",
  input_schema: obj({ occupantId: Str, moveOutDate: StrOpt }, ["occupantId"]),
  summarize: (i) => `Unassign occupant ${i.occupantId}`,
  execute: async (input) => {
    return db.transaction(async (tx) => {
      const [occ] = await tx.select().from(occupantsTable).where(eq(occupantsTable.id, input.occupantId));
      if (!occ) throw new Error(`Occupant ${input.occupantId} not found`);
      if (occ.bedId) {
        await tx
          .update(bedsTable)
          .set({ occupantId: null, status: "Vacant", cleaningStatus: "needs_cleaning" })
          .where(eq(bedsTable.id, occ.bedId));
      }
      const [updatedOcc] = await tx
        .update(occupantsTable)
        .set({
          bedId: null,
          status: "Inactive",
          moveOutDate: input.moveOutDate ?? new Date().toISOString().slice(0, 10),
        })
        .where(eq(occupantsTable.id, input.occupantId))
        .returning();
      return { occupant: updatedOcc };
    });
  },
});

// LEASES
tools.push({
  name: "create_lease",
  kind: "write",
  description: "Create a lease on a property.",
  input_schema: obj(
    {
      propertyId: Str,
      startDate: StrOpt,
      endDate: StrOpt,
      monthlyRent: NumOpt,
      securityDeposit: NumOpt,
      status: StrOpt,
      unit: StrOpt,
      notes: StrOpt,
      vendor: StrOpt,
      buildingId: StrOpt,
    },
    ["propertyId"],
  ),
  summarize: (i) => `Create lease on property ${i.propertyId}`,
  execute: async (input) => {
    const id = newId("l");
    const [row] = await db
      .insert(leasesTable)
      .values({
        id,
        propertyId: input.propertyId,
        startDate: input.startDate ?? "",
        endDate: input.endDate ?? "",
        monthlyRent: input.monthlyRent ?? 0,
        securityDeposit: input.securityDeposit ?? 0,
        status: input.status ?? "Active",
        notes: input.notes ?? "",
        vendor: input.vendor ?? "",
        unit: input.unit ?? "",
        buildingId: input.buildingId ?? null,
      })
      .returning();
    return { lease: row };
  },
});

tools.push({
  name: "update_lease",
  kind: "write",
  description: "Update a lease.",
  input_schema: obj(
    {
      id: Str,
      startDate: StrOpt,
      endDate: StrOpt,
      monthlyRent: NumOpt,
      securityDeposit: NumOpt,
      status: StrOpt,
      unit: StrOpt,
      notes: StrOpt,
      vendor: StrOpt,
    },
    ["id"],
  ),
  summarize: (i) => `Update lease ${i.id}`,
  execute: async (input) => {
    const { id, ...rest } = input;
    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined) update[k] = v;
    const [row] = await db.update(leasesTable).set(update).where(eq(leasesTable.id, id)).returning();
    if (!row) throw new Error(`Lease ${id} not found`);
    return { lease: row };
  },
});

tools.push({
  name: "delete_lease",
  kind: "write",
  description: "Delete a lease.",
  input_schema: obj({ id: Str }, ["id"]),
  summarize: (i) => `Delete lease ${i.id}`,
  execute: async (input) => {
    await db.delete(leasesTable).where(eq(leasesTable.id, input.id));
    return { ok: true };
  },
});

// UTILITIES
tools.push({
  name: "create_utility",
  kind: "write",
  description: "Create a utility account for a property.",
  input_schema: obj(
    { propertyId: Str, type: Str, company: StrOpt, monthlyCost: NumOpt, accountNumber: StrOpt, notes: StrOpt },
    ["propertyId", "type"],
  ),
  summarize: (i) => `Create ${i.type} utility for property ${i.propertyId}`,
  execute: async (input) => {
    const id = newId("u");
    const [row] = await db
      .insert(utilitiesTable)
      .values({
        id,
        propertyId: input.propertyId,
        type: input.type,
        company: input.company ?? "",
        monthlyCost: input.monthlyCost ?? 0,
        accountNumber: input.accountNumber ?? "",
        notes: input.notes ?? "",
      })
      .returning();
    return { utility: row };
  },
});

tools.push({
  name: "update_utility",
  kind: "write",
  description: "Update a utility.",
  input_schema: obj(
    { id: Str, type: StrOpt, company: StrOpt, monthlyCost: NumOpt, accountNumber: StrOpt, notes: StrOpt },
    ["id"],
  ),
  summarize: (i) => `Update utility ${i.id}`,
  execute: async (input) => {
    const { id, ...rest } = input;
    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined) update[k] = v;
    const [row] = await db.update(utilitiesTable).set(update).where(eq(utilitiesTable.id, id)).returning();
    if (!row) throw new Error(`Utility ${id} not found`);
    return { utility: row };
  },
});

tools.push({
  name: "delete_utility",
  kind: "write",
  description: "Delete a utility account.",
  input_schema: obj({ id: Str }, ["id"]),
  summarize: (i) => `Delete utility ${i.id}`,
  execute: async (input) => {
    await db.delete(utilitiesTable).where(eq(utilitiesTable.id, input.id));
    return { ok: true };
  },
});

// INSURANCE
tools.push({
  name: "create_insurance_certificate",
  kind: "write",
  description: "Create an insurance certificate for a property.",
  input_schema: obj(
    {
      propertyId: Str,
      carrier: StrOpt,
      policyNumber: StrOpt,
      insuredName: StrOpt,
      coverageStart: StrOpt,
      coverageEnd: StrOpt,
      leaseId: StrOpt,
      notes: StrOpt,
    },
    ["propertyId"],
  ),
  summarize: (i) => `Create insurance certificate for property ${i.propertyId}`,
  execute: async (input) => {
    const id = newId("ic");
    const [row] = await db
      .insert(insuranceCertificatesTable)
      .values({
        id,
        propertyId: input.propertyId,
        carrier: input.carrier ?? "",
        policyNumber: input.policyNumber ?? "",
        insuredName: input.insuredName ?? "",
        coverageStart: input.coverageStart ?? "",
        coverageEnd: input.coverageEnd ?? "",
        leaseId: input.leaseId ?? "",
        notes: input.notes ?? "",
      })
      .returning();
    return { insuranceCertificate: row };
  },
});

tools.push({
  name: "update_insurance_certificate",
  kind: "write",
  description: "Update an insurance certificate.",
  input_schema: obj(
    {
      id: Str,
      carrier: StrOpt,
      policyNumber: StrOpt,
      insuredName: StrOpt,
      coverageStart: StrOpt,
      coverageEnd: StrOpt,
      notes: StrOpt,
    },
    ["id"],
  ),
  summarize: (i) => `Update insurance certificate ${i.id}`,
  execute: async (input) => {
    const { id, ...rest } = input;
    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined) update[k] = v;
    const [row] = await db
      .update(insuranceCertificatesTable)
      .set(update)
      .where(eq(insuranceCertificatesTable.id, id))
      .returning();
    if (!row) throw new Error(`Insurance certificate ${id} not found`);
    return { insuranceCertificate: row };
  },
});

tools.push({
  name: "delete_insurance_certificate",
  kind: "write",
  description: "Delete an insurance certificate.",
  input_schema: obj({ id: Str }, ["id"]),
  summarize: (i) => `Delete insurance certificate ${i.id}`,
  execute: async (input) => {
    await db.delete(insuranceCertificatesTable).where(eq(insuranceCertificatesTable.id, input.id));
    return { ok: true };
  },
});

// PAYROLL DEDUCTIONS
tools.push({
  name: "create_payroll_deduction",
  kind: "write",
  description: "Record a per-week payroll housing deduction snapshot.",
  input_schema: obj(
    {
      occupantId: Str,
      payWeekEndDate: Str,
      weeklyAmount: Num,
      customerId: StrOpt,
      propertyId: StrOpt,
      personId: StrOpt,
    },
    ["occupantId", "payWeekEndDate", "weeklyAmount"],
  ),
  summarize: (i) => `Record $${i.weeklyAmount} payroll deduction for ${i.occupantId} (week ${i.payWeekEndDate})`,
  execute: async (input) => {
    const id = newId("pd");
    const [row] = await db
      .insert(payrollDeductionsTable)
      .values({
        id,
        occupantId: input.occupantId,
        payWeekEndDate: input.payWeekEndDate,
        weeklyAmount: input.weeklyAmount,
        customerId: input.customerId ?? "",
        propertyId: input.propertyId ?? "",
        personId: input.personId ?? "",
      })
      .returning();
    return { payrollDeduction: row };
  },
});

tools.push({
  name: "delete_payroll_deduction",
  kind: "write",
  description: "Delete a payroll deduction snapshot.",
  input_schema: obj({ id: Str }, ["id"]),
  summarize: (i) => `Delete payroll deduction ${i.id}`,
  execute: async (input) => {
    await db.delete(payrollDeductionsTable).where(eq(payrollDeductionsTable.id, input.id));
    return { ok: true };
  },
});

export const TOOLS: ReadonlyArray<ToolDef> = tools;

export const TOOL_BY_NAME: Map<string, ToolDef> = new Map(tools.map((t) => [t.name, t]));

export function anthropicToolDefs(): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}
