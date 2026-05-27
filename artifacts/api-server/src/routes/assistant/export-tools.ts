import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  assistantExportsTable,
  propertiesTable,
  buildingsTable,
  roomsTable,
  bedsTable,
  occupantsTable,
  leasesTable,
  utilitiesTable,
  insuranceCertificatesTable,
  payrollDeductionsTable,
  roomNightLogsTable,
  customersTable,
} from "@workspace/db";
import {
  buildXlsxBuffer,
  colLetter,
  type ExportColumn,
  type SummarySheet,
} from "../../lib/xlsx-export";
import { buildPdfBuffer } from "../../lib/pdf-export";
import type { ToolDef, ToolCtx } from "./tools";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PDF_MIME = "application/pdf";

const StrOpt = { type: ["string", "null"] } as const;
const NumOpt = { type: ["number", "null"] } as const;
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

const FormatField = { type: "string", enum: ["xlsx", "pdf"] } as const;

function newExportId(): string {
  return `ax-${randomUUID().slice(0, 8)}`;
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function slug(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function describeFilters(
  parts: Array<[string, unknown]>,
): string {
  const kept = parts
    .filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false)
    .map(([k, v]) => `${k}=${String(v)}`);
  return kept.length ? `Filters: ${kept.join(", ")}` : "Filters: none";
}

interface BuildAndPersistOpts {
  ctx: ToolCtx;
  toolName: string;
  entityType: string;
  scopeName?: string | null;
  format: "xlsx" | "pdf";
  filenameOverride?: string;
  title: string;
  filterDesc: string;
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
  summary?: SummarySheet;
}

async function buildAndPersist(
  opts: BuildAndPersistOpts,
): Promise<{
  exportId: string;
  filename: string;
  format: string;
  rowCount: number;
  sizeBytes: number;
}> {
  const ext = opts.format === "pdf" ? "pdf" : "xlsx";
  const scope = slug(opts.scopeName ?? "");
  const auto = `${opts.entityType}${scope ? "-" + scope : ""}-${todayYmd()}.${ext}`;
  const filename =
    opts.filenameOverride && opts.filenameOverride.trim()
      ? opts.filenameOverride.trim()
      : auto;

  const content =
    opts.format === "pdf"
      ? await buildPdfBuffer({
          title: opts.title,
          filterDesc: opts.filterDesc,
          columns: opts.columns,
          rows: opts.rows,
          summary: opts.summary,
        })
      : buildXlsxBuffer({
          title: opts.title,
          filterDesc: opts.filterDesc,
          columns: opts.columns,
          rows: opts.rows,
          summary: opts.summary,
        });

  const id = newExportId();
  const mime = opts.format === "pdf" ? PDF_MIME : XLSX_MIME;
  const sizeBytes = content.length;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  await db.insert(assistantExportsTable).values({
    id,
    userId: opts.ctx.userId,
    conversationId: opts.ctx.conversationId ?? null,
    filename,
    mime,
    sizeBytes,
    content,
    toolName: opts.toolName,
    format: opts.format,
    entityType: opts.entityType,
    rowCount: opts.rows.length,
    filterDesc: opts.filterDesc,
    expiresAt,
  });

  return {
    exportId: id,
    filename,
    format: opts.format,
    rowCount: opts.rows.length,
    sizeBytes,
  };
}

async function customerNameById(id: string | undefined | null): Promise<string | null> {
  if (!id) return null;
  const [c] = await db
    .select({ name: customersTable.name })
    .from(customersTable)
    .where(eq(customersTable.id, id));
  return c?.name ?? null;
}

async function propertyNameById(id: string | undefined | null): Promise<string | null> {
  if (!id) return null;
  const [p] = await db
    .select({ name: propertiesTable.name })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, id));
  return p?.name ?? null;
}

async function loadPropertyMap(ids: string[]): Promise<Map<string, { id: string; name: string; customerId: string | null }>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({
      id: propertiesTable.id,
      name: propertiesTable.name,
      customerId: propertiesTable.customerId,
    })
    .from(propertiesTable)
    .where(inArray(propertiesTable.id, Array.from(new Set(ids))));
  return new Map(rows.map((r) => [r.id, r]));
}

function safeDays(end: string | undefined | null): number | null {
  if (!end) return null;
  const t = Date.parse(end + "T00:00:00Z");
  if (!Number.isFinite(t)) return null;
  return Math.round((t - Date.now()) / (24 * 60 * 60 * 1000));
}

// ────────────────────────────────────────────────────────────────────
// 1. export_leases
// ────────────────────────────────────────────────────────────────────

