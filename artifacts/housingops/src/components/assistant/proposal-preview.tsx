import type { ReactNode } from "react";

// Task #672: per-tool typed renderer for proposal previews.
// The assistant bubble used to JSON-stringify whatever the server's
// `preview:` callback returned. The shapes are tool-specific and
// already known, so we render them as readable tables / headers here
// and only fall back to a collapsed JSON dump for unknown tools.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Recursively drop keys that are server-side internal flags:
//   - any key ending in "Missing" (e.g. `monthlyCostMissing`)
//   - any key starting with "_" (private/internal)
// Applied before the renderer reads the object, so nested
// before/after diff cells are clean too.
export function stripInternalFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripInternalFields(v)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith("_")) continue;
      if (k.endsWith("Missing")) continue;
      out[k] = stripInternalFields(v);
    }
    return out as unknown as T;
  }
  return value;
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-left text-muted-foreground">
            {headers.map((h) => (
              <th key={h} className="border-b border-border/60 py-0.5 pr-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="align-top">
              {cells.map((c, j) => (
                <td key={j} className="border-b border-border/30 py-0.5 pr-2 break-words">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Header({ children }: { children: ReactNode }) {
  return <div className="font-medium">{children}</div>;
}

function RawFallback({ data }: { data: unknown }) {
  return (
    <details>
      <summary className="cursor-pointer text-muted-foreground">
        Show raw preview
      </summary>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-[11px]">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}

function renderBulkCreateUtilities(p: Record<string, unknown>): ReactNode {
  const propertyId = formatCell(p.propertyId);
  const count = typeof p.count === "number" ? p.count : 0;
  const items = Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : [];
  const rows = items.map((it) => [
    formatCell(it.type),
    formatCell(it.company),
    formatCell(it.monthlyCost),
    formatCell(it.notes),
  ]);
  return (
    <div className="space-y-1">
      <Header>
        Add {count} utilit{count === 1 ? "y" : "ies"} to {propertyId}
      </Header>
      {rows.length > 0 && (
        <Table headers={["Type", "Company", "Monthly Cost", "Notes"]} rows={rows} />
      )}
    </div>
  );
}

function renderBulkCreateBeds(p: Record<string, unknown>): ReactNode {
  const roomId = formatCell(p.roomId);
  const count = typeof p.count === "number" ? p.count : 0;
  const planned = Array.isArray(p.planned) ? (p.planned as Record<string, unknown>[]) : [];
  const list = planned
    .map((b) => (typeof b.bedNumber === "number" ? `Bed #${b.bedNumber}` : null))
    .filter((v): v is string => Boolean(v))
    .join(", ");
  return (
    <div className="space-y-1">
      <Header>
        Add {count} bed{count === 1 ? "" : "s"} to room {roomId}
      </Header>
      {list && <div className="text-muted-foreground">{list}</div>}
    </div>
  );
}

function renderBulkCreateOccupants(p: Record<string, unknown>): ReactNode {
  // The server tool currently has no preview callback for occupants, so
  // in practice this renderer rarely fires today. We still handle the
  // execute-shape `{ occupants: [{id, name, bedId}] }` and the input-
  // shape `{ occupants: [{name, propertyId, company, ...}] }` for
  // forward compatibility.
  const occupants = Array.isArray(p.occupants)
    ? (p.occupants as Record<string, unknown>[])
    : [];
  const rows = occupants.map((o) => [
    formatCell(o.name),
    formatCell(o.company ?? o.propertyId),
    formatCell(o.bedId ?? o.chargePerBed),
  ]);
  return (
    <div className="space-y-1">
      <Header>
        Add {occupants.length} occupant{occupants.length === 1 ? "" : "s"}
      </Header>
      {rows.length > 0 && (
        <Table headers={["Name", "Company / Property", "Bed / Charge"]} rows={rows} />
      )}
    </div>
  );
}

function renderBulkUpdateDiff(
  p: Record<string, unknown>,
  noun: string,
  idHeader: string,
): ReactNode {
  const count = typeof p.count === "number" ? p.count : 0;
  const changes = Array.isArray(p.changes)
    ? (p.changes as Array<{ id?: unknown; before?: unknown; after?: unknown }>)
    : [];
  const rows: ReactNode[][] = [];
  for (const c of changes) {
    const id = formatCell(c.id);
    const before = isPlainObject(c.before) ? c.before : null;
    const after = isPlainObject(c.after) ? c.after : {};
    const fields = Object.keys(after);
    if (fields.length === 0) {
      rows.push([id, <em key="nf" className="text-muted-foreground">(no fields)</em>, "—", "—"]);
      continue;
    }
    for (const field of fields) {
      const afterVal = (after as Record<string, unknown>)[field];
      let beforeCell: ReactNode;
      if (c.before === null) {
        beforeCell = (
          <span className="text-amber-700 dark:text-amber-300">
            (not found — id may be stale)
          </span>
        );
      } else {
        const beforeVal = before ? (before as Record<string, unknown>)[field] : undefined;
        if (beforeVal === afterVal) continue;
        beforeCell = formatCell(beforeVal);
      }
      rows.push([id, field, beforeCell, formatCell(afterVal)]);
    }
  }
  return (
    <div className="space-y-1">
      <Header>
        Update {count} {noun}
        {count === 1 ? "" : "s"}
      </Header>
      {rows.length > 0 && (
        <Table headers={[idHeader, "Field", "Before", "After"]} rows={rows} />
      )}
    </div>
  );
}

function renderImportSummary(p: Record<string, unknown>): ReactNode {
  // Preserve the existing key: value list style used by the previous
  // PreviewBlock for these two tools.
  const entries = Object.entries(p);
  return (
    <ul className="space-y-0.5">
      {entries.map(([k, v]) => (
        <li key={k} className="flex gap-1.5">
          <span className="text-muted-foreground">{k}:</span>
          <span className="break-words">{formatCell(v)}</span>
        </li>
      ))}
    </ul>
  );
}

export function renderPreview(toolName: string, rawPreview: unknown): ReactNode {
  if (rawPreview === null || rawPreview === undefined) return null;
  const preview = stripInternalFields(rawPreview);
  if (!isPlainObject(preview)) {
    return <RawFallback data={preview} />;
  }
  switch (toolName) {
    case "bulk_create_utilities":
      return renderBulkCreateUtilities(preview);
    case "bulk_create_beds":
      return renderBulkCreateBeds(preview);
    case "bulk_create_occupants":
      return renderBulkCreateOccupants(preview);
    case "bulk_update_leases":
      return renderBulkUpdateDiff(preview, "lease", "Lease ID");
    case "bulk_update_beds":
      return renderBulkUpdateDiff(preview, "bed", "Bed ID");
    case "import_master_leases":
    case "import_payroll_deductions":
      return renderImportSummary(preview);
    default:
      return <RawFallback data={preview} />;
  }
}
