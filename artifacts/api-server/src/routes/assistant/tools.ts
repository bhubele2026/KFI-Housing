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
  propertyViolationsTable,
  projectedMoveInsTable,
  roomNightLogsTable,
  assistantUploadsTable,
} from "@workspace/db";
import {
  normalizePropertyRow,
  normalizeBuildingRow,
  normalizeRoomRow,
  normalizeBedRow,
  normalizeOccupantRow,
  normalizeLeaseRow,
  normalizeUtilityRow,
} from "../../lib/db-row-normalizers";
import { callRouteOrThrow } from "./dispatch";
import { importMasterLeases, readMasterWorkbookFromBuffer } from "../../lib/import-master-leases";
import { seedHousingDeductions } from "../../lib/seed-housing-deductions";
import { parseDeductionsWorkbook } from "../payroll-import-deductions";
import {
  extractLeaseFromText,
  extractLeaseFromPdfBuffer,
  rankPropertyCandidates,
} from "../../lib/lease-pdf-import";
import { isSaturdayDate } from "../../lib/pay-week";
import { logger } from "../../lib/logger";
import { PDFParse } from "pdf-parse";

export type ToolKind = "read" | "write";

/**
 * Per-invocation context passed into every tool's preview/execute.
 * Currently carries the authenticated operator's userId so any tool
 * that reads user-owned data (e.g. uploaded files) can enforce an
 * ownership check at the point of read, not just at the point of
 * upload (defense against IDOR on `assistant_uploads.id`).
 */
export interface ToolCtx {
  userId: string;
}

export interface ToolDef {
  name: string;
  kind: ToolKind;
  description: string;
  input_schema: Record<string, unknown>;
  summarize: (input: any) => string;
  /**
   * Optional "what will change" preview for write tools. Runs BEFORE
   * the operator is shown the proposal card so they see the
   * before/after of the proposed change in plain English (row counts,
   * matched/unmatched, dollar totals, etc.). Must be side-effect free.
   */
  preview?: (input: any, ctx: ToolCtx) => Promise<unknown>;
  execute: (input: any, ctx: ToolCtx) => Promise<unknown>;
}

async function loadUploadBytes(
  uploadId: string,
  ctx: ToolCtx,
): Promise<{
  filename: string;
  mime: string;
  sizeBytes: number;
  content: Buffer;
}> {
  if (!uploadId || typeof uploadId !== "string") {
    throw new Error("uploadId is required");
  }
  if (!ctx?.userId) {
    // Defense-in-depth: every code path that reaches a tool should
    // have already resolved a userId. Refuse rather than fall back to
    // an unscoped lookup.
    throw new Error("Upload access requires an authenticated user");
  }
  const [row] = await db
    .select()
    .from(assistantUploadsTable)
    .where(
      and(
        eq(assistantUploadsTable.id, uploadId),
        eq(assistantUploadsTable.userId, ctx.userId),
      ),
    );
  if (!row) throw new Error(`Upload ${uploadId} not found`);
  const content = Buffer.isBuffer(row.content)
    ? row.content
    : Buffer.from(row.content as unknown as Uint8Array);
  return {
    filename: row.filename,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    content,
  };
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
  description:
    "List leases. Optional filters: propertyId, customerId (resolves via property), and expiringWithinDays (returns only leases whose endDate is between today and today+N).",
  input_schema: obj({
    propertyId: StrOpt,
    customerId: StrOpt,
    expiringWithinDays: NumOpt,
  }),
  summarize: (i) =>
    `Listing leases${i.expiringWithinDays ? ` expiring within ${i.expiringWithinDays}d` : ""}${i.customerId ? ` for customer ${i.customerId}` : ""}${i.propertyId ? ` for property ${i.propertyId}` : ""}`,
  execute: async (input) => {
    // Resolve customerId → set of propertyIds so we can filter leases.
    let propertyIdSet: Set<string> | null = null;
    if (input.customerId) {
      const props = await db
        .select({ id: propertiesTable.id })
        .from(propertiesTable)
        .where(eq(propertiesTable.customerId, input.customerId));
      propertyIdSet = new Set(props.map((p) => p.id));
    }
    let rows = input.propertyId
      ? await db.select().from(leasesTable).where(eq(leasesTable.propertyId, input.propertyId))
      : await db.select().from(leasesTable);
    if (propertyIdSet) {
      rows = rows.filter((l) => propertyIdSet!.has(l.propertyId));
    }
    if (typeof input.expiringWithinDays === "number" && input.expiringWithinDays >= 0) {
      const today = new Date().toISOString().slice(0, 10);
      const horizon = new Date(Date.now() + input.expiringWithinDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      rows = rows.filter((l) => {
        const end = (l as any).endDate as string | undefined;
        return typeof end === "string" && end >= today && end <= horizon;
      });
    }
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
  description:
    "List payroll housing deductions. Optional filters: occupantId, propertyId, customerId, payWeekEndDate (exact YYYY-MM-DD week), and unmatched=true to return only rows whose occupantId does not match any current occupant (the 'unmatched payroll for <customer>' workflow).",
  input_schema: obj({
    occupantId: StrOpt,
    propertyId: StrOpt,
    customerId: StrOpt,
    payWeekEndDate: StrOpt,
    unmatched: BoolOpt,
  }),
  summarize: (i) =>
    `Listing payroll deductions${i.unmatched ? " (unmatched only)" : ""}${i.customerId ? ` for customer ${i.customerId}` : ""}${i.payWeekEndDate ? ` week ${i.payWeekEndDate}` : ""}`,
  execute: async (input) => {
    const conds = [] as any[];
    if (input.occupantId) conds.push(eq(payrollDeductionsTable.occupantId, input.occupantId));
    if (input.propertyId) conds.push(eq(payrollDeductionsTable.propertyId, input.propertyId));
    if (input.customerId) conds.push(eq(payrollDeductionsTable.customerId, input.customerId));
    if (input.payWeekEndDate)
      conds.push(eq(payrollDeductionsTable.payWeekEndDate, input.payWeekEndDate));
    let rows = conds.length
      ? await db.select().from(payrollDeductionsTable).where(and(...conds))
      : await db.select().from(payrollDeductionsTable).limit(200);
    if (input.unmatched) {
      const occIds = new Set(
        (await db.select({ id: occupantsTable.id }).from(occupantsTable)).map((o) => o.id),
      );
      rows = rows.filter((r) => !r.occupantId || !occIds.has(r.occupantId));
    }
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
    // Apply the same boundary normaliser the POST /api/properties route
    // uses (Task #646) so address coercion, paymentMethod sanitisation
    // and friends fire for assistant-initiated creates too. The route
    // can't be called directly here because its `CreatePropertyBody`
    // schema requires a long list of fields (ratings, furnishings,
    // landlord fields, …) the tool intentionally doesn't expose to the
    // model; we still apply the normaliser to match the route's write
    // contract.
    const id = newId("p");
    const values = normalizePropertyRow({
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
    });
    const [row] = await db.insert(propertiesTable).values(values).returning();
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
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined) body[k] = v;
    // Route through PATCH /api/properties/:id (Task #646) so the
    // server-side geocode-on-address-change pathway, the
    // `normalizePropertyRow` boundary coercion and the
    // `UpdatePropertyBody` enum/shape gates fire for assistant writes
    // too — previously this tool wrote straight to the DB and skipped
    // every one of them.
    const property = await callRouteOrThrow(
      "PATCH",
      `/properties/${encodeURIComponent(id)}`,
      body,
    );
    return { property };
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
    // Mirror the POST /api/buildings normaliser (Task #646).
    const id = newId("bld");
    const values = normalizeBuildingRow({
      id,
      propertyId: input.propertyId,
      name: input.name,
      address: input.address ?? "",
      city: input.city ?? "",
      state: input.state ?? "",
      zip: input.zip ?? "",
      notes: input.notes ?? "",
    });
    const [row] = await db.insert(buildingsTable).values(values).returning();
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
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined) body[k] = v;
    // Route through PATCH /api/buildings/:id (Task #646) so the
    // UpdateBuildingBody Zod gates + normalizeBuildingRow fire for
    // assistant writes too.
    const building = await callRouteOrThrow(
      "PATCH",
      `/buildings/${encodeURIComponent(id)}`,
      body,
    );
    return { building };
  },
});

