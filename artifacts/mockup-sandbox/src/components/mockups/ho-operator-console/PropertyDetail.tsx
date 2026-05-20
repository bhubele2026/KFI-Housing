import React from "react";
import { Sidebar, PageHeader, StatusDot, Sparkline } from "./Properties";
import { properties, customers, propertyDetail } from "../_housingops-fixtures/data";
import { X, ExternalLink, ChevronDown, MoreHorizontal } from "lucide-react";
import "./_group.css";

export function PropertyDetail() {
  const getCustomerShortName = (id: string) => customers.find(c => c.id === id)?.shortName || id;

  return (
    <div className="operator-console h-screen w-full flex bg-[#fbfcfd] overflow-hidden text-[13px]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 relative">
        <PageHeader 
          breadcrumb="HousingOps"
          title="Properties"
        />
        
        {/* Background List (Dimmed) */}
        <div className="flex-1 overflow-hidden p-4 opacity-30 pointer-events-none select-none">
          <div className="bg-white border rounded shadow-sm overflow-hidden flex flex-col h-full">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b bg-[#f8f9fa] text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  <th className="py-2 px-3">Property</th>
                  <th className="py-2 px-3">Customer</th>
                  <th className="py-2 px-3 text-right">Beds</th>
                  <th className="py-2 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="text-xs">
                {properties.map(p => (
                  <tr key={p.id} className="operator-console-table-row">
                    <td className="px-3 font-medium">{p.name}</td>
                    <td className="px-3 text-muted-foreground">{getCustomerShortName(p.customerId)}</td>
                    <td className="px-3 text-right operator-console-mono text-muted-foreground">{p.totalBeds}</td>
                    <td className="px-3"><StatusDot status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Drawer Overlay */}
        <div className="absolute inset-y-0 right-0 w-[520px] bg-white border-l shadow-2xl flex flex-col z-10 transform transition-transform">
          {/* Drawer Header */}
          <div className="px-5 py-4 border-b shrink-0 flex items-start justify-between bg-[#fbfcfd]">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">Magnolia Court</div>
              <h2 className="text-xl font-bold text-foreground leading-tight">{propertyDetail.property.name}</h2>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1 hover:text-foreground cursor-pointer transition-colors"><ExternalLink size={12}/> {propertyDetail.property.address}</span>
                <span className="text-border">|</span>
                <span>{propertyDetail.customer.name}</span>
                <span className="text-border">|</span>
                <StatusDot status={propertyDetail.property.status} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="h-7 px-3 bg-muted border rounded text-xs font-medium hover:bg-border transition-colors">Edit</button>
              <button className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted text-muted-foreground transition-colors">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Drawer Tabs */}
          <div className="px-5 border-b shrink-0 flex items-center gap-5 text-xs font-medium">
            {propertyDetail.tabs.map(t => (
              <div key={t} className={`py-2.5 border-b-2 cursor-pointer transition-colors ${t === 'Beds' ? 'border-[#12223a] text-[#12223a]' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                {t}
              </div>
            ))}
          </div>

          {/* Drawer Content - Beds Tab */}
          <div className="flex-1 overflow-auto operator-drawer-scroll p-5 flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-xs">
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Total Beds</span>
                  <span className="operator-console-mono font-medium">{propertyDetail.property.totalBeds}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Occupied</span>
                  <span className="operator-console-mono font-medium text-emerald-600">{propertyDetail.property.occupied}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Rent/Bed</span>
                  <span className="operator-console-mono font-medium">${propertyDetail.property.rentPerBed}</span>
                </div>
              </div>
              <button className="flex items-center gap-1 text-xs text-[#4182f2] font-medium hover:underline">
                Add Bed
              </button>
            </div>

            <div className="border rounded overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b bg-[#f8f9fa] text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <th className="py-2 px-3 w-[25%]">Bed ID</th>
                    <th className="py-2 px-3">Occupant</th>
                    <th className="py-2 px-3 text-right">Rate</th>
                    <th className="py-2 px-3 text-right w-[25%]">Status</th>
                  </tr>
                </thead>
                <tbody className="text-xs">
                  {propertyDetail.beds.map(b => (
                    <tr key={b.id} className="operator-console-table-row hover:bg-blue-50/40 transition-colors group cursor-pointer">
                      <td className="px-3 operator-console-mono text-muted-foreground">{b.label}</td>
                      <td className="px-3 font-medium truncate">{b.occupant || <span className="text-muted-foreground/50 italic">Empty</span>}</td>
                      <td className="px-3 text-right operator-console-mono text-muted-foreground">${b.rate}</td>
                      <td className="px-3 text-right">
                        <StatusDot status={b.status === 'Occupied' ? 'Active' : b.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t pt-5">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">Finance Overview</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="border rounded p-3 bg-[#f8f9fa]">
                  <div className="text-xs text-muted-foreground mb-1">Monthly Rent</div>
                  <div className="text-lg font-bold operator-console-mono leading-none">${propertyDetail.finance.monthlyRent.toLocaleString()}</div>
                </div>
                <div className="border rounded p-3 bg-[#f8f9fa]">
                  <div className="text-xs text-muted-foreground mb-1">Est. Electric</div>
                  <div className="text-lg font-bold operator-console-mono leading-none">${propertyDetail.finance.monthlyElectric.toLocaleString()}</div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}