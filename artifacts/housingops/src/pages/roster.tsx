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
 * Active Roster — the live pool of employees on assignment as of the
 * last payroll run, pulled from Zenople (`GET /roster/active`). Operators
 * search this pool and "Place in property" anyone not yet housed; that
 * creates an occupant on the chosen bed so they show up in the property.
 *
 * Replaces the old static `data/roster.ts` snapshot (which was really
 * just people with a housing *deduction*, not the active roster).
 */

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export default function RosterPage() {
  const [q, setQ] = useState("");
  const [company, setCompany] = useState<string>("");
  const [onlyOpen, setOnlyOpen] = useState(false);

  const rosterQuery = useListActiveRoster();
  const { occupants, properties, addOccupant, updateBed } = useData();

  const people = rosterQuery.data?.people ?? [];

  // Index housed occupants so we can tell, for each active employee,
  // whether they're already placed and where. Match on employeeId
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

  const rows = useMemo(() => {
    const needle = norm(q);
    return people.filter((r) => {
      if (company && r.company !== company) return false;
      if (onlyOpen && matchOccupant(r.personId, r.name)) return false;
      if (
        needle &&
        !norm(`${r.name} ${r.company} ${r.jobTitle}`).includes(needle)
      ) {
        return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, q, company, onlyOpen, housed]);

  const placedCount = useMemo(
    () => people.filter((r) => matchOccupant(r.personId, r.name)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [people, housed],
  );

  // Reconciliation: occupants marked Active in the app whose employeeId
  // (and name) are NOT in the active roster — likely a move-out that
  // hasn't been recorded yet.
  const staleOccupants = useMemo(() => {
    if (people.length === 0) return [];
    const activeIds = new Set(people.map((p) => p.personId));
    const activeNames = new Set(people.map((p) => norm(p.name)));
    return occupants.filter(
      (o) =>
        o.status === "Active" &&
        !(o.employeeId && activeIds.has(String(o.employeeId))) &&
        !activeNames.has(norm(o.name)),
    );
  }, [people, occupants]);

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="Active Roster"
          description="Employees on assignment as of the last payroll run (live from Zenople). Search the pool and place anyone into a property — they'll show up in that property."
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
              Loading the active roster from Zenople…
            </CardContent>
          </Card>
        ) : rosterQuery.isError ? (
          <Card>
            <CardContent className="py-10 text-center space-y-2">
              <AlertTriangle className="h-6 w-6 text-amber-500 mx-auto" />
              <p className="font-medium">Couldn't load the active roster from Zenople.</p>
              <p className="text-sm text-muted-foreground max-w-xl mx-auto">
                Check that <code>ZENOPLE_CLIENT_ID</code> / <code>ZENOPLE_CLIENT_SECRET</code>{" "}
                are set on the API server. If they are, the assignment fields may need a
                tweak — hit <code>/api/roster/active?fields=1</code> to see the field names
                Zenople returned.
              </p>
              <Button variant="outline" size="sm" onClick={() => rosterQuery.refetch()}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardContent className="py-4">
                  <div className="text-2xl font-semibold">{people.length}</div>
                  <div className="text-xs text-muted-foreground">Active employees</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4">
                  <div className="text-2xl font-semibold">{placedCount}</div>
                  <div className="text-xs text-muted-foreground">Currently housed</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4">
                  <div className="text-2xl font-semibold">{people.length - placedCount}</div>
                  <div className="text-xs text-muted-foreground">Not placed</div>
                </CardContent>
              </Card>
            </div>

            {staleOccupants.length > 0 && (
              <Card className="border-amber-300">
                <CardContent className="py-3 flex items-start gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-medium">
                      {staleOccupants.length} housed{" "}
                      {staleOccupants.length === 1 ? "person is" : "people are"} no longer on
                      the active roster
                    </span>{" "}
                    — likely move-outs to record:{" "}
                    <span className="text-muted-foreground">
                      {staleOccupants
                        .slice(0, 8)
                        .map((o) => o.name)
                        .join(", ")}
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
              <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyOpen}
                  onChange={(e) => setOnlyOpen(e.target.checked)}
                />
                Only show unplaced
              </label>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Housing</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          <Users className="h-5 w-5 mx-auto mb-2 opacity-50" />
                          No employees match.
                        </TableCell>
                      </TableRow>
                    ) : (
                      rows.map((r) => {
                        const occ = matchOccupant(r.personId, r.name);
                        const placedAt = occ?.propertyId ? propertyName.get(occ.propertyId) : null;
                        return (
                          <TableRow key={r.personId}>
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
                              {occ ? (
                                <Badge variant="secondary" className="gap-1">
                                  <Home className="h-3 w-3" />
                                  {placedAt ?? "Housed"}
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
                                  }}
                                  onAssign={(occupant, bed) => {
                                    addOccupant(occupant);
                                    updateBed(bed.id, {
                                      status: "Occupied",
                                      occupantId: occupant.id,
                                    });
                                  }}
                                  trigger={
                                    <Button size="sm" variant="outline">
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
