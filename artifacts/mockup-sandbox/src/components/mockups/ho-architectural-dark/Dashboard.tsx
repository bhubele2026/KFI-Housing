import React from "react";
import "./_group.css";
import { Layout } from "./Shared";
import { kpis, unplacedPayroll, projectedMoveIns } from "../_housingops-fixtures/data";
import { DollarSign, Users, AlertTriangle, Home } from "lucide-react";

function KpiCard({ title, value, subtext, icon: Icon, isGood }: { title: string, value: string | number, subtext: string, icon: any, isGood?: boolean }) {
  return (
    <div className={`ho-arch-dark-card p-5 rounded-lg border-t-2 ${isGood ? "border-t-[#d4be8a]" : "border-t-[hsl(215,20%,65%)]"} relative overflow-hidden flex flex-col`}>
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-sm font-medium ho-arch-dark-text-muted uppercase tracking-wider">{title}</h3>
        <div className="p-2 rounded bg-white/5">
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
      <div className="text-3xl font-heading font-semibold text-white tabular-nums">{value}</div>
      <div className="text-xs ho-arch-dark-text-muted mt-2">{subtext}</div>
    </div>
  );
}

export function Dashboard() {
  return (
    <Layout activeId="dashboard" title="Dashboard">
      <div className="flex flex-col gap-6">
        
        {/* KPI Row */}
        <div className="grid grid-cols-4 gap-6">
          <KpiCard 
            title="Monthly Rent" 
            value={`$${kpis.monthlyRent.toLocaleString()}`} 
            subtext="Across all active leases" 
            icon={DollarSign} 
            isGood={true}
          />
          <KpiCard 
            title="Occupancy" 
            value={`${kpis.occupancyPct}%`} 
            subtext={`${kpis.occupied} of ${kpis.totalBeds} beds occupied`} 
            icon={Users} 
            isGood={true}
          />
          <KpiCard 
            title="Active Properties" 
            value={kpis.activeProperties} 
            subtext="Operating currently" 
            icon={Home} 
          />
          <KpiCard 
            title="Action Needed" 
            value={kpis.payrollUnmatched + kpis.needsReview} 
            subtext="Unmatched payroll & reviews" 
            icon={AlertTriangle} 
          />
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Unmatched Payroll */}
          <div className="ho-arch-dark-card rounded-lg flex flex-col">
            <div className="p-5 border-b border-[hsl(216,50%,30%)] flex justify-between items-center">
              <h3 className="font-heading font-medium text-lg text-white">Unmatched Payroll</h3>
              <span className="ho-arch-dark-badge-amber px-2 py-0.5 rounded text-xs">{kpis.payrollUnmatched} issues</span>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-left ho-arch-dark-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Employer</th>
                    <th>Week</th>
                    <th className="text-right">Charge</th>
                  </tr>
                </thead>
                <tbody>
                  {unplacedPayroll.map((row) => (
                    <tr key={row.id}>
                      <td className="font-medium">{row.employee}</td>
                      <td className="text-sm ho-arch-dark-text-muted">{row.employer}</td>
                      <td className="text-sm tabular-nums">{row.week}</td>
                      <td className="text-right tabular-nums text-white">${row.charge}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Upcoming Move-Ins */}
          <div className="ho-arch-dark-card rounded-lg flex flex-col">
            <div className="p-5 border-b border-[hsl(216,50%,30%)] flex justify-between items-center">
              <h3 className="font-heading font-medium text-lg text-white">Upcoming Move-Ins</h3>
              <button className="text-sm text-[#d4be8a] hover:underline">View All</button>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-left ho-arch-dark-table">
                <thead>
                  <tr>
                    <th>Occupant</th>
                    <th>Property & Bed</th>
                    <th>Date</th>
                    <th className="text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {projectedMoveIns.map((row) => (
                    <tr key={row.id}>
                      <td className="font-medium">{row.occupant}</td>
                      <td className="text-sm ho-arch-dark-text-muted">{row.property} • {row.bed}</td>
                      <td className="text-sm tabular-nums">{row.date}</td>
                      <td className="text-right">
                        <span className="ho-arch-dark-badge-neutral px-2 py-0.5 rounded text-xs whitespace-nowrap">
                          In {row.daysAway} days
                        </span>
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