export const exportLeasesTool: ToolDef = {
  name: "export_leases",
  kind: "read",
  description:
    "Export leases to Excel (.xlsx with live formulas) or PDF. Accepts the same filters as list_leases (customerId, propertyId, status, expiringWithinDays). Returns a download chip the operator can click — no confirm card.",
  input_schema: obj(
    {
      format: FormatField,
      filename: StrOpt,
      customerId: StrOpt,
      propertyId: StrOpt,
      status: StrOpt,
      expiringWithinDays: NumOpt,
    },
    ["format"],
  ),
  summarize: (i) =>
    `Exporting leases to ${i.format}${i.status ? ` (status=${i.status})` : ""}`,
  execute: async (input, ctx) => {
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
    if (propertyIdSet) rows = rows.filter((l) => propertyIdSet!.has(l.propertyId));
    if (input.status) rows = rows.filter((l) => l.status === input.status);
    if (typeof input.expiringWithinDays === "number" && input.expiringWithinDays >= 0) {
      const today = todayYmd();
      const horizon = new Date(Date.now() + input.expiringWithinDays * 86400000)
        .toISOString()
        .slice(0, 10);
      rows = rows.filter(
        (l) => typeof l.endDate === "string" && l.endDate >= today && l.endDate <= horizon,
      );
    }

    const propMap = await loadPropertyMap(rows.map((l) => l.propertyId));
    const buildingMap = new Map<string, string>();
    // Buildings are optional; leases don't directly carry buildingId on
    // every row in this schema. Leave Building blank when unknown.

    const data = rows.map((l) => {
      const p = propMap.get(l.propertyId);
      return {
        leaseId: l.id,
        property: p?.name ?? l.propertyId,
        building: buildingMap.get(l.propertyId) ?? "",
        unit: l.unit ?? "",
        start: l.startDate ?? "",
        end: l.endDate ?? "",
        status: l.status ?? "",
        monthlyRent: l.monthlyRent ?? 0,
        securityDeposit: l.securityDeposit ?? 0,
        vendor: l.vendor ?? "",
        notes: l.notes ?? "",
      };
    });

    const endColLetter = colLetter(5); // F (0-indexed: leaseId,property,building,unit,start,end)
    const columns: ExportColumn[] = [
      { key: "leaseId", header: "Lease ID", priority: 2 },
      { key: "property", header: "Property" },
      { key: "building", header: "Building", priority: 4 },
      { key: "unit", header: "Unit", priority: 3 },
      { key: "start", header: "Start", format: "date", priority: 3 },
      { key: "end", header: "End", format: "date" },
      { key: "status", header: "Status" },
      { key: "monthlyRent", header: "Monthly Rent", format: "currency" },
      { key: "securityDeposit", header: "Security Deposit", format: "currency", priority: 3 },
      { key: "vendor", header: "Vendor", priority: 4 },
      { key: "notes", header: "Notes", priority: 5 },
      {
        key: "daysToExpiry",
        header: "Days to Expiry",
        format: "int",
        formula: (r) => `IF(${endColLetter}${r}<>"",${endColLetter}${r}-TODAY(),"")`,
        compute: (row) => safeDays(row.end as string),
      },
    ];

    // Summary uses dynamic column letters for monthly rent (H = idx 7)
    // and days-to-expiry (L = idx 11) — kept here for clarity.
    const rentCol = colLetter(7);
    const statusCol = colLetter(6);
    const dCol = colLetter(11);
    const idCol = colLetter(0);
    const summary: SummarySheet = {
      name: "Totals",
      rows: [
        { label: "Total leases", formula: `COUNTA(Data!${idCol}5:${idCol}{lastRow})` },
        {
          label: "Active leases",
          formula: `COUNTIF(Data!${statusCol}5:${statusCol}{lastRow},"Active")`,
        },
        {
          label: "Expiring next 30d",
          formula: `COUNTIFS(Data!${dCol}5:${dCol}{lastRow},">=0",Data!${dCol}5:${dCol}{lastRow},"<=30")`,
        },
        { label: "Monthly rent total", formula: `SUM(Data!${rentCol}5:${rentCol}{lastRow})` },
        { label: "Avg monthly rent", formula: `AVERAGE(Data!${rentCol}5:${rentCol}{lastRow})` },
      ],
    };

    const scopeName =
      (await propertyNameById(input.propertyId)) ??
      (await customerNameById(input.customerId)) ??
      null;
    const filterDesc = describeFilters([
      ["customer", input.customerId],
      ["property", input.propertyId],
      ["status", input.status],
      ["expiringWithinDays", input.expiringWithinDays],
    ]);

    return buildAndPersist({
      ctx,
      toolName: "export_leases",
      entityType: "leases",
      scopeName,
      format: input.format as "xlsx" | "pdf",
      filenameOverride: input.filename,
      title: "Leases",
      filterDesc,
      columns,
      rows: data,
      summary,
    });
  },
};

// ────────────────────────────────────────────────────────────────────
// 2. export_occupants
// ────────────────────────────────────────────────────────────────────

