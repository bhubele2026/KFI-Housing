import React from "react";
import { Layout, PageHeader, StatusBadge, EdButton } from "./Shared";
import { propertyDetail } from "../_housingops-fixtures/data";

export function PropertyDetail() {
  const { property, customer, beds, finance } = propertyDetail;

  return (
    <Layout activeId="properties">
      <PageHeader 
        breadcrumbs={["Properties", property.name]}
        title={property.name}
        subtitle={`${property.address}, ${property.city}, ${property.state}`}
      />
      
      <div className="px-12 pb-32 flex flex-col gap-24">
        
        {/* Overview Section */}
        <section>
          <div className="flex items-center justify-between border-b border-slate-900 pb-4 mb-8">
            <h2 className="text-3xl font-['Fraunces'] font-light text-slate-900">Overview</h2>
            <StatusBadge status={property.status} />
          </div>
          
          <div className="grid grid-cols-4 gap-12">
            <div className="flex flex-col gap-2">
              <span className="text-[11px] uppercase tracking-[0.15em] text-slate-500 font-medium">Customer</span>
              <span className="text-[18px] text-slate-900">{customer.name}</span>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[11px] uppercase tracking-[0.15em] text-slate-500 font-medium">Beds</span>
              <span className="text-[18px] text-slate-900 tabular-nums">{property.occupied} occupied / {property.totalBeds} total</span>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[11px] uppercase tracking-[0.15em] text-slate-500 font-medium">Monthly Rent</span>
              <span className="text-[18px] text-slate-900 tabular-nums">${finance.monthlyRent.toLocaleString()}</span>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[11px] uppercase tracking-[0.15em] text-slate-500 font-medium">Rating</span>
              <span className="text-[18px] text-slate-900 tabular-nums">{property.rating} / 5.0</span>
            </div>
          </div>
        </section>

        {/* Beds Section */}
        <section>
          <div className="flex items-center justify-between border-b border-slate-900 pb-4 mb-8">
            <h2 className="text-3xl font-['Fraunces'] font-light text-slate-900">Beds</h2>
            <EdButton variant="secondary">Add Bed</EdButton>
          </div>
          
          <table className="w-full text-left">
            <thead>
              <tr>
                <th className="font-medium text-[11px] uppercase tracking-[0.1em] text-slate-500 pb-4 border-b border-slate-200">Bed ID</th>
                <th className="font-medium text-[11px] uppercase tracking-[0.1em] text-slate-500 pb-4 border-b border-slate-200">Occupant</th>
                <th className="font-medium text-[11px] uppercase tracking-[0.1em] text-slate-500 pb-4 border-b border-slate-200">Rate</th>
                <th className="font-medium text-[11px] uppercase tracking-[0.1em] text-slate-500 pb-4 border-b border-slate-200 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {beds.map((b, i) => (
                <tr key={b.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                  <td className="py-5 text-[17px] text-slate-900 font-medium">{b.label}</td>
                  <td className="py-5 text-[17px] text-slate-600">{b.occupant || <span className="text-slate-400 italic">Empty</span>}</td>
                  <td className="py-5 text-[17px] text-slate-900 tabular-nums">${b.rate}/mo</td>
                  <td className="py-5 text-right">
                    <span className={`inline-flex items-center px-2 py-1 text-xs font-medium uppercase tracking-wider ${b.status === 'Occupied' ? 'text-emerald-700' : b.status === 'Pending' ? 'text-amber-700' : 'text-slate-500'}`}>
                      {b.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Finance Section */}
        <section>
          <div className="flex items-center justify-between border-b border-slate-900 pb-4 mb-8">
            <h2 className="text-3xl font-['Fraunces'] font-light text-slate-900">Finance</h2>
            <EdButton variant="ghost">View Ledger</EdButton>
          </div>
          
          <div className="grid grid-cols-2 gap-16">
            <div className="flex flex-col gap-6">
              <h3 className="text-[13px] uppercase tracking-[0.15em] text-slate-500 font-medium border-b border-slate-200 pb-2">Current Rates</h3>
              <div className="flex justify-between items-center py-2">
                <span className="text-[18px] text-slate-600">Base Rent (per bed)</span>
                <span className="text-[18px] text-slate-900 tabular-nums">${finance.perBedRent}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-[18px] text-slate-600">Electric (per bed)</span>
                <span className="text-[18px] text-slate-900 tabular-nums">${finance.perBedElectric}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-t border-slate-200 mt-2 pt-4">
                <span className="text-[18px] font-medium text-slate-900">Total Monthly Yield</span>
                <span className="text-[24px] font-['Fraunces'] text-slate-900 tabular-nums">${finance.monthlyRent + finance.monthlyElectric}</span>
              </div>
            </div>
            
            <div className="bg-slate-50 p-8 flex flex-col gap-4">
              <h3 className="text-[13px] uppercase tracking-[0.15em] text-slate-500 font-medium">Trailing 6 Months</h3>
              <div className="flex items-end gap-2 h-32 mt-4">
                {finance.last6.map((val, idx) => (
                  <div key={idx} className="flex-1 bg-[#1e3a8a]/80 hover:bg-[#1e3a8a] transition-colors relative group" style={{ height: `${(val / 4000) * 100}%`}}>
                     <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs py-1 px-2 rounded whitespace-nowrap pointer-events-none transition-opacity">
                       ${val}
                     </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

      </div>
    </Layout>
  )
}
