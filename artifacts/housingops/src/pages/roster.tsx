import { useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowUpDown, ArrowUp, ArrowDown, Search } from "lucide-react";
import { useListActiveRoster } from "@workspace/api-client-react";
import { useData } from "@/context/data-store";
import {
  Card,
  CardHead,
  DataTable,
  Pill,
  Seg,
  EmptyState,
  WhyPopover,
  type Column,
} from "@/components/kit-v2";

/**
 * Roster — the FULL active Zenople roster (everyone paid on the last run, ~513),
 * annotated placed (in a bed) vs unplaced, with their housing deduction. Fixes
 * the old "89" (which only counted people already in a bed).
 *
 * Phase 15: searchable, sortable, grouped, fully clickable. Two rules hold —
 * every number explains itself (WhyPopover), and unplaced people route to where
 * you place them.
 */
type Filter = "all" | "placed" | "unplaced" | "zeroded";
type SortKey = "name" | "company" | "placement" | "weekly" | "payroll";
type SortDir = "asc" | "desc";

type RosterPerson = {
  personId: string;
  name: string;
  company?: string;
  jobTitle?: string;
  weeklyDeduction?: number;
  hasDeduction?: boolean;
};

type Row = {
  personId: string;
  name: string;
  company: string;
  customerId?: string;
  occId?: string;
  propertyId?: string;
  /** Property to send an UNPLACED person to so they can be seated (their
   *  occupant's property even though they hold no bed yet). */
  assignPropertyId?: string;
  placedProp: string;
  placed: boolean;
  weekly: number;
  pillKind: "ok" | "risk" | "grey";
  pillLabel: string;
};

function shortProp(name: string): string {
  return (name || "").split(/[–\-·]/)[0].trim() || name || "—";
}
const normName = (s: string): string => (s || "").trim().toLowerCase();

