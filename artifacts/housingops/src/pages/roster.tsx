import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Users, AlertTriangle, Home, ChevronDown, ChevronRight, ArrowLeftRight, LogOut } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useData } from "@/context/data-store";
import { AssignOccupantDialog } from "@/components/assign-occupant-dialog";
import { shortPropertyName } from "@/lib/property-name";
import { titleCaseName } from "@/lib/name-format";
import { DeductionBadge } from "@/components/kit";
import { Sparkles } from "lucide-react";
import type { Occupant } from "@/data/mockData";

/**
 * Active Roster — built the way payroll thinks about it:
 *   • Headcount = everyone on the LAST PAYROLL RUN (Zenople PayrollData).
 *   • Each person is tagged with whether they carry a housing DEDUCTION.
 *   • The actionable group, highlighted, is "has a housing deduction but
 *     is NOT placed in a bed" — they're being charged for housing yet
 *     aren't assigned anywhere.
 * Operators place anyone into a property/bed; they then show up there.
 */

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const money = (n: number) =>
  `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}/wk`;

// ── Fuzzy name matching ──────────────────────────────────────────────
// Lightweight similarity used to SUGGEST who a housed-but-not-on-payroll
// person actually is on the live payroll (names drift: "Devin M. Law" vs
// "Devin Law"). Dice coefficient over character bigrams + a last-name
// token boost. Runs client-side over the few-hundred payroll names — no
// external service needed.
function bigrams(s: string): string[] {
  const t = norm(s).replace(/[^a-z0-9 ]/g, "");
  const grams: string[] = [];
  for (let i = 0; i < t.length - 1; i++) grams.push(t.slice(i, i + 2));
  return grams;
}
function dice(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.length === 0 || B.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const g of B) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      overlap++;
      counts.set(g, c - 1);
    }
  }
  return (2 * overlap) / (A.length + B.length);
}
function lastToken(s: string): string {
  const parts = norm(s).replace(/[^a-z ]/g, "").split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}
function nameScore(a: string, b: string): number {
  let s = dice(a, b);
  const la = lastToken(a);
  if (la && la === lastToken(b)) s = Math.min(1, s + 0.15);
  return s;
}

type RosterRow = {
  personId: string;
  name: string;
  aliases: string[];
  company: string;
  jobTitle: string;
  hasDeduction: boolean;
  weeklyDeduction: number;
};
type RosterResponse = {
  asOf: string;
  payPeriod: string;
  periods: string[];
  count: number;
  withDeduction: number;
  people: RosterRow[];
};

