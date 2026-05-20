import React from "react";
import { Layout, PageHeader, StatusBadge, EdButton } from "./Shared";
import { properties, customers } from "../_housingops-fixtures/data";

export function Properties() {
  return (
    <Layout activeId="properties">
      <PageHeader 
        title="Properties" 
        subtitle="Manage your housing portfolio, track occupancy, and monitor lease health." 
      />
      
      <div className="px-12 pb-24 flex flex-col gap-8">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div className="flex items-center gap-6">
            <span className="text-sm font-medium text-slate-900 border-b-2 border-slate-900 pb-4 -mb-[17px]">All Properties</span>
            <span className="text-sm text-slate-500 hover:text-slate-900 cursor-pointer pb-4 -mb-[17px]">Active</span>
            <span className="text-sm text-slate-500 hover:text-slate-900 cursor-pointer pb-4 -mb-[17px]">Needs Review</span>
          </div>
          <div className="flex gap-4">
            <input type="text" placeholder="Search properties..." className="border border-slate-200 px-4 py-2 text-sm focus:outline-none focus:border-slate-400 w-64 bg-slate-50/50" />
            <EdButton>Add Property</EdButton>
          </div>
        </div>

        <div className="bg-white">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr>
                <th className="font-medium text-xs uppercase tracking-[0.1em] text-slate-500 pb-4 border-b border-slate-200 pl-6">Name</th>
                <th className="font-medium text-xs uppercase tracking-[0.1em] text-slate-500 pb-4 border-b border-slate-200">Customer</th>
                <th className="font-medium text-xs uppercase tracking-[0.1em] text-slate-500 pb-4 border-b border-slate-200">Beds (Occ/Vac)</th>
                <th className="font-medium text-xs uppercase tracking-[0.1em] text-slate-500 pb-4 border-b border-slate-200">Rent</th>
                <th className="font-medium text-xs uppercase tracking-[0.1em] text-slate-500 pb-4 border-b border-slate-200">Status</th>
              </tr>
            </thead>
            <tbody>
              {properties.map((p, i) => {
                const customer = customers.find(c => c.id === p.customerId)?.name || "Unknown";
                const isExpiring = p.leaseEndDays !== null && p.leaseEndDays < 60;
                const statusColor = p.status === 'Inactive' ? 'border-slate-300' : isExpiring ? 'border-amber-400' : 'border-[#1e3a8a]';
                
                return (
                  <tr key={p.id} className="group relative border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                    <td className="py-5 pl-6 relative">
                      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${statusColor}`} />
                      <div className="flex flex-col gap-1">
                        <span className="text-[17px] font-medium text-slate-900">{p.name}</span>
                        <span className="text-[15px] text-slate-500 font-light">{p.address}, {p.city}</span>
                      </div>
                    </td>
                    <td className="py-5 text-[17px] text-slate-700">{customer}</td>
                    <td className="py-5">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[17px] tabular-nums text-slate-900">{p.totalBeds}</span>
                        <span className="text-[14px] text-slate-500 tabular-nums">({p.occupied} / {p.vacant})</span>
                      </div>
                    </td>
                    <td className="py-5 text-[17px] tabular-nums text-slate-900">${p.totalRent.toLocaleString()}<span className="text-[14px] text-slate-500">/mo</span></td>
                    <td className="py-5">
                      <StatusBadge status={p.status === 'Active' && isExpiring ? 'Expiring' : p.status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  )
}