export const exportOccupantsTool: ToolDef = {
  name: "export_occupants",
  kind: "read",
  description:
    "Export occupants to Excel or PDF. Filters: customerId, propertyId, status, company.",
  input_schema: obj(
    {
      format: FormatField,
      filename: StrOpt,
      customerId: StrOpt,
      propertyId: StrOpt,
      status: StrOpt,
      company: StrOpt,
    },
    ["format"],
  ),
  summarize: (i) => `Exporting occupants to ${i.format}`,
  execute: async (input, ctx) => {
    let propertyIdSet: Set<string> | null = null;
    if (input.customerId) {
      const props = await db
        .select({ id: propertiesTable.id })
        .from(propertiesTable)
        .where(eq(propertiesTable.customerId, input.customerId));
      propertyIdSet = new Set(props.map((p) => p.id));
    }
    let rows = input.propertyId
      ? await db.select().from(occupantsTable).where(eq(occupantsTable.propertyId, input.propertyId))
      : await db.select().from(occupantsTable);
    if (propertyIdSet) rows = rows.filter((o) => o.propertyId && propertyIdSet!.has(o.propertyId));
    if (input.status) rows = rows.filter((o) => o.status === input.status);
    if (input.company) rows = rows.filter((o) => o.company === input.company);

    const propMap = await loadPropertyMap(rows.map((o) => o.propertyId).filter(Boolean) as string[]);
    const bedIds = Array.from(new Set(rows.map((o) => o.bedId).filter(Boolean) as string[]));
    const beds = bedIds.length
      ? await db.select({ id: bedsTable.id, bedNumber: bedsTable.bedNumber }).from(bedsTable).where(inArray(bedsTable.id, bedIds))
      : [];
    const bedMap = new Map(beds.map((b) => [b.id, b]));

    const data = rows.map((o) => ({
      occupantId: o.id,
      name: o.name,
      property: o.propertyId ? propMap.get(o.propertyId)?.name ?? o.propertyId : "",
      bed: o.bedId ? `#${bedMap.get(o.bedId)?.bedNumber ?? "?"}` : "",
      company: o.company,
      status: o.status,
      moveInDate: o.moveInDate,
      chargePerBed: o.chargePerBed,
      chargeSourceCustomer: o.chargeSourceCustomer,
      notes: "",
    }));

    const idCol = colLetter(0);
    const statusCol = colLetter(5);
    const chargeCol = colLetter(7);
    const columns: ExportColumn[] = [
      { key: "occupantId", header: "Occupant ID", priority: 3 },
      { key: "name", header: "Name" },
      { key: "property", header: "Property" },
      { key: "bed", header: "Bed", priority: 3 },
      { key: "company", header: "Company", priority: 2 },
      { key: "status", header: "Status" },
      { key: "moveInDate", header: "Move-in Date", format: "date", priority: 2 },
      { key: "chargePerBed", header: "Charge/Bed", format: "currency" },
      { key: "chargeSourceCustomer", header: "Charge Source Customer", priority: 4 },
      { key: "notes", header: "Notes", priority: 5 },
    ];
    const summary: SummarySheet = {
      name: "Totals",
      rows: [
        { label: "Total occupants", formula: `COUNTA(Data!${idCol}5:${idCol}{lastRow})` },
        { label: "Active", formula: `COUNTIF(Data!${statusCol}5:${statusCol}{lastRow},"Active")` },
        { label: "Former", formula: `COUNTIF(Data!${statusCol}5:${statusCol}{lastRow},"Former")` },
        { label: "Total weekly charges", formula: `SUM(Data!${chargeCol}5:${chargeCol}{lastRow})` },
      ],
    };

    const scopeName =
      (await propertyNameById(input.propertyId)) ??
      (await customerNameById(input.customerId)) ??
      null;
    const filterDesc = describeFilters([
      ["customer", input.customerId],
      ["property", input.propertyId],
      ["status", input.status],
      ["company", input.company],
    ]);

    return buildAndPersist({
      ctx,
      toolName: "export_occupants",
      entityType: "occupants",
      scopeName,
      format: input.format as "xlsx" | "pdf",
      filenameOverride: input.filename,
      title: "Occupants",
      filterDesc,
      columns,
      rows: data,
      summary,
    });
  },
};

// ────────────────────────────────────────────────────────────────────
// 3. export_beds
// ────────────────────────────────────────────────────────────────────

