import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Search, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { StatusDot, DeductionBadge, EmptyState } from "@/components/kit";

const baseUrl = (): string => import.meta.env.BASE_URL ?? "/";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

interface UnlinkedRow {
  occupantId: string;
  name: string;
  company: string;
  propertyName: string;
  bedId: string;
  zenopleStatus: string;
  weeklyDeduction: number;
  monthlyRentWePay: number;
}

interface Suggestion {
  zenoplePersonId: string;
  confidence: number;
  reasoning: string;
}

interface SuggestState {
  loading: boolean;
  suggestions: Suggestion[];
  asked: boolean;
}

export default function ZenopleReview() {
  const { toast } = useToast();
  const [rows, setRows] = useState<UnlinkedRow[]>([]);
  const [totalAtRisk, setTotalAtRisk] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suggests, setSuggests] = useState<Record<string, SuggestState>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl()}api/zenople/unlinked`);
      const body = (await res.json().catch(() => ({}))) as {
        rows?: UnlinkedRow[];
        totalMonthlyAtRisk?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Couldn't load the payroll-gap list.");
      setRows(body.rows ?? []);
      setTotalAtRisk(body.totalMonthlyAtRisk ?? 0);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't reach the server. Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const findMatches = async (occupantId: string) => {
    setSuggests((s) => ({
      ...s,
      [occupantId]: { loading: true, suggestions: s[occupantId]?.suggestions ?? [], asked: true },
    }));
    try {
      const res = await fetch(`${baseUrl()}api/zenople/match/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occupantId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        suggestions?: Suggestion[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Couldn't look up matches.");
      setSuggests((s) => ({
        ...s,
        [occupantId]: { loading: false, suggestions: body.suggestions ?? [], asked: true },
      }));
    } catch (e) {
      setSuggests((s) => ({
        ...s,
        [occupantId]: { loading: false, suggestions: [], asked: true },
      }));
      toast({
        title: "Couldn't find matches",
        description: e instanceof Error ? e.message : "Try again in a moment.",
        variant: "destructive",
      });
    }
  };

  const decide = async (
    occupantId: string,
    action: "confirm" | "mark_not" | "reject",
    zenoplePersonId?: string,
    label?: string,
  ) => {
    setBusy((b) => ({ ...b, [occupantId]: true }));
    try {
      const res = await fetch(`${baseUrl()}api/zenople/match/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occupantId, action, zenoplePersonId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't save that.");
      if (action === "reject") {
        // keep the person in the queue, just drop the bad suggestion
        setSuggests((s) => ({
          ...s,
          [occupantId]: {
            loading: false,
            asked: true,
            suggestions: (s[occupantId]?.suggestions ?? []).filter(
              (x) => x.zenoplePersonId !== zenoplePersonId,
            ),
          },
        }));
        toast({ title: "Cleared", description: "That suggestion was set aside." });
      } else {
        // confirm / mark_not -> person leaves the gap list
        setRows((r) => r.filter((x) => x.occupantId !== occupantId));
        toast({
          title: action === "confirm" ? "Matched" : "Marked not in payroll",
          description:
            action === "confirm"
              ? `${label ?? "Associate"} linked to payroll — their rent will deduct.`
              : `${label ?? "Associate"} flagged as not in payroll yet.`,
        });
      }
    } catch (e) {
      toast({
        title: "Didn't save",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy((b) => ({ ...b, [occupantId]: false }));
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-ink">Payroll gaps</h1>
        <p className="text-sm text-muted-foreground">
          People we're housing that payroll doesn't recognize yet. Confirm who they
          are in Zenople so their rent starts getting deducted — every one is rent
          we pay but don't recover.
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-risk/30 bg-risk-soft p-3">
        <AlertTriangle className="h-5 w-5 text-risk" />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Rent at risk / month
          </p>
          <p className="text-2xl font-bold tabular-nums text-risk">{money(totalAtRisk)}</p>
        </div>
        <p className="ml-auto text-sm text-muted-foreground tabular-nums">
          {rows.length} {rows.length === 1 ? "person" : "people"} to review
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load the list"
          description={error}
          action={
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No payroll gaps"
          description="Everyone we're housing is linked to payroll and being deducted. Nice."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const sg = suggests[r.occupantId];
            const isBusy = busy[r.occupantId];
            return (
              <div
                key={r.occupantId}
                className="rounded-lg border border-line bg-panel p-3"
                data-testid={`gap-row-${r.occupantId}`}
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <StatusDot
                        status={r.zenopleStatus === "needs_review" ? "warn" : "risk"}
                      />
                      <span className="font-semibold text-ink">{r.name}</span>
                      <span className="text-xs text-muted-foreground">{r.company}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {r.propertyName || "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Rent we pay / mo
                    </p>
                    <p className="text-base font-semibold tabular-nums text-risk">
                      {money(r.monthlyRentWePay)}
                    </p>
                  </div>
                  <DeductionBadge
                    weeklyAmount={r.weeklyDeduction || null}
                    zenopleStatus={r.zenopleStatus}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={isBusy || sg?.loading}
                      onClick={() => void findMatches(r.occupantId)}
                    >
                      <Search className="h-3.5 w-3.5" />
                      {sg?.asked ? "Re-check" : "Find matches"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground"
                      disabled={isBusy}
                      onClick={() =>
                        void decide(r.occupantId, "mark_not", undefined, r.name)
                      }
                    >
                      <UserX className="h-3.5 w-3.5" />
                      Not in payroll
                    </Button>
                  </div>
                </div>

                {sg && (
                  <div className="mt-3 border-t border-line pt-3">
                    {sg.loading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-9 w-2/3" />
                      </div>
                    ) : sg.suggestions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No Zenople match found — mark “Not in payroll” if they truly
                        aren't on payroll yet.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {sg.suggestions.map((s) => (
                          <li
                            key={s.zenoplePersonId}
                            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-surface/60 p-2"
                          >
                            <span className="font-mono text-xs text-ink">
                              {s.zenoplePersonId}
                            </span>
                            <span className="rounded bg-ok-soft px-1.5 py-0.5 text-xs font-medium tabular-nums text-ok">
                              {Math.round(s.confidence * 100)}% match
                            </span>
                            <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                              {s.reasoning}
                            </span>
                            <div className="flex gap-1.5">
                              <Button
                                size="sm"
                                className="h-7"
                                disabled={isBusy}
                                onClick={() =>
                                  void decide(
                                    r.occupantId,
                                    "confirm",
                                    s.zenoplePersonId,
                                    r.name,
                                  )
                                }
                              >
                                Confirm
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-muted-foreground"
                                disabled={isBusy}
                                onClick={() =>
                                  void decide(
                                    r.occupantId,
                                    "reject",
                                    s.zenoplePersonId,
                                    r.name,
                                  )
                                }
                              >
                                Reject
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
