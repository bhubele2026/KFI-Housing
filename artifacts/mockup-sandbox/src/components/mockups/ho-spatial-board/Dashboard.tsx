import React from "react";
import { Layout } from "./Shared";
import { kpis, unplacedPayroll, projectedMoveIns } from "../_housingops-fixtures/data";
import { ArrowUpRight, ArrowDownRight, DollarSign, Users, Home, AlertTriangle, FileText, CheckCircle2 } from "lucide-react";
import "./_group.css";

export function Dashboard() {
  return (
    <Layout
      activeId="dashboard"
      title="Dashboard"
      headerActions={
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 bg-white border border-[hsl(214,32%,91%)] rounded-xl text-sm font-medium shadow-sm flex items-center gap-2 text-[hsl(217,71%,21%)] hover:bg-[#F8FAFC] transition-colors">
            <FileText className="w-4 h-4" /> Export Report
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-8 max-w-6xl mx-auto">
        
        {/* KPI Row */}
        <div className="grid grid-cols-4 gap-4">
          <KpiTile 
            label="Active Properties" 
            value={kpis.activeProperties.toString()} 
            icon={<Home className="w-4 h-4" />}
            trend={[2,3,4,4,5,6,6]}
            positive
          />
          <KpiTile 
            label="Total Occupancy" 
            value={`${kpis.occupancyPct}%`} 
            subValue={`${kpis.occupied} / ${kpis.totalBeds} beds`}
            icon={<Users className="w-4 h-4" />}
            trend={[65,66,68,70,69,70,71]}
            positive
          />
          <KpiTile 
            label="Monthly Rent" 
            value={`$${kpis.monthlyRent.toLocaleString()}`} 
            icon={<DollarSign className="w-4 h-4" />}
            trend={[15000, 15500, 16000, 16200, 17000, 17500, 17879]}
            positive
          />
          <KpiTile 
            label="Requires Attention" 
            value={(kpis.expiringSoon + kpis.needsReview + kpis.payrollUnmatched).toString()} 
            icon={<AlertTriangle className="w-4 h-4" />}
            trend={[8,7,6,6,5,4,6]}
            positive={false}
            alert
          />
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Unmatched Payroll */}
          <div className="spatial-card p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[hsl(217,71%,21%)]">Unmatched Payroll</h3>
              <span className="bg-amber-100 text-amber-800 text-xs font-medium px-2.5 py-1 rounded-md">
                {unplacedPayroll.length} Items
              </span>
            </div>
            <div className="border border-[hsl(214,32%,91%)] rounded-xl overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-[#F8FAFC] text-[hsl(215,16%,47%)] font-medium border-b border-[hsl(214,32%,91%)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Employer</th>
                    <th className="px-4 py-3 font-medium text-right">Charge</th>
                    <th className="px-4 py-3 font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[hsl(214,32%,91%)]">
                  {unplacedPayroll.map(row => (
                    <tr key={row.id} className="hover:bg-[#F8FAFC]/50 transition-colors">
                      <td className="px-4 py-3 font-medium">{row.employee}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.employer}</td>
                      <td className="px-4 py-3 text-right font-medium">${row.charge}</td>
                      <td className="px-4 py-3">
                        <button className="text-[hsl(217,75%,55%)] hover:text-[hsl(217,71%,21%)] transition-colors font-medium text-xs">
                          Match
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Upcoming Move-ins */}
          <div className="spatial-card p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[hsl(217,71%,21%)]">Upcoming Move-ins</h3>
              <span className="bg-blue-50 text-[hsl(217,75%,55%)] text-xs font-medium px-2.5 py-1 rounded-md">
                Next 7 Days
              </span>
            </div>
            <div className="border border-[hsl(214,32%,91%)] rounded-xl overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-[#F8FAFC] text-[hsl(215,16%,47%)] font-medium border-b border-[hsl(214,32%,91%)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Occupant</th>
                    <th className="px-4 py-3 font-medium">Property / Bed</th>
                    <th className="px-4 py-3 font-medium text-right">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[hsl(214,32%,91%)]">
                  {projectedMoveIns.map(row => (
                    <tr key={row.id} className="hover:bg-[#F8FAFC]/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.occupant}</div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{row.shift} Shift</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div>{row.property}</div>
                        <div className="text-xs">{row.bed}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-medium">{row.date}</div>
                        <div className="text-xs text-[hsl(217,75%,55%)] mt-0.5">In {row.daysAway} days</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>
    </Layout>
  );
}

function KpiTile({ label, value, subValue, icon, trend, positive, alert }: any) {
  const max = Math.max(...trend);
  const min = Math.min(...trend);
  const range = max - min || 1;
  
  return (
    <div className={`spatial-card p-5 flex flex-col gap-3 relative overflow-hidden group ${alert ? 'border border-amber-200' : ''}`}>
      <div className="flex items-center justify-between text-muted-foreground relative z-10">
        <span className="text-sm font-medium">{label}</span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${alert ? 'bg-amber-100 text-amber-600' : 'bg-[#F8FAFC] text-[hsl(217,71%,21%)]'}`}>
          {icon}
        </div>
      </div>
      
      <div className="relative z-10">
        <div className={`text-3xl font-bold tracking-tight ${alert ? 'text-amber-700' : 'text-[hsl(217,71%,21%)]'}`}>
          {value}
        </div>
        {subValue && (
          <div className="text-sm text-muted-foreground mt-1">{subValue}</div>
        )}
      </div>

      <div className="h-8 mt-2 flex items-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
        {trend.map((val: number, i: number) => {
          const height = Math.max(10, ((val - min) / range) * 100);
          return (
            <div 
              key={i} 
              className={`flex-1 rounded-t-sm ${alert ? 'bg-amber-300' : positive ? 'bg-[hsl(217,75%,55%)]' : 'bg-slate-300'}`} 
              style={{ height: `${height}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}
