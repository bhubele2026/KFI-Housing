import { useMemo, useState } from "react";
import { useLocation } from "wouter";
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
 * the old "89" (which only counted people already in a bed). Two rules: every
 * number explains itself (WhyPopover); unplaced people route to where you place
 * them.
 */
type Filter = "all" | "placed" | "unplaced" | "zeroded";

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
  occId?: string;
  placedProp: string;
  placed: boolean;
  weekly: number;
  pillKind: "ok" | "risk" | "grey";
  pillLabel: string;
};

function shortProp(name: string): string {
  return (name || "").split(/[–\-·]/)[0].trim() || name || "—";
}

export default function RosterPage() {
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<Filter>("all");

  // Full Zenople active roster (cast-safe — shape comes from the direct API).
  const rosterQuery = useListActiveRoster();
  const people = ((rosterQuery.data as unknown as { people?: RosterPerson[] })
    ?.people ?? []) as RosterPerson[];
  const loading = rosterQuery.isLoading;

  // App occupants/properties to resolve who's actually placed in a bed.
  const data = useData() as unknown as {
    occupants: Array<Record<string, unknown>>;
    properties: Array<{ id: string; name: string }>;
  };
  const occupants = data.occupants ?? [];
  const properties = data.properties ?? [];

  const propName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of properties) m.set(p.id, shortProp(p.name));
    return m;
  }, [properties]);

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
      const placedProp = placed ? propName.get(match!.propertyId) || "—" : "";
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
        occId: match?.id,
        placedProp,
        placed,
        weekly,
        pillKind,
        pillLabel,
      });
    }
    // Placed first, then alphabetical.
    out.sort((a, b) => Number(b.placed) - Number(a.placed) || a.name.localeCompare(b.name));
    return out;
  }, [people, occByEmp, propName]);

  const placedCount = rows.filter((r) => r.placed).length;

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (filter === "placed") return r.placed;
        if (filter === "unplaced") return !r.placed;
        if (filter === "zeroded") return r.weekly === 0;
        return true;
      }),
    [rows, filter],
  );

  const columns: Column<Row>[] = [
    {
      header: "Associate",
      align: "left",
      cell: (r) => <span className="font-medium text-ink">{r.name}</span>,
    },
    {
      header: "Client",
      align: "left",
      cell: (r) => <span className="text-muted-foreground">{r.company}</span>,
    },
    {
      header: "Placement",
      align: "left",
      cell: (r) =>
        r.placed ? (
          <span className="text-ink">{r.placedProp}</span>
        ) : (
          <span className="font-medium text-warn">Unplaced · assign →</span>
        ),
    },
    {
      header: "Weekly rent",
      cell: (r) =>
        r.weekly > 0 ? (
          `$${r.weekly.toFixed(2)}`
        ) : (
          <span className="font-bold text-risk">$0.00</span>
        ),
    },
    {
      header: "Payroll",
      cell: (r) => <Pill kind={r.pillKind}>{r.pillLabel}</Pill>,
    },
  ];

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-[21px] font-semibold tracking-tight text-ink">Roster</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          <WhyPopover
            title="Roster"
            formula="Active people paid on the last Zenople payroll run"
            rows={[
              { k: "On payroll", v: rows.length },
              { k: "Placed in a bed", v: placedCount },
              { k: "Unplaced", v: rows.length - placedCount },
            ]}
          >
            <span className="font-semibold text-ink">{rows.length}</span> on payroll ·{" "}
            {placedCount} placed
          </WhyPopover>{" "}
          · pulled from Zenople (active, paid last payroll)
        </p>
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
        <DataTable
          columns={columns}
          rows={filtered}
          getKey={(r) => r.personId}
          onRowClick={(r) =>
            r.occId ? navigate(`/occupants/${r.occId}`) : navigate(`/properties`)
          }
          empty={
            <EmptyState
              title={loading ? "Loading the roster…" : "No associates match this filter"}
            />
          }
          testId="roster-table"
        />
      </Card>
    </div>
  );
}
