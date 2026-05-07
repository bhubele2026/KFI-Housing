import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { z } from "zod";
import {
  useListCustomers, getListCustomersQueryKey, useCreateCustomer, useUpdateCustomer, useDeleteCustomer,
  useListProperties, getListPropertiesQueryKey, useCreateProperty, useUpdateProperty, useDeleteProperty,
  useListLeases, getListLeasesQueryKey, useCreateLease, useUpdateLease, useDeleteLease,
  useListRooms, getListRoomsQueryKey, useCreateRoom, useUpdateRoom, useDeleteRoom,
  useListBeds, getListBedsQueryKey, useCreateBed, useUpdateBed, useDeleteBed,
  useListOccupants, getListOccupantsQueryKey, useCreateOccupant, useUpdateOccupant, useDeleteOccupant,
  useListUtilities, getListUtilitiesQueryKey, useCreateUtility, useUpdateUtility, useDeleteUtility,
  useListRoomNightLogs, getListRoomNightLogsQueryKey,
  useResetToSampleData,
  useImportData,
} from "@workspace/api-client-react";
import {
  CustomerSchema, PropertySchema, LeaseSchema, RoomSchema, BedSchema, OccupantSchema, UtilitySchema,
  RoomNightLogSchema,
  RatingsSchema,
  type Customer, type Property, type Lease, type Room, type Bed, type Occupant, type Utility,
  type RoomNightLog,
} from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";

export const EXPORT_FORMAT_VERSION = 3;

export const ExportPayloadSchema = z.object({
  format: z.literal("housingops-export"),
  version: z.literal(EXPORT_FORMAT_VERSION),
  exportedAt: z.string(),
  data: z.object({
    customers: z.array(CustomerSchema),
    properties: z.array(PropertySchema),
    leases: z.array(LeaseSchema),
    rooms: z.array(RoomSchema),
    beds: z.array(BedSchema),
    occupants: z.array(OccupantSchema),
    utilities: z.array(UtilitySchema),
    // Optional for backward compatibility: backups taken before task #321
    // shipped this field. Default to an empty array so older v3 files
    // (and the v1/v2 migration paths) parse cleanly.
    roomNightLogs: z.array(RoomNightLogSchema).optional().default([]),
  }),
});
export type ExportPayload = z.infer<typeof ExportPayloadSchema>;
export type ExportData = ExportPayload["data"];

// ── v1 (pre-Customers) export support ───────────────────────────────────
// v1 files have no `customers` array and properties have no `customerId`.
// We accept them by auto-creating a single placeholder customer and
// assigning every imported property to it.
//
// Real-world v1 backups predate the landlord/payment/banking/furnishings
// fields, so each of those is optional here with a sensible default. Only
// the truly-core property fields (id, name, address, totals, status) stay
// required — everything newer is filled in so the rest of the UI keeps
// working and the user can edit the values later.
const LegacyPropertySchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  totalBeds: z.number(),
  monthlyRent: z.number(),
  chargePerBed: z.number(),
  status: z.enum(["Active", "Inactive"]),
  landlordName: z.string().optional().default(""),
  landlordEmail: z.string().optional().default(""),
  landlordPhone: z.string().optional().default(""),
  paymentMethod: z
    .enum(["", "ACH", "Check", "Wire", "Online Portal", "Money Order", "Invoice"])
    .optional()
    .default("ACH"),
  paymentRecipient: z.string().optional().default(""),
  paymentDueDay: z.number().optional().default(0),
  paymentNotes: z.string().optional().default(""),
  bankName: z.string().optional().default(""),
  bankRouting: z.string().optional().default(""),
  bankAccount: z.string().optional().default(""),
  portalUrl: z.string().optional().default(""),
  notes: z.string().optional().default(""),
  furnishings: z.array(z.string()).optional().default([]),
  ratings: RatingsSchema.optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
});

// v1/v2 beds had a free-text `room` column instead of a `roomId` foreign key.
// We accept those payloads and synthesize Room rows for each unique
// (propertyId, room name) pair during the v1→v3 / v2→v3 migration.
const V2BedSchema = z.object({
  id: z.string(),
  propertyId: z.string(),
  bedNumber: z.number(),
  room: z.string().optional().default(""),
  status: z.enum(["Occupied", "Vacant"]),
  occupantId: z.string().nullable(),
});

const LegacyExportPayloadSchema = z.object({
  format: z.literal("housingops-export"),
  version: z.literal(1),
  exportedAt: z.string(),
  data: z.object({
    properties: z.array(LegacyPropertySchema),
    leases: z.array(LeaseSchema),
    beds: z.array(V2BedSchema),
    occupants: z.array(OccupantSchema),
    utilities: z.array(UtilitySchema),
  }),
});

const V2ExportPayloadSchema = z.object({
  format: z.literal("housingops-export"),
  version: z.literal(2),
  exportedAt: z.string(),
  data: z.object({
    customers: z.array(CustomerSchema),
    properties: z.array(PropertySchema),
    leases: z.array(LeaseSchema),
    beds: z.array(V2BedSchema),
    occupants: z.array(OccupantSchema),
    utilities: z.array(UtilitySchema),
  }),
});

export const LEGACY_CUSTOMER_ID = "legacy-customer";
const LEGACY_CUSTOMER: Customer = {
  id: LEGACY_CUSTOMER_ID,
  name: "Legacy Properties",
  contactName: "",
  email: "",
  phone: "",
  state: "",
  notes:
    "Auto-created during import of an older backup that did not include customers. " +
    "Re-assign these properties to your real customers when you're ready.",
};

/**
 * One bad row dropped from a list response. Surfaced via {@link DataStore.dataIssues}
 * so the UI can render a small inline notice instead of letting a single
 * malformed row blank the whole page.
 */