export const exportBedsTool: ToolDef = {
  name: "export_beds",
  kind: "read",
  description:
    "Export beds to Excel or PDF. Filters: customerId, propertyId, buildingId, roomId, status, cleaningStatus.",
  input_schema: obj(
    {
      format: FormatField,
      filename: StrOpt,
      customerId: StrOpt,
      propertyId: StrOpt,
      buildingId: StrOpt,
      roomId: StrOpt,
      status: StrOpt,
      cleaningStatus: StrOpt,
    },
    ["format"],
  ),
  summarize: (i) => `Exporting beds to ${i.format}`,
  execute: async (input, ctx) => {
    let propertyIdSet: Set<string> | null = null;
    if (input.customerId) {
      const props = await db
        .select({ id: propertiesTable.id })
        .from(propertiesTable)
        .where(eq(propertiesTable.customerId, input.customerId));
      propertyIdSet = new Set(props.map((p) => p.id));
    }
    const conds: any[] = [];
    if (input.propertyId) conds.push(eq(bedsTable.propertyId, input.propertyId));
    if (input.roomId) conds.push(eq(bedsTable.roomId, input.roomId));
    if (input.status) conds.push(eq(bedsTable.status, input.status));
    if (input.cleaningStatus) conds.push(eq(bedsTable.cleaningStatus, input.cleaningStatus));
    let rows = conds.length
      ? await db.select().from(bedsTable).where(and(...conds))
      : await db.select().from(bedsTable);
    if (propertyIdSet) rows = rows.filter((b) => propertyIdSet!.has(b.propertyId));

    const propMap = await loadPropertyMap(rows.map((b) => b.propertyId));
    const roomIds = Array.from(new Set(rows.map((b) => b.roomId).filter(Boolean)));
    const roomRows = roomIds.length
      ? await db
          .select({
            id: roomsTable.id,
            name: roomsTable.name,
            buildingId: roomsTable.buildingId,
            monthlyRent: roomsTable.monthlyRent,
          })
          .from(roomsTable)
          .where(inArray(roomsTable.id, roomIds as string[]))
      : [];
    const roomMap = new Map(roomRows.map((r) => [r.id, r]));
    const buildingIds = Array.from(new Set(roomRows.map((r) => r.buildingId).filter(Boolean)));
    const buildings = buildingIds.length
      ? await db
          .select({ id: buildingsTable.id, name: buildingsTable.name })
          .from(buildingsTable)
          .where(inArray(buildingsTable.id, buildingIds as string[]))
      : [];
    const buildingMap = new Map(buildings.map((b) => [b.id, b.name]));
    const occIds = Array.from(new Set(rows.map((b) => b.occupantId).filter(Boolean) as string[]));
    const occRows = occIds.length
      ? await db
          .select({ id: occupantsTable.id, name: occupantsTable.name })
          .from(occupantsTable)
          .where(inArray(occupantsTable.id, occIds))
      : [];
    const occMap = new Map(occRows.map((o) => [o.id, o.name]));

    if (input.buildingId) {
      const roomSet = new Set(roomRows.filter((r) => r.buildingId === input.buildingId).map((r) => r.id));
      rows = rows.filter((b) => roomSet.has(b.roomId));
    }

    const data = rows.map((b) => {
      const r = b.roomId ? roomMap.get(b.roomId) : null;
      return {
        bedId: b.id,
        property: propMap.get(b.propertyId)?.name ?? b.propertyId,
        building: r?.buildingId ? buildingMap.get(r.buildingId) ?? "" : "",
        room: r?.name ?? "",
        bedNumber: b.bedNumber,
        status: b.status,
        cleaningStatus: b.cleaningStatus,
        occupant: b.occupantId ? occMap.get(b.occupantId) ?? "" : "",
        monthlyRent: r?.monthlyRent ?? 0,
      };
    });

    const idCol = colLetter(0);
    const statusCol = colLetter(5);
    const cleaningCol = colLetter(6);
    const columns: ExportColumn[] = [
      { key: "bedId", header: "Bed ID", priority: 3 },
      { key: "property", header: "Property" },
      { key: "building", header: "Building", priority: 3 },
      { key: "room", header: "Room" },
      { key: "bedNumber", header: "Bed #", format: "int" },
      { key: "status", header: "Status" },
      { key: "cleaningStatus", header: "Cleaning", priority: 2 },
      { key: "occupant", header: "Occupant" },
      { key: "monthlyRent", header: "Monthly Rent", format: "currency", priority: 2 },
    ];
    const summary: SummarySheet = {
      name: "Totals",
      rows: [
        { label: "Total beds", formula: `COUNTA(Data!${idCol}5:${idCol}{lastRow})` },
        { label: "Occupied", formula: `COUNTIF(Data!${statusCol}5:${statusCol}{lastRow},"Occupied")` },
        { label: "Vacant", formula: `COUNTIF(Data!${statusCol}5:${statusCol}{lastRow},"Vacant")` },
        {
          label: "Needs Cleaning",
          formula: `COUNTIF(Data!${cleaningCol}5:${cleaningCol}{lastRow},"needs_cleaning")`,
        },
        {
          label: "Occupancy %",
          formula: `IFERROR(COUNTIF(Data!${statusCol}5:${statusCol}{lastRow},"Occupied")/COUNTA(Data!${idCol}5:${idCol}{lastRow}),0)`,
        },
      ],
    };

    const scopeName =
      (await propertyNameById(input.propertyId)) ??
      (await customerNameById(input.customerId)) ??
      null;
    const filterDesc = describeFilters([
      ["customer", input.customerId],
      ["property", input.propertyId],
      ["building", input.buildingId],
      ["room", input.roomId],
      ["status", input.status],
      ["cleaningStatus", input.cleaningStatus],
    ]);

    return buildAndPersist({
      ctx,
      toolName: "export_beds",
      entityType: "beds",
      scopeName,
      format: input.format as "xlsx" | "pdf",
      filenameOverride: input.filename,
      title: "Beds",
      filterDesc,
      columns,
      rows: data,
      summary,
    });
  },
};

// ────────────────────────────────────────────────────────────────────
// 4. export_properties
// ────────────────────────────────────────────────────────────────────

