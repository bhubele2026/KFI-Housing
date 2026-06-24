import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useData } from "@/context/data-store";
import {
  Card,
  CardHead,
  DataTable,
  Pill,
  Seg,
  EmptyState,
  type Column,
} from "@/components/kit-v2";

/**
 * Roster — v2 (KFI_Housing_Redesign_Mockup_v2 #roster).
 * Everyone housed, annotated with their Zenople payroll-link status + weekly
 * rent deducted. Read-only table; bed management lives on the Beds page.
 */
type Filter = "all" | "notpayroll" | "zeroded";

function shortProp(name: string): string {
  return (
    (name || "").split(/[–\-·]/)[0].trim() || name || "—"
  );
}

type Row = {
  id: string;
  name: string;
  clientProp: string;
  shift: string;
  weekly: number;
  pillKind: "ok" | "risk" | "grey";
  pillLabel: string;
};

export default function RosterPage() {
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<Filter>("all");

  // Cast-safe: deduction/zenopleStatus are surfaced by the API after codegen;
  // read them defensively so the page renders the best value available today.
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

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const o of occupants) {
      if ((o.status as string) === "Former") continue;
      const name = (o.fullName as string) || (o.name as string) || "";
      if (!name) continue;
      const company = (o.company as string) || "";
      const prop = propName.get((o.propertyId as string) || "") || "";
      const clientProp =
        company && prop ? `${company} → ${prop}` : company || prop || "—";
      const ded = o.deduction as { weeklyAmount?: number } | undefined;
      const weekly = ded?.weeklyAmount ?? (o.chargePerBed as number) ?? 0;
      const z = (o.zenopleStatus as string) || "";
      let pillKind: Row["pillKind"];
      let pillLabel: string;
      if (weekly > 0) {
        pillKind = "ok";
        pillLabel = "Linked";
      } else if (z === "linked") {
        pillKind = "risk";
        pillLabel = "Not deducted";
      } else {
        pillKind = "grey";
        pillLabel = "Not in payroll yet";
      }
      out.push({
        id: o.id as string,
        name,
        clientProp,
        shift: (o.shift as string) || "—",
        weekly,
        pillKind,
        pillLabel,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [occupants, propName]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (filter === "notpayroll") return r.pillLabel === "Not in payroll yet";
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
      header: "Client → property",
      align: "left",
      cell: (r) => <span className="text-muted-foreground">{r.clientProp}</span>,
    },
    { header: "Shift", align: "left", cell: (r) => r.shift },
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
          {rows.length} associates housed · pulled from Zenople (active, paid last payroll)
        </p>
      </div>
      <Card>
        <CardHead
          label="Everyone housed"
          link={
            <Seg<Filter>
              options={[
                { value: "all", label: "All" },
                { value: "notpayroll", label: "Not in payroll" },
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
          getKey={(r) => r.id}
          onRowClick={(r) => navigate(`/occupants/${r.id}`)}
          empty={<EmptyState title="No associates match this filter" />}
          testId="roster-table"
        />
      </Card>
    </div>
  );
}