export interface DataIssue {
  /** Cache key, e.g. "leases" or "properties". */
  kind: string;
  /** Human-readable label, e.g. "leases" / "properties". */
  label: string;
  /** Number of rows that failed schema validation and were dropped. */
  dropped: number;
}

/**
 * Validate an unknown list payload row-by-row against `schema`. Drops (and
 * `console.warn`s) any row that fails to parse so a single malformed row
 * only loses that row, not the whole list. A non-array input is treated as
 * an empty list.
 */
export function safeParseList<S extends z.ZodTypeAny>(
  schema: S,
  raw: unknown,
  label: string,
): { rows: z.infer<S>[]; dropped: number } {
  if (!Array.isArray(raw)) return { rows: [], dropped: 0 };
  const rows: z.infer<S>[] = [];
  let dropped = 0;
  for (let i = 0; i < raw.length; i++) {
    const result = schema.safeParse(raw[i]);
    if (result.success) {
      rows.push(result.data);
    } else {
      dropped++;
      // eslint-disable-next-line no-console
      console.warn(
        `[data-store] Dropped malformed ${label} row at index ${i}:`,
        result.error.issues,
        raw[i],
      );
    }
  }
  return { rows, dropped };
}

export class UnsupportedImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedImportError";
  }
}

export interface ImportSummary {
  customers: number;
  properties: number;
  leases: number;
  rooms: number;
  beds: number;
  occupants: number;
  utilities: number;
  roomNightLogs: number;
}

export type ImportMode = "replace" | "merge";

export interface ImportResult {
  mode: ImportMode;
  /** Count of records read from the imported file (per type). */
  summary: ImportSummary;
  /** Merge mode only: records whose id did not exist before this import. */
  added?: ImportSummary;
  /**
   * Merge mode only: existing records whose content was overwritten by the
   * imported version (same id, different field values).
   */
  updated?: ImportSummary;
}

export interface ImportPreview {
  data: ExportData;
  summary: ImportSummary;
  /** True when the file was a v1 backup and we auto-created a Legacy customer. */
  migratedFromV1: boolean;
  /** True when the file was a v1 or v2 backup and we synthesized Rooms from bed.room strings. */
  migratedRooms: boolean;
}

/** Sums two ImportSummary objects field-by-field. */
export function totalImportSummary(s: ImportSummary): number {
  return s.customers + s.properties + s.leases + s.rooms + s.beds + s.occupants + s.utilities + s.roomNightLogs;
}

/** A single record affected by a merge dry-run, with a human-readable label. */
export interface MergeImpactItem {
  id: string;
  label: string;
}

/** Per-type breakdown of what a merge would change. */
export interface MergeImpactCategory {
  added: number;
  updated: number;
  unchanged: number;
  /** Records whose existing content would be overwritten by the import. */
  updatedItems: MergeImpactItem[];
  /** Records that would be appended as new entries. */
  addedItems: MergeImpactItem[];
}

export interface MergeDryRun {
  customers: MergeImpactCategory;
  properties: MergeImpactCategory;
  leases: MergeImpactCategory;
  rooms: MergeImpactCategory;
  beds: MergeImpactCategory;
  occupants: MergeImpactCategory;
  utilities: MergeImpactCategory;
  roomNightLogs: MergeImpactCategory;
}

/** Total counts across every record type in a dry run. */
export function totalMergeDryRun(dry: MergeDryRun): { added: number; updated: number; unchanged: number } {
  let added = 0, updated = 0, unchanged = 0;
  for (const k of ["customers", "properties", "leases", "rooms", "beds", "occupants", "utilities", "roomNightLogs"] as const) {
    added += dry[k].added;
    updated += dry[k].updated;
    unchanged += dry[k].unchanged;
  }
  return { added, updated, unchanged };
}

const EMPTY_SUMMARY: ImportSummary = {
  customers: 0,
  properties: 0,
  leases: 0,
  rooms: 0,
  beds: 0,
  occupants: 0,
  utilities: 0,
  roomNightLogs: 0,
};

/**
 * Merge an imported bundle into the current data. Records are matched by id:
 *   - new ids are appended ("added")
 *   - existing ids whose content differs are overwritten ("updated")
 *   - existing ids whose content is identical are left as-is (not counted)
 *   - records that exist locally but not in the file are preserved
 *
 * Returns the resulting bundle plus per-type counts of added/updated rows.
 */
export function mergeImportBundles(
  current: ExportData,
  incoming: ExportData,
): { data: ExportData; added: ImportSummary; updated: ImportSummary } {
  const added: ImportSummary = { ...EMPTY_SUMMARY };
  const updated: ImportSummary = { ...EMPTY_SUMMARY };

  function mergeList<T extends { id: string }>(
    currentList: readonly T[],
    incomingList: readonly T[],
    key: keyof ImportSummary,
  ): T[] {
    const byId = new Map<string, T>();
    for (const item of currentList) byId.set(item.id, item);
    for (const item of incomingList) {
      const existing = byId.get(item.id);
      if (!existing) {
        added[key] += 1;
        byId.set(item.id, item);
      } else if (JSON.stringify(existing) !== JSON.stringify(item)) {
        updated[key] += 1;
        byId.set(item.id, item);
      }
    }
    return Array.from(byId.values());
  }

  const data: ExportData = {
    customers: mergeList(current.customers, incoming.customers, "customers"),
    properties: mergeList(current.properties, incoming.properties, "properties"),
    leases: mergeList(current.leases, incoming.leases, "leases"),
    rooms: mergeList(current.rooms, incoming.rooms, "rooms"),
    beds: mergeList(current.beds, incoming.beds, "beds"),
    occupants: mergeList(current.occupants, incoming.occupants, "occupants"),
    utilities: mergeList(current.utilities, incoming.utilities, "utilities"),
    roomNightLogs: mergeList(current.roomNightLogs, incoming.roomNightLogs, "roomNightLogs"),
  };

  return { data, added, updated };
}