tools.push({
  name: "delete_building",
  kind: "write",
  description:
    "Delete a building. Refuses if the building still has rooms, or if it is the last building on its property (mirrors DELETE /api/buildings/:id).",
  input_schema: obj({ id: Str }, ["id"]),
  summarize: (i) => `Delete building ${i.id}`,
  execute: async (input) => {
    // Route through DELETE /api/buildings/:id (Task #646) so the
    // has-rooms and last-building-on-property guards fire — these used
    // to be duplicated here and could drift away from the route's
    // wording over time.
    await callRouteOrThrow(
      "DELETE",
      `/buildings/${encodeURIComponent(input.id)}`,
    );
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
    // Mirror the POST /api/rooms normaliser (Task #646).
    const id = newId("r");
    const values = normalizeRoomRow({
      id,
      propertyId: input.propertyId,
      buildingId: input.buildingId ?? "",
      name: input.name,
      sqft: input.sqft ?? 0,
      bathrooms: input.bathrooms ?? 0,
      monthlyRent: input.monthlyRent ?? 0,
    });
    const [row] = await db.insert(roomsTable).values(values).returning();
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
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined) body[k] = v;
    // Route through PATCH /api/rooms/:id (Task #646).
    const room = await callRouteOrThrow(
      "PATCH",
      `/rooms/${encodeURIComponent(id)}`,
      body,
    );
    return { room };
  },
});

tools.push({
  name: "delete_room",
  kind: "write",
  description:
    "Delete a room. Refuses if the room still has beds (mirrors DELETE /api/rooms/:id). To delete a populated room, delete each of its beds first (or vacate + delete them).",
  input_schema: obj({ id: Str }, ["id"]),
  summarize: (i) => `Delete room ${i.id}`,
  execute: async (input) => {
    // Route through DELETE /api/rooms/:id (Task #646) so the
    // has-beds guard fires consistently with the HTTP route.
    await callRouteOrThrow(
      "DELETE",
      `/rooms/${encodeURIComponent(input.id)}`,
    );
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
    // Mirror the POST /api/beds normaliser (Task #646).
    const values = normalizeBedRow({
      id,
      propertyId: input.propertyId,
      roomId: input.roomId,
      bedNumber,
      status: "Vacant",
      cleaningStatus: "ready",
      occupantId: null,
    });
    const [row] = await db.insert(bedsTable).values(values).returning();
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
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined) body[k] = v;
    // Route through PATCH /api/beds/:id (Task #646) so the cleaning
    // workflow guard (#500) fires — refuses to flip a non-"ready" bed
    // to Occupied / attach an occupant, and auto-sets needs_cleaning on
    // vacate. Previously this tool went straight to db.update and
    // skipped the whole workflow.
    const bed = await callRouteOrThrow(
      "PATCH",
      `/beds/${encodeURIComponent(id)}`,
      body,
    );
    return { bed };
  },
});

tools.push({
  name: "delete_bed",
  kind: "write",
  description: "Delete a bed. Fails if it is currently occupied.",
  input_schema: obj({ id: Str }, ["id"]),
  summarize: (i) => `Delete bed ${i.id}`,
  execute: async (input) => {
    // The DELETE /api/beds/:id route doesn't refuse occupied beds (it
    // would leave a dangling occupant.bedId), so we keep the assistant-
    // side occupied check here and then route through for the actual
    // delete so future route-level guards apply automatically.
    const [bed] = await db.select().from(bedsTable).where(eq(bedsTable.id, input.id));
    if (!bed) throw new Error(`Bed ${input.id} not found`);
    if (bed.occupantId) throw new Error(`Bed ${input.id} is occupied — unassign first`);
    await callRouteOrThrow(
      "DELETE",
      `/beds/${encodeURIComponent(input.id)}`,
    );
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
    // Mirror POST /api/occupants: moveInDate is required for a useful
    // occupant record. Default to today if the caller didn't supply one
    // rather than persisting "" (which breaks downstream date math).
    const moveInDate =
      typeof input.moveInDate === "string" && input.moveInDate.length > 0
        ? input.moveInDate
        : new Date().toISOString().slice(0, 10);
    // Mirror the POST /api/occupants normaliser + chargeSource defaults
    // (Task #646). The route's `CreateOccupantBody` requires `bedId` /
    // `propertyId` / `moveOutDate` keys we don't expose to the model, so
    // we apply the normaliser in-process rather than dispatching through
    // the route — the cleaning-workflow guard on bedId isn't relevant
    // here because this tool always creates an unplaced occupant.
    const values = normalizeOccupantRow({
      id,
      name: input.name,
      email: input.email ?? "",
      phone: input.phone ?? "",
      moveInDate,
      chargePerBed: input.chargePerBed ?? 0,
      billingFrequency: input.billingFrequency ?? "Monthly",
      employeeId: input.employeeId ?? "",
      company: input.company ?? "",
      shift: input.shift ?? null,
      chargeSource: "",
      chargeSourceCustomer: "",
      chargeSourcePersonId: "",
      // canonical status is Active | Former — the normalizer coerces
      // anything else to Active.
      status: "Active",
    });
    const [row] = await db.insert(occupantsTable).values(values).returning();
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
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined) body[k] = v;
    // Route through PATCH /api/occupants/:id (Task #646) so the full
    // chain runs for assistant writes too: cleaning workflow guard on
    // bedId transfers (#500), automatic prior-bed turnover, lead-tenant
    // demotion when isLead flips on, chargeSource preservation (#330)
    // when chargePerBed/billingFrequency change, and the move-to-Former
    // bed detach. Direct db.update used to bypass every one of these.
    const occupant = await callRouteOrThrow(
      "PATCH",
      `/occupants/${encodeURIComponent(id)}`,
      body,
    );
    return { occupant };
  },
});

