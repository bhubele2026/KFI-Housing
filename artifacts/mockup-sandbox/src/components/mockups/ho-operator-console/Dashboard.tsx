import React from "react";
import { Sidebar, PageHeader, StatusDot } from "./Properties";
import { kpis, unplacedPayroll, projectedMoveIns, properties, customers } from "../_housingops-fixtures/data";
import { MoreHorizontal } from "lucide-react";
import "./_group.css";

const KpiTile = ({ label, value, sub }: { label: string, value: string | number, sub: string }) => (
  <div className="bg-white border rounded shadow-sm p-3 flex flex-col justify-between h-20 relative overflow-hidden">
    <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</div>
    <div className="flex items-baseline gap-2">
      <div className="text-xl font-bold operator-console-mono leading-none tracking-tight text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  </div>
);

export function Dashboard() {
  const getPropertyName = (id: string) => properties.find(p => p.id === id)?.name || id;
  const getCustomerName = (id: string) => customers.find(c => c.id === id)?.shortName || id;

  return (
    <div className="operator-console h-screen w-full flex bg-[#fbfcfd] overflow-hidden text-[13px]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader 
          breadcrumb="HousingOps"
          title="Dashboard"
        />
        
        <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
          <div className="grid grid-cols-4 gap-4">
            <KpiTile label="Active Properties" value={kpis.activeProperties} sub="Total" />
            <KpiTile label="Occupancy" value={`${kpis.occupancyPct}%`} sub={`${kpis.occupied}/${kpis.totalBeds} Beds`} />
            <KpiTile label="Monthly Rent" value={`$${kpis.monthlyRent.toLocaleString()}`} sub="Est. recurring" />
            <KpiTile label="Unmatched Payroll" value={kpis.payrollUnmatched} sub="Requires triage" />
          </div>

          <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
            {/* Table 1: Unmatched Payroll */}
            <div className="bg-white border rounded shadow-sm flex flex-col overflow-hidden">
              <div className="h-9 border-b flex items-center px-3 bg-[#f8f9fa] shrink-0 justify-between">
                <span className="text-xs font-bold text-foreground">Unmatched Payroll</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">May 16 Week</span>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                      <th className="py-2 px-3">Employee</th>
                      <th className="py-2 px-3">Employer</th>
                      <th className="py-2 px-3 text-right">Hours</th>
                      <th className="py-2 px-3 text-right">Charge</th>
                      <th className="py-2 px-3 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="text-xs">
                    {unplacedPayroll.filter(r => !r.matched).map(r => (
                      <tr key={r.id} className="operator-console-table-row hover:bg-blue-50/40 transition-colors group">
                        <td className="px-3 font-medium">{r.employee}</td>
                        <td className="px-3 text-muted-foreground">{r.employer}</td>
                        <td className="px-3 text-right operator-console-mono text-muted-foreground">{r.hours}</td>
                        <td className="px-3 text-right operator-console-mono text-destructive font-medium">${r.charge}</td>
                        <td className="px-3 text-center">
                          <button className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-all">
                            <MoreHorizontal size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Table 2: Upcoming Move-ins */}
            <div className="bg-white border rounded shadow-sm flex flex-col overflow-hidden">
              <div className="h-9 border-b flex items-center px-3 bg-[#f8f9fa] shrink-0 justify-between">
                <span className="text-xs font-bold text-foreground">Upcoming Move-Ins</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Next 7 Days</span>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                      <th className="py-2 px-3">Occupant</th>
                      <th className="py-2 px-3">Property / Bed</th>
                      <th className="py-2 px-3 text-right">Date</th>
                      <th className="py-2 px-3 text-right">Days</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs">
                    {projectedMoveIns.map(m => (
                      <tr key={m.id} className="operator-console-table-row hover:bg-blue-50/40 transition-colors group">
                        <td className="px-3 font-medium truncate">{m.occupant}</td>
                        <td className="px-3 text-muted-foreground truncate">
                          {m.property} <span className="text-border mx-1">/</span> <span className="operator-console-mono text-[11px]">{m.bed}</span>
                        </td>
                        <td className="px-3 text-right operator-console-mono text-muted-foreground">{m.date}</td>
                        <td className="px-3 text-right operator-console-mono font-medium text-amber-600">{m.daysAway}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}