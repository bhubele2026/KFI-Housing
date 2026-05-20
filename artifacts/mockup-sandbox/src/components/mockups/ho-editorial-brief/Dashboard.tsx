import React from "react";
import { Layout, PageHeader, StatBlock, StatusBadge } from "./Shared";
import { kpis, unplacedPayroll, projectedMoveIns } from "../_housingops-fixtures/data";

export function Dashboard() {
  return (
    <Layout activeId="dashboard">
      <PageHeader 
        title="Dashboard" 
        subtitle="Good morning. Here is the operational state of your portfolio for the week of May 16." 
      />
      
      <div className="px-12 pb-24 flex flex-col gap-16">
        <div className="grid grid-cols-4 gap-12">
          <StatBlock label="Occupancy" value={`${kpis.occupancyPct}%`} delta="+2.1% from last week" deltaType="positive" />
          <StatBlock label="Total Beds" value={kpis.totalBeds} delta={`${kpis.occupied} occupied`} />
          <StatBlock label="Monthly Rent" value={`$${kpis.monthlyRent.toLocaleString()}`} delta="Est. collected" />
          <StatBlock label="Needs Review" value={kpis.needsReview + kpis.payrollUnmatched} delta={`${kpis.payrollUnmatched} payroll, ${kpis.needsReview} properties`} deltaType="negative" />
        </div>

        <div className="grid grid-cols-2 gap-16">
          <div className="flex flex-col gap-6">
            <div className="flex items-end justify-between border-b border-slate-200 pb-4">
              <h2 className="text-2xl font-['Fraunces'] font-light text-slate-900">Unmatched Payroll</h2>
              <a href="#" className="text-sm text-[#1e3a8a] font-medium hover:underline">View all</a>
            </div>
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className="font-medium text-[11px] uppercase tracking-[0.1em] text-slate-500 pb-3 border-b border-slate-200">Employee</th>
                  <th className="font-medium text-[11px] uppercase tracking-[0.1em] text-slate-500 pb-3 border-b border-slate-200">Employer</th>
                  <th className="font-medium text-[11px] uppercase tracking-[0.1em] text-slate-500 pb-3 border-b border-slate-200 text-right">Charge</th>
                </tr>
              </thead>
              <tbody>
                {unplacedPayroll.filter(r => !r.matched).map(row => (
                  <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                    <td className="py-4 text-[16px] text-slate-900 font-medium">{row.employee}</td>
                    <td className="py-4 text-[16px] text-slate-600">{row.employer}</td>
                    <td className="py-4 text-[16px] text-slate-900 tabular-nums text-right">${row.charge.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-6">
            <div className="flex items-end justify-between border-b border-slate-200 pb-4">
              <h2 className="text-2xl font-['Fraunces'] font-light text-slate-900">Upcoming Move-ins</h2>
              <a href="#" className="text-sm text-[#1e3a8a] font-medium hover:underline">View timeline</a>
            </div>
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className="font-medium text-[11px] uppercase tracking-[0.1em] text-slate-500 pb-3 border-b border-slate-200">Occupant</th>
                  <th className="font-medium text-[11px] uppercase tracking-[0.1em] text-slate-500 pb-3 border-b border-slate-200">Location</th>
                  <th className="font-medium text-[11px] uppercase tracking-[0.1em] text-slate-500 pb-3 border-b border-slate-200 text-right">Date</th>
                </tr>
              </thead>
              <tbody>
                {projectedMoveIns.map(row => (
                  <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                    <td className="py-4 text-[16px] text-slate-900 font-medium">{row.occupant}</td>
                    <td className="py-4 text-[16px] text-slate-600">{row.property} • {row.bed}</td>
                    <td className="py-4 text-[16px] text-slate-900 text-right">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${row.daysAway <= 3 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>
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
    </Layout>
  )
}