tools.push({
  name: "delete_occupant",
  kind: "write",
  description: "Delete an occupant. The bed they sat on becomes vacant + needs_cleaning.",
  input_schema: obj({ id: Str }, ["id"]),
  summarize: (i) => `Delete occupant ${i.id}`,
  execute: async (input) => {
    // Route through DELETE /api/occupants/:id (Task #646) so the bed
    // cleanup pass (clear occupantId + flip to Vacant + needs_cleaning,
    // task #500) is the single source of truth — previously this tool
    // duplicated that logic in a local transaction.
    await callRouteOrThrow(
      "DELETE",
      `/occupants/${encodeURIComponent(input.id)}`,
    );
    return { ok: true };
  },
});

tools.push({
  name: "assign_occupant_to_bed",
  kind: "write",
  description: "Place an occupant in a bed. The bed must be vacant AND cleaningStatus must be 'ready'. If the occupant is already in another bed, that bed is vacated (set to needs_cleaning) first.",
  input_schema: obj({ occupantId: Str, bedId: Str }, ["occupantId", "bedId"]),
  summarize: (i) => `Assign occupant ${i.occupantId} to bed ${i.bedId}`,
  execute: async (input) => {
    // Look up the bed's propertyId so we can mirror the route's
    // expectation that occupant.propertyId follows the bed.
    const [bed] = await db.select().from(bedsTable).where(eq(bedsTable.id, input.bedId));
    if (!bed) throw new Error(`Bed ${input.bedId} not found`);
    // Step 1: PATCH /api/occupants/:id with the new bedId — this fires
    // the route's cleaning-workflow guard (refuses non-"ready" beds),
    // the "already occupied by someone else" guard, and the prior-bed
    // automatic turnover. (Task #646 / #500.)
    const occupant = await callRouteOrThrow(
      "PATCH",
      `/occupants/${encodeURIComponent(input.occupantId)}`,
      { bedId: input.bedId, propertyId: bed.propertyId, status: "Active" },
    );
    // Step 2: PATCH /api/beds/:id to mark the bed Occupied and stamp
    // occupantId — same call the UI's "place occupant" action makes.
    // The bed's cleaning guard re-validates "ready" so the workflow
    // can't be bypassed even if step 1 raced.
    const updatedBed = await callRouteOrThrow(
      "PATCH",
      `/beds/${encodeURIComponent(input.bedId)}`,
      { occupantId: input.occupantId, status: "Occupied", cleaningStatus: "occupied" },
    );
    return { bed: updatedBed, occupant };
  },
});

tools.push({
  name: "move_occupant_to_bed",
  kind: "write",
  description: "Move an already-placed occupant from their current bed to a new bed (target must be vacant AND cleaningStatus must be 'ready'). Source bed becomes vacant + needs_cleaning.",
  input_schema: obj({ occupantId: Str, newBedId: Str }, ["occupantId", "newBedId"]),
  summarize: (i) => `Move occupant ${i.occupantId} to bed ${i.newBedId}`,
  execute: async (input) => {
    // Route through PATCH /api/occupants + PATCH /api/beds (Task #646)
    // — same dispatch chain as assign_occupant_to_bed. The occupants
    // route handles prior-bed turnover automatically when bedId
    // changes, and the beds route re-enforces the cleaning workflow.
    const [newBed] = await db.select().from(bedsTable).where(eq(bedsTable.id, input.newBedId));
    if (!newBed) throw new Error(`Bed ${input.newBedId} not found`);
    const occupant = await callRouteOrThrow(
      "PATCH",
      `/occupants/${encodeURIComponent(input.occupantId)}`,
      { bedId: input.newBedId, propertyId: newBed.propertyId },
    );
    const updatedBed = await callRouteOrThrow(
      "PATCH",
      `/beds/${encodeURIComponent(input.newBedId)}`,
      { occupantId: input.occupantId, status: "Occupied", cleaningStatus: "occupied" },
    );
    return { bed: updatedBed, occupant };
  },
});

