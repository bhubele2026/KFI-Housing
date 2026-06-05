import { useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

interface RollupRow {
  propertyId: string;
  propertyName: string;
  customerName: string;
  expectedRent: number;
  expectedUtilities: number;
  invoicedRent: number;
  invoicedUtilities: number;
  paidRent: number;
  paidUtilities: number;
  variance: number;
  status: "ok" | "warn" | "bad";
}

function StatusBadge({ status }: { status: "ok" | "warn" | "bad" }) {
  if (status === "ok") return <span title="Reconciled" data-testid="status-ok">✓</span>;
  if (status === "warn")
    return (
      <span className="text-yellow-600" title="Invoiced ≠ paid" data-testid="status-warn">
        ⚠
      </span>
    );
  return (
    <span className="text-destructive" title="Variance > $1" data-testid="status-bad">
      ✗
    </span>
  );
}

interface QboTxn {
  id: string;
  txnDate: string;
  type: string;
  classification: string;
  amount: number;
  memo: string | null;
  accountName: string | null;
  propertyId: string | null;
  mappedConfidence: number;
  qboVendorId?: string | null;
}

interface PropertyLite {
  id: string;
  name: string;
}

interface LeaseLite {
  id: string;
  name: string;
  propertyId: string;
  status?: string | null;
}

interface UtilityLite {
  id: string;
  type?: string | null;
  provider?: string | null;
  propertyId: string;
}

function apiBase(): string {
  return import.meta.env.BASE_URL ?? "/";
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default function ReconciliationPage() {
  const { toast } = useToast();
  const [month, setMonth] = useState<string>(
    new Date().toISOString().slice(0, 7),
  );
  const [rows, setRows] = useState<RollupRow[]>([]);
  const [unmappedCount, setUnmappedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [drillIn, setDrillIn] = useState<RollupRow | null>(null);
  const [drillTxns, setDrillTxns] = useState<QboTxn[]>([]);
  const [unmapped, setUnmapped] = useState<QboTxn[]>([]);
  const [properties, setProperties] = useState<PropertyLite[]>([]);
  const [leases, setLeases] = useState<LeaseLite[]>([]);
  const [utilities, setUtilities] = useState<UtilityLite[]>([]);
  const [showUnmappedTray, setShowUnmappedTray] = useState(false);
  // Per-row remap selection state: txnId -> { propertyId, leaseId?, utilityId? }
  const [remapDraft, setRemapDraft] = useState<
    Record<string, { propertyId: string; leaseId?: string; utilityId?: string }>
  >({});

  const loadConnection = async () => {
    try {
      const res = await fetch(`${apiBase()}api/qbo/status`);
      const body = (await res.json()) as { connected?: boolean };
      setConnected(!!body.connected);
    } catch {
      setConnected(false);
    }
  };

  const load = async (m: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `${apiBase()}api/reconciliation/properties?month=${encodeURIComponent(m)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        rows: RollupRow[];
        unmappedCount: number;
      };
      setRows(body.rows);
      setUnmappedCount(body.unmappedCount);
    } catch (err) {
      toast({
        title: "Failed to load reconciliation",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadProperties = async () => {
    try {
      const [pRes, lRes, uRes] = await Promise.all([
        fetch(`${apiBase()}api/properties`),
        fetch(`${apiBase()}api/leases`).catch(() => null),
        fetch(`${apiBase()}api/utilities`).catch(() => null),
      ]);
      if (pRes.ok) {
        const body = (await pRes.json()) as
          | { properties?: PropertyLite[] }
          | PropertyLite[];
        const arr = Array.isArray(body) ? body : (body.properties ?? []);
        setProperties(arr.map((p) => ({ id: p.id, name: p.name })));
      }
      if (lRes && lRes.ok) {
        const lb = (await lRes.json()) as
          | { leases?: LeaseLite[] }
          | LeaseLite[];
        setLeases(Array.isArray(lb) ? lb : (lb.leases ?? []));
      }
      if (uRes && uRes.ok) {
        const ub = (await uRes.json()) as
          | { utilities?: UtilityLite[] }
          | UtilityLite[];
        setUtilities(Array.isArray(ub) ? ub : (ub.utilities ?? []));
      }
    } catch {
      /* non-fatal */
    }
  };

  useEffect(() => {
    void loadConnection();
    void loadProperties();
  }, []);

  useEffect(() => {
    if (connected) void load(month);
  }, [month, connected]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.expectedRent += r.expectedRent;
        acc.expectedUtilities += r.expectedUtilities;
        acc.invoicedRent += r.invoicedRent;
        acc.invoicedUtilities += r.invoicedUtilities;
        acc.paidRent += r.paidRent;
        acc.paidUtilities += r.paidUtilities;
        acc.variance += r.variance;
        return acc;
      },
      {
        expectedRent: 0,
        expectedUtilities: 0,
        invoicedRent: 0,
        invoicedUtilities: 0,
        paidRent: 0,
        paidUtilities: 0,
        variance: 0,
      },
    );
  }, [rows]);

  const runSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${apiBase()}api/qbo/sync`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        upserted?: number;
        results?: Array<{ upserted?: number; remappedCount?: number }>;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const total =
        body.upserted ??
        (body.results ?? []).reduce((s, r) => s + (r.upserted ?? 0), 0);
      toast({
        title: "QuickBooks sync complete",
        description: `${total} transactions updated.`,
      });
      await load(month);
    } catch (err) {
      toast({
        title: "Sync failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  const openDrillIn = async (row: RollupRow) => {
    setDrillIn(row);
    setDrillTxns([]);
    try {
      const res = await fetch(
        `${apiBase()}api/reconciliation/property/${row.propertyId}?month=${month}`,
      );
      const body = (await res.json()) as { transactions: QboTxn[] };
      setDrillTxns(body.transactions);
    } catch (err) {
      toast({
        title: "Failed to load transactions",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  const openUnmappedTray = async () => {
    setShowUnmappedTray(true);
    try {
      const res = await fetch(`${apiBase()}api/reconciliation/unmapped`);
      const body = (await res.json()) as { transactions: QboTxn[] };
      setUnmapped(body.transactions);
    } catch (err) {
      toast({
        title: "Failed to load unmapped transactions",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  const updateDraft = (
    txnId: string,
    patch: Partial<{ propertyId: string; leaseId?: string; utilityId?: string }>,
  ) => {
    setRemapDraft((prev) => {
      const cur = prev[txnId] ?? { propertyId: "" };
      const next = { ...cur, ...patch };
      // If the property changed, drop lease/utility (they belong to old prop)
      if (patch.propertyId && patch.propertyId !== cur.propertyId) {
        next.leaseId = undefined;
        next.utilityId = undefined;
      }
      return { ...prev, [txnId]: next };
    });
  };

  /**
   * Open the shared add-rule dialog on the Mapping Rules page,
   * prefilled from this transaction. We deliberately do NOT save here
   * — the operator needs to confirm the suggested memo token, scope,
   * and lease/utility choice in the same dialog they'd see if they
   * started on the Mapping Rules page (per Task #694 UX spec). The
   * prefill is passed via query-string so the page can read the
   * suggested token from the server and feed it to <MemoRules>'s
   * initialDraft.
   */
  const saveAsRule = (txnId: string) => {
    const draft = remapDraft[txnId];
    if (!draft?.propertyId) {
      toast({ title: "Select a property first", variant: "destructive" });
      return;
    }
    const txn = unmapped.find((t) => t.id === txnId);
    const params = new URLSearchParams({
      prefillTxn: txnId,
      propertyId: draft.propertyId,
    });
    if (draft.leaseId) params.set("leaseId", draft.leaseId);
    if (draft.utilityId) params.set("utilityId", draft.utilityId);
    // Carry vendor identity when the source is a bill/vendor-credit so
    // the prefilled rule scopes to that vendor — otherwise a vendor
    // rule would over-broadly match every vendor with the same memo
    // token. The page also re-fetches qboVendorId from the server via
    // /suggest-token as a fallback for cases where the unmapped tray
    // didn't include it.
    if (txn?.qboVendorId) params.set("qboVendorId", txn.qboVendorId);
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    window.location.assign(`${base}/qbo/mapping-rules?${params.toString()}`);
  };

  const remap = async (txnId: string) => {
    const draft = remapDraft[txnId];
    if (!draft?.propertyId) {
      toast({
        title: "Select a property first",
        variant: "destructive",
      });
      return;
    }
    try {
      const res = await fetch(
        `${apiBase()}api/reconciliation/transactions/${txnId}/remap`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            propertyId: draft.propertyId,
            leaseId: draft.leaseId ?? null,
            utilityId: draft.utilityId ?? null,
          }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "Mapping saved" });
      setUnmapped((prev) => prev.filter((t) => t.id !== txnId));
      setRemapDraft((prev) => {
        const { [txnId]: _, ...rest } = prev;
        return rest;
      });
      await load(month);
    } catch (err) {
      toast({
        title: "Save failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  if (connected === false) {
    return (
      <MainLayout>
        <PageHeader
          title="Reconciliation"
          description="Compare expected rent and utilities against invoiced and paid amounts from QuickBooks."
        />
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <p className="text-muted-foreground">
              Connect QuickBooks to enable per-property rent and utility reconciliation.
            </p>
            <Button asChild>
              <a href={`${apiBase()}settings?tab=quickbooks`}>Go to QuickBooks settings</a>
            </Button>
          </CardContent>
        </Card>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <PageHeader
        title="Reconciliation"
        description="Compare expected rent and utilities against invoiced and paid amounts from QuickBooks."
      />
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-48"
            data-testid="reconciliation-month"
          />
          <Button
            onClick={() => void runSync()}
            disabled={syncing}
            data-testid="reconciliation-sync"
          >
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
          {unmappedCount > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openUnmappedTray()}
              data-testid="reconciliation-unmapped"
            >
              <Badge variant="destructive" className="mr-2">
                {unmappedCount}
              </Badge>
              Needs mapping
            </Button>
          ) : null}
        </div>
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table data-testid="reconciliation-table">
              <TableHeader>
                <TableRow>
                  <TableHead rowSpan={2}>Property</TableHead>
                  <TableHead rowSpan={2}>Customer</TableHead>
                  <TableHead colSpan={2} className="text-center border-l">Expected</TableHead>
                  <TableHead colSpan={2} className="text-center border-l">Invoiced</TableHead>
                  <TableHead colSpan={2} className="text-center border-l">Paid</TableHead>
                  <TableHead rowSpan={2} className="text-right border-l">Variance</TableHead>
                  <TableHead rowSpan={2} className="text-center border-l w-12">Status</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead className="text-right border-l">Rent</TableHead>
                  <TableHead className="text-right">Utility</TableHead>
                  <TableHead className="text-right border-l">Rent</TableHead>
                  <TableHead className="text-right">Utility</TableHead>
                  <TableHead className="text-right border-l">Rent</TableHead>
                  <TableHead className="text-right">Utility</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground">
                      No properties to reconcile for {month}.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow
                      key={r.propertyId}
                      data-testid={`reconciliation-row-${r.propertyId}`}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => void openDrillIn(r)}
                    >
                      <TableCell className="font-medium">{r.propertyName}</TableCell>
                      <TableCell>{r.customerName}</TableCell>
                      <TableCell className="text-right border-l">{fmt(r.expectedRent)}</TableCell>
                      <TableCell className="text-right">{fmt(r.expectedUtilities)}</TableCell>
                      <TableCell className="text-right border-l">{fmt(r.invoicedRent)}</TableCell>
                      <TableCell className="text-right">{fmt(r.invoicedUtilities)}</TableCell>
                      <TableCell className="text-right border-l">{fmt(r.paidRent)}</TableCell>
                      <TableCell className="text-right">{fmt(r.paidUtilities)}</TableCell>
                      <TableCell
                        className={
                          r.variance < 0
                            ? "text-right text-destructive border-l"
                            : "text-right border-l"
                        }
                      >
                        {fmt(r.variance)}
                      </TableCell>
                      <TableCell className="text-center border-l">
                        <StatusBadge status={r.status} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              {rows.length > 0 ? (
                <TableBody>
                  <TableRow className="font-semibold border-t">
                    <TableCell colSpan={2}>Totals</TableCell>
                    <TableCell className="text-right border-l">{fmt(totals.expectedRent)}</TableCell>
                    <TableCell className="text-right">{fmt(totals.expectedUtilities)}</TableCell>
                    <TableCell className="text-right border-l">{fmt(totals.invoicedRent)}</TableCell>
                    <TableCell className="text-right">{fmt(totals.invoicedUtilities)}</TableCell>
                    <TableCell className="text-right border-l">{fmt(totals.paidRent)}</TableCell>
                    <TableCell className="text-right">{fmt(totals.paidUtilities)}</TableCell>
                    <TableCell
                      className={
                        totals.variance < 0
                          ? "text-right text-destructive border-l"
                          : "text-right border-l"
                      }
                    >
                      {fmt(totals.variance)}
                    </TableCell>
                    <TableCell className="text-center border-l" />
                  </TableRow>
                </TableBody>
              ) : null}
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!drillIn} onOpenChange={(o) => !o && setDrillIn(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{drillIn?.propertyName} — {month}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Memo / Account</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drillTxns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No transactions for this property/month.
                    </TableCell>
                  </TableRow>
                ) : (
                  drillTxns.map((t) => (
                    <TableRow key={t.id} data-testid={`drill-txn-${t.id}`}>
                      <TableCell>{t.txnDate}</TableCell>
                      <TableCell>{t.type}</TableCell>
                      <TableCell>{t.classification}</TableCell>
                      <TableCell className="text-xs">
                        <div>{t.memo}</div>
                        <div className="text-muted-foreground">{t.accountName}</div>
                      </TableCell>
                      <TableCell className="text-right">{fmt(t.amount)}</TableCell>
                      <TableCell className="text-right">
                        {(t.mappedConfidence * 100).toFixed(0)}%
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showUnmappedTray} onOpenChange={setShowUnmappedTray}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Needs mapping ({unmapped.length})</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Memo / Account</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Lease / Utility</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {unmapped.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Nothing to map.
                    </TableCell>
                  </TableRow>
                ) : (
                  unmapped.map((t) => {
                    const draft = remapDraft[t.id];
                    const draftPropId = draft?.propertyId;
                    const propLeases = draftPropId
                      ? leases.filter((l) => l.propertyId === draftPropId)
                      : [];
                    const propUtils = draftPropId
                      ? utilities.filter((u) => u.propertyId === draftPropId)
                      : [];
                    const isRent = t.classification === "rent";
                    const isUtil = t.classification === "utility";
                    return (
                      <TableRow key={t.id} data-testid={`unmapped-row-${t.id}`}>
                        <TableCell>{t.txnDate}</TableCell>
                        <TableCell className="text-xs">
                          <div>{t.memo}</div>
                          <div className="text-muted-foreground">
                            {t.accountName} · {t.classification}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{fmt(t.amount)}</TableCell>
                        <TableCell>
                          <Select
                            value={draftPropId ?? ""}
                            onValueChange={(v) => updateDraft(t.id, { propertyId: v })}
                          >
                            <SelectTrigger data-testid={`unmapped-property-${t.id}`}>
                              <SelectValue placeholder="Choose property…" />
                            </SelectTrigger>
                            <SelectContent>
                              {properties.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {draftPropId && isRent ? (
                            <Select
                              value={draft?.leaseId ?? ""}
                              onValueChange={(v) => updateDraft(t.id, { leaseId: v })}
                            >
                              <SelectTrigger data-testid={`unmapped-lease-${t.id}`}>
                                <SelectValue placeholder="Lease (optional)" />
                              </SelectTrigger>
                              <SelectContent>
                                {propLeases.map((l) => (
                                  <SelectItem key={l.id} value={l.id}>
                                    {l.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : draftPropId && isUtil ? (
                            <Select
                              value={draft?.utilityId ?? ""}
                              onValueChange={(v) => updateDraft(t.id, { utilityId: v })}
                            >
                              <SelectTrigger data-testid={`unmapped-utility-${t.id}`}>
                                <SelectValue placeholder="Utility (optional)" />
                              </SelectTrigger>
                              <SelectContent>
                                {propUtils.map((u) => (
                                  <SelectItem key={u.id} value={u.id}>
                                    {u.type ?? u.provider ?? u.id}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Button
                              size="sm"
                              onClick={() => void remap(t.id)}
                              disabled={!draftPropId}
                              data-testid={`unmapped-save-${t.id}`}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void saveAsRule(t.id)}
                              disabled={!draftPropId}
                              data-testid={`unmapped-save-rule-${t.id}`}
                              title="Save as a reusable rule that auto-maps future transactions like this one"
                            >
                              Save as rule…
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
