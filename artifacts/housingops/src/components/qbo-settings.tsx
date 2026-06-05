import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface QboStatus {
  connected: boolean;
  realmId?: string;
  companyName?: string | null;
  environment?: "sandbox" | "production";
  connectedAt?: string;
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
}

function apiBase(): string {
  return import.meta.env.BASE_URL ?? "/";
}

export function QboSettings() {
  const { toast } = useToast();
  const [status, setStatus] = useState<QboStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const sRes = await fetch(`${apiBase()}api/qbo/status`);
      const sBody = (await sRes.json()) as QboStatus;
      setStatus(sBody);
    } catch (err) {
      toast({
        title: "Failed to load QuickBooks status",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleConnect = () => {
    window.location.href = `${apiBase()}api/qbo/connect/start`;
  };
  const handleDisconnect = async () => {
    setBusy("disconnect");
    try {
      const res = await fetch(`${apiBase()}api/qbo/disconnect`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "QuickBooks disconnected" });
      await refresh();
    } catch (err) {
      toast({
        title: "Disconnect failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };
  const handleSync = async () => {
    setBusy("sync");
    try {
      const res = await fetch(`${apiBase()}api/qbo/sync`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        upserted?: number;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast({
        title: "Sync complete",
        description: `${body.upserted ?? 0} transactions updated.`,
      });
      await refresh();
    } catch (err) {
      toast({
        title: "Sync failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>QuickBooks Online</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!status ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !status.connected ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Connect a QuickBooks Online company to mirror invoices, bills, and
              payments into HousingOps and reconcile them against expected rent
              and utility costs.
            </p>
            <Button onClick={handleConnect} data-testid="qbo-connect">
              Connect QuickBooks
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm">
              <div>
                Connected to <strong>{status.companyName ?? status.realmId}</strong>{" "}
                ({status.environment})
              </div>
              {status.lastSyncAt ? (
                <div className="text-muted-foreground">
                  Last sync: {new Date(status.lastSyncAt).toLocaleString()}
                </div>
              ) : null}
              {status.lastSyncError ? (
                <div className="text-destructive">{status.lastSyncError}</div>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleSync}
                disabled={busy !== null}
                data-testid="qbo-sync"
              >
                {busy === "sync" ? "Syncing…" : "Sync now"}
              </Button>
              <Button
                variant="outline"
                onClick={handleDisconnect}
                disabled={busy !== null}
                data-testid="qbo-disconnect"
              >
                Disconnect
              </Button>
            </div>
            <div className="pt-4 border-t">
              <h4 className="text-sm font-semibold mb-1">Mapping rules</h4>
              <p className="text-xs text-muted-foreground mb-2">
                Author customer links, memo → property rules, and account
                classifications that QuickBooks sync uses to attach mirrored
                transactions to the right HousingOps records.
              </p>
              <Button asChild variant="outline" size="sm" data-testid="qbo-open-mapping-rules">
                <Link href="/qbo/mapping-rules">Open Mapping Rules</Link>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