tools.push({
  name: "unassign_occupant",
  kind: "write",
  description: "Remove an occupant from their current bed (does not delete the occupant). Bed becomes vacant + needs_cleaning.",
  input_schema: obj({ occupantId: Str, moveOutDate: StrOpt }, ["occupantId"]),
  summarize: (i) => `Unassign occupant ${i.occupantId}`,
  execute: async (input) => {
    // Route through PATCH /api/occupants/:id (Task #646). The route
    // sees bedId moving to null while the occupant currently has a bed
    // and runs the move-to-Former cleanup pass on the old bed (Vacant
    // + needs_cleaning) plus the normalizer.
    const updatedOcc = await callRouteOrThrow(
      "PATCH",
      `/occupants/${encodeURIComponent(input.occupantId)}`,
      {
        bedId: null,
        status: "Former",
        moveOutDate: input.moveOutDate ?? new Date().toISOString().slice(0, 10),
      },
    );
    return { occupant: updatedOcc };
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
    // Mirror the POST /api/leases normaliser (Task #646) — derives
    // status from dates, coerces paymentMethod, etc.
    const id = newId("l");
    const values = normalizeLeaseRow({
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
    });
    const [row] = await db.insert(leasesTable).values(values).returning();
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
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined) body[k] = v;
    // Route through PATCH /api/leases/:id (Task #646) so the status
    // derivation from dates + paymentMethod coercion in
    // normalizeLeaseRow fire for assistant writes too.
    const lease = await callRouteOrThrow(
      "PATCH",
      `/leases/${encodeURIComponent(id)}`,
      body,
    );
    return { lease };
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
    // Mirror the POST /api/utilities normaliser (Task #646).
    const id = newId("u");
    const values = normalizeUtilityRow({
      id,
      propertyId: input.propertyId,
      type: input.type,
      company: input.company ?? "",
      monthlyCost: input.monthlyCost ?? 0,
      accountNumber: input.accountNumber ?? "",
      notes: input.notes ?? "",
    });
    const [row] = await db.insert(utilitiesTable).values(values).returning();
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
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined) body[k] = v;
    // Route through PATCH /api/utilities/:id (Task #646).
    const utility = await callRouteOrThrow(
      "PATCH",
      `/utilities/${encodeURIComponent(id)}`,
      body,
    );
    return { utility };
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
    // The insurance-certificates route doesn't have a dedicated row
    // normaliser (just CreateInsuranceCertificateBody Zod parsing on
    // POST), so we insert the same flat shape the route would. Keep
    // the field list aligned with that schema so any future normaliser
    // added route-side gets picked up by mirroring the same call.
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
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined) body[k] = v;
    // Route through PATCH /api/insurance-certificates/:id (Task #646).
    const insuranceCertificate = await callRouteOrThrow(
      "PATCH",
      `/insurance-certificates/${encodeURIComponent(id)}`,
      body,
    );
    return { insuranceCertificate };
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

// ─────────────── Additional GET tools (per task spec) ────────────────

tools.push({
  name: "get_occupant",
  kind: "read",
  description: "Get one occupant by id, including the current bed (if any) and active leases for the same property.",
  input_schema: obj({ id: Str }, ["id"]),
  summarize: (i) => `Getting occupant ${i.id}`,
  execute: async (input) => {
    const [occ] = await db.select().from(occupantsTable).where(eq(occupantsTable.id, input.id));
    if (!occ) throw new Error(`Occupant ${input.id} not found`);
    const bed = occ.bedId
      ? (await db.select().from(bedsTable).where(eq(bedsTable.id, occ.bedId)))[0] ?? null
      : null;
    const leases = occ.propertyId
      ? await db.select().from(leasesTable).where(eq(leasesTable.propertyId, occ.propertyId))
      : [];
    return { occupant: occ, bed, leases };
  },
});

tools.push({
  name: "get_lease",
  kind: "read",
  description: "Get one lease by id.",
  input_schema: obj({ id: Str }, ["id"]),
  summarize: (i) => `Getting lease ${i.id}`,
  execute: async (input) => {
    const [row] = await db.select().from(leasesTable).where(eq(leasesTable.id, input.id));
    if (!row) throw new Error(`Lease ${input.id} not found`);
    return row;
  },
});

tools.push({
  name: "get_bed",
  kind: "read",
  description: "Get one bed by id.",
  input_schema: obj({ id: Str }, ["id"]),
  summarize: (i) => `Getting bed ${i.id}`,
  execute: async (input) => {
    const [row] = await db.select().from(bedsTable).where(eq(bedsTable.id, input.id));
    if (!row) throw new Error(`Bed ${input.id} not found`);
    return row;
  },
});

// ─────────────── Composite write tools (per task spec) ───────────────

tools.push({
  name: "create_property_with_layout",
  kind: "write",
  description:
    "Create a property AND its buildings, rooms, and beds in a single transaction. Use this for the 'create a property with 2 buildings, 8 rooms each, double-occupancy at $750/week' style of request — one Confirm card runs everything atomically.",
  input_schema: obj(
    {
      property: obj(
        {
          name: Str,
          address: StrOpt,
          city: StrOpt,
          state: StrOpt,
          zip: StrOpt,
          customerId: StrOpt,
          status: StrOpt,
        },
        ["name"],
      ),
      buildings: {
        type: "array",
        items: obj(
          {
            name: Str,
            address: StrOpt,
            rooms: {
              type: "array",
              items: obj(
                {
                  name: Str,
                  monthlyRent: NumOpt,
                  beds: {
                    type: "array",
                    items: obj(
                      {
                        bedNumber: Num,
                      },
                      ["bedNumber"],
                    ),
                  },
                },
                ["name"],
              ),
            },
          },
          ["name"],
        ),
      },
    },
    ["property", "buildings"],
  ),
  summarize: (i) => {
    const buildings = (i.buildings ?? []) as any[];
    const rooms = buildings.reduce((n, b) => n + ((b.rooms ?? []).length as number), 0);
    const beds = buildings.reduce(
      (n, b) =>
        n +
        ((b.rooms ?? []) as any[]).reduce(
          (rn: number, r: any) => rn + ((r.beds ?? []).length as number),
          0,
        ),
      0,
    );
    return `Create property "${i.property?.name}" with ${buildings.length} building(s), ${rooms} room(s), ${beds} bed(s)`;
  },
  execute: async (input) => {
    // Composite tool stays inside one transaction (so the model gets
    // all-or-nothing on the layout), but every insert now goes through
    // the same normalisers the route handlers use (Task #646) so the
    // rows match what POST /api/properties|/buildings|/rooms|/beds
    // would have produced.
    return db.transaction(async (tx) => {
      const pid = newId("p");
      const p = input.property ?? {};
      await tx.insert(propertiesTable).values(
        normalizePropertyRow({
          id: pid,
          name: p.name,
          address: p.address ?? "",
          city: p.city ?? "",
          state: p.state ?? "",
          zip: p.zip ?? "",
          customerId: p.customerId ?? "",
          status: p.status ?? "Active",
        }),
      );
      const createdBuildings: any[] = [];
      const createdRooms: any[] = [];
      const createdBeds: any[] = [];
      for (const b of (input.buildings ?? []) as any[]) {
        const bid = newId("bld");
        await tx.insert(buildingsTable).values(
          normalizeBuildingRow({
            id: bid,
            propertyId: pid,
            name: b.name,
            address: b.address ?? "",
          }),
        );
        createdBuildings.push({ id: bid, name: b.name });
        for (const r of (b.rooms ?? []) as any[]) {
          const rid = newId("r");
          await tx.insert(roomsTable).values(
            normalizeRoomRow({
              id: rid,
              buildingId: bid,
              propertyId: pid,
              name: r.name,
              monthlyRent: r.monthlyRent ?? 0,
            }),
          );
          createdRooms.push({ id: rid, name: r.name, buildingId: bid });
          for (const bedDef of (r.beds ?? []) as any[]) {
            const bedId = newId("bed");
            await tx.insert(bedsTable).values(
              normalizeBedRow({
                id: bedId,
                roomId: rid,
                propertyId: pid,
                bedNumber: bedDef.bedNumber,
                status: "Vacant",
                cleaningStatus: "ready",
                occupantId: null,
              }),
            );
            createdBeds.push({ id: bedId, bedNumber: bedDef.bedNumber, roomId: rid });
          }
        }
      }
      return {
        property: { id: pid, ...p },
        buildings: createdBuildings,
        rooms: createdRooms,
        beds: createdBeds,
      };
    });
  },
});

