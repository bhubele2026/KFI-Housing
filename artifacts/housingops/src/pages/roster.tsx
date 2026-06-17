import { useMemo, useState } from "react";
import { useListActiveRoster } from "@workspace/api-client-react";
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
import { Search, Users, AlertTriangle, Home } from "lucide-react";
import { useData } from "@/context/data-store";
import { AssignOccupantDialog } from "@/components/assign-occupant-dialog";
import { CustomerLogo } from "@/components/customer-logo";
import { shortPropertyName } from "@/lib/property-name";

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

export default function RosterPage() {
  const [q, setQ] = useState("");
  const [company, setCompany] = useState<string>("");
  // "all" | "deduction" | "gap" (gap = has deduction but not placed)
  const [view, setView] = useState<"all" | "deduction" | "gap">("all");

  const rosterQuery = useListActiveRoster();
  const { occupants, properties, addOccupant, updateBed } = useData();

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
    for (const p of people) {
      const placed = !!matchOccupant(p.personId, p.name);
      if (p.hasDeduction) {
        withDeduction++;
        if (!placed) gap++;
      }
    }
    return { total: people.length, withDeduction, gap };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, housed]);

  const rows = useMemo(() => {
    const needle = norm(q);
    return people.filter((r) => {
      if (company && r.company !== company) return false;
      const placed = !!matchOccupant(r.personId, r.name);
      if (view === "deduction" && !r.hasDeduction) return false;
      if (view === "gap" && !(r.hasDeduction && !placed)) return false;
      if (
        needle &&
        !norm(`${r.name} ${r.company} ${r.jobTitle}`).includes(needle)
      ) {
        return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, q, company, view, housed]);

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
      <div className="p-8 max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="Active Roster"
          description="Everyone on the last payroll run (live from Zenople). Tagged by housing deduction, so you can spot anyone being charged for housing who isn't placed in a bed — then place them."
          actions={
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, company, role…"
                className="w-72 pl-8"
              />
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
            <div className="grid grid-cols-3 gap-3">
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
            </div>

            {staleOccupants.length > 0 && (
              <Card className="border-amber-300">
                <CardContent className="py-3 flex items-start gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-medium">
                      {staleOccupants.length} housed{" "}
                      {staleOccupants.length === 1 ? "person is" : "people are"} not on the
                      last payroll
                    </span>{" "}
                    — likely move-outs to record:{" "}
                    <span className="text-muted-foreground">
                      {staleOccupants.slice(0, 8).map((o) => o.name).join(", ")}
                      {staleOccupants.length > 8 ? `, +${staleOccupants.length - 8} more` : ""}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Company filter chips */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setCompany("")}
                className={
                  "rounded-full border px-3 py-1 text-sm " +
                  (company === "" ? "bg-primary text-primary-foreground border-primary" : "bg-card")
                }
              >
                All ({people.length})
              </button>
              {companies.map((c) => (
                <button
                  key={c}
                  onClick={() => setCompany(c)}
                  className={
                    "rounded-full border px-3 py-1 text-sm " +
                    (company === c ? "bg-primary text-primary-foreground border-primary" : "bg-card")
                  }
                >
                  {c}
                </button>
              ))}
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
                            <TableCell className="font-medium">{r.name}</TableCell>
                            <TableCell>
                              <span className="flex items-center gap-2">
                                {r.company ? <CustomerLogo name={r.company} size={18} /> : null}
                                {r.company || <span className="text-muted-foreground">—</span>}
                              </span>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {r.jobTitle || "—"}
                            </TableCell>
                            <TableCell>
                              {r.hasDeduction ? (
                                <span className="text-sm font-medium">{money(r.weeklyDeduction)}</span>
                              ) : (
                                <span className="text-muted-foreground text-sm">—</span>
                              )}
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
                                    name: r.name,
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
