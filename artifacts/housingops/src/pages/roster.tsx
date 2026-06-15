import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Users } from "lucide-react";
import { ROSTER } from "@/data/roster";
import { CustomerLogo } from "@/components/customer-logo";

/**
 * Active Roster — associates currently housed (from the occupancy master),
 * with the company they work for and where they live. This is the pool an
 * operator picks from when assigning someone to a bed. (Full payroll roster
 * can replace this once a CSV/Zenople export is loaded.)
 */
export default function RosterPage() {
  const [q, setQ] = useState("");
  const [company, setCompany] = useState<string>("");

  const companies = useMemo(
    () => Array.from(new Set(ROSTER.map((r) => r.company).filter(Boolean))).sort(),
    [],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ROSTER.filter(
      (r) =>
        (!company || r.company === company) &&
        (!needle || `${r.name} ${r.company} ${r.property}`.toLowerCase().includes(needle)),
    );
  }, [q, company]);

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="Active Roster"
          description="Associates currently housed — name, who they work for, and where they live. Use this to assign people to beds."
          actions={
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, property…" className="w-72 pl-8" />
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setCompany("")}
            className={"rounded-full border px-3 py-1 text-sm " + (company === "" ? "bg-primary text-primary-foreground border-primary" : "bg-card")}
          >
            All ({ROSTER.length})
          </button>
          {companies.map((c) => (
            <button
              key={c}
              onClick={() => setCompany(c)}
              className={"rounded-full border px-3 py-1 text-sm " + (company === c ? "bg-primary text-primary-foreground border-primary" : "bg-card")}
            >
              {c}
            </button>
          ))}
        </div>

        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Users className="h-5 w-5 text-primary" />
            <p className="text-sm">
              <span className="font-semibold">{rows.length}</span> associates
              {company ? <> at <span className="font-semibold">{company}</span></> : " housed"}.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Housed at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.name}-${i}`}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>
                      {r.company ? (
                        <span className="inline-flex items-center gap-2">
                          <CustomerLogo name={r.company} size={18} />
                          {r.company}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell><Badge variant="secondary" className="font-normal">{r.property}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Source: occupancy master (June 2026). For the full company payroll roster, load a CSV/Zenople export.
        </p>
      </div>
    </MainLayout>
  );
}