tools.push({
  name: "bulk_create_occupants",
  kind: "write",
  description:
    "Create multiple occupants in one transaction. Optionally place each new occupant on a bed by passing parallel `assignToBedIds` (same length as `occupants`). Use this for the 'add 8 occupants to Atlas crew' flow.",
  input_schema: obj(
    {
      occupants: {
        type: "array",
        items: obj(
          {
            name: Str,
            propertyId: StrOpt,
            chargePerBed: NumOpt,
            company: StrOpt,
            chargeSourceCustomer: StrOpt,
          },
          ["name"],
        ),
      },
      assignToBedIds: { type: ["array", "null"], items: StrOpt },
    },
    ["occupants"],
  ),
  summarize: (i) => `Create ${(i.occupants ?? []).length} occupants`,
  execute: async (input) => {
    const list = (input.occupants ?? []) as any[];
    const bedIds = (input.assignToBedIds ?? []) as Array<string | null>;
    // Composite tool stays inside one transaction so the whole bulk
    // create is all-or-nothing, but the cleaning-workflow guard and
    // the occupant/bed normalisers from the route handlers fire on
    // every row (Task #646 / #500).
    return db.transaction(async (tx) => {
      const created: any[] = [];
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        const oid = newId("o");
        const targetBedId = bedIds[i] ?? null;
        let propertyId: string | null = o.propertyId ?? null;
        if (targetBedId) {
          const [bed] = await tx.select().from(bedsTable).where(eq(bedsTable.id, targetBedId));
          if (!bed) throw new Error(`Bed ${targetBedId} not found`);
          if (bed.occupantId) throw new Error(`Bed ${targetBedId} already occupied`);
          if (bed.cleaningStatus !== "ready") {
            throw new Error(
              `Bed ${targetBedId} is not ready (cleaningStatus=${bed.cleaningStatus}).`,
            );
          }
          propertyId = bed.propertyId;
        }
        await tx.insert(occupantsTable).values(
          normalizeOccupantRow({
            id: oid,
            name: o.name,
            propertyId,
            bedId: targetBedId,
            chargePerBed: o.chargePerBed ?? 0,
            company: o.company ?? "",
            chargeSource: "",
            chargeSourceCustomer: o.chargeSourceCustomer ?? "",
            chargeSourcePersonId: "",
            // canonical occupant status is Active | Former — Pending is not
            // recognised by the normalizer and would silently coerce to Active.
            status: "Active",
            moveInDate: new Date().toISOString().slice(0, 10),
          }),
        );
        if (targetBedId) {
          await tx
            .update(bedsTable)
            .set(
              normalizeBedRow({
                occupantId: oid,
                status: "Occupied",
                cleaningStatus: "occupied",
              }),
            )
            .where(eq(bedsTable.id, targetBedId));
        }
        created.push({ id: oid, name: o.name, bedId: targetBedId });
      }
      return { occupants: created };
    });
  },
});

// ───────────────────────────── File-upload + import tools (Task #647) ──

tools.push({
  name: "import_master_leases",
  kind: "write",
  description:
    "Import customers/properties/leases from an uploaded master spreadsheet (.xlsx). The user must first attach the workbook in the assistant panel; pass its uploadId here. Reads existing data and upserts — safe to re-run. The preview shows how many rows will be created vs. updated before you confirm.",
  input_schema: obj({ uploadId: Str }, ["uploadId"]),
  summarize: () => "Import master lease workbook",
  preview: async (input, ctx) => {
    const upload = await loadUploadBytes(input.uploadId, ctx);
    const rows = readMasterWorkbookFromBuffer(upload.content);
    return {
      filename: upload.filename,
      sizeBytes: upload.sizeBytes,
      detectedRows: rows.length,
      note:
        "The import will upsert customers, properties, and leases keyed by their canonical ids. Existing rows will be updated in place; missing ones will be created.",
    };
  },
  execute: async (input, ctx) => {
    const upload = await loadUploadBytes(input.uploadId, ctx);
    const rows = readMasterWorkbookFromBuffer(upload.content);
    const summary = await importMasterLeases(rows, { logger });
    return {
      filename: upload.filename,
      customersCreated: summary.customersCreated,
      customersUpdated: summary.customersUpdated,
      propertiesCreated: summary.propertiesCreated,
      propertiesUpdated: summary.propertiesUpdated,
      leasesCreated: summary.leasesCreated,
      leasesUpdated: summary.leasesUpdated,
      leasesSkipped: summary.leasesSkipped,
      rowsNeedingReviewCount: summary.rowsNeedingReview.length,
      rowsWithFixupsCount: summary.rowsWithFixups.length,
    };
  },
});