// Per-type label generators used by the merge dry-run preview. Each returns
// a short human-readable string so operators can spot accidental overwrites
// (e.g. "Sunset House" instead of "p-7"). Pure: depends only on the record
// itself, no cross-table joins required.
const MERGE_LABELS = {
  customers: (c: Customer) => c.name || c.id,
  properties: (p: Property) => p.name || p.id,
  leases: (l: Lease) => `Lease ${l.startDate || l.id}`,
  rooms: (r: Room) => r.name || r.id,
  beds: (b: Bed) => `Bed #${b.bedNumber}`,
  occupants: (o: Occupant) => o.name || o.id,
  utilities: (u: Utility) => `${u.type}${u.company ? ` — ${u.company}` : ""}`,
  roomNightLogs: (l: RoomNightLog) => `Log ${l.month}`,
};

const EMPTY_CATEGORY = (): MergeImpactCategory => ({
  added: 0,
  updated: 0,
  unchanged: 0,
  updatedItems: [],
  addedItems: [],
});

/**
 * Compute what `mergeImportBundles(current, incoming)` would do — without
 * mutating any caches. Returns per-type counts of added/updated/unchanged
 * plus the ids and human-readable labels of affected rows so the import
 * dialog can preview the impact and surface accidental overwrites.
 */
export function dryRunMergeImport(current: ExportData, incoming: ExportData): MergeDryRun {
  function diffList<T extends { id: string }>(
    currentList: readonly T[],
    incomingList: readonly T[],
    label: (item: T) => string,
  ): MergeImpactCategory {
    const out = EMPTY_CATEGORY();
    const byId = new Map<string, T>();
    for (const item of currentList) byId.set(item.id, item);
    for (const item of incomingList) {
      const existing = byId.get(item.id);
      if (!existing) {
        out.added += 1;
        out.addedItems.push({ id: item.id, label: label(item) });
      } else if (JSON.stringify(existing) !== JSON.stringify(item)) {
        out.updated += 1;
        // Use the EXISTING label so the operator recognizes the row that's
        // about to be overwritten by name they already know, not the
        // (possibly renamed) incoming version.
        out.updatedItems.push({ id: existing.id, label: label(existing) });
      } else {
        out.unchanged += 1;
      }
    }
    return out;
  }

  return {
    customers: diffList(current.customers, incoming.customers, MERGE_LABELS.customers),
    properties: diffList(current.properties, incoming.properties, MERGE_LABELS.properties),
    leases: diffList(current.leases, incoming.leases, MERGE_LABELS.leases),
    rooms: diffList(current.rooms, incoming.rooms, MERGE_LABELS.rooms),
    beds: diffList(current.beds, incoming.beds, MERGE_LABELS.beds),
    occupants: diffList(current.occupants, incoming.occupants, MERGE_LABELS.occupants),
    utilities: diffList(current.utilities, incoming.utilities, MERGE_LABELS.utilities),
    roomNightLogs: diffList(current.roomNightLogs, incoming.roomNightLogs, MERGE_LABELS.roomNightLogs),
  };
}

// Strict shape check: only treat a value as a pre-validated ImportPreview when
// every documented field is present with the right type. This prevents arbitrary
// objects from bypassing schema validation in importData.
function isImportPreview(value: unknown): value is ImportPreview {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.migratedFromV1 !== "boolean") return false;
  if (typeof v.migratedRooms !== "boolean") return false;
  const summary = v.summary;
  if (typeof summary !== "object" || summary === null) return false;
  const s = summary as Record<string, unknown>;
  for (const k of ["customers", "properties", "leases", "rooms", "beds", "occupants", "utilities", "roomNightLogs"]) {
    if (typeof s[k] !== "number") return false;
  }
  const data = v.data;
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  for (const k of ["customers", "properties", "leases", "rooms", "beds", "occupants", "utilities", "roomNightLogs"]) {
    if (!Array.isArray(d[k])) return false;
  }
  return true;
}

// Synthesize Room rows from a list of legacy beds (which carried a free-text
// `room` column) and convert each bed to use the new `roomId` field. Empty or
// missing room names map to a per-property "Unassigned" room so every bed
// satisfies the new NOT NULL FK constraint.
function migrateBedsToRooms(legacyBeds: z.infer<typeof V2BedSchema>[]): { rooms: Room[]; beds: Bed[] } {
  const rooms: Room[] = [];
  const roomIdByKey = new Map<string, string>();
  let synth = 0;

  const beds: Bed[] = legacyBeds.map((b) => {
    const name = (b.room ?? "").trim() || "Unassigned";
    const key = `${b.propertyId}::${name}`;
    let roomId = roomIdByKey.get(key);
    if (!roomId) {
      synth++;
      roomId = `room-migrated-${synth}`;
      roomIdByKey.set(key, roomId);
      rooms.push({
        id: roomId,
        propertyId: b.propertyId,
        name,
        sqft: 0,
        bathrooms: 0,
        monthlyRent: 0,
      });
    }
    return {
      id: b.id,
      propertyId: b.propertyId,
      bedNumber: b.bedNumber,
      roomId,
      status: b.status,
      occupantId: b.occupantId,
    };
  });
  return { rooms, beds };
}

/**
 * Validate a parsed JSON payload, optionally migrating older backups (v1, v2)
 * up to the current v3 format. Throws {@link UnsupportedImportError} with a
 * user-friendly message if the file is unrecognized or from an unsupported
 * future version.
 */