export const exportPropertiesTool: ToolDef = {
  name: "export_properties",
  kind: "read",
  description: "Export properties to Excel or PDF. Filters: customerId, status.",
  input_schema: obj(
    { format: FormatField, filename: StrOpt, customerId: StrOpt, status: StrOpt },
    ["format"],
  ),
  summarize: (i) => `Exporting properties to ${i.format}`,
  execute: async (input, ctx) => {
    const conds: any[] = [];
    if (input.customerId) conds.push(eq(propertiesTable.customerId, input.customerId));
    if (input.status) conds.push(eq(propertiesTable.status, input.status));
    const rows = conds.length
      ? await db.select().from(propertiesTable).where(and(...conds))
      : await db.select().from(propertiesTable);

    const propIds = rows.map((p) => p.id);
    const allBeds = propIds.length
      ? await db
          .select({
            propertyId: bedsTable.propertyId,
            status: bedsTable.status,
          })
          .from(bedsTable)
          .where(inArray(bedsTable.propertyId, propIds))
      : [];
    const bedTotals = new Map<string, { total: number; occupied: number }>();
    for (const b of allBeds) {
      const t = bedTotals.get(b.propertyId) ?? { total: 0, occupied: 0 };
      t.total++;
      if (b.status === "Occupied") t.occupied++;
      bedTotals.set(b.propertyId, t);
    }
    const custIds = Array.from(new Set(rows.map((p) => p.customerId).filter(Boolean) as string[]));
    const custRows = custIds.length
      ? await db
          .select({ id: customersTable.id, name: customersTable.name })
          .from(customersTable)
          .where(inArray(customersTable.id, custIds))
      : [];
    const custMap = new Map(custRows.map((c) => [c.id, c.name]));

    const data = rows.map((p) => {
      const t = bedTotals.get(p.id) ?? { total: 0, occupied: 0 };
      return {
        propertyId: p.id,
        name: p.name,
        customer: p.customerId ? custMap.get(p.customerId) ?? p.customerId : "",
        address: p.address,
        city: p.city,
        state: p.state,
        zip: p.zip,
        status: p.status,
        bedCount: t.total,
        occupiedBeds: t.occupied,
      };
    });

    const bedCountCol = colLetter(8); // I
    const occCol = colLetter(9); // J
    const idCol = colLetter(0);
    const statusCol = colLetter(7);
    const columns: ExportColumn[] = [
      { key: "propertyId", header: "Property ID", priority: 3 },
      { key: "name", header: "Name" },
      { key: "customer", header: "Customer" },
      { key: "address", header: "Address", priority: 4 },
      { key: "city", header: "City", priority: 3 },
      { key: "state", header: "State", priority: 4 },
      { key: "zip", header: "Zip", priority: 4 },
      { key: "status", header: "Status" },
      { key: "bedCount", header: "Bed Count", format: "int" },
      { key: "occupiedBeds", header: "Occupied Beds", format: "int" },
      {
        key: "occupancyPct",
        header: "Occupancy %",
        format: "percent",
        formula: (r) => `IF(${bedCountCol}${r}=0,"",${occCol}${r}/${bedCountCol}${r})`,
        compute: (row) => {
          const t = Number(row.bedCount) || 0;
          const o = Number(row.occupiedBeds) || 0;
          return t === 0 ? "" : o / t;
        },
      },
    ];
    const summary: SummarySheet = {
      name: "Totals",
      rows: [
        { label: "Total properties", formula: `COUNTA(Data!${idCol}5:${idCol}{lastRow})` },
        { label: "Active", formula: `COUNTIF(Data!${statusCol}5:${statusCol}{lastRow},"Active")` },
        { label: "Total beds", formula: `SUM(Data!${bedCountCol}5:${bedCountCol}{lastRow})` },
        { label: "Occupied beds", formula: `SUM(Data!${occCol}5:${occCol}{lastRow})` },
        {
          label: "Portfolio occupancy %",
          formula: `IFERROR(SUM(Data!${occCol}5:${occCol}{lastRow})/SUM(Data!${bedCountCol}5:${bedCountCol}{lastRow}),0)`,
        },
      ],
    };

    const scopeName = (await customerNameById(input.customerId)) ?? null;
    const filterDesc = describeFilters([
      ["customer", input.customerId],
      ["status", input.status],
    ]);

    return buildAndPersist({
      ctx,
      toolName: "export_properties",
      entityType: "properties",
      scopeName,
      format: input.format as "xlsx" | "pdf",
      filenameOverride: input.filename,
      title: "Properties",
      filterDesc,
      columns,
      rows: data,
      summary,
    });
  },
};

// ────────────────────────────────────────────────────────────────────
// 5. export_payroll_deductions
// ────────────────────────────────────────────────────────────────────

