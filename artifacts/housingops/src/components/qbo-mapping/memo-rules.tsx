import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useData } from "@/context/data-store";
import type { CustomerLink, MemoRule } from "./types";

function apiBase(): string {
  return import.meta.env.BASE_URL ?? "/";
}

interface DraftRule {
  customerId: string;
  // Vendor-scoped rules (bills/vendor credits): we don't try to
  // map qboVendorId to a HousingOps entity — it's an opaque QBO id
  // captured from the source transaction. Empty string = "any vendor".
  qboVendorId: string;
  memoToken: string;
  propertyId: string;
  leaseId: string;
  utilityId: string;
}

const EMPTY_DRAFT: DraftRule = {
  customerId: "",
  qboVendorId: "",
  memoToken: "",
  propertyId: "",
  leaseId: "",
  utilityId: "",
};

interface PreviewState {
  matchCount: number;
  transactions: Array<{
    id: string;
    txnDate: string;
    memo: string | null;
    amount: number;
    type: string | null;
    classification: string;
    propertyId: string | null;
  }>;
}

export function MemoRules({
  rules,
  customerLinks,
  onChanged,
  initialDraft,
  openOnMount = false,
}: {
  rules: MemoRule[];
  customerLinks: CustomerLink[];
  onChanged: () => void | Promise<void>;
  initialDraft?: Partial<DraftRule>;
  openOnMount?: boolean;
}) {
  const { toast } = useToast();
  const { properties, leases, utilities } = useData();
  const [open, setOpen] = useState(openOnMount);
  const [draft, setDraft] = useState<DraftRule>({
    ...EMPTY_DRAFT,
    ...(initialDraft ?? {}),
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialDraft) setDraft({ ...EMPTY_DRAFT, ...initialDraft });
  }, [JSON.stringify(initialDraft ?? {})]);

  // Filter the property picker by the selected customer scope so the
  // operator can't accidentally route a customer-scoped rule to a
  // property owned by a different customer. When no customer is set
  // ("Any customer"), show all properties.
  const customerProperties = useMemo(() => {
    if (!draft.customerId) return properties;
    return properties.filter(
      (p) =>
        p.customerId === draft.customerId ||
        (p.sharedWithCustomerIds ?? []).includes(draft.customerId),
    );
  }, [properties, draft.customerId]);
  const propLeases = useMemo(
    () => leases.filter((l) => l.propertyId === draft.propertyId),
    [leases, draft.propertyId],
  );
  const propUtils = useMemo(
    () => utilities.filter((u) => u.propertyId === draft.propertyId),
    [utilities, draft.propertyId],
  );
  const customerLinkByQboId = useMemo(() => {
    const m = new Map<string, CustomerLink>();
    for (const l of customerLinks)
      if (l.qboCustomerId) m.set(l.qboCustomerId, l);
    return m;
  }, [customerLinks]);
  const propertyNameById = useMemo(
    () => new Map(properties.map((p) => [p.id, p.name])),
    [properties],
  );

  const openCreate = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setPreview(null);
    setOpen(true);
  };

  const openEdit = (r: MemoRule) => {
    setEditingId(r.id);
    setDraft({
      customerId: customerLinkByQboId.get(r.qboCustomerId)?.customerId ?? "",
      qboVendorId: r.qboVendorId ?? "",
      memoToken: r.memoToken,
      propertyId: r.propertyId,
      leaseId: r.leaseId ?? "",
      utilityId: r.utilityId ?? "",
    });
    setPreview(null);
    setOpen(true);
  };

  const runPreview = async () => {
    if (!draft.memoToken) {
      setPreview(null);
      return;
    }
    try {
      const res = await fetch(`${apiBase()}api/qbo/mapping-rules/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: draft.customerId || null,
          qboVendorId: draft.qboVendorId || null,
          memoToken: draft.memoToken,
          // Always send propertyId (even when unset) so the preview
          // backend knows to compute the "current → proposed" diff
          // against the draft. Server uses it only for matching when
          // present.
          propertyId: draft.propertyId || undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPreview((await res.json()) as PreviewState);
    } catch (err) {
      toast({
        title: "Preview failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  // Re-run the preview on every field that changes the match set OR
  // the comparison column. customerId/memoToken/leaseId/utilityId all
  // narrow or relabel the match; propertyId changes the "→" target.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void runPreview(), 250);
    return () => clearTimeout(t);
  }, [
    draft.customerId,
    draft.qboVendorId,
    draft.memoToken,
    draft.propertyId,
    draft.leaseId,
    draft.utilityId,
    open,
  ]);

  const save = async () => {
    if (!draft.memoToken || !draft.propertyId) {
      toast({
        title: "Memo token and property are required",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${apiBase()}api/qbo/mapping-rules/memo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId ?? undefined,
          customerId: draft.customerId || null,
          qboVendorId: draft.qboVendorId || null,
          memoToken: draft.memoToken,
          propertyId: draft.propertyId,
          leaseId: draft.leaseId || null,
          utilityId: draft.utilityId || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        rule?: MemoRule;
        reclassified?: number;
        skippedManual?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast({
        title: editingId ? "Rule updated" : "Rule saved",
        description: `${body.reclassified ?? 0} transactions reclassified${(body.skippedManual ?? 0) > 0 ? `, ${body.skippedManual} manual overrides skipped` : ""}.`,
      });
      setOpen(false);
      await onChanged();
    } catch (err) {
      toast({
        title: "Save failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: MemoRule) => {
    if (!confirm(`Delete rule "${r.memoToken}"?`)) return;
    try {
      const res = await fetch(`${apiBase()}api/qbo/mapping-rules/memo/${r.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await onChanged();
    } catch (err) {
      toast({
        title: "Delete failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={openCreate} data-testid="memo-rule-new">
          New rule
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer scope</TableHead>
            <TableHead>Memo contains</TableHead>
            <TableHead>Property</TableHead>
            <TableHead>Lease / Utility</TableHead>
            <TableHead className="text-right">Matches</TableHead>
            <TableHead className="w-32" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No memo rules yet.
              </TableCell>
            </TableRow>
          ) : (
            rules.map((r) => {
              const cust = customerLinkByQboId.get(r.qboCustomerId);
              return (
                <TableRow key={r.id} data-testid={`memo-rule-${r.id}`}>
                  <TableCell>
                    {cust?.customerName ?? (r.qboCustomerId ? `QBO ${r.qboCustomerId}` : "Any")}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.memoToken}
                  </TableCell>
                  <TableCell>
                    {propertyNameById.get(r.propertyId) ?? r.propertyId}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.leaseId ? `Lease ${r.leaseId.slice(0, 6)}…` : null}
                    {r.utilityId ? `Utility ${r.utilityId.slice(0, 6)}…` : null}
                    {!r.leaseId && !r.utilityId ? "—" : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.matchCount ?? 0}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(r)}
                        data-testid={`memo-rule-edit-${r.id}`}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void remove(r)}
                        data-testid={`memo-rule-delete-${r.id}`}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit memo rule" : "New memo rule"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                Customer scope (optional)
                <Select
                  value={draft.customerId}
                  onValueChange={(v) =>
                    setDraft((d) => ({ ...d, customerId: v }))
                  }
                >
                  <SelectTrigger data-testid="rule-customer">
                    <SelectValue placeholder="Any customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customerLinks.map((l) => (
                      <SelectItem key={l.customerId} value={l.customerId}>
                        {l.customerName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="text-sm">
                Memo contains
                <Input
                  value={draft.memoToken}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, memoToken: e.target.value }))
                  }
                  placeholder="e.g. Maple 3107"
                  data-testid="rule-memo-token"
                />
              </label>
              <label className="text-sm">
                Property
                <Select
                  value={draft.propertyId}
                  onValueChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      propertyId: v,
                      leaseId: "",
                      utilityId: "",
                    }))
                  }
                >
                  <SelectTrigger data-testid="rule-property">
                    <SelectValue placeholder="Choose property…" />
                  </SelectTrigger>
                  <SelectContent>
                    {customerProperties.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="text-sm">
                Lease (rent rules)
                <Select
                  value={draft.leaseId}
                  onValueChange={(v) =>
                    setDraft((d) => ({ ...d, leaseId: v, utilityId: "" }))
                  }
                  disabled={!draft.propertyId}
                >
                  <SelectTrigger data-testid="rule-lease">
                    <SelectValue placeholder="Optional" />
                  </SelectTrigger>
                  <SelectContent>
                    {propLeases.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {`Lease ${l.id.slice(0, 6)}…`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="text-sm">
                Vendor scope (optional)
                <Input
                  value={draft.qboVendorId}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, qboVendorId: e.target.value }))
                  }
                  placeholder="QBO vendor id (auto-filled for bill prefills)"
                  data-testid="rule-vendor"
                />
              </label>
              <label className="text-sm col-span-2">
                Utility (utility rules)
                <Select
                  value={draft.utilityId}
                  onValueChange={(v) =>
                    setDraft((d) => ({ ...d, utilityId: v, leaseId: "" }))
                  }
                  disabled={!draft.propertyId}
                >
                  <SelectTrigger data-testid="rule-utility">
                    <SelectValue placeholder="Optional" />
                  </SelectTrigger>
                  <SelectContent>
                    {propUtils.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.type || u.company || u.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <div className="border rounded p-3 bg-muted/30">
              <div className="text-xs font-semibold mb-1">
                Live preview · {preview?.matchCount ?? 0} matches
              </div>
              {preview && preview.transactions.length > 0 ? (
                <table
                  className="w-full text-xs"
                  data-testid="rule-preview-table"
                >
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="font-normal pb-1">Date</th>
                      <th className="font-normal pb-1">Type</th>
                      <th className="font-normal pb-1">Memo</th>
                      <th className="font-normal pb-1 text-right">Amount</th>
                      <th className="font-normal pb-1">Currently mapped to</th>
                      <th className="font-normal pb-1">Would map to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...preview.transactions]
                      .sort((a, b) =>
                        (b.txnDate || "").localeCompare(a.txnDate || ""),
                      )
                      .map((t) => {
                      const current = t.propertyId
                        ? (propertyNameById.get(t.propertyId) ?? t.propertyId)
                        : "—";
                      const proposed = draft.propertyId
                        ? (propertyNameById.get(draft.propertyId) ??
                          draft.propertyId)
                        : "(choose a property)";
                      const changes =
                        draft.propertyId &&
                        t.propertyId !== draft.propertyId;
                      return (
                        <tr key={t.id} className="align-top">
                          <td className="pr-2 tabular-nums text-muted-foreground">
                            {t.txnDate}
                          </td>
                          <td className="pr-2 text-xs uppercase text-muted-foreground">
                            {t.type ?? "—"}
                          </td>
                          <td className="pr-2 truncate max-w-[18ch]">
                            {t.memo}
                          </td>
                          <td className="pr-2 text-right tabular-nums">
                            ${t.amount.toFixed(2)}
                          </td>
                          <td className="pr-2 text-muted-foreground">
                            {current}
                          </td>
                          <td
                            className={
                              changes
                                ? "font-medium text-foreground"
                                : "text-muted-foreground"
                            }
                          >
                            {proposed}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {draft.memoToken
                    ? "No mirrored transactions match this rule yet."
                    : "Type a memo token to preview matches."}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busy} data-testid="rule-save">
              {busy ? "Saving…" : "Save rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