export function inspectImportPayload(payload: unknown): ImportPreview {
  // Try the current (v3) format first.
  const v3 = ExportPayloadSchema.safeParse(payload);
  if (v3.success) {
    const d = v3.data.data;
    return {
      data: d,
      migratedFromV1: false,
      migratedRooms: false,
      summary: {
        customers: d.customers.length,
        properties: d.properties.length,
        leases: d.leases.length,
        rooms: d.rooms.length,
        beds: d.beds.length,
        occupants: d.occupants.length,
        utilities: d.utilities.length,
        roomNightLogs: d.roomNightLogs.length,
      },
    };
  }

  // Try v2 (pre-Rooms) and migrate by synthesizing Room rows from bed.room.
  const v2 = V2ExportPayloadSchema.safeParse(payload);
  if (v2.success) {
    const old = v2.data.data;
    const { rooms, beds } = migrateBedsToRooms(old.beds);
    const data: ExportData = {
      customers: old.customers,
      properties: old.properties,
      leases: old.leases,
      rooms,
      beds,
      occupants: old.occupants,
      utilities: old.utilities,
      roomNightLogs: [],
    };
    return {
      data,
      migratedFromV1: false,
      migratedRooms: true,
      summary: {
        customers: data.customers.length,
        properties: data.properties.length,
        leases: data.leases.length,
        rooms: data.rooms.length,
        beds: data.beds.length,
        occupants: data.occupants.length,
        utilities: data.utilities.length,
        roomNightLogs: 0,
      },
    };
  }

  // Fall back to the v1 (pre-Customers, pre-Rooms) format.
  const v1 = LegacyExportPayloadSchema.safeParse(payload);
  if (v1.success) {
    const old = v1.data.data;
    const migratedProperties: Property[] = old.properties.map((p) => ({
      ...p,
      customerId: LEGACY_CUSTOMER_ID,
    }));
    const { rooms, beds } = migrateBedsToRooms(old.beds);
    const data: ExportData = {
      customers: [LEGACY_CUSTOMER],
      properties: migratedProperties,
      leases: old.leases,
      rooms,
      beds,
      occupants: old.occupants,
      utilities: old.utilities,
      roomNightLogs: [],
    };
    return {
      data,
      migratedFromV1: true,
      migratedRooms: true,
      summary: {
        customers: 1,
        properties: data.properties.length,
        leases: data.leases.length,
        rooms: data.rooms.length,
        beds: data.beds.length,
        occupants: data.occupants.length,
        utilities: data.utilities.length,
        roomNightLogs: 0,
      },
    };
  }

  // Couldn't parse as any version — produce a tailored message.
  const obj =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const format = obj?.format;
  const version = obj?.version;
  if (format !== "housingops-export") {
    throw new UnsupportedImportError(
      "That file doesn't look like a HousingOps export. No changes were made.",
    );
  }
  if (typeof version === "number" && version > EXPORT_FORMAT_VERSION) {
    throw new UnsupportedImportError(
      `This backup uses a newer format (v${version}) than this app supports ` +
        `(v${EXPORT_FORMAT_VERSION}). Please update HousingOps and try again.`,
    );
  }
  throw new UnsupportedImportError(
    "This HousingOps backup is missing required fields and can't be imported.",
  );
}

export class CustomerInUseError extends Error {
  constructor() {
    super("Customer still owns properties.");
    this.name = "CustomerInUseError";
  }
}

export class RoomInUseError extends Error {
  constructor() {
    super("Cannot delete a room that still has beds.");
    this.name = "RoomInUseError";
  }
}

interface DataStore {
  customers: Customer[];
  properties: Property[];
  leases: Lease[];
  rooms: Room[];
  beds: Bed[];
  occupants: Occupant[];
  utilities: Utility[];
  roomNightLogs: RoomNightLog[];
  isLoading: boolean;
  /**
   * Per-list counts of rows the client dropped because they failed schema
   * validation. Empty when every row parsed cleanly. Surfaced in the layout
   * as a small inline notice ("N rows hidden — see console") so a single
   * malformed row never blanks the whole page.
   */
  dataIssues: DataIssue[];
  addCustomer: (customer: Customer) => Promise<Customer>;
  updateCustomer: (id: string, updates: Partial<Customer>) => void;
  deleteCustomer: (id: string) => Promise<void>;
  addProperty: (property: Property) => Promise<Property>;
  updateProperty: (id: string, updates: Partial<Property>) => void;
  deleteProperty: (id: string) => void;
  updateLease: (id: string, updates: Partial<Lease>) => void;
  addLease: (lease: Lease) => void;
  deleteLease: (id: string) => void;
  addRoom: (room: Room) => Promise<Room>;
  updateRoom: (id: string, updates: Partial<Room>) => void;
  deleteRoom: (id: string) => Promise<void>;
  addBed: (bed: Bed) => void;
  deleteBed: (id: string) => void;
  updateBed: (id: string, updates: Partial<Bed>) => void;
  updateOccupant: (id: string, updates: Partial<Occupant>) => void;
  addOccupant: (occupant: Occupant) => void;
  deleteOccupant: (id: string) => void;
  updateUtility: (id: string, updates: Partial<Utility>) => void;
  addUtility: (utility: Utility) => void;
  deleteUtility: (id: string) => void;
  resetToSampleData: (callbacks?: { onSuccess?: () => void; onError?: () => void; onSettled?: () => void }) => void;
  exportData: () => ExportPayload;
  importData: (input: unknown | ImportPreview, mode?: ImportMode) => ImportResult;
  /**
   * Compute a per-type "what will change" preview for a merge import without
   * touching any caches. Use to surface accidental overwrites before the user
   * confirms.
   */
  previewMergeImport: (preview: ImportPreview) => MergeDryRun;
  /**
   * Restore the bundle that was active just before the most recent
   * {@link importData} call. Returns true if a snapshot was available and
   * applied, false if the undo window has already expired (or no import has
   * happened in this session). The snapshot is cleared whether undo
   * succeeds or fails so it can only ever be applied once.
   */
  undoLastImport: () => boolean;
}