export default function RosterPage() {
  const [, navigate] = useLocation();
  // Deep-link support — the customer-detail "$0 deduction" / "Not in payroll"
  // stat cards link here with ?client=<name>&filter=<...>; honor those so the
  // roster opens already scoped to the people behind the number.
  const qs = new URLSearchParams(useSearch());
  const initialClient = qs.get("client") || "all";
  const rawFilter = qs.get("filter");
  const initialFilter: Filter =
    rawFilter === "zero-deduction" || rawFilter === "zeroded"
      ? "zeroded"
      : rawFilter === "placed" || rawFilter === "unplaced"
      ? rawFilter
      : rawFilter === "not-in-payroll"
      ? "unplaced"
      : "all";
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [search, setSearch] = useState("");
  const [client, setClient] = useState(initialClient);
  const [sortKey, setSortKey] = useState<SortKey>("placement");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Full Zenople active roster (cast-safe — shape comes from the direct API).
  const rosterQuery = useListActiveRoster();
  const people = ((rosterQuery.data as unknown as { people?: RosterPerson[] })
    ?.people ?? []) as RosterPerson[];
  const loading = rosterQuery.isLoading;

  // App occupants/properties/customers to resolve placement + link targets.
  const data = useData() as unknown as {
    occupants: Array<Record<string, unknown>>;
    properties: Array<{ id: string; name: string; customerId?: string }>;
    customers: Array<{ id: string; name: string }>;
  };
  const occupants = data.occupants ?? [];
  const properties = data.properties ?? [];
  const customers = data.customers ?? [];

  const propMeta = useMemo(() => {
    const m = new Map<string, { name: string; customerId?: string }>();
    for (const p of properties) m.set(p.id, { name: shortProp(p.name), customerId: p.customerId });
    return m;
  }, [properties]);

  // Resolve a roster person's staffing client (company string) to a customer id
  // for the client link.
  const customerByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers) m.set(normName(c.name), c.id);
    return m;
  }, [customers]);

  // employeeId(personId) -> the occupant record, preferring a bed-placed one.
  const occByEmp = useMemo(() => {
    const m = new Map<string, { id: string; propertyId: string; bedId: string }>();
    for (const o of occupants) {
      if ((o.status as string) === "Former") continue;
      const emp = (o.employeeId as string) || "";
      if (!emp) continue;
      const bedId = (o.bedId as string) || "";
      const prev = m.get(emp);
      if (!prev || (bedId && !prev.bedId)) {
        m.set(emp, {
          id: o.id as string,
          propertyId: (o.propertyId as string) || "",
          bedId,
        });
      }
    }
    return m;
  }, [occupants]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const p of people) {
      const match = occByEmp.get(p.personId);
      const placed = !!(match && match.bedId);
      const meta = match ? propMeta.get(match.propertyId) : undefined;
      const placedProp = placed ? meta?.name || "—" : "";
      const weekly = Number(p.weeklyDeduction ?? 0) || 0;
      let pillKind: Row["pillKind"];
      let pillLabel: string;
      if (weekly > 0) {
        pillKind = "ok";
        pillLabel = "Deducted";
      } else if (placed) {
        pillKind = "risk";
        pillLabel = "No deduction";
      } else {
        pillKind = "grey";
        pillLabel = "No deduction";
      }
      out.push({
        personId: p.personId,
        name: p.name || "—",
        company: p.company || "—",
        customerId: customerByName.get(normName(p.company || "")),
        occId: match?.id,
        propertyId: placed ? match?.propertyId : undefined,
        assignPropertyId: match?.propertyId || undefined,
        placedProp,
        placed,
        weekly,
        pillKind,
        pillLabel,
      });
    }
    return out;
  }, [people, occByEmp, propMeta, customerByName]);

  const placedCount = rows.filter((r) => r.placed).length;
  const unplacedCount = rows.length - placedCount;

  // Distinct clients for the filter dropdown.
  const clientOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.company && r.company !== "—") s.add(r.company);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = normName(search);
    let list = rows.filter((r) => {
      if (filter === "placed" && !r.placed) return false;
      if (filter === "unplaced" && r.placed) return false;
      if (filter === "zeroded" && r.weekly !== 0) return false;
      if (client !== "all" && r.company !== client) return false;
      if (q) {
        const hay = `${r.name} ${r.company} ${r.placedProp}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return dir * a.name.localeCompare(b.name);
        case "company":
          return dir * a.company.localeCompare(b.company);
        case "weekly":
          return dir * (a.weekly - b.weekly);
        case "payroll":
          return dir * (a.weekly - b.weekly || a.name.localeCompare(b.name));
        case "placement":
        default:
          // Placed first (or last when desc), then property name, then name.
          return (
            dir * (Number(b.placed) - Number(a.placed)) ||
            a.placedProp.localeCompare(b.placedProp) ||
            a.name.localeCompare(b.name)
          );
      }
    });
    return list;
  }, [rows, filter, client, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // A sortable header button (kept as a header ReactNode so DataTable stays generic).
  const SortHead = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      type="button"
      onClick={() => toggleSort(k)}
      className="inline-flex items-center gap-1 uppercase tracking-[0.5px] text-faint hover:text-ink"
    >
      {label}
      {sortKey === k ? (
        sortDir === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );

  // Inner links must not also fire the row navigation.
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  // Where an UNPLACED person's "assign" affordance lands: their property's bed
  // board (the BedBoardV2 assign picker lives there), else their client, else
  // the properties list as a last resort.
  const assignHref = (r: Row): string =>
    r.assignPropertyId
      ? `/properties/${r.assignPropertyId}`
      : r.customerId
        ? `/customers/${r.customerId}`
        : "/properties";

  const columns: Column<Row>[] = [
    {
      header: <SortHead k="name" label="Associate" />,
      align: "left",
      cell: (r) => <span className="font-medium text-ink">{r.name}</span>,
    },
    {
      header: <SortHead k="company" label="Client" />,
      align: "left",
      cell: (r) =>
        r.customerId ? (
          <Link
            href={`/customers/${r.customerId}`}
            onClick={stop}
            className="text-brand hover:underline"
          >
            {r.company}
          </Link>
        ) : (
          <span className="text-muted-foreground">{r.company}</span>
        ),
    },
    {
      header: <SortHead k="placement" label="Placement" />,
      align: "left",
      cell: (r) =>
        r.placed && r.propertyId ? (
          <Link
            href={`/properties/${r.propertyId}`}
            onClick={stop}
            className="text-ink hover:text-brand hover:underline"
          >
            {r.placedProp}
          </Link>
        ) : (
          <Link
            href={assignHref(r)}
            onClick={stop}
            className="font-medium text-warn hover:underline"
          >
            Unplaced · assign →
          </Link>
        ),
    },
    {
      header: <SortHead k="weekly" label="Weekly rent" />,
      cell: (r) =>
        r.weekly > 0 ? (
          <span className="tabular-nums">${r.weekly.toFixed(2)}</span>
        ) : (
          <span className="font-bold tabular-nums text-risk">$0.00</span>
        ),
    },
    {
      header: <SortHead k="payroll" label="Payroll" />,
      cell: (r) => <Pill kind={r.pillKind}>{r.pillLabel}</Pill>,
    },
  ];

  return (
    <div className="mx-auto max-w-[1120px] px-6 py-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight text-ink">Roster</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <WhyPopover
              title="Roster"
              formula="Active people paid on the last Zenople payroll run"
              rows={[
                { k: "On payroll", v: rows.length },
                { k: "Placed in a bed", v: placedCount },
                { k: "Unplaced", v: unplacedCount },
              ]}
            >
              <span className="font-semibold tabular-nums text-ink">{placedCount}</span> of{" "}
              <span className="tabular-nums">{rows.length}</span> placed
            </WhyPopover>{" "}
            · <span className="tabular-nums text-warn">{unplacedCount}</span> unplaced · pulled from
            Zenople
          </p>
        </div>
        {unplacedCount > 0 ? (
          <Link
            href="/properties"
            className="rounded-lg bg-brand px-3 py-2 text-[13px] font-semibold text-white hover:opacity-90"
          >
            Place the unplaced →
          </Link>
        ) : null}
      </div>

      <Card>
        <CardHead
          label="Active roster"
          link={
            <Seg<Filter>
              options={[
                { value: "all", label: "All" },
                { value: "placed", label: "Placed" },
                { value: "unplaced", label: "Unplaced" },
                { value: "zeroded", label: "$0 deduction" },
              ]}
              value={filter}
              onChange={setFilter}
            />
          }
        />

        {/* Search + client group filter */}
        <div className="flex flex-wrap items-center gap-2 px-3.5 pb-3 pt-1">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, client, or property…"
              className="w-full rounded-lg border border-line bg-panel py-2 pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-faint focus:border-brand"
            />
          </div>
          <select
            value={client}
            onChange={(e) => setClient(e.target.value)}
            className="rounded-lg border border-line bg-panel px-2.5 py-2 text-[13px] text-ink outline-none focus:border-brand"
          >
            <option value="all">All clients</option>
            {clientOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span className="ml-auto text-[12px] tabular-nums text-faint">
            {filtered.length} of {rows.length}
          </span>
        </div>

        <DataTable
          columns={columns}
          rows={filtered}
          getKey={(r) => r.personId}
          onRowClick={(r) =>
            r.placed && r.occId
              ? navigate(`/occupants/${r.occId}`)
              : navigate(assignHref(r))
          }
          empty={
            <EmptyState
              title={
                loading
                  ? "Loading the roster…"
                  : search || client !== "all" || filter !== "all"
                    ? "No associates match these filters"
                    : "No associates on the last payroll run"
              }
              hint={
                !loading && (search || client !== "all" || filter !== "all")
                  ? "Clear the search or filters to see everyone."
                  : undefined
              }
            />
          }
          testId="roster-table"
        />
      </Card>
    </div>
  );
}