export const exportPayrollDeductionsTool: ToolDef = {
  name: "export_payroll_deductions",
  kind: "read",
  description:
    "Export payroll deductions to Excel or PDF. Filters: customerId, propertyId, occupantId, payWeekEndDate, unmatched (boolean).",
  input_schema: obj(
    {
      format: FormatField,
      filename: StrOpt,
      customerId: StrOpt,
      propertyId: StrOpt,
      occupantId: StrOpt,
      payWeekEndDate: StrOpt,
      unmatched: BoolOpt,
    },
    ["format"],
  ),
  summarize: (i) => `Exporting payroll deductions to ${i.format}`,
  execute: async (input, ctx) => {
    const conds: any[] = [];
    if (input.occupantId) conds.push(eq(payrollDeductionsTable.occupantId, input.occupantId));
    if (input.propertyId) conds.push(eq(payrollDeductionsTable.propertyId, input.propertyId));
    if (input.customerId) conds.push(eq(payrollDeductionsTable.customerId, input.customerId));
    if (input.payWeekEndDate)
      conds.push(eq(payrollDeductionsTable.payWeekEndDate, input.payWeekEndDate));
    let rows = conds.length
      ? await db.select().from(payrollDeductionsTable).where(and(...conds))
      : await db.select().from(payrollDeductionsTable);

    const occIdSet = new Set(
      (await db.select({ id: occupantsTable.id }).from(occupantsTable)).map((o) => o.id),
    );
    if (input.unmatched) {
      rows = rows.filter((r) => !r.occupantId || !occIdSet.has(r.occupantId));
    }

    const propMap = await loadPropertyMap(rows.map((r) => r.propertyId).filter(Boolean));
    const data = rows.map((r) => ({
      deductionId: r.id,
      payWeek: r.payWeekEndDate,
      occupant: r.nameSnapshot || r.occupantId,
      property: r.propertyId ? propMap.get(r.propertyId)?.name ?? r.propertyId : "",
      amount: r.weeklyAmount,
      matched: r.occupantId && occIdSet.has(r.occupantId) ? "Yes" : "No",
      sourceFile: r.source,
      notes: "",
    }));

    const idCol = colLetter(0);
    const matchedCol = colLetter(5);
    const amtCol = colLetter(4);
    const columns: ExportColumn[] = [
      { key: "deductionId", header: "Deduction ID", priority: 3 },
      { key: "payWeek", header: "Pay Week", format: "date" },
      { key: "occupant", header: "Occupant" },
      { key: "property", header: "Property" },
      { key: "amount", header: "Amount", format: "currency" },
      { key: "matched", header: "Matched" },
      { key: "sourceFile", header: "Source File", priority: 4 },
      { key: "notes", header: "Notes", priority: 5 },
    ];
    const summary: SummarySheet = {
      name: "Totals",
      rows: [
        { label: "Total rows", formula: `COUNTA(Data!${idCol}5:${idCol}{lastRow})` },
        { label: "Matched", formula: `COUNTIF(Data!${matchedCol}5:${matchedCol}{lastRow},"Yes")` },
        { label: "Unmatched", formula: `COUNTIF(Data!${matchedCol}5:${matchedCol}{lastRow},"No")` },
        { label: "Total $ deducted", formula: `SUM(Data!${amtCol}5:${amtCol}{lastRow})` },
        {
          label: "Total $ unmatched",
          formula: `SUMIF(Data!${matchedCol}5:${matchedCol}{lastRow},"No",Data!${amtCol}5:${amtCol}{lastRow})`,
        },
      ],
    };

    const scopeName =
      (await propertyNameById(input.propertyId)) ??
      (await customerNameById(input.customerId)) ??
      null;
    const filterDesc = describeFilters([
      ["customer", input.customerId],
      ["property", input.propertyId],
      ["occupant", input.occupantId],
      ["payWeekEndDate", input.payWeekEndDate],
      ["unmatched", input.unmatched],
    ]);

    return buildAndPersist({
      ctx,
      toolName: "export_payroll_deductions",
      entityType: "payroll-deductions",
      scopeName,
      format: input.format as "xlsx" | "pdf",
      filenameOverride: input.filename,
      title: "Payroll Deductions",
      filterDesc,
      columns,
      rows: data,
      summary,
    });
  },
};

// ────────────────────────────────────────────────────────────────────
// 6. export_utilities
// ────────────────────────────────────────────────────────────────────

