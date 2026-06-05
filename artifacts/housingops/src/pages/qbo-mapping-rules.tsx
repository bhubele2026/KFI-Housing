import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { CustomerLinkRules } from "@/components/qbo-mapping/customer-link-rules";
import { MemoRules } from "@/components/qbo-mapping/memo-rules";
import { AccountClassificationRules } from "@/components/qbo-mapping/account-classification-rules";
import type {
  MappingRulesPayload,
  AccountClassification,
} from "@/components/qbo-mapping/types";

function apiBase(): string {
  return import.meta.env.BASE_URL ?? "/";
}

export default function QboMappingRulesPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [data, setData] = useState<MappingRulesPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase()}api/qbo/mapping-rules`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as MappingRulesPayload);
    } catch (err) {
      toast({
        title: "Failed to load mapping rules",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  // Reconciliation's "Save as rule…" affordance navigates here with
  // ?prefillTxn=<id>; we hydrate the suggested memo token + customer
  // scope from the server and feed them into the shared <MemoRules>
  // dialog as `initialDraft` so the operator sees the same form they
  // would have seen if they'd opened the dialog from this page.
  //
  // NOTE: these hooks MUST stay above every early return below or
  // React's hook-order invariant breaks on the first render (when
  // `loading` is true).
  const [prefill, setPrefill] = useState<
    | {
        customerId: string;
        qboVendorId: string;
        memoToken: string;
      }
    | null
  >(null);
  const [prefillKey, setPrefillKey] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const txnId = params.get("prefillTxn");
    const propertyId = params.get("propertyId") ?? "";
    const leaseId = params.get("leaseId") ?? "";
    const utilityId = params.get("utilityId") ?? "";
    const urlVendorId = params.get("qboVendorId") ?? "";
    if (!txnId) return;
    (async () => {
      try {
        const res = await fetch(
          `${apiBase()}api/qbo/mapping-rules/suggest-token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transactionId: txnId }),
          },
        );
        if (!res.ok) return;
        const body = (await res.json()) as {
          memoToken?: string;
          customerId?: string | null;
          qboVendorId?: string | null;
        };
        setPrefill({
          customerId: body.customerId ?? "",
          // URL vendor wins over server vendor: Reconciliation may
          // have a fresher hint than the mirror.
          qboVendorId: urlVendorId || (body.qboVendorId ?? ""),
          memoToken: body.memoToken ?? "",
          // The dialog reads these too via initialDraft spreading.
          ...(propertyId ? { propertyId } : {}),
          ...(leaseId ? { leaseId } : {}),
          ...(utilityId ? { utilityId } : {}),
        } as any);
        setPrefillKey((k) => k + 1);
      } catch {
        // Non-fatal — operator can still open the dialog manually.
      }
    })();
  }, []);

  const handleExport = async () => {
    try {
      const res = await fetch(`${apiBase()}api/qbo/mapping-rules/export`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const blob = new Blob([JSON.stringify(body, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `qbo-mapping-rules-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: "Export failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const res = await fetch(`${apiBase()}api/qbo/mapping-rules/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        upsertedRules?: number;
        linkedCustomers?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast({
        title: "Mapping rules imported",
        description: `${body.upsertedRules ?? 0} rules, ${body.linkedCustomers ?? 0} customer links.`,
      });
      await refresh();
    } catch (err) {
      toast({
        title: "Import failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <MainLayout>
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      </MainLayout>
    );
  }

  if (!data || !data.realmId) {
    return (
      <MainLayout>
        <div className="max-w-3xl mx-auto p-6 space-y-4">
          <h1 className="text-2xl font-semibold">QuickBooks Mapping Rules</h1>
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Connect QuickBooks first to author mapping rules.
            </CardContent>
          </Card>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">QuickBooks Mapping Rules</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Author the rules QuickBooks sync uses to attach transactions to
              the right property — before the sync runs. Saved rules
              reclassify existing transactions on the spot.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              data-testid="qbo-rules-export"
            >
              Export
            </Button>
            <label className="inline-flex">
              <Input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleImport(f);
                  e.target.value = "";
                }}
                data-testid="qbo-rules-import-input"
              />
              <Button
                variant="outline"
                size="sm"
                asChild
                data-testid="qbo-rules-import"
              >
                <span>Import</span>
              </Button>
            </label>
          </div>
        </div>
        <Card data-testid="qbo-rules-precedence">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">How rules combine</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1 text-muted-foreground">
            <p>
              When sync mirrors a QuickBooks transaction, the engine walks
              this list top-to-bottom and the first rule that matches wins.
            </p>
            <ol className="list-decimal pl-6 space-y-0.5">
              <li>
                <strong>Manual override</strong> &mdash; anything the operator
                remapped on the Reconciliation page always wins and is never
                touched by saved rules.
              </li>
              <li>
                <strong>Customer-scoped memo rule</strong> &mdash; a memo
                rule whose customer matches the transaction&apos;s QBO
                customer.
              </li>
              <li>
                <strong>&ldquo;Any customer&rdquo; memo rule</strong> with
                the same memo token.
              </li>
              <li>
                <strong>Fuzzy auto-match</strong> against property / lease /
                utility names (the legacy behavior used before rules existed).
              </li>
              <li>
                <strong>Account classifications</strong> decide whether
                anything left unmatched is treated as rent, utility, or
                other.
              </li>
            </ol>
            <p className="pt-1 italic">
              Customer links (above) feed step 2 by telling the engine which
              HousingOps customer each QBO customer maps to.
            </p>
          </CardContent>
        </Card>

        <section
          data-testid="qbo-rules-section-customers"
          className="space-y-2"
        >
          <h2 className="text-lg font-semibold">
            1 · Customer links
          </h2>
          <CustomerLinkRules
            links={data.customerLinks}
            onChanged={refresh}
          />
        </section>

        <section data-testid="qbo-rules-section-memo" className="space-y-2">
          <h2 className="text-lg font-semibold">
            2 · Memo &rarr; property rules ({data.memoRules.length})
          </h2>
          <MemoRules
            key={prefillKey}
            rules={data.memoRules}
            customerLinks={data.customerLinks}
            onChanged={refresh}
            initialDraft={prefill ?? undefined}
            openOnMount={!!prefill}
          />
        </section>

        <section
          data-testid="qbo-rules-section-accounts"
          className="space-y-2"
        >
          <h2 className="text-lg font-semibold">
            3 · Account classifications ({data.accountClassifications.length})
          </h2>
          <AccountClassificationRules
            rows={data.accountClassifications as AccountClassification[]}
            onChanged={refresh}
          />
        </section>
      </div>
    </MainLayout>
  );
}
