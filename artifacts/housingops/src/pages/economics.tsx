import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { useData } from "@/context/data-store";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { TrendingDown, BedDouble, DollarSign, AlertTriangle } from "lucide-react";
import { computePropertyEconomics } from "@/lib/property-economics";

const usd = (n: number | null | undefined) =>
  n == null
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Inline editable bed count — commits on blur / Enter so the per-bed math updates. */
function BedInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value || ""));
  return (
    <Input
      type="number"
      min={0}
      value={draft}
      placeholder="set"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = Math.max(0, Math.floor(Number(draft) || 0));
        if (n !== value) onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="h-8 w-16 text-right"
      data-testid={`beds-input`}
    />
  );
}

export default function EconomicsPage() {
  const { properties, leases, occupants, utilities = [], customers, updateProperty, isLoading } = useData();

  const customerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers) m.set(c.id, c.name);
    return m;
  }, [customers]);

  const { rows, summary } = useMemo(
    () => computePropertyEconomics(properties, leases, occupants, utilities),
    [properties, leases, occupants, utilities],
  );

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="Per-Bed Economics"
          description="What each property costs, what you should charge per bed, and where you're losing money to empty beds or undercharging."
        />

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
                <TrendingDown className="h-4 w-4 text-red-600" /> Monthly loss
              </div>
              <div className="mt-1 text-2xl font-bold text-red-600">{usd(summary.totalMonthlyLoss)}</div>
              <div className="text-xs text-muted-foreground">{summary.propertiesLosing} properties bleeding</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
                <BedDouble className="h-4 w-4" /> Vacant beds
              </div>
              <div className="mt-1 text-2xl font-bold">{summary.totalVacant}</div>
              <div className="text-xs text-muted-foreground">of {summary.totalBeds} total beds</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
                <DollarSign className="h-4 w-4" /> Cost / Recovery
              </div>
              <div className="mt-1 text-2xl font-bold">{usd(summary.totalMonthlyCost)}</div>
              <div className="text-xs text-muted-foreground">collecting {usd(summary.totalRecovery)}/mo</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
                <AlertTriangle className="h-4 w-4 text-amber-600" /> Beds unknown
              </div>
              <div className="mt-1 text-2xl font-bold">{summary.bedsUnknownCount}</div>
              <div className="text-xs text-muted-foreground">set bed counts to score them</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead className="text-right">Cost/mo</TableHead>
                  <TableHead className="text-center">Beds</TableHead>
                  <TableHead className="text-center">Occ</TableHead>
                  <TableHead className="text-center">Vacant</TableHead>
                  <TableHead className="text-right">Should charge/bed</TableHead>
                  <TableHead className="text-right">Now charging/bed</TableHead>
                  <TableHead className="text-right">Vacancy loss</TableHead>
                  <TableHead className="text-right">Undercharge loss</TableHead>
                  <TableHead className="text-right">Monthly loss</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && rows.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No properties yet.</TableCell></TableRow>
                ) : (
                  rows.map((r) => {
                    const undercharged =
                      r.recommendedPerBed != null &&
                      r.avgChargePerBed != null &&
                      r.avgChargePerBed < r.recommendedPerBed;
                    return (
                      <TableRow key={r.propertyId} className={r.monthlyLoss > 0 ? "bg-red-50/40 dark:bg-red-950/10" : undefined}>
                        <TableCell>
                          <div className="font-medium">{r.name}</div>
                          <div className="text-xs text-muted-foreground">{customerName.get(r.customerId) ?? ""}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{usd(r.monthlyCost)}</TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <BedInput value={r.beds} onCommit={(n) => updateProperty(r.propertyId, { totalBeds: n })} />
                            {!r.bedsKnown && <span className="text-[10px] text-amber-600">unknown</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-center tabular-nums">{r.occupied}</TableCell>
                        <TableCell className="text-center tabular-nums">
                          {r.bedsKnown ? (
                            r.vacant > 0 ? <span className="font-semibold text-amber-700">{r.vacant}</span> : 0
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{usd(r.recommendedPerBed)}</TableCell>
                        <TableCell className={"text-right tabular-nums " + (undercharged ? "text-red-600 font-medium" : "")}>
                          {r.avgChargePerBed != null ? usd(r.avgChargePerBed) : <span className="text-muted-foreground">—</span>}
                          {r.chargeDataMissing && <span className="ml-1 text-[10px] text-amber-600">partial</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.vacancyLoss > 0 ? usd(r.vacancyLoss) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.underchargeLoss > 0 ? usd(r.underchargeLoss) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums font-bold text-red-600">{r.monthlyLoss > 0 ? usd(r.monthlyLoss) : "—"}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          "Should charge/bed" = monthly cost ÷ beds (break-even). Vacancy loss = empty beds × that number.
          Undercharge loss = occupied beds charged below it. Set a bed count on any "unknown" row to score it.
          Charges shown are normalized to monthly; "partial" means some occupants have no charge on file yet.
        </p>
      </div>
    </MainLayout>
  );
}