export const exportUtilitiesTool: ToolDef = {
  name: "export_utilities",
  kind: "read",
  description: "Export utility accounts to Excel or PDF. Filters: customerId, propertyId.",
  input_schema: obj(
    { format: FormatField, filename: StrOpt, customerId: StrOpt, propertyId: StrOpt },
    ["format"],
  ),
  summarize: (i) => `Exporting utilities to ${i.format}`,
  execute: async (input, ctx) => {
    let rows = input.propertyId
      ? await db.select().from(utilitiesTable).where(eq(utilitiesTable.propertyId, input.propertyId))
      : await db.select().from(utilitiesTable);
    if (input.customerId) {
      const props = await db
        .select({ id: propertiesTable.id })
        .from(propertiesTable)
        .where(eq(propertiesTable.customerId, input.customerId));
      const ids = new Set(props.map((p) => p.id));
      rows = rows.filter((u) => ids.has(u.propertyId));
    }
    const propMap = await loadPropertyMap(rows.map((u) => u.propertyId));
    const data = rows.map((u) => ({
      utilityId: u.id,
      property: propMap.get(u.propertyId)?.name ?? u.propertyId,
      type: u.type,
      company: u.company,
      monthlyCost: u.monthlyCost,
      accountNumber: u.accountNumber,
      notes: u.notes,
    }));

    const idCol = colLetter(0);
    const propCol = colLetter(1);
    const costCol = colLetter(4);
    const columns: ExportColumn[] = [
      { key: "utilityId", header: "Utility ID", priority: 3 },
      { key: "property", header: "Property" },
      { key: "type", header: "Type" },
      { key: "company", header: "Company" },
      { key: "monthlyCost", header: "Monthly Cost", format: "currency" },
      { key: "accountNumber", header: "Account #", priority: 2 },
      { key: "notes", header: "Notes", priority: 4 },
    ];
    const summary: SummarySheet = {
      name: "Totals",
      rows: [
        { label: "Total utilities", formula: `COUNTA(Data!${idCol}5:${idCol}{lastRow})` },
        { label: "Total monthly cost", formula: `SUM(Data!${costCol}5:${costCol}{lastRow})` },
        {
          label: "Avg per property",
          formula: `IFERROR(SUM(Data!${costCol}5:${costCol}{lastRow})/SUMPRODUCT(1/COUNTIF(Data!${propCol}5:${propCol}{lastRow},Data!${propCol}5:${propCol}{lastRow})),0)`,
        },
      ],
    };

    const scopeName =
      (await propertyNameById(input.propertyId)) ??
      (await customerNameById(input.customerId)) ??
      null;
    const filterDesc = describeFilters([
      ["customer", input.customerId],
      ["property", input.propertyId],
    ]);

    return buildAndPersist({
      ctx,
      toolName: "export_utilities",
      entityType: "utilities",
      scopeName,
      format: input.format as "xlsx" | "pdf",
      filenameOverride: input.filename,
      title: "Utilities",
      filterDesc,
      columns,
      rows: data,
      summary,
    });
  },
};

// ────────────────────────────────────────────────────────────────────
// 7. export_insurance_certificates
// ────────────────────────────────────────────────────────────────────

export const exportInsuranceCertificatesTool: ToolDef = {
  name: "export_insurance_certificates",
  kind: "read",
  description:
    "Export insurance certificates to Excel or PDF. Filters: customerId, propertyId, expiringWithinDays.",
  input_schema: obj(
    {
      format: FormatField,
      filename: StrOpt,
      customerId: StrOpt,
      propertyId: StrOpt,
      expiringWithinDays: NumOpt,
    },
    ["format"],
  ),
  summarize: (i) => `Exporting insurance certificates to ${i.format}`,
  execute: async (input, ctx) => {
    let rows = input.propertyId
      ? await db
          .select()
          .from(insuranceCertificatesTable)
          .where(eq(insuranceCertificatesTable.propertyId, input.propertyId))
      : await db.select().from(insuranceCertificatesTable);
    if (input.customerId) {
      const props = await db
        .select({ id: propertiesTable.id })
        .from(propertiesTable)
        .where(eq(propertiesTable.customerId, input.customerId));
      const ids = new Set(props.map((p) => p.id));
      rows = rows.filter((c) => ids.has(c.propertyId));
    }
    if (typeof input.expiringWithinDays === "number" && input.expiringWithinDays >= 0) {
      const today = todayYmd();
      const horizon = new Date(Date.now() + input.expiringWithinDays * 86400000)
        .toISOString()
        .slice(0, 10);
      rows = rows.filter((c) => c.coverageEnd && c.coverageEnd >= today && c.coverageEnd <= horizon);
    }

    const propMap = await loadPropertyMap(rows.map((c) => c.propertyId));
    const data = rows.map((c) => ({
      certId: c.id,
      property: propMap.get(c.propertyId)?.name ?? c.propertyId,
      carrier: c.carrier,
      policyNumber: c.policyNumber,
      coverageStart: c.coverageStart,
      coverageEnd: c.coverageEnd,
    }));

    const endCol = colLetter(5); // F
    const idCol = colLetter(0);
    const daysCol = colLetter(6);
    const columns: ExportColumn[] = [
      { key: "certId", header: "Cert ID", priority: 3 },
      { key: "property", header: "Property" },
      { key: "carrier", header: "Carrier" },
      { key: "policyNumber", header: "Policy #" },
      { key: "coverageStart", header: "Coverage Start", format: "date", priority: 2 },
      { key: "coverageEnd", header: "Coverage End", format: "date" },
      {
        key: "daysToExpiry",
        header: "Days to Expiry",
        format: "int",
        formula: (r) => `IF(${endCol}${r}<>"",${endCol}${r}-TODAY(),"")`,
        compute: (row) => safeDays(row.coverageEnd as string),
      },
    ];
    const summary: SummarySheet = {
      name: "Totals",
      rows: [
        { label: "Total certs", formula: `COUNTA(Data!${idCol}5:${idCol}{lastRow})` },
        {
          label: "Expiring next 30d",
          formula: `COUNTIFS(Data!${daysCol}5:${daysCol}{lastRow},">=0",Data!${daysCol}5:${daysCol}{lastRow},"<=30")`,
        },
        {
          label: "Expiring next 7d",
          formula: `COUNTIFS(Data!${daysCol}5:${daysCol}{lastRow},">=0",Data!${daysCol}5:${daysCol}{lastRow},"<=7")`,
        },
      ],
    };

    const scopeName =
      (await propertyNameById(input.propertyId)) ??
      (await customerNameById(input.customerId)) ??
      null;
    const filterDesc = describeFilters([
      ["customer", input.customerId],
      ["property", input.propertyId],
      ["expiringWithinDays", input.expiringWithinDays],
    ]);

    return buildAndPersist({
      ctx,
      toolName: "export_insurance_certificates",
      entityType: "insurance-certificates",
      scopeName,
      format: input.format as "xlsx" | "pdf",
      filenameOverride: input.filename,
      title: "Insurance Certificates",
      filterDesc,
      columns,
      rows: data,
      summary,
    });
  },
};

