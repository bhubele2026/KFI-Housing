import { eq, inArray } from "drizzle-orm";
import {
  db,
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

export type Entity =
  | "property"
  | "building"
  | "room"
  | "bed"
  | "occupant"
  | "lease"
  | "utility"
  | "insurance"
  | "payroll";

interface EntityInfo {
  table: any;
  resultKey: string;
  label: string;
}

const ENTITIES: Record<Entity, EntityInfo> = {
  property: { table: propertiesTable, resultKey: "property", label: "property" },
  building: { table: buildingsTable, resultKey: "building", label: "building" },
  room: { table: roomsTable, resultKey: "room", label: "room" },
  bed: { table: bedsTable, resultKey: "bed", label: "bed" },
  occupant: { table: occupantsTable, resultKey: "occupant", label: "occupant" },
  lease: { table: leasesTable, resultKey: "lease", label: "lease" },
  utility: { table: utilitiesTable, resultKey: "utility", label: "utility" },
  insurance: {
    table: insuranceCertificatesTable,
    resultKey: "insuranceCertificate",
    label: "insurance certificate",
  },
  payroll: {
    table: payrollDeductionsTable,
    resultKey: "payrollDeduction",
    label: "payroll deduction",
  },
};

// Per-tool reversibility metadata. Only tools listed here are
// undoable; everything else (composite tools, cascading deletes,
// occupant assignment moves, etc.) is reported as not reversible so
// operators don't get a misleading Undo button.
type Reversibility =
  | { kind: "createDelete"; entity: Entity }
  | { kind: "updateRestore"; entity: Entity }
  | { kind: "deleteRestore"; entity: Entity }
  | { kind: "bulkUpdateRestore"; entity: Entity }
  | { kind: "bulkCreateDelete"; entity: Entity };

const TOOL_REVERSIBILITY: Record<string, Reversibility> = {
  // Creates — undo deletes the row by id from result.
  create_property: { kind: "createDelete", entity: "property" },
  create_building: { kind: "createDelete", entity: "building" },
  create_room: { kind: "createDelete", entity: "room" },
  create_bed: { kind: "createDelete", entity: "bed" },
  create_occupant: { kind: "createDelete", entity: "occupant" },
  create_lease: { kind: "createDelete", entity: "lease" },
  create_utility: { kind: "createDelete", entity: "utility" },
  create_insurance_certificate: { kind: "createDelete", entity: "insurance" },
  create_payroll_deduction: { kind: "createDelete", entity: "payroll" },

  // Updates — undo restores the captured pre-update row.
  update_property: { kind: "updateRestore", entity: "property" },
  update_building: { kind: "updateRestore", entity: "building" },
  update_room: { kind: "updateRestore", entity: "room" },
  update_bed: { kind: "updateRestore", entity: "bed" },
  update_occupant: { kind: "updateRestore", entity: "occupant" },
  update_lease: { kind: "updateRestore", entity: "lease" },
  update_utility: { kind: "updateRestore", entity: "utility" },
  update_insurance_certificate: { kind: "updateRestore", entity: "insurance" },

  // Simple deletes — capture the row before deleting, undo re-inserts.
  // We deliberately leave out cascading / state-mutating deletes
  // (delete_property, delete_occupant) which would need multi-row
  // snapshots — those report as "not reversible" so we don't pretend.
  delete_building: { kind: "deleteRestore", entity: "building" },
  delete_room: { kind: "deleteRestore", entity: "room" },
  delete_bed: { kind: "deleteRestore", entity: "bed" },
  delete_lease: { kind: "deleteRestore", entity: "lease" },
  delete_utility: { kind: "deleteRestore", entity: "utility" },
  delete_insurance_certificate: { kind: "deleteRestore", entity: "insurance" },
  delete_payroll_deduction: { kind: "deleteRestore", entity: "payroll" },

  // Bulk write tools (Task #668). Snapshot every targeted row before
  // the batch runs; undo restores each one or deletes the freshly-
  // created ids.
  bulk_update_leases: { kind: "bulkUpdateRestore", entity: "lease" },
  bulk_update_beds: { kind: "bulkUpdateRestore", entity: "bed" },
  bulk_create_beds: { kind: "bulkCreateDelete", entity: "bed" },
};

export interface UndoPlan {
  kind:
    | "deleteById"
    | "restoreRow"
    | "reinsertRow"
    | "bulkRestoreRows"
    | "bulkDeleteByIds";
  entity: Entity;
  /** Single-row plans use `id`. */
  id?: string;
  /** Single-row plans use `row`. */
  row?: Record<string, unknown>;
  /** bulkRestoreRows uses `rows`. */
  rows?: Array<Record<string, unknown>>;
  /** bulkDeleteByIds uses `ids`. */
  ids?: string[];
}

export function isToolReversible(toolName: string): boolean {
  return toolName in TOOL_REVERSIBILITY;
}

/**
 * Called BEFORE a write tool executes. For update_* and delete_*
 * tools, snapshots the current row so we can rebuild an undo plan
 * after execution. Returns null for creates (no snapshot needed) and
 * for tools that aren't undoable.
 */
export async function captureSnapshot(
  toolName: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const meta = TOOL_REVERSIBILITY[toolName];
  if (!meta) return null;
  if (meta.kind === "createDelete" || meta.kind === "bulkCreateDelete") {
    return null;
  }
  if (meta.kind === "bulkUpdateRestore") {
    const entries = Array.isArray(input.entries)
      ? (input.entries as Array<Record<string, unknown>>)
      : [];
    const ids = entries
      .map((e) => (typeof e?.id === "string" ? e.id : null))
      .filter((x): x is string => x !== null && x.length > 0);
    if (ids.length === 0) return null;
    const info = ENTITIES[meta.entity];
    const rows = await db
      .select()
      .from(info.table)
      .where(inArray(info.table.id, ids));
    // Wrap in an object so captureSnapshot's return type stays uniform.
    return { __bulkRows: rows } as Record<string, unknown>;
  }
  const id = typeof input.id === "string" ? input.id : null;
  if (!id) return null;
  const info = ENTITIES[meta.entity];
  const [row] = await db.select().from(info.table).where(eq(info.table.id, id));
  return (row as Record<string, unknown>) ?? null;
}

/**
 * Build an undo plan from the tool name, the final input, the
 * execution result, and the optional pre-execution snapshot.
 * Returns null when no plan can be built (tool unreversible, missing
 * id, etc.) so callers can mark the proposal "not reversible".
 */
export function buildUndoPlan(
  toolName: string,
  input: Record<string, unknown>,
  result: unknown,
  snapshot: Record<string, unknown> | null,
): UndoPlan | null {
  const meta = TOOL_REVERSIBILITY[toolName];
  if (!meta) return null;
  if (meta.kind === "createDelete") {
    const info = ENTITIES[meta.entity];
    const row = (result as any)?.[info.resultKey];
    const id = row && typeof row.id === "string" ? row.id : null;
    if (!id) return null;
    return { kind: "deleteById", entity: meta.entity, id };
  }
  if (meta.kind === "updateRestore") {
    if (!snapshot || typeof snapshot.id !== "string") return null;
    return {
      kind: "restoreRow",
      entity: meta.entity,
      id: snapshot.id,
      row: snapshot,
    };
  }
  if (meta.kind === "bulkUpdateRestore") {
    const rows = (snapshot?.__bulkRows as Array<Record<string, unknown>>) ?? [];
    if (rows.length === 0) return null;
    return { kind: "bulkRestoreRows", entity: meta.entity, rows };
  }
  if (meta.kind === "bulkCreateDelete") {
    const info = ENTITIES[meta.entity];
    const createdList = (result as any)?.[`${info.resultKey}s`];
    const rows: Array<Record<string, unknown>> = Array.isArray(createdList)
      ? (createdList as Array<Record<string, unknown>>)
      : Array.isArray((result as any)?.beds)
        ? ((result as any).beds as Array<Record<string, unknown>>)
        : [];
    const ids = rows
      .map((r) => (typeof r?.id === "string" ? (r.id as string) : null))
      .filter((x): x is string => x !== null && x.length > 0);
    if (ids.length === 0) return null;
    return { kind: "bulkDeleteByIds", entity: meta.entity, ids };
  }
  // deleteRestore
  if (!snapshot || typeof snapshot.id !== "string") return null;
  return {
    kind: "reinsertRow",
    entity: meta.entity,
    id: snapshot.id,
    row: snapshot,
  };
}

/**
 * Extract the operator-friendly "result id" for the changelog row.
 * For creates this is the new id; for updates / deletes it's the
 * target row's id (taken from the input, falling back to snapshot).
 */
export function extractResultId(
  toolName: string,
  input: Record<string, unknown>,
  result: unknown,
): string | null {
  const meta = TOOL_REVERSIBILITY[toolName];
  if (meta?.kind === "createDelete") {
    const info = ENTITIES[meta.entity];
    const row = (result as any)?.[info.resultKey];
    if (row && typeof row.id === "string") return row.id;
  }
  // Bulk tools touch many rows; no single result id makes sense — the
  // changelog/Undo button uses the undo plan's row list instead.
  if (
    meta?.kind === "bulkUpdateRestore" ||
    meta?.kind === "bulkCreateDelete"
  ) {
    return null;
  }
  if (typeof input.id === "string") return input.id;
  return null;
}

/**
 * Execute an undo plan. Throws if the target row's state means the
 * undo can't be safely applied (e.g. the row was re-created in the
 * meantime, or restoring would violate a foreign-key constraint).
 */
export async function executeUndoPlan(plan: UndoPlan): Promise<void> {
  const info = ENTITIES[plan.entity];
  if (plan.kind === "bulkDeleteByIds") {
    const ids = plan.ids ?? [];
    if (ids.length === 0) return;
    await db.delete(info.table).where(inArray(info.table.id, ids));
    return;
  }
  if (plan.kind === "bulkRestoreRows") {
    const rows = plan.rows ?? [];
    for (const row of rows) {
      const id = typeof row.id === "string" ? row.id : null;
      if (!id) continue;
      const { id: _id, ...rest } = row;
      const [existing] = await db
        .select({ id: info.table.id })
        .from(info.table)
        .where(eq(info.table.id, id));
      if (!existing) {
        await db.insert(info.table).values(row as any);
      } else {
        await db.update(info.table).set(rest).where(eq(info.table.id, id));
      }
    }
    return;
  }
  if (plan.kind === "deleteById") {
    if (!plan.id) throw new Error("Undo plan missing id");
    // Reverse a create. If the row is already gone (operator deleted
    // it manually) the undo is a no-op rather than an error — the
    // end state matches what undo wanted to achieve.
    await db.delete(info.table).where(eq(info.table.id, plan.id));
    return;
  }
  if (plan.kind === "restoreRow") {
    if (!plan.row) throw new Error("Undo plan missing snapshot row");
    const { id, ...rest } = plan.row;
    if (typeof id !== "string") throw new Error("Snapshot row missing id");
    const [existing] = await db
      .select({ id: info.table.id })
      .from(info.table)
      .where(eq(info.table.id, id));
    if (!existing) {
      // Row was deleted after the update was applied — reinsert the
      // pre-update snapshot rather than silently dropping the undo.
      await db.insert(info.table).values(plan.row as any);
      return;
    }
    await db.update(info.table).set(rest).where(eq(info.table.id, id));
    return;
  }
  // reinsertRow — reverse a delete.
  if (!plan.row) throw new Error("Undo plan missing snapshot row");
  if (!plan.id) throw new Error("Undo plan missing id");
  const [existing] = await db
    .select({ id: info.table.id })
    .from(info.table)
    .where(eq(info.table.id, plan.id));
  if (existing) {
    // The row is back somehow — treat as already-undone.
    return;
  }
  await db.insert(info.table).values(plan.row as any);
}
