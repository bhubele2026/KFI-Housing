import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useListPayrollDeductions } from "@workspace/api-client-react";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { useData } from "@/context/data-store";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { TrendingDown, DollarSign, AlertTriangle, Percent } from "lucide-react";
import { computePropertyEconomics, type DeductionLite } from "@/lib/property-economics";
import { PropertyTypeIcon } from "@/components/property-type-icon";
import { CustomerLogo } from "@/components/customer-logo";

const usd = (n: number | null | undefined) =>
  n == null
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n)}%`);
const monthLabel = (m: string) => {
  if (!m) return "—";
  const d = new Date(`${m}-01T00:00:00`);
  return Number.isNaN(d.getTime())
    ? m
    : d.toLocaleString("en-US", { month: "short", year: "numeric" });
};

/** Inline editable bed count — commits on blur / Enter so the per-bed math updates. */
function BedInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value || ""));
  return (
    <Input
      type="number"
      min={0}
      value={draft}
      placeholder="set"
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => {
        const n = Math.max(0, Math.floor(Number(draft) || 0));
        if (n !== value) onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="h-8 w-16 text-right"
      data-testid="beds-input"
    />
  );
}

export default function EconomicsPage() {
  const { properties, leases, occupants, utilities = [], customers, updateProperty, isLoading } = useData();
  const [, navigate] = useLocation();
  const { data: deductionsData } = useListPayrollDeductions();
  const deductions = (deductionsData ?? []) as unknown as DeductionLite[];

  const customerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers) m.set(c.id, c.name);
    return m;
  }, [customers]);

  const months = useMemo(
    () =>
      Array.from(
        new Set(deductions.map((d) => (d.payWeekEndDate || "").slice(0, 7)).filter(Boolean)),
      ).sort().reverse(),
    [deductions],
  );
  const [period, setPeriod] = useState<string>("");
  const effectivePeriod = period || months[0] || "";

  const { rows, summary } = useMemo(
    () => computePropertyEconomics(properties, leases, occupants, utilities, deductions, effectivePeriod),
    [properties, leases, occupants, utilities, deductions, effectivePeriod],
  );

  return (
    <MainLayout>
      <div className="p-8 max-w-[1600px] mx-auto space-y-6">
        <PageHeader
          title="Rent Recovery"
          description="Are we recovering the rent we pay out? Cost vs. what payroll actually deducted, per property — biggest gap first."
          actions={
            months.length > 0 ? (
              <Select value={effectivePeriod} onValueChange={setPeriod}>
                <SelectTrigger className="w-40" data-testid="select-recovery-period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null
          }
        />

        {/* Lead with the answer: one dominant recovery-gap verdict an
            operator can read in two seconds, before the supporting cards. */}
        <Card
          className={
            "border-l-4 " +
            (summary.totalRecoveryGap > 0
              ? "border-l-red-500 bg-red-50/50 dark:bg-red-950/10"
              : "border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/10")
          }
          data-testid="recovery-verdict"
        >
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {summary.totalRecoveryGap > 0 ? "Housing loss this month" : "Fully recovered this month"}
              </div>
              <div
                className={
                  "mt-1 text-4xl font-bold tabular-nums sm:text-5xl " +
                  (summary.totalRecoveryGap > 0 ? "text-red-600" : "text-emerald-700")
                }
              >
                {usd(summary.totalRecoveryGap)}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {summary.totalRecoveryGap > 0
                  ? `Recovering ${pct(summary.blendedRecoveryRate)} of rent · ${summary.propertiesLosing} ${summary.propertiesLosing === 1 ? "property" : "properties"} under-recovering`
                  : `Recovering ${pct(summary.blendedRecoveryRate)} of the rent you pay out — nothing leaking right now.`}
              </div>
            </div>
            <div className="flex gap-6 text-right">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Empty beds</div>
                <div className="text-lg font-semibold tabular-nums text-amber-700">{usd(summary.totalVacancyLoss)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Under-charged</div>
                <div className="text-lg font-semibold tabular-nums text-amber-700">{usd(summary.totalCollectionLoss)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Supporting breakdown */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
                <DollarSign className="h-4 w-4" /> Rent cost
              </div>
              <div className="mt-1 text-2xl font-bold">{usd(summary.totalRentCost)}</div>
              <div className="text-xs text-muted-foreground">paid to landlords / mo</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
                <DollarSign className="h-4 w-4 text-emerald-600" /> Recovered
              </div>
              <div className="mt-1 text-2xl font-bold text-emerald-700">{usd(summary.totalRecovered)}</div>
              <div className="text-xs text-muted-foreground">actually deducted · {monthLabel(summary.periodMonth)}</div>
            </CardContent>
          </Card>
          <Card className={summary.totalRecoveryGap > 0 ? "border-red-300" : undefined}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
                <TrendingDown className="h-4 w-4 text-red-600" /> Recovery gap
              </div>
              <div className={"mt-1 text-2xl font-bold " + (summary.totalRecoveryGap > 0 ? "text-red-600" : "text-emerald-700")}>
                {usd(summary.totalRecoveryGap)}
              </div>
              <div className="text-xs text-muted-foreground">{summary.propertiesLosing} properties under-recovering</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
                <Percent className="h-4 w-4" /> Recovery rate
              </div>
              <div className="mt-1 text-2xl font-bold">{pct(summary.blendedRecoveryRate)}</div>
              <div className="text-xs text-muted-foreground">
                vacancy {usd(summary.totalVacancyLoss)} · collection {usd(summary.totalCollectionLoss)}
              </div>
            </CardContent>
          </Card>
        </div>

        {(summary.chargedNotPlacedCount > 0 || summary.bedsUnknownCount > 0) && (
          <div className="flex flex-wrap gap-2 text-xs">
            {summary.chargedNotPlacedCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" />
                {summary.chargedNotPlacedCount} people deducted but not placed in a bed — those dollars can't be attributed to a property
              </span>
            )}
            {summary.bedsUnknownCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-muted-foreground">
                {summary.bedsUnknownCount} properties have no bed count set
              </span>
            )}
          </div>
        )}

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead className="text-right">Rent cost/mo</TableHead>
                  <TableHead className="text-center">Beds</TableHead>
                  <TableHead className="text-center">Occ %</TableHead>
                  <TableHead className="text-right">Recovered/mo</TableHead>
                  <TableHead className="text-right">Recovery gap</TableHead>
                  <TableHead className="text-right">Now charging/bed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && rows.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No properties yet.</TableCell></TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow
                      key={r.propertyId}
                      onClick={() => navigate(`/properties/${r.propertyId}`)}
                      className={"cursor-pointer hover:bg-muted/40 " + (r.recoveryGap > 0 ? "bg-red-50/40 dark:bg-red-950/10" : "")}
                      data-testid={`recovery-row-${r.propertyId}`}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <PropertyTypeIcon type={r.propertyType} />
                          <div className="min-w-0">
                            <div className="font-medium hover:underline">{r.name}</div>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              {customerName.get(r.customerId) ? (
                                <>
                                  <CustomerLogo name={customerName.get(r.customerId)!} size={16} />
                                  <span className="truncate">{customerName.get(r.customerId)}</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{usd(r.monthlyRent)}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <BedInput value={r.beds} onCommit={(n) => updateProperty(r.propertyId, { totalBeds: n })} />
                          {!r.bedsKnown && <span className="text-[10px] text-amber-600">unknown</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {r.occupancyRate == null ? "—" : (
                          <span className={r.occupancyRate < 80 ? "text-amber-700 font-medium" : ""}>{pct(r.occupancyRate)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700">{usd(r.recoveredMonthly)}</TableCell>
                      <TableCell className={"text-right tabular-nums font-bold " + (r.recoveryGap > 0 ? "text-red-600" : "text-emerald-700")}>
                        {usd(r.recoveryGap)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.avgChargePerBed != null ? usd(r.avgChargePerBed) : <span className="text-muted-foreground">—</span>}
                        {r.chargeDataMissing && <span className="ml-1 text-[10px] text-amber-600">partial</span>}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Recovery gap = active lease rent − what payroll actually deducted for this property in {monthLabel(summary.periodMonth)}.
          A positive gap is housing loss: either empty beds (vacancy) or placed people not being deducted enough (collection).
          Click a row to open the property and trace the gap down to the bed. Set a bed count on any "unknown" row to score occupancy.
        </p>
      </div>
    </MainLayout>
  );
}