/**
 * How long (ms) after a successful import the user has to click Undo before
 * the snapshot is dropped. Kept short so we don't pin a duplicate copy of
 * the entire bundle in memory indefinitely, but long enough that an
 * operator who clicked Confirm by mistake has time to react.
 */
export const UNDO_IMPORT_WINDOW_MS = 30_000;

const DataContext = createContext<DataStore | undefined>(undefined);

export function DataProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const notifySaveError = (action: string) => {
    toast({
      title: "Save failed",
      description: `Couldn't ${action}. Your change was reverted. Please check your connection and try again.`,
      variant: "destructive",
    });
  };

  const customersQuery = useListCustomers();
  const propertiesQuery = useListProperties();
  const leasesQuery = useListLeases();
  const roomsQuery = useListRooms();
  const bedsQuery = useListBeds();
  const occupantsQuery = useListOccupants();
  const utilitiesQuery = useListUtilities();
  const roomNightLogsQuery = useListRoomNightLogs();

  const customersKey = getListCustomersQueryKey();
  const propertiesKey = getListPropertiesQueryKey();
  const leasesKey = getListLeasesQueryKey();
  const roomsKey = getListRoomsQueryKey();
  const bedsKey = getListBedsQueryKey();
  const occupantsKey = getListOccupantsQueryKey();
  const utilitiesKey = getListUtilitiesQueryKey();
  const roomNightLogsKey = getListRoomNightLogsQueryKey();

  const createCustomerMut = useCreateCustomer();
  const updateCustomerMut = useUpdateCustomer();
  const deleteCustomerMut = useDeleteCustomer();
  const createPropertyMut = useCreateProperty();
  const updatePropertyMut = useUpdateProperty();
  const deletePropertyMut = useDeleteProperty();
  const createLeaseMut = useCreateLease();
  const updateLeaseMut = useUpdateLease();
  const deleteLeaseMut = useDeleteLease();
  const createRoomMut = useCreateRoom();
  const updateRoomMut = useUpdateRoom();
  const deleteRoomMut = useDeleteRoom();
  const createBedMut = useCreateBed();
  const updateBedMut = useUpdateBed();
  const deleteBedMut = useDeleteBed();
  const createOccupantMut = useCreateOccupant();
  const updateOccupantMut = useUpdateOccupant();
  const deleteOccupantMut = useDeleteOccupant();
  const createUtilityMut = useCreateUtility();
  const updateUtilityMut = useUpdateUtility();
  const deleteUtilityMut = useDeleteUtility();
  const resetMut = useResetToSampleData();
  const importMut = useImportData();

  // Parse each list response row-by-row so a single malformed row from the
  // server only loses that row, not the whole page. The dropped count is
  // surfaced via `dataIssues` so the layout can render an inline notice
  // ("N rows hidden — see console") instead of going blank. Memoized on
  // the raw query data so we don't re-walk the array every render.
  const { rows: customers, dropped: customersDropped } = useMemo(
    () => safeParseList(CustomerSchema, customersQuery.data, "customers"),
    [customersQuery.data],
  );
  const { rows: properties, dropped: propertiesDropped } = useMemo(
    () => safeParseList(PropertySchema, propertiesQuery.data, "properties"),
    [propertiesQuery.data],
  );
  const { rows: leases, dropped: leasesDropped } = useMemo(
    () => safeParseList(LeaseSchema, leasesQuery.data, "leases"),
    [leasesQuery.data],
  );
  const { rows: rooms, dropped: roomsDropped } = useMemo(
    () => safeParseList(RoomSchema, roomsQuery.data, "rooms"),
    [roomsQuery.data],
  );
  const { rows: beds, dropped: bedsDropped } = useMemo(
    () => safeParseList(BedSchema, bedsQuery.data, "beds"),
    [bedsQuery.data],
  );
  const { rows: occupants, dropped: occupantsDropped } = useMemo(
    () => safeParseList(OccupantSchema, occupantsQuery.data, "occupants"),
    [occupantsQuery.data],
  );
  const { rows: utilities, dropped: utilitiesDropped } = useMemo(
    () => safeParseList(UtilitySchema, utilitiesQuery.data, "utilities"),
    [utilitiesQuery.data],
  );
  const { rows: roomNightLogs, dropped: roomNightLogsDropped } = useMemo(
    () => safeParseList(RoomNightLogSchema, roomNightLogsQuery.data, "room-night logs"),
    [roomNightLogsQuery.data],
  );

  const dataIssues = useMemo<DataIssue[]>(() => {
    const counts: Array<[string, string, number]> = [
      ["customers", "customers", customersDropped],
      ["properties", "properties", propertiesDropped],
      ["leases", "leases", leasesDropped],
      ["rooms", "rooms", roomsDropped],
      ["beds", "beds", bedsDropped],
      ["occupants", "occupants", occupantsDropped],
      ["utilities", "utilities", utilitiesDropped],
      ["roomNightLogs", "room-night logs", roomNightLogsDropped],
    ];
    return counts
      .filter(([, , n]) => n > 0)
      .map(([kind, label, dropped]) => ({ kind, label, dropped }));
  }, [
    customersDropped, propertiesDropped, leasesDropped, roomsDropped,
    bedsDropped, occupantsDropped, utilitiesDropped, roomNightLogsDropped,
  ]);
  const isLoading =
    customersQuery.isLoading ||
    propertiesQuery.isLoading ||
    leasesQuery.isLoading ||
    roomsQuery.isLoading ||
    bedsQuery.isLoading ||
    occupantsQuery.isLoading ||
    utilitiesQuery.isLoading ||
    roomNightLogsQuery.isLoading;

  // ── Helpers for optimistic cache updates ────────────────────────────────
  function patchInList<T extends { id: string }>(
    key: QueryKey,
    id: string,
    updates: Partial<T>,
  ) {
    queryClient.setQueryData<T[]>(key, (prev) =>
      prev ? prev.map((item) => (item.id === id ? { ...item, ...updates } : item)) : prev,
    );
  }
  function pushToList<T>(key: QueryKey, item: T) {
    queryClient.setQueryData<T[]>(key, (prev) => (prev ? [...prev, item] : [item]));
  }
  function removeFromList<T extends { id: string }>(key: QueryKey, id: string) {
    queryClient.setQueryData<T[]>(key, (prev) =>
      prev ? prev.filter((item) => item.id !== id) : prev,
    );
  }

  /**
   * Capture the current cache for {@link key} BEFORE we apply an optimistic
   * patch, then return mutation handlers that restore that snapshot on
   * failure (so the user's row visibly reverts) and refetch on settle (so
   * the local cache catches any server-side fields we didn't predict).
   *
   * Mutation `retry: false` is set globally on the QueryClient — if the
   * server rejects once we surface the failure immediately rather than
   * thrashing the optimistic patch on every retry attempt.
   */
  function captureRollback<T>(key: QueryKey, action: string) {
    const snapshot = queryClient.getQueryData<T>(key);
    return {
      onError: () => {
        if (snapshot !== undefined) queryClient.setQueryData<T>(key, snapshot);
        notifySaveError(action);
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
    };
  }

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: customersKey });
    queryClient.invalidateQueries({ queryKey: propertiesKey });
    queryClient.invalidateQueries({ queryKey: leasesKey });
    queryClient.invalidateQueries({ queryKey: roomsKey });
    queryClient.invalidateQueries({ queryKey: bedsKey });
    queryClient.invalidateQueries({ queryKey: occupantsKey });
    queryClient.invalidateQueries({ queryKey: utilitiesKey });
    queryClient.invalidateQueries({ queryKey: roomNightLogsKey });
  };

  // ── Customer mutations ──────────────────────────────────────────────────
  // Returns a promise so callers (e.g. inline customer-create from the Add
  // Property dialog) can await persistence before creating dependent rows.
  const addCustomer = async (customer: Customer): Promise<Customer> => {
    pushToList<Customer>(customersKey, customer);
    try {
      const saved = await createCustomerMut.mutateAsync({ data: customer });
      return saved as Customer;
    } catch (err) {
      // Roll back the optimistic insert and rethrow for the caller to surface.
      removeFromList<Customer>(customersKey, customer.id);
      throw err;
    } finally {
      queryClient.invalidateQueries({ queryKey: customersKey });
    }
  };
  const updateCustomer = (id: string, updates: Partial<Customer>) => {
    const handlers = captureRollback<Customer[]>(customersKey, "save your customer changes");
    patchInList<Customer>(customersKey, id, updates);
    updateCustomerMut.mutate({ id, data: updates }, handlers);
  };
  const deleteCustomer = async (id: string): Promise<void> => {
    // Guard: refuse if any property still references this customer.
    const hasProperty = properties.some((p) => p.customerId === id);
    if (hasProperty) {
      throw new CustomerInUseError();
    }
    return new Promise<void>((resolve, reject) => {
      deleteCustomerMut.mutate(
        { id },
        {
          onSuccess: () => {
            removeFromList<Customer>(customersKey, id);
            resolve();
          },
          onError: (err: unknown) => {
            const status = (err as { status?: number } | undefined)?.status;
            if (status === 409) reject(new CustomerInUseError());
            else reject(err);
          },
          onSettled: () => queryClient.invalidateQueries({ queryKey: customersKey }),
        },
      );
    });
  };

  // ── Property mutations (optimistic; refetch on settle) ──────────────────
  // Returns a promise so callers can await server validation (e.g. customerId
  // foreign-key check) before showing a success toast.
  const addProperty = async (property: Property): Promise<Property> => {
    pushToList<Property>(propertiesKey, property);
    try {
      const saved = await createPropertyMut.mutateAsync({ data: property });
      return saved as Property;
    } catch (err) {
      removeFromList<Property>(propertiesKey, property.id);
      throw err;
    } finally {
      queryClient.invalidateQueries({ queryKey: propertiesKey });
    }
  };
  const updateProperty = (id: string, updates: Partial<Property>) => {
    // Any edit to the address fields invalidates the cached lat/lng —
    // the old coordinates would otherwise pin the property at the old
    // address forever. The portfolio map will re-geocode and persist
    // the fresh coordinates on the next view. Skip this when the
    // caller is itself updating lat/lng (i.e. the geocode write-back),
    // otherwise we'd null out the value we're trying to save.
    const touchesAddress =
      "address" in updates ||
      "city" in updates ||
      "state" in updates ||
      "zip" in updates;
    const writingCoords = "lat" in updates || "lng" in updates;
    // Address edits also reset the "verified" flag — a manual
    // verification only applies to the address it was made against.
    // The server enforces the same rule, but clearing it optimistically
    // keeps the UI badge from briefly showing the wrong state.
    const effectiveUpdates: Partial<Property> =
      touchesAddress && !writingCoords
        ? { ...updates, lat: null, lng: null, coordsVerified: false }
        : updates;
    const handlers = captureRollback<Property[]>(propertiesKey, "save your property changes");
    patchInList<Property>(propertiesKey, id, effectiveUpdates);
    updatePropertyMut.mutate({ id, data: effectiveUpdates }, handlers);
  };
  const deleteProperty = (id: string) => {
    const handlers = captureRollback<Property[]>(propertiesKey, "delete the property");
    removeFromList<Property>(propertiesKey, id);
    deletePropertyMut.mutate({ id }, handlers);
  };

  const updateLease = (id: string, updates: Partial<Lease>) => {
    const handlers = captureRollback<Lease[]>(leasesKey, "save your lease changes");
    patchInList<Lease>(leasesKey, id, updates);
    updateLeaseMut.mutate({ id, data: updates }, handlers);
  };
  const addLease = (lease: Lease) => {
    const handlers = captureRollback<Lease[]>(leasesKey, "add the new lease");
    pushToList<Lease>(leasesKey, lease);
    createLeaseMut.mutate({ data: lease }, handlers);
  };
  const deleteLease = (id: string) => {
    const handlers = captureRollback<Lease[]>(leasesKey, "delete the lease");
    removeFromList<Lease>(leasesKey, id);
    deleteLeaseMut.mutate({ id }, handlers);
  };

  // ── Room mutations ──────────────────────────────────────────────────────
  // addRoom returns a promise so the UI can await the server-confirmed Room
  // (and its id) before adding a bed that references it.
  const addRoom = async (room: Room): Promise<Room> => {
    pushToList<Room>(roomsKey, room);
    try {
      const saved = await createRoomMut.mutateAsync({ data: room });
      return saved as Room;
    } catch (err) {
      removeFromList<Room>(roomsKey, room.id);
      notifySaveError("add the new room");
      throw err;
    } finally {
      queryClient.invalidateQueries({ queryKey: roomsKey });
    }
  };
  const updateRoom = (id: string, updates: Partial<Room>) => {
    const handlers = captureRollback<Room[]>(roomsKey, "save your room changes");
    patchInList<Room>(roomsKey, id, updates);
    updateRoomMut.mutate({ id, data: updates }, handlers);
  };
  const deleteRoom = async (id: string): Promise<void> => {
    // Client-side guard mirrors the server's 409: rooms with beds can't be
    // deleted. We still translate a server 409 below in case the cache is stale.
    const hasBed = beds.some((b) => b.roomId === id);
    if (hasBed) throw new RoomInUseError();
    return new Promise<void>((resolve, reject) => {
      deleteRoomMut.mutate(
        { id },
        {
          onSuccess: () => {
            removeFromList<Room>(roomsKey, id);
            resolve();
          },
          onError: (err: unknown) => {
            const status = (err as { status?: number } | undefined)?.status;
            if (status === 409) reject(new RoomInUseError());
            else reject(err);
          },
          onSettled: () => queryClient.invalidateQueries({ queryKey: roomsKey }),
        },
      );
    });
  };

  const addBed = (bed: Bed) => {
    const handlers = captureRollback<Bed[]>(bedsKey, "add the new bed");
    pushToList<Bed>(bedsKey, bed);
    createBedMut.mutate({ data: bed }, handlers);
  };
  const deleteBed = (id: string) => {
    const handlers = captureRollback<Bed[]>(bedsKey, "delete the bed");
    removeFromList<Bed>(bedsKey, id);
    deleteBedMut.mutate({ id }, handlers);
  };
  const updateBed = (id: string, updates: Partial<Bed>) => {
    const handlers = captureRollback<Bed[]>(bedsKey, "save your bed changes");
    patchInList<Bed>(bedsKey, id, updates);
    updateBedMut.mutate({ id, data: updates }, handlers);
  };

  const updateOccupant = (id: string, updates: Partial<Occupant>) => {
    const handlers = captureRollback<Occupant[]>(occupantsKey, "save your occupant changes");
    patchInList<Occupant>(occupantsKey, id, updates);
    updateOccupantMut.mutate({ id, data: updates }, handlers);
  };
  const addOccupant = (occupant: Occupant) => {
    const handlers = captureRollback<Occupant[]>(occupantsKey, "add the new occupant");
    pushToList<Occupant>(occupantsKey, occupant);
    createOccupantMut.mutate({ data: occupant }, handlers);
  };
  const deleteOccupant = (id: string) => {
    // Mirror the api-server cleanup: any bed pointing at this occupant
    // gets cleared optimistically so the UI doesn't show a stale link
    // before the next /beds GET runs. We snapshot both caches here so a
    // failed mutation rolls back together — but we only surface ONE
    // user-facing error toast on failure (captureRollback emits one per
    // call, which would double up if used naively here).
    const occupantsSnapshot = queryClient.getQueryData<Occupant[]>(occupantsKey);
    const bedsSnapshot = queryClient.getQueryData<Bed[]>(bedsKey);
    removeFromList<Occupant>(occupantsKey, id);
    queryClient.setQueryData<Bed[]>(bedsKey, (prev) =>
      (prev ?? []).map((b) => (b.occupantId === id ? { ...b, occupantId: null } : b)),
    );
    deleteOccupantMut.mutate(
      { id },
      {
        onError: () => {
          if (occupantsSnapshot !== undefined) {
            queryClient.setQueryData<Occupant[]>(occupantsKey, occupantsSnapshot);
          }
          if (bedsSnapshot !== undefined) {
            queryClient.setQueryData<Bed[]>(bedsKey, bedsSnapshot);
          }
          notifySaveError("delete the occupant");
        },
        onSettled: () => {
          queryClient.invalidateQueries({ queryKey: occupantsKey });
          queryClient.invalidateQueries({ queryKey: bedsKey });
        },
      },
    );
  };

  const updateUtility = (id: string, updates: Partial<Utility>) => {
    const handlers = captureRollback<Utility[]>(utilitiesKey, "save your utility changes");
    patchInList<Utility>(utilitiesKey, id, updates);
    updateUtilityMut.mutate({ id, data: updates }, handlers);
  };
  const addUtility = (utility: Utility) => {
    const handlers = captureRollback<Utility[]>(utilitiesKey, "add the new utility");
    pushToList<Utility>(utilitiesKey, utility);
    createUtilityMut.mutate({ data: utility }, handlers);
  };
  const deleteUtility = (id: string) => {
    const handlers = captureRollback<Utility[]>(utilitiesKey, "delete the utility");
    removeFromList<Utility>(utilitiesKey, id);
    deleteUtilityMut.mutate({ id }, handlers);
  };

  const resetToSampleData = (
    callbacks?: { onSuccess?: () => void; onError?: () => void; onSettled?: () => void },
  ) => {
    resetMut.mutate(undefined, {
      onSuccess: () => callbacks?.onSuccess?.(),
      onError: () => {
        notifySaveError("reset to sample data");
        callbacks?.onError?.();
      },
      onSettled: () => {
        invalidateAll();
        callbacks?.onSettled?.();
      },
    });
  };

  const exportData = (): ExportPayload => ({
    format: "housingops-export",
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    data: { customers, properties, leases, rooms, beds, occupants, utilities, roomNightLogs },
  });

  // Holds the pre-import bundle plus the timer that drops it after the
  // undo window elapses. A ref (not state) so the timer callback and the
  // synchronous undo handler always observe the freshest value without
  // triggering re-renders that could clobber the optimistic cache writes.
  const undoSnapshotRef = useRef<{
    data: ExportData;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const clearUndoSnapshot = () => {
    if (undoSnapshotRef.current) {
      clearTimeout(undoSnapshotRef.current.timer);
      undoSnapshotRef.current = null;
    }
  };

  // Belt-and-suspenders cleanup: if the provider unmounts (e.g. user logs
  // out) while an undo timer is still pending we don't want it firing on
  // a torn-down React tree.
  useEffect(() => () => clearUndoSnapshot(), []);

  // Shared writer used by both importData and undoLastImport: pushes the
  // bundle into every cache and persists atomically through /import. Kept
  // separate from importData so undo can replay the previous bundle
  // without itself capturing a fresh snapshot (which would let operators
  // un-undo and confuse the timer accounting).
  const writeBundle = (dataToWrite: ExportData) => {
    queryClient.setQueryData<Customer[]>(customersKey, dataToWrite.customers);
    queryClient.setQueryData<Property[]>(propertiesKey, dataToWrite.properties);
    queryClient.setQueryData<Lease[]>(leasesKey, dataToWrite.leases);
    queryClient.setQueryData<Room[]>(roomsKey, dataToWrite.rooms);
    queryClient.setQueryData<Bed[]>(bedsKey, dataToWrite.beds);
    queryClient.setQueryData<Occupant[]>(occupantsKey, dataToWrite.occupants);
    queryClient.setQueryData<Utility[]>(utilitiesKey, dataToWrite.utilities);
    queryClient.setQueryData<RoomNightLog[]>(roomNightLogsKey, dataToWrite.roomNightLogs);

    importMut.mutate(
      { data: dataToWrite },
      {
        onError: () => notifySaveError("save the imported data"),
        onSettled: invalidateAll,
      },
    );
  };

  // Accepts either a raw parsed JSON payload (which we'll inspect ourselves)
  // or a pre-validated ImportPreview (so callers that already inspected the
  // file — e.g. to show a tailored confirmation dialog — don't pay to parse
  // it twice). Throws UnsupportedImportError for unrecognized payloads.
  //
  // mode="replace" (default) wipes existing data and writes the file's contents.
  // mode="merge" overlays the file onto current data: new ids are added,
  // existing ids whose content differs are overwritten, and local-only
  // records are preserved.
  const importData = (input: unknown, mode: ImportMode = "replace"): ImportResult => {
    const preview =
      isImportPreview(input) ? input : inspectImportPayload(input);

    // Snapshot the CURRENT bundle before we overwrite anything so the
    // user can undo the import. We snapshot from the React-state arrays
    // (which mirror the cache) rather than reading the cache again
    // because they're guaranteed to be the values the operator was
    // looking at when they confirmed.
    const previousBundle: ExportData = {
      customers: [...customers],
      properties: [...properties],
      leases: [...leases],
      rooms: [...rooms],
      beds: [...beds],
      occupants: [...occupants],
      utilities: [...utilities],
      roomNightLogs: [...roomNightLogs],
    };

    let dataToWrite: ExportData;
    let added: ImportSummary | undefined;
    let updated: ImportSummary | undefined;

    if (mode === "merge") {
      const merged = mergeImportBundles(previousBundle, preview.data);
      dataToWrite = merged.data;
      added = merged.added;
      updated = merged.updated;
    } else {
      dataToWrite = preview.data;
    }

    writeBundle(dataToWrite);

    // Arm the undo window. Replace any prior snapshot so back-to-back
    // imports only ever undo the most recent one — the older snapshot
    // wouldn't fit the now-current state anyway.
    clearUndoSnapshot();
    const timer = setTimeout(() => {
      undoSnapshotRef.current = null;
    }, UNDO_IMPORT_WINDOW_MS);
    undoSnapshotRef.current = { data: previousBundle, timer };

    return { mode, summary: preview.summary, added, updated };
  };

  const undoLastImport = (): boolean => {
    const snap = undoSnapshotRef.current;
    if (!snap) return false;
    // Drop the snapshot first so a double-clicked Undo can't replay it
    // twice and so the next import starts with a clean slate.
    clearUndoSnapshot();
    writeBundle(snap.data);
    return true;
  };

  const previewMergeImport = (preview: ImportPreview): MergeDryRun =>
    dryRunMergeImport(
      { customers, properties, leases, rooms, beds, occupants, utilities, roomNightLogs },
      preview.data,
    );

  return (
    <DataContext.Provider value={{
      customers, properties, leases, rooms, beds, occupants, utilities, roomNightLogs, isLoading,
      dataIssues,
      addCustomer, updateCustomer, deleteCustomer,
      addProperty, updateProperty, deleteProperty,
      updateLease, addLease, deleteLease,
      addRoom, updateRoom, deleteRoom,
      addBed, deleteBed, updateBed, updateOccupant, addOccupant, deleteOccupant,
      updateUtility, addUtility, deleteUtility,
      resetToSampleData, exportData, importData, previewMergeImport, undoLastImport,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