// ────────────────────────────────────────────────────────────────────
// 8. export_room_nights
// ────────────────────────────────────────────────────────────────────

export const exportRoomNightsTool: ToolDef = {
  name: "export_room_nights",
  kind: "read",
  description:
    "Export room-night logs (hotel-rate lease usage) to Excel or PDF. Filters: leaseId, propertyId, month (exact YYYY-MM), monthFrom, monthTo.",
  input_schema: obj(
    {
      format: FormatField,
      filename: StrOpt,
      leaseId: StrOpt,
      propertyId: StrOpt,
      month: StrOpt,
      monthFrom: StrOpt,
      monthTo: StrOpt,
    },
    ["format"],
  ),
  summarize: (i) => `Exporting room-nights to ${i.format}`,
  execute: async (input, ctx) => {
    let rows = input.leaseId
      ? await db
          .select()
          .from(roomNightLogsTable)
          .where(eq(roomNightLogsTable.leaseId, input.leaseId))
      : await db.select().from(roomNightLogsTable);
    if (input.month) rows = rows.filter((r) => r.month === input.month);
    if (input.monthFrom) rows = rows.filter((r) => r.month >= input.monthFrom);
    if (input.monthTo) rows = rows.filter((r) => r.month <= input.monthTo);

    const leaseIds = Array.from(new Set(rows.map((r) => r.leaseId)));
    const leases = leaseIds.length
      ? await db
          .select({
            id: leasesTable.id,
            propertyId: leasesTable.propertyId,
            nightlyRate: leasesTable.nightlyRate,
          })
          .from(leasesTable)
          .where(inArray(leasesTable.id, leaseIds))
      : [];
    const leaseMap = new Map(leases.map((l) => [l.id, l]));
    const propMap = await loadPropertyMap(leases.map((l) => l.propertyId));

    if (input.propertyId) {
      rows = rows.filter((r) => leaseMap.get(r.leaseId)?.propertyId === input.propertyId);
    }

    const data = rows.map((r) => {
      const l = leaseMap.get(r.leaseId);
      return {
        logId: r.id,
        lease: r.leaseId,
        property: l ? propMap.get(l.propertyId)?.name ?? l.propertyId : "",
        month: r.month,
        roomNights: r.roomNights,
        rate: l?.nightlyRate ?? 0,
      };
    });

    // Total column = roomNights * rate => columns E * F (idx 4 * 5)
    const nightsCol = colLetter(4);
    const rateCol = colLetter(5);
    const totalCol = colLetter(6);
    const idCol = colLetter(0);
    const columns: ExportColumn[] = [
      { key: "logId", header: "Log ID", priority: 3 },
      { key: "lease", header: "Lease" },
      { key: "property", header: "Property" },
      { key: "month", header: "Month" },
      { key: "roomNights", header: "Room Nights", format: "int" },
      { key: "rate", header: "Rate", format: "currency" },
      {
        key: "total",
        header: "Total",
        format: "currency",
        formula: (r) => `${nightsCol}${r}*${rateCol}${r}`,
        compute: (row) => (Number(row.roomNights) || 0) * (Number(row.rate) || 0),
      },
    ];
    const summary: SummarySheet = {
      name: "Totals",
      rows: [
        { label: "Total room-nights", formula: `SUM(Data!${nightsCol}5:${nightsCol}{lastRow})` },
        { label: "Total $ billed", formula: `SUM(Data!${totalCol}5:${totalCol}{lastRow})` },
        { label: "Log rows", formula: `COUNTA(Data!${idCol}5:${idCol}{lastRow})` },
      ],
    };

    const scopeName = (await propertyNameById(input.propertyId)) ?? null;
    const filterDesc = describeFilters([
      ["lease", input.leaseId],
      ["property", input.propertyId],
      ["month", input.month],
      ["monthFrom", input.monthFrom],
      ["monthTo", input.monthTo],
    ]);

    return buildAndPersist({
      ctx,
      toolName: "export_room_nights",
      entityType: "room-nights",
      scopeName,
      format: input.format as "xlsx" | "pdf",
      filenameOverride: input.filename,
      title: "Room Nights",
      filterDesc,
      columns,
      rows: data,
      summary,
    });
  },
};

export const allExportTools: ToolDef[] = [
  exportLeasesTool,
  exportOccupantsTool,
  exportBedsTool,
  exportPropertiesTool,
  exportPayrollDeductionsTool,
  exportUtilitiesTool,
  exportInsuranceCertificatesTool,
  exportRoomNightsTool,
];
