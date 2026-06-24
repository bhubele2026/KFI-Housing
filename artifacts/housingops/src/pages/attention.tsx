import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, DataTable, Badge, EmptyState, type Column } from "@/components/kit-v2";
import { formatUsdWhole } from "@/data/mockData";

interface AttentionRow {
  kind: string;
  label: string;
  dollarsAtRisk: number;
  fixHref: string;
}
interface AttentionResp {
  rows: AttentionRow[];
  totalAtRisk: number;
}

/** Leak kinds the server emits → badge tone (Badge only does ok/risk/grey). */
const TONE: Record<string, "ok" | "risk" | "grey"> = {
  zero_charge: "risk",
  former_charged: "risk",
  not_in_payroll: "grey",
  rent_no_occupants: "grey",
  occupants_no_rent: "grey",
};

/**
 * Needs-attention inbox (refinement #1) — every money leak in one ranked list,
 * each with a one-click "Fix →". Fed by GET /api/attention.
 */
export default function Attention() {
  const [, navigate] = useLocation();
  const q = useQuery({
    queryKey: ["attention"],
    queryFn: async () => {
      const base = import.meta.env.BASE_URL ?? "/";
      const r = await fetch(`${base}api/attention`);
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as AttentionResp;
    },
    retry: false,
  });

  const rows = [...(q.data?.rows ?? [])].sort(
    (a, b) => (Number(b.dollarsAtRisk) || 0) - (Number(a.dollarsAtRisk) || 0),
  );
  const total = Number(q.data?.totalAtRisk) || 0;

  const columns: Column<AttentionRow>[] = [
    { header: "Issue", cell: (r) => <span className="font-medium text-ink">{r.label}</span> },
    {
      header: "Type",
      align: "left",
      cell: (r) => <Badge kind={TONE[r.kind] ?? "grey"}>{(r.kind || "").replace(/_/g, " ") || "issue"}</Badge>,
    },
    {
      header: "$ /mo at risk",
      align: "right",
      cell: (r) => <span className="font-bold tabular-nums text-risk">{formatUsdWhole(Number(r.dollarsAtRisk) || 0)}</span>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <span className="cursor-pointer font-semibold text-brand" onClick={(e) => { e.stopPropagation(); navigate(r.fixHref || "/"); }}>
          Fix →
        </span>
      ),
    },
  ];

  return (
    <MainLayout>
      <div className="mx-auto max-w-[1180px] px-6 pb-10 pt-2">
        <div className="mb-4">
          <h1 className="text-[21px] tracking-[-.3px]">Needs attention</h1>
          <div className="mt-1 text-[13px] text-muted-foreground">
            Every money leak in one place, biggest dollars first
            {total > 0 && (
              <> · <span className="font-bold tabular-nums text-risk">{formatUsdWhole(total)}/mo</span> at risk</>
            )}
          </div>
        </div>
        <Card>
          {q.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-9 animate-pulse rounded-md bg-track" />)}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState title="All clear" hint="No money leaks right now — every housed person is being recovered." />
          ) : (
            <DataTable
              columns={columns}
              rows={rows}
              getKey={(r, i) => `${r.kind}-${i}`}
              onRowClick={(r) => navigate(r.fixHref || "/")}
            />
          )}
        </Card>
      </div>
    </MainLayout>
  );
}
