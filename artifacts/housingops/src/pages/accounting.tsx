import { useMemo, useState, type ComponentType } from "react";
import { Link } from "wouter";
import { useListPayrollDeductions } from "@workspace/api-client-react";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { useData } from "@/context/data-store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DollarSign, Zap, Banknote, Plus, Trash2, Link2 } from "lucide-react";
import { computePropertyEconomics, type DeductionLite } from "@/lib/property-economics";
import { formatUsdWhole, UTILITY_TYPES, type UtilityType, type Utility } from "@/data/mockData";
import { shortPropertyName } from "@/lib/property-name";

/**
 * Accounting — the single place to FEED what KFI pays out per active
 * property: monthly RENT and UTILITIES, entered manually (or, later, pulled
 * from a connected bank). These are the cost side of rent recovery, so what
 * you enter here flows straight into Economics / Finance:
 *   cost = rent + utilities, gap = cost − recovered (actual deductions).
 *
 * Rent writes to the active monthly lease (when there's exactly one) or to
 * the property's monthlyRent — the same value the recovery math reads.
 */

function MoneyCell({ value, onSave, placeholder }: { value: number; onSave: (n: number) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  if (editing) {
    const commit = () => {
      const n = Math.max(0, Math.round((parseFloat(val) || 0) * 100) / 100);
      if (n !== value) onSave(n);
      setEditing(false);
    };
    return (
      <Input
        autoFocus
        type="number"
        min={0}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        className="h-7 w-24 text-right text-sm ml-auto"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => { setVal(value ? String(value) : ""); setEditing(true); }}
      className="ml-auto block rounded px-1.5 py-0.5 text-right tabular-nums hover:bg-muted/60"
      title="Click to edit"
    >
      {value > 0 ? `${formatUsdWhole(value)}/mo` : <span className="text-amber-600">{placeholder ?? "Set"}</span>}
    </button>
  );
}

export default function Accounting() {
  const {
    properties, leases, occupants, utilities, customers, isLoading,
    updateProperty, updateLease, addUtility, updateUtility, deleteUtility,
  } = useData();
  const { data: deductionsData } = useListPayrollDeductions();
  const deductions = (deductionsData ?? []) as unknown as DeductionLite[];

  const customerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers) m.set(c.id, c.name);
    return m;
  }, [customers]);

  const { rows, summary } = useMemo(
    () => computePropertyEconomics(properties, leases, occupants, utilities, deductions),
    [properties, leases, occupants, utilities, deductions],
  );

  // Active properties only, worst gap first.
  const activeRows = useMemo(
    () => [...rows].sort((a, b) => b.recoveryGap - a.recoveryGap),
    [rows],
  );

  const utilitiesByProperty = useMemo(() => {
    const m = new Map<string, Utility[]>();
    for (const u of utilities) {
      const arr = m.get(u.propertyId) ?? [];
      arr.push(u);
      m.set(u.propertyId, arr);
    }
    return m;
  }, [utilities]);

  // Rent feeds the recovery math: edit the single active monthly lease when
  // there is exactly one, otherwise the property's monthlyRent.
  const saveRent = (propertyId: string, n: number) => {
    const active = leases.filter(
      (l) => l.propertyId === propertyId && l.status === "Active" && (l.rateType ?? "monthly") === "monthly",
    );
    if (active.length === 1) {
      updateLease(active[0]!.id, { monthlyRent: n });
    } else {
      updateProperty(propertyId, { monthlyRent: n });
    }
  };

  return (
    <MainLayout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-5">
        <PageHeader
          title="Accounting"
          description="Feed what KFI pays per active property — rent and utilities. These costs flow straight into Rent Recovery (Economics) and Finance."
        />

        {/* Connections */}
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-primary/10 p-2"><Link2 className="h-4 w-4 text-primary" /></div>
              <div className="text-sm">
                <div className="font-medium">Manual entry or bank connection</div>
                <p className="text-muted-foreground">
                  Type rent &amp; utilities inline below, or connect a bank to auto-import utility &amp; rent payments and tag them by property.
                </p>
              </div>
            </div>
            <Link href="/settings">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Banknote className="h-4 w-4" /> Connect bank
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Rent cost /mo" value={formatUsdWhole(summary.totalRentCost)} icon={DollarSign} />
          <Kpi label="Utilities /mo" value={formatUsdWhole(summary.totalMonthlyCost - summary.totalRentCost)} icon={Zap} />
          <Kpi label="Recovered /mo" value={formatUsdWhole(summary.totalRecovered)} tone="good" />
          <Kpi label="Gap /mo" value={formatUsdWhole(summary.totalRecoveryGap)} tone={summary.totalRecoveryGap > 0 ? "bad" : "good"} />
        </div>

        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" /> Active properties — rent &amp; utilities
            </h2>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Rent /mo</TableHead>
                  <TableHead className="text-right">Utilities /mo</TableHead>
                  <TableHead className="text-right">Total cost</TableHead>
                  <TableHead className="text-right">Recovered</TableHead>
                  <TableHead className="text-right">Gap</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
                ) : activeRows.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No active properties.</TableCell></TableRow>
                ) : (
                  activeRows.map((r) => (
                    <TableRow key={r.propertyId} className="hover:bg-muted/40">
                      <TableCell className="font-medium">
                        <Link href={`/properties/${r.propertyId}`} className="hover:underline">{shortPropertyName(r.name)}</Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{customerName.get(r.customerId) ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <MoneyCell value={r.monthlyRent} onSave={(n) => saveRent(r.propertyId, n)} placeholder="Set rent" />
                      </TableCell>
                      <TableCell className="text-right">
                        <UtilitiesCell
                          propertyName={shortPropertyName(r.name)}
                          total={r.monthlyUtilities}
                          rows={utilitiesByProperty.get(r.propertyId) ?? []}
                          onAdd={(type, company, cost) => addUtility({ id: `util-${Date.now()}`, propertyId: r.propertyId, type, company, monthlyCost: cost, accountNumber: "", notes: "" })}
                          onUpdate={(id, cost) => updateUtility(id, { monthlyCost: cost })}
                          onDelete={(id) => deleteUtility(id)}
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsdWhole(r.monthlyCost)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsdWhole(r.recoveredMonthly)}</TableCell>
                      <TableCell className={"text-right tabular-nums font-semibold " + (r.recoveryGap > 0 ? "text-red-600" : "text-emerald-600")}>
                        {formatUsdWhole(r.recoveryGap)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </MainLayout>
  );
}

function Kpi({ label, value, icon: Icon, tone }: { label: string; value: string; icon?: ComponentType<{ className?: string }>; tone?: "good" | "bad" }) {
  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {Icon && <Icon className="h-3.5 w-3.5" />} {label}
        </div>
        <div className={"mt-1 text-xl font-semibold tabular-nums " + (tone === "bad" ? "text-red-600" : tone === "good" ? "text-emerald-600" : "")}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

// Utilities are itemized per property; this opens a small editor to add /
// adjust / remove line items. The table cell shows the monthly total.
function UtilitiesCell({
  propertyName, total, rows, onAdd, onUpdate, onDelete,
}: {
  propertyName: string;
  total: number;
  rows: Utility[];
  onAdd: (type: UtilityType, company: string, cost: number) => void;
  onUpdate: (id: string, cost: number) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<UtilityType>("Electric");
  const [company, setCompany] = useState("");
  const [cost, setCost] = useState("");
  const add = () => {
    const n = Math.max(0, Math.round((parseFloat(cost) || 0) * 100) / 100);
    if (n <= 0) return;
    onAdd(type, company.trim(), n);
    setCompany(""); setCost(""); setType("Electric");
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="ml-auto block rounded px-1.5 py-0.5 text-right tabular-nums hover:bg-muted/60" title="Edit utilities">
          {total > 0 ? `${formatUsdWhole(total)}/mo` : <span className="text-amber-600">Add</span>}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Utilities · {propertyName}</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          {rows.length > 0 ? (
            <div className="rounded-md border divide-y">
              {rows.map((u) => (
                <div key={u.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="w-20 shrink-0 font-medium">{u.type}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{u.company || "—"}</span>
                  <Input
                    type="number" min={0} defaultValue={u.monthlyCost || ""}
                    onBlur={(e) => { const n = Math.max(0, parseFloat(e.target.value) || 0); if (n !== u.monthlyCost) onUpdate(u.id, n); }}
                    className="h-7 w-24 text-right text-sm"
                  />
                  <button type="button" onClick={() => onDelete(u.id)} title="Remove" className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No utilities entered yet.</p>
          )}
          <div className="flex items-end gap-2 border-t pt-3">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Type</label>
              <Select value={type} onValueChange={(v) => setType(v as UtilityType)}>
                <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                <SelectContent>{UTILITY_TYPES.map((tp) => <SelectItem key={tp} value={tp}>{tp}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <label className="text-[11px] text-muted-foreground">Provider</label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="optional" className="h-8" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">$/mo</label>
              <Input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} className="h-8 w-24"
                onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
            </div>
            <Button size="sm" className="h-8 gap-1" onClick={add}><Plus className="h-3.5 w-3.5" /> Add</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