export default function RosterPage() {
  const [q, setQ] = useState("");
  const [company, setCompany] = useState<string>("");
  // all | deduction | gap (charged, not placed) | placed-no-ded (housed, uncharged)
  const [view, setView] = useState<"all" | "deduction" | "gap" | "placed-no-ded">("all");
  const [sort, setSort] = useState<"name" | "company" | "deduction">("name");
  const [showStale, setShowStale] = useState(false);
  const [period, setPeriod] = useState<string>(""); // "" = latest payroll period

  // Roster for the selected payroll period (period="" → latest). Fetched
  // directly (not the generated hook) so we can pass ?period=; the API is
  // open same-origin. Cached/keyed by period server-side.
  const rosterQuery = useQuery({
    queryKey: ["roster-active", period],
    queryFn: async (): Promise<RosterResponse> => {
      const res = await fetch(
        `/api/roster/active${period ? `?period=${encodeURIComponent(period)}` : ""}`,
      );
      if (!res.ok) throw new Error(`roster ${res.status}`);
      return res.json();
    },
  });
  const periods = rosterQuery.data?.periods ?? [];
  const payPeriod = rosterQuery.data?.payPeriod ?? "";
  const { occupants, properties, rooms, beds, addOccupant, updateBed, updateOccupant } = useData();

  const people = rosterQuery.data?.people ?? [];

  // Index housed occupants to resolve placement. Match on employeeId
  // (== Zenople personId) first, then fall back to a normalized name.
  const housed = useMemo(() => {
    const byEmployeeId = new Map<string, (typeof occupants)[number]>();
    const byName = new Map<string, (typeof occupants)[number]>();
    for (const o of occupants) {
      if (o.status !== "Active") continue;
      if (o.employeeId) byEmployeeId.set(String(o.employeeId), o);
      if (o.name) byName.set(norm(o.name), o);
    }
    return { byEmployeeId, byName };
  }, [occupants]);

  const propertyName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of properties) m.set(p.id, shortPropertyName(p.name));
    return m;
  }, [properties]);

  const matchOccupant = (personId: string, name: string) =>
    housed.byEmployeeId.get(personId) ?? housed.byName.get(norm(name));

  const companies = useMemo(
    () => Array.from(new Set(people.map((r) => r.company).filter(Boolean))).sort(),
    [people],
  );

  // Headline metrics in the user's terms.
  const stats = useMemo(() => {
    let withDeduction = 0;
    let gap = 0; // has deduction but not placed
    let placedNoDed = 0; // placed in a bed but NOT being charged
    for (const p of people) {
      const placed = !!matchOccupant(p.personId, p.name);
      if (p.hasDeduction) {
        withDeduction++;
        if (!placed) gap++;
      } else if (placed) {
        placedNoDed++;
      }
    }
    return { total: people.length, withDeduction, gap, placedNoDed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, housed]);

  const rows = useMemo(() => {
    const needle = norm(q);
    const filtered = people.filter((r) => {
      if (company && r.company !== company) return false;
      const placed = !!matchOccupant(r.personId, r.name);
      if (view === "deduction" && !r.hasDeduction) return false;
      if (view === "gap" && !(r.hasDeduction && !placed)) return false;
      if (view === "placed-no-ded" && !(placed && !r.hasDeduction)) return false;
      if (
        needle &&
        !norm(`${r.name} ${(r.aliases ?? []).join(" ")} ${r.company} ${r.jobTitle} ${r.personId}`).includes(needle)
      ) {
        return false;
      }
      return true;
    });
    const sorted = [...filtered];
    if (sort === "company") {
      sorted.sort((a, b) => (a.company || "~").localeCompare(b.company || "~") || a.name.localeCompare(b.name));
    } else if (sort === "deduction") {
      sorted.sort((a, b) => (b.weeklyDeduction || 0) - (a.weeklyDeduction || 0) || a.name.localeCompare(b.name));
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, q, company, view, sort, housed]);

  // Reconciliation: occupants marked Active in the app whose personId
  // (and name) are NOT on the last payroll — likely a move-out / term.
  const staleOccupants = useMemo(() => {
    if (people.length === 0) return [];
    const ids = new Set(people.map((p) => p.personId));
    const names = new Set(people.map((p) => norm(p.name)));
    return occupants.filter(
      (o) =>
        o.status === "Active" &&
        !(o.employeeId && ids.has(String(o.employeeId))) &&
        !names.has(norm(o.name)),
    );
  }, [people, occupants]);

  // Suggested match: for each housed person NOT on the live payroll, find
  // the closest name still on payroll (names drift between systems). Above
  // a confidence floor we offer a one-click "Link" that ties the occupant
  // to that Zenople person — resolving the mismatch.
  const staleSuggestions = useMemo(() => {
    const m = new Map<string, { personId: string; name: string; company: string; score: number }>();
    for (const o of staleOccupants) {
      let best: { personId: string; name: string; company: string; score: number } | null = null;
      for (const p of people) {
        // Score against the payroll name AND every known alias — catches a
        // person entered under a different spelling/nickname.
        const score = Math.max(
          nameScore(o.name, p.name),
          ...(p.aliases ?? []).map((a) => nameScore(o.name, a)),
        );
        if (!best || score > best.score) {
          best = { personId: p.personId, name: p.name, company: p.company, score };
        }
      }
      if (best && best.score >= 0.55) m.set(o.id, best);
    }
    return m;
  }, [staleOccupants, people]);

  // Link a housed occupant to the suggested payroll person (adopts the
  // Zenople id, canonical name + company) — they drop off the stale list.
  const handleLinkToPayroll = (
    o: Occupant,
    s: { personId: string; name: string; company: string },
  ) => {
    updateOccupant(o.id, {
      employeeId: s.personId,
      name: s.name,
      company: s.company || o.company,
    });
  };

  const roomName = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rooms) m.set(r.id, r.name);
    return m;
  }, [rooms]);

  // Where an occupant currently sits: "Property · Room · Bed N".
  const locationOf = (o: Occupant): string => {
    const parts: string[] = [];
    if (o.propertyId) parts.push(propertyName.get(o.propertyId) ?? "—");
    const bed = o.bedId ? beds.find((b) => b.id === o.bedId) : undefined;
    if (bed) {
      const rn = roomName.get(bed.roomId);
      if (rn) parts.push(rn);
      parts.push(`Bed ${bed.bedNumber}`);
    }
    return parts.join(" · ") || "—";
  };

  // Vacant, ready beds an occupant can be moved into (labelled).
  const vacantBeds = useMemo(() => {
    return beds
      .filter((b) => b.status === "Vacant" && b.cleaningStatus === "ready")
      .map((b) => ({
        id: b.id,
        propertyId: b.propertyId,
        label: `${propertyName.get(b.propertyId) ?? "—"} · ${roomName.get(b.roomId) ?? "—"} · Bed ${b.bedNumber}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [beds, propertyName, roomName]);

  // Remove someone from their bed (records the move-out): free the bed +
  // mark the occupant Former. Server frees the prior bed too — belt &
  // braces here keeps the UI instant.
  const handleMoveOut = (o: Occupant) => {
    if (o.bedId) updateBed(o.bedId, { status: "Vacant", occupantId: null });
    updateOccupant(o.id, { status: "Former", bedId: null });
  };

  // Move someone to a different vacant bed. The occupant PATCH frees the
  // prior bed automatically; we mark the destination occupied here.
  const handleMove = (o: Occupant, bedId: string, propertyId: string) => {
    updateOccupant(o.id, { bedId, propertyId });
    updateBed(bedId, { status: "Occupied", occupantId: o.id });
  };

  const StatCard = ({
    label,
    value,
    tone,
    onClick,
    active,
  }: {
    label: string;
    value: number;
    tone?: "default" | "warn";
    onClick?: () => void;
    active?: boolean;
  }) => (
    <Card
      onClick={onClick}
      className={
        (onClick ? "cursor-pointer transition-shadow hover:shadow-md " : "") +
        (active ? "ring-2 ring-primary " : "") +
        (tone === "warn" ? "border-amber-300" : "")
      }
    >
      <CardContent className="py-4">
        <div
          className={
            "text-2xl font-semibold " + (tone === "warn" ? "text-amber-600" : "")
          }
        >
          {value}
        </div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );

  return (
    <MainLayout>
      <div className="p-8 max-w-[1600px] mx-auto space-y-6">
        <PageHeader
          title="Active Roster"
          description="Everyone on the last payroll run (live from Zenople). Tagged by housing deduction, so you can spot anyone being charged for housing who isn't placed in a bed — then place them."
          actions={
            <div className="flex items-center gap-2">
              {periods.length > 0 && (
                <Select value={period || payPeriod} onValueChange={setPeriod}>
                  <SelectTrigger className="w-44" data-testid="select-roster-period">
                    <SelectValue placeholder="Pay period" />
                  </SelectTrigger>
                  <SelectContent>
                    {periods.map((p, i) => (
                      <SelectItem key={p} value={p}>
                        Pay period {p}
                        {i === 0 ? " (latest)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search name, company, role…"
                  className="w-72 pl-8"
                />
              </div>
            </div>
          }
        />

        {rosterQuery.isLoading ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Loading the roster from Zenople…
            </CardContent>
          </Card>
        ) : rosterQuery.isError ? (
          <Card>
            <CardContent className="py-10 text-center space-y-2">
              <AlertTriangle className="h-6 w-6 text-amber-500 mx-auto" />
              <p className="font-medium">Couldn't load the roster from Zenople.</p>
              <p className="text-sm text-muted-foreground max-w-xl mx-auto">
                Check <code>ZENOPLE_CLIENT_ID</code> / <code>ZENOPLE_CLIENT_SECRET</code> on
                the API server. If the headcount looks wrong, hit{" "}
                <code>/api/roster/active?fields=1</code> to see the payroll field names
                Zenople returned.
              </p>
              <Button variant="outline" size="sm" onClick={() => rosterQuery.refetch()}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Headline metrics — click to filter the list */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                label="On last payroll"
                value={stats.total}
                onClick={() => setView("all")}
                active={view === "all"}
              />
              <StatCard
                label="Have a housing deduction"
                value={stats.withDeduction}
                onClick={() => setView("deduction")}
                active={view === "deduction"}
              />
              <StatCard
                label="Charged but NOT placed"
                value={stats.gap}
                tone="warn"
                onClick={() => setView("gap")}
                active={view === "gap"}
              />
              <StatCard
                label="Placed, no deduction"
                value={stats.placedNoDed}
                tone="warn"
                onClick={() => setView("placed-no-ded")}
                active={view === "placed-no-ded"}
              />
            </div>

            {staleOccupants.length > 0 && (
              <Card className="border-amber-300 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowStale((v) => !v)}
                  className="w-full flex items-start gap-2 text-sm text-left py-3 px-4 hover:bg-amber-50/50"
                  data-testid="button-toggle-stale-occupants"
                >
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <span className="flex-1">
                    <span className="font-medium">
                      {staleOccupants.length} housed{" "}
                      {staleOccupants.length === 1 ? "person is" : "people are"} not on the
                      last payroll
                    </span>{" "}
                    — likely move-outs. Click to review, move, or move them out.
                  </span>
                  {showStale ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  )}
                </button>
                {showStale && (
                  <div className="border-t">
                    <Table className="[&_tbody_tr]:border-line [&_tbody_tr:nth-child(even)]:bg-surface/40 [&_td]:tabular-nums">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Works for</TableHead>
                          <TableHead>Current bed</TableHead>
                          <TableHead>Suggested payroll match</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {staleOccupants.map((o) => {
                          const sug = staleSuggestions.get(o.id);
                          return (
                          <TableRow key={o.id}>
                            <TableCell className="font-medium">{titleCaseName(o.name)}</TableCell>
                            <TableCell>
                              {o.company || <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-muted-foreground">{locationOf(o)}</TableCell>
                            <TableCell>
                              {sug ? (
                                <button
                                  type="button"
                                  onClick={() => handleLinkToPayroll(o, sug)}
                                  title={`Link to ${titleCaseName(sug.name)} on payroll (${Math.round(sug.score * 100)}% name match)`}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-xs hover:bg-primary/10"
                                  data-testid={`button-stale-link-${o.id}`}
                                >
                                  <Sparkles className="h-3 w-3 text-primary" />
                                  <span className="font-medium">{titleCaseName(sug.name)}</span>
                                  <span className="text-muted-foreground">· Link</span>
                                </button>
                              ) : (
                                <span className="text-xs text-muted-foreground">No close match</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <MoveBedDialog
                                  occupant={o}
                                  vacantBeds={vacantBeds}
                                  onMove={handleMove}
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1 h-7 text-destructive hover:text-destructive"
                                  onClick={() => handleMoveOut(o)}
                                  data-testid={`button-stale-moveout-${o.id}`}
                                >
                                  <LogOut className="h-3.5 w-3.5" /> Move out
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>
            )}

            {/* Filters — a compact Company dropdown (replacing the old chip
                wall) + Sort, kept on one tidy row. */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Company</span>
                <Select value={company || "__all"} onValueChange={(v) => setCompany(v === "__all" ? "" : v)}>
                  <SelectTrigger className="h-8 w-64" data-testid="select-roster-company">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="__all">All companies ({people.length})</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Sort</span>
                <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                  <SelectTrigger className="h-8 w-44" data-testid="select-roster-sort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">Name A–Z</SelectItem>
                    <SelectItem value="company">Company</SelectItem>
                    <SelectItem value="deduction">Deduction (high → low)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Deduction</TableHead>
                      <TableHead>Housing</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          <Users className="h-5 w-5 mx-auto mb-2 opacity-50" />
                          No one matches.
                        </TableCell>
                      </TableRow>
                    ) : (
                      rows.map((r) => {
                        const occ = matchOccupant(r.personId, r.name);
                        const placedAt = occ?.propertyId ? propertyName.get(occ.propertyId) : null;
                        const gap = r.hasDeduction && !occ;
                        return (
                          <TableRow
                            key={r.personId}
                            className={gap ? "bg-amber-50/70 hover:bg-amber-50" : undefined}
                          >
                            <TableCell className="font-medium">
                              <div>{titleCaseName(r.name)}</div>
                              <div className="text-[11px] font-normal text-muted-foreground">
                                ID {r.personId}
                                {(r.aliases ?? []).length > 0 && (
                                  <span title={`Also known as: ${r.aliases.join(", ")}`}>
                                    {" · aka "}
                                    {r.aliases.slice(0, 2).join(", ")}
                                    {r.aliases.length > 2 ? "…" : ""}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {r.company || <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {r.jobTitle || "—"}
                            </TableCell>
                            <TableCell>
                              <DeductionBadge
                                weeklyAmount={r.hasDeduction ? r.weeklyDeduction : null}
                                zenopleStatus={occ ? "linked" : gap ? "needs_review" : "pending"}
                              />
                            </TableCell>
                            <TableCell>
                              {occ ? (
                                <Badge variant="secondary" className="gap-1">
                                  <Home className="h-3 w-3" />
                                  {placedAt ?? "Housed"}
                                </Badge>
                              ) : gap ? (
                                <Badge className="gap-1 bg-amber-500 hover:bg-amber-500 text-white">
                                  <AlertTriangle className="h-3 w-3" />
                                  Charged, no bed
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-sm">Not placed</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {occ ? (
                                <span className="text-xs text-muted-foreground">Placed</span>
                              ) : (
                                <AssignOccupantDialog
                                  initial={{
                                    name: titleCaseName(r.name),
                                    employeeId: r.personId,
                                    company: r.company,
                                    chargePerBed: r.weeklyDeduction || undefined,
                                    billingFrequency: r.weeklyDeduction ? "Weekly" : undefined,
                                  }}
                                  onAssign={(occupant, bed) => {
                                    addOccupant(occupant);
                                    updateBed(bed.id, {
                                      status: "Occupied",
                                      occupantId: occupant.id,
                                    });
                                  }}
                                  trigger={
                                    <Button size="sm" variant={gap ? "default" : "outline"}>
                                      Place in property
                                    </Button>
                                  }
                                />
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </MainLayout>
  );
}

// Move an existing occupant into a different vacant bed. Their current
// bed is freed by the occupant PATCH server-side; we mark the new bed
// occupied. Used from the "not on payroll" review table.
function MoveBedDialog({
  occupant,
  vacantBeds,
  onMove,
}: {
  occupant: Occupant;
  vacantBeds: { id: string; propertyId: string; label: string }[];
  onMove: (o: Occupant, bedId: string, propertyId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [bedId, setBedId] = useState("");
  const chosen = vacantBeds.find((b) => b.id === bedId);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setBedId("");
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="gap-1 h-7"
          data-testid={`button-stale-move-${occupant.id}`}
        >
          <ArrowLeftRight className="h-3.5 w-3.5" /> Move
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move {occupant.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <p className="text-sm text-muted-foreground">
            Pick a vacant, ready bed to move them into. Their current bed is freed
            automatically.
          </p>
          <Select value={bedId} onValueChange={setBedId}>
            <SelectTrigger data-testid={`select-stale-move-bed-${occupant.id}`}>
              <SelectValue
                placeholder={vacantBeds.length ? "Choose a vacant bed…" : "No vacant beds available"}
              />
            </SelectTrigger>
            <SelectContent>
              {vacantBeds.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!chosen}
              onClick={() => {
                if (chosen) {
                  onMove(occupant, chosen.id, chosen.propertyId);
                  setOpen(false);
                }
              }}
              data-testid={`button-stale-move-confirm-${occupant.id}`}
            >
              Move
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