tools.push({
  name: "import_payroll_deductions",
  kind: "write",
  description:
    "Import weekly housing payroll deductions from an uploaded .xlsx export. The user must first attach the workbook in the assistant panel; pass its uploadId. `payWeekEndDate` MUST be the Saturday YYYY-MM-DD ending the pay week. The preview shows how many rows parsed and their total dollar amount before you confirm.",
  input_schema: obj(
    { uploadId: Str, payWeekEndDate: Str },
    ["uploadId", "payWeekEndDate"],
  ),
  summarize: (i) =>
    `Import payroll deductions for week ending ${i.payWeekEndDate}`,
  preview: async (input, ctx) => {
    if (!isSaturdayDate(input.payWeekEndDate)) {
      throw new Error(
        "payWeekEndDate must be a Saturday in YYYY-MM-DD format.",
      );
    }
    const upload = await loadUploadBytes(input.uploadId, ctx);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require("xlsx") as typeof import("xlsx");
    const wb = XLSX.read(upload.content, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    const sheetRows: string[][] = sheetName
      ? (
          XLSX.utils.sheet_to_json(wb.Sheets[sheetName]!, {
            header: 1,
            raw: false,
            defval: "",
          }) as unknown[][]
        ).map((r) => r.map((c) => (c == null ? "" : String(c))))
      : [];
    const parsed = parseDeductionsWorkbook(sheetRows);
    const total = parsed.rows.reduce((acc, r) => acc + r.weekly, 0);
    return {
      filename: upload.filename,
      payWeekEndDate: input.payWeekEndDate,
      parsedRows: parsed.rows.length,
      skippedRows: parsed.skipped,
      totalWeeklyAmount: Math.round(total * 100) / 100,
      note:
        "Each parsed row will be matched to an occupant by employeeId (preferred) or name+customer, then snapshotted into payroll_deductions for the supplied week. Re-importing the same week is idempotent.",
    };
  },
  execute: async (input, ctx) => {
    if (!isSaturdayDate(input.payWeekEndDate)) {
      throw new Error(
        "payWeekEndDate must be a Saturday in YYYY-MM-DD format.",
      );
    }
    const upload = await loadUploadBytes(input.uploadId, ctx);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require("xlsx") as typeof import("xlsx");
    const wb = XLSX.read(upload.content, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    const sheetRows: string[][] = sheetName
      ? (
          XLSX.utils.sheet_to_json(wb.Sheets[sheetName]!, {
            header: 1,
            raw: false,
            defval: "",
          }) as unknown[][]
        ).map((r) => r.map((c) => (c == null ? "" : String(c))))
      : [];
    const parsed = parseDeductionsWorkbook(sheetRows);
    if (parsed.rows.length === 0) {
      throw new Error(
        "No deduction rows found. Expected columns: Customer, Person, Person Id, Adjustment.",
      );
    }
    const result = await seedHousingDeductions({
      logger,
      rows: parsed.rows,
      payWeekEndDate: input.payWeekEndDate,
              reclaimOverridden: false,
    });
    return {
      filename: upload.filename,
      payWeekEndDate: result.payWeekEndDate,
      deductionsImported: result.snapshotsWritten,
      totalAmount: result.snapshotsTotalAmount,
      matched: result.matched,
      unmatchedCount: result.unmatched.length,
      lowConfidenceCount: result.lowConfidenceMatches.length,
      skippedRows: parsed.skipped,
    };
  },
});

tools.push({
  name: "extract_lease_pdf",
  kind: "read",
  description:
    "Read an uploaded lease PDF and return the extracted lease fields plus the top property-match candidates. Use this to help the user review a lease before creating it. The user must first attach the PDF in the assistant panel; pass its uploadId. This is read-only — it does NOT create a lease row.",
  input_schema: obj({ uploadId: Str }, ["uploadId"]),
  summarize: () => "Extract fields from lease PDF",
  execute: async (input, ctx) => {
    const upload = await loadUploadBytes(input.uploadId, ctx);
    const lc = (upload.mime || "").toLowerCase();
    const lcName = (upload.filename || "").toLowerCase();
    if (lc !== "application/pdf" && !lcName.endsWith(".pdf")) {
      throw new Error(`Only PDF uploads are supported (got "${upload.mime}").`);
    }
    let text = "";
    try {
      const parser = new PDFParse({ data: new Uint8Array(upload.content) });
      const parsed = await parser.getText();
      text = (parsed.text ?? "").trim();
      await parser.destroy?.();
    } catch (err) {
      logger.warn({ err }, "pdf-parse failed; falling back to OCR");
    }
    const needsOcr = text.length < 50;
    const extractResult = needsOcr
      ? await extractLeaseFromPdfBuffer(upload.content)
      : await extractLeaseFromText(text);
    const { extracted, fixups } = extractResult;
    const [properties, customers] = await Promise.all([
      db.select().from(propertiesTable),
      db.select().from(customersTable),
    ]);
    const candidates = rankPropertyCandidates(extracted, properties, customers);
    const topMatch = candidates[0] && candidates[0].score >= 0.6 ? candidates[0] : null;
    return {
      filename: upload.filename,
      usedOcr: needsOcr,
      extracted,
      topMatch,
      candidates: candidates.slice(0, 5),
      fixups,
    };
  },
});

tools.push({
  name: "log_room_nights",
  kind: "write",
  description:
    "Create one or more room-night log entries against hotel-rate (room-night) leases. Each entry needs leaseId, month (YYYY-MM), and roomNights. The preview lists the rows that will be inserted before you confirm.",
  input_schema: obj(
    {
      entries: {
        type: "array",
        minItems: 1,
        items: obj(
          {
            leaseId: Str,
            month: { type: "string", pattern: "^\\d{4}-\\d{2}$" },
            roomNights: Num,
            notes: StrOpt,
          },
          ["leaseId", "month", "roomNights"],
        ),
      },
    },
    ["entries"],
  ),
  summarize: (i) =>
    `Log ${Array.isArray(i.entries) ? i.entries.length : 0} room-night entr${
      Array.isArray(i.entries) && i.entries.length === 1 ? "y" : "ies"
    }`,
  preview: async (input) => {
    const entries = Array.isArray(input.entries) ? input.entries : [];
    const totalNights = entries.reduce(
      (acc: number, e: any) => acc + (Number(e?.roomNights) || 0),
      0,
    );
    return {
      entries: entries.map((e: any) => ({
        leaseId: e.leaseId,
        month: e.month,
        roomNights: e.roomNights,
        notes: e.notes ?? "",
      })),
      totalRowsToInsert: entries.length,
      totalRoomNights: totalNights,
    };
  },
  execute: async (input) => {
    const entries = Array.isArray(input.entries) ? input.entries : [];
    if (entries.length === 0) throw new Error("entries is required");
    const inserted: Array<{ id: string; leaseId: string; month: string; roomNights: number }> = [];
    await db.transaction(async (tx) => {
      for (const e of entries) {
        if (!e?.leaseId || typeof e.leaseId !== "string") {
          throw new Error("Each entry requires leaseId");
        }
        if (!/^\d{4}-\d{2}$/.test(String(e.month ?? ""))) {
          throw new Error(`Invalid month "${e.month}" — expected YYYY-MM`);
        }
        const id = newId("rnl");
        const [row] = await tx
          .insert(roomNightLogsTable)
          .values({
            id,
            leaseId: e.leaseId,
            month: e.month,
            roomNights: Number(e.roomNights) || 0,
            notes: typeof e.notes === "string" ? e.notes : "",
          })
          .returning();
        inserted.push({
          id: row.id,
          leaseId: row.leaseId,
          month: row.month,
          roomNights: row.roomNights,
        });
      }
    });
    return { inserted, count: inserted.length };
  },
});

tools.push({
  name: "record_property_violation",
  kind: "write",
  description:
    "Record a rule violation against a property (smoking / parking / noise / police / maintenance / cleanliness / other). occurredOn must be YYYY-MM-DD. The preview shows the property name and previously-logged violation count before you confirm.",
  input_schema: obj(
    {
      propertyId: Str,
      occurredOn: Str,
      category: {
        type: "string",
        enum: [
          "smoking",
          "parking",
          "noise",
          "police",
          "maintenance",
          "cleanliness",
          "other",
        ],
      },
      occupantId: StrOpt,
      occupantName: StrOpt,
      details: StrOpt,
      notes: StrOpt,
      createdBy: StrOpt,
    },
    ["propertyId", "occurredOn", "category"],
  ),
  summarize: (i) =>
    `Log ${i.category} violation at property ${i.propertyId} on ${i.occurredOn}`,
  preview: async (input) => {
    const [property] = await db
      .select({ id: propertiesTable.id, name: propertiesTable.name })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, input.propertyId));
    if (!property) throw new Error(`Property ${input.propertyId} not found`);
    const existing = await db
      .select({ id: propertyViolationsTable.id })
      .from(propertyViolationsTable)
      .where(eq(propertyViolationsTable.propertyId, input.propertyId));
    return {
      property: { id: property.id, name: property.name },
      existingViolationCount: existing.length,
      newViolation: {
        category: input.category,
        occurredOn: input.occurredOn,
        occupantName: input.occupantName ?? "",
        details: input.details ?? "",
        notes: input.notes ?? "",
      },
    };
  },
  execute: async (input) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.occurredOn))) {
      throw new Error("occurredOn must be YYYY-MM-DD");
    }
    const [property] = await db
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, input.propertyId));
    if (!property) throw new Error(`Property ${input.propertyId} not found`);
    const id = newId("pv");
    const [row] = await db
      .insert(propertyViolationsTable)
      .values({
        id,
        propertyId: input.propertyId,
        occupantId:
          typeof input.occupantId === "string" && input.occupantId
            ? input.occupantId
            : null,
        occupantName: typeof input.occupantName === "string" ? input.occupantName : "",
        category: input.category,
        details: typeof input.details === "string" ? input.details : "",
        notes: typeof input.notes === "string" ? input.notes : "",
        occurredOn: input.occurredOn,
        createdBy: typeof input.createdBy === "string" ? input.createdBy : "",
      })
      .returning();
    return { violation: row };
  },
});

