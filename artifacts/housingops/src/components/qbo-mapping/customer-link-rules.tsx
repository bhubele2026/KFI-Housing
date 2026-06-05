import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useData } from "@/context/data-store";
import type { CustomerLink, UnlinkedQboCustomer } from "./types";

function apiBase(): string {
  return import.meta.env.BASE_URL ?? "/";
}

interface AutoLinkProposal {
  qboCustomerId: string;
  qboCustomerName: string;
  customerId: string;
  customerName: string;
}

export function CustomerLinkRules({
  links,
  onChanged,
}: {
  links: CustomerLink[];
  onChanged: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const { customers } = useData();
  const [unlinked, setUnlinked] = useState<UnlinkedQboCustomer[]>([]);
  const [proposals, setProposals] = useState<AutoLinkProposal[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const refreshUnlinked = async () => {
    try {
      const res = await fetch(`${apiBase()}api/qbo/customers/unlinked`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { qboCustomers: UnlinkedQboCustomer[] };
      setUnlinked(body.qboCustomers ?? []);
    } catch (err) {
      toast({
        title: "Failed to load QBO customers",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    void refreshUnlinked();
  }, [links]);

  const linkOne = async (qboCustomerId: string, customerId: string) => {
    if (!customerId) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiBase()}api/qbo/mapping-rules/customer-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qboCustomerId, customerId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await onChanged();
    } catch (err) {
      toast({
        title: "Link failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (customerId: string) => {
    setBusy(true);
    try {
      const res = await fetch(
        `${apiBase()}api/qbo/mapping-rules/customer-link/${customerId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await onChanged();
    } catch (err) {
      toast({
        title: "Unlink failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const proposeAutoLink = async () => {
    setBusy(true);
    try {
      const res = await fetch(
        `${apiBase()}api/qbo/mapping-rules/auto-link-customers`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { proposals: AutoLinkProposal[] };
      setProposals(body.proposals ?? []);
      if ((body.proposals ?? []).length === 0) {
        toast({ title: "No automatic matches found." });
      }
    } catch (err) {
      toast({
        title: "Auto-link failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmAutoLink = async () => {
    if (!proposals) return;
    setBusy(true);
    try {
      const res = await fetch(
        `${apiBase()}api/qbo/mapping-rules/auto-link-customers/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proposals }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { linked?: number };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: `Linked ${body.linked ?? 0} customers.` });
      setProposals(null);
      await onChanged();
    } catch (err) {
      toast({
        title: "Confirm failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold">Linked customers</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={proposeAutoLink}
            disabled={busy}
            data-testid="auto-link-propose"
          >
            Auto-match by name
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>HousingOps customer</TableHead>
              <TableHead>QBO customer id</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  No customer links yet.
                </TableCell>
              </TableRow>
            ) : (
              links.map((l) => (
                <TableRow key={l.customerId} data-testid={`linked-${l.customerId}`}>
                  <TableCell>{l.customerName}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {l.qboCustomerId}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void unlink(l.customerId)}
                      disabled={busy}
                      data-testid={`unlink-${l.customerId}`}
                    >
                      Unlink
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>

      {proposals && proposals.length > 0 ? (
        <section className="border border-amber-300 bg-amber-50 rounded p-3 space-y-2">
          <div className="text-sm font-semibold">
            Suggested links by exact-name match ({proposals.length})
          </div>
          <ul className="text-sm space-y-1">
            {proposals.map((p) => (
              <li key={p.qboCustomerId}>
                <span className="font-mono">{p.qboCustomerName}</span> →{" "}
                {p.customerName}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={confirmAutoLink}
              disabled={busy}
              data-testid="auto-link-confirm"
            >
              Confirm all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setProposals(null)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="text-base font-semibold mb-2">
          Unlinked QBO customers ({unlinked.length})
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>QBO display name</TableHead>
              <TableHead>QBO id</TableHead>
              <TableHead>Link to HousingOps customer</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {unlinked.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  Every QBO customer with mirrored transactions is linked.
                </TableCell>
              </TableRow>
            ) : (
              unlinked.map((q) => (
                <TableRow key={q.id} data-testid={`unlinked-${q.id}`}>
                  <TableCell>{q.displayName}</TableCell>
                  <TableCell className="font-mono text-xs">{q.id}</TableCell>
                  <TableCell>
                    <Select
                      value={draft[q.id] ?? ""}
                      onValueChange={(v) => setDraft((d) => ({ ...d, [q.id]: v }))}
                    >
                      <SelectTrigger data-testid={`link-target-${q.id}`}>
                        <SelectValue placeholder="Choose customer…" />
                      </SelectTrigger>
                      <SelectContent>
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      onClick={() => void linkOne(q.id, draft[q.id] ?? "")}
                      disabled={busy || !draft[q.id]}
                      data-testid={`link-save-${q.id}`}
                    >
                      Link
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