tools.push({
  name: "create_projected_move_in",
  kind: "write",
  description:
    "Record an upcoming (planned) move-in for a property. Useful for advance-planning a future arrival before the bed assignment is finalised. projectedMoveInDate must be YYYY-MM-DD. bedId is optional. The preview shows existing planned move-ins for the same property so you can spot duplicates.",
  input_schema: obj(
    {
      propertyId: Str,
      personName: Str,
      projectedMoveInDate: Str,
      bedId: StrOpt,
      notes: StrOpt,
    },
    ["propertyId", "personName", "projectedMoveInDate"],
  ),
  summarize: (i) =>
    `Plan move-in for ${i.personName} at property ${i.propertyId} on ${i.projectedMoveInDate}`,
  preview: async (input) => {
    const [property] = await db
      .select({ id: propertiesTable.id, name: propertiesTable.name })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, input.propertyId));
    if (!property) throw new Error(`Property ${input.propertyId} not found`);
    const existing = await db
      .select({
        personName: projectedMoveInsTable.personName,
        projectedMoveInDate: projectedMoveInsTable.projectedMoveInDate,
      })
      .from(projectedMoveInsTable)
      .where(eq(projectedMoveInsTable.propertyId, input.propertyId));
    return {
      property: { id: property.id, name: property.name },
      existingPlanned: existing,
      newEntry: {
        personName: input.personName,
        projectedMoveInDate: input.projectedMoveInDate,
        bedId: input.bedId ?? null,
        notes: input.notes ?? "",
      },
    };
  },
  execute: async (input) => {
    if (!String(input.personName ?? "").trim()) {
      throw new Error("personName cannot be empty");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.projectedMoveInDate))) {
      throw new Error("projectedMoveInDate must be YYYY-MM-DD");
    }
    const [property] = await db
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, input.propertyId));
    if (!property) throw new Error(`Property ${input.propertyId} not found`);
    if (typeof input.bedId === "string" && input.bedId) {
      const [bed] = await db
        .select({ propertyId: bedsTable.propertyId })
        .from(bedsTable)
        .where(eq(bedsTable.id, input.bedId));
      if (!bed) throw new Error(`Bed ${input.bedId} not found`);
      if (bed.propertyId !== input.propertyId) {
        throw new Error(
          `Bed ${input.bedId} does not belong to property ${input.propertyId}`,
        );
      }
    }
    const id = newId("pmi");
    const [row] = await db
      .insert(projectedMoveInsTable)
      .values({
        id,
        propertyId: input.propertyId,
        personName: input.personName,
        projectedMoveInDate: input.projectedMoveInDate,
        bedId: typeof input.bedId === "string" && input.bedId ? input.bedId : null,
        notes: typeof input.notes === "string" ? input.notes : "",
      })
      .returning();
    return { projectedMoveIn: row };
  },
});

export const TOOLS: ReadonlyArray<ToolDef> = tools;

// Maps each write tool to the table its `id` parameter (or other named
// id) lives in, so the scope guard can authoritatively walk back to a
// customerId. Keep this in sync when adding new write tools.
const SCOPE_RESOLVERS: Record<
  string,
  { idField: string; table: "property" | "building" | "room" | "bed" | "occupant" | "lease" | "utility" | "insurance" | "payroll" }
> = {
  // Properties
  update_property: { idField: "id", table: "property" },
  delete_property: { idField: "id", table: "property" },
  // Buildings
  update_building: { idField: "id", table: "building" },
  delete_building: { idField: "id", table: "building" },
  // Rooms
  update_room: { idField: "id", table: "room" },
  delete_room: { idField: "id", table: "room" },
  // Beds
  update_bed: { idField: "id", table: "bed" },
  delete_bed: { idField: "id", table: "bed" },
  // Occupants
  update_occupant: { idField: "id", table: "occupant" },
  delete_occupant: { idField: "id", table: "occupant" },
  // Leases
  update_lease: { idField: "id", table: "lease" },
  delete_lease: { idField: "id", table: "lease" },
  // Utilities
  update_utility: { idField: "id", table: "utility" },
  delete_utility: { idField: "id", table: "utility" },
  // Insurance certificates
  update_insurance_certificate: { idField: "id", table: "insurance" },
  delete_insurance_certificate: { idField: "id", table: "insurance" },
  // Payroll deductions
  delete_payroll_deduction: { idField: "id", table: "payroll" },
};

async function customerIdViaProperty(propertyId: string | null | undefined): Promise<string | null> {
  if (!propertyId) return null;
  const [p] = await db
    .select({ customerId: propertiesTable.customerId })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId));
  return p?.customerId ?? null;
}

async function customerIdForRow(
  table: "property" | "building" | "room" | "bed" | "occupant" | "lease" | "utility" | "insurance" | "payroll",
  id: string,
): Promise<string | null> {
  switch (table) {
    case "property": {
      const [p] = await db
        .select({ customerId: propertiesTable.customerId })
        .from(propertiesTable)
        .where(eq(propertiesTable.id, id));
      return p?.customerId ?? null;
    }
    case "building": {
      const [b] = await db
        .select({ propertyId: buildingsTable.propertyId })
        .from(buildingsTable)
        .where(eq(buildingsTable.id, id));
      return customerIdViaProperty(b?.propertyId);
    }
    case "room": {
      const [r] = await db
        .select({ propertyId: roomsTable.propertyId })
        .from(roomsTable)
        .where(eq(roomsTable.id, id));
      return customerIdViaProperty(r?.propertyId);
    }
    case "bed": {
      const [b] = await db
        .select({ propertyId: bedsTable.propertyId })
        .from(bedsTable)
        .where(eq(bedsTable.id, id));
      return customerIdViaProperty(b?.propertyId);
    }
    case "occupant": {
      const [o] = await db
        .select({ propertyId: occupantsTable.propertyId })
        .from(occupantsTable)
        .where(eq(occupantsTable.id, id));
      return customerIdViaProperty(o?.propertyId);
    }
    case "lease": {
      const [l] = await db
        .select({ propertyId: leasesTable.propertyId })
        .from(leasesTable)
        .where(eq(leasesTable.id, id));
      return customerIdViaProperty(l?.propertyId);
    }
    case "utility": {
      const [u] = await db
        .select({ propertyId: utilitiesTable.propertyId })
        .from(utilitiesTable)
        .where(eq(utilitiesTable.id, id));
      return customerIdViaProperty(u?.propertyId);
    }
    case "insurance": {
      const [c] = await db
        .select({ propertyId: insuranceCertificatesTable.propertyId })
        .from(insuranceCertificatesTable)
        .where(eq(insuranceCertificatesTable.id, id));
      return customerIdViaProperty(c?.propertyId);
    }
    case "payroll": {
      const [d] = await db
        .select({ customerId: payrollDeductionsTable.customerId, propertyId: payrollDeductionsTable.propertyId })
        .from(payrollDeductionsTable)
        .where(eq(payrollDeductionsTable.id, id));
      return d?.customerId || customerIdViaProperty(d?.propertyId);
    }
  }
}

/**
 * Returns the customerId implied by a write tool's input. Used by the
 * assistant runtime to enforce the active customer scope so the
 * assistant can't accidentally bridge across customers under a scoped
 * session.
 *
 * Contract: returns the resolved customerId, or `null` if ownership
 * could not be proven. The caller MUST treat `null` under an active
 * scope as a "fail closed" — refuse the write — for any tool listed in
 * SCOPE_RESOLVERS or in the parent-id branches below. The only writes
 * that legitimately resolve to `null` are pure "create top-level" tools
 * with no customerId on the input (`create_customer` etc., not present
 * in the current registry).
 */
export async function impliedCustomerIdForWrite(
  toolName: string,
  input: any,
): Promise<string | null> {
  if (input && typeof input.customerId === "string" && input.customerId) {
    return input.customerId as string;
  }
  if (toolName === "create_property_with_layout") {
    return (input?.property?.customerId as string) || null;
  }
  try {
    // Batch write tools whose ownership lives inside a nested array of
    // entries. We resolve the customerId for every nested target id and
    // only return a non-null value when ALL entries resolve to the
    // SAME customer — otherwise we fall through to null so the caller
    // fails closed under an active scope (refuses to bridge customers).
    if (toolName === "log_room_nights") {
      const entries = Array.isArray(input?.entries) ? input.entries : [];
      if (entries.length === 0) return null;
      const seen = new Set<string>();
      for (const e of entries) {
        const lid = typeof e?.leaseId === "string" ? e.leaseId : "";
        if (!lid) return null;
        const cid = await customerIdForRow("lease", lid);
        if (!cid) return null;
        seen.add(cid);
        if (seen.size > 1) return null;
      }
      return seen.size === 1 ? [...seen][0]! : null;
    }
    // Imports + extract_lease_pdf operate against an uploaded file and
    // intentionally touch records across many customers. Refuse them
    // under an active customer scope rather than silently bridging.
    if (
      toolName === "import_master_leases" ||
      toolName === "import_payroll_deductions"
    ) {
      return null;
    }
    // 1) Tool-name driven id → table lookup (covers all destructive +
    //    update tools by their canonical `id` argument).
    const resolver = SCOPE_RESOLVERS[toolName];
    if (resolver) {
      const idValue = input?.[resolver.idField];
      if (typeof idValue === "string" && idValue) {
        return await customerIdForRow(resolver.table, idValue);
      }
    }
    // 2) Named-parent-id fallback for create_* tools that point at a
    //    parent record by an explicit field (e.g. create_lease has
    //    propertyId, create_bed has roomId, etc.).
    if (typeof input?.propertyId === "string") {
      return await customerIdViaProperty(input.propertyId);
    }
    if (typeof input?.buildingId === "string") {
      return await customerIdForRow("building", input.buildingId);
    }
    if (typeof input?.roomId === "string") {
      return await customerIdForRow("room", input.roomId);
    }
    if (typeof input?.bedId === "string") {
      return await customerIdForRow("bed", input.bedId);
    }
    if (typeof input?.occupantId === "string") {
      return await customerIdForRow("occupant", input.occupantId);
    }
    if (typeof input?.leaseId === "string") {
      return await customerIdForRow("lease", input.leaseId);
    }
  } catch {
    /* fall through to null — caller treats as fail-closed under scope */
  }
  return null;
}

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
