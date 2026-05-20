import React from "react";
import { Sidebar, PageHeader } from "./Shared";
import { Home, Users, DollarSign } from "lucide-react";
import "./_group.css";

export function SystemKit() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] font-spatial p-12 text-[hsl(222,47%,11%)] flex flex-col gap-16">
      
      <div className="max-w-4xl">
        <h1 className="text-4xl font-bold tracking-tight text-[hsl(217,71%,21%)] mb-2">Spatial Board</h1>
        <p className="text-muted-foreground text-lg mb-8">Design System Reference</p>
        
        <div className="space-y-16">
          
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Sidebar & Header</h2>
            <div className="relative h-64 border border-dashed border-slate-300 rounded-2xl bg-slate-50 overflow-hidden">
              <Sidebar activeId="properties" />
              <div className="ml-24">
                <PageHeader title="Page Title">
                  <button className="px-4 py-2 bg-[hsl(217,71%,21%)] text-white rounded-xl text-sm font-medium shadow-md shadow-[hsl(217,71%,21%)]/20">Primary Action</button>
                </PageHeader>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">KPI Tile</h2>
            <div className="w-80">
              <div className="spatial-card p-5 flex flex-col gap-3 relative overflow-hidden group">
                <div className="flex items-center justify-between text-muted-foreground relative z-10">
                  <span className="text-sm font-medium">Monthly Revenue</span>
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-[#F8FAFC] text-[hsl(217,71%,21%)]">
                    <DollarSign className="w-4 h-4" />
                  </div>
                </div>
                <div className="relative z-10">
                  <div className="text-3xl font-bold tracking-tight text-[hsl(217,71%,21%)]">$17,879</div>
                  <div className="text-sm text-muted-foreground mt-1">Across 6 properties</div>
                </div>
                <div className="h-8 mt-2 flex items-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                  {[4,5,6,6,7,8,9].map((val, i) => (
                    <div key={i} className="flex-1 rounded-t-sm bg-[hsl(217,75%,55%)]" style={{ height: `${val*10}%` }} />
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Table Row</h2>
            <div className="bg-white rounded-2xl border border-[hsl(214,32%,91%)] shadow-sm overflow-hidden max-w-3xl">
              <table className="w-full text-sm text-left">
                <tbody className="divide-y divide-[hsl(214,32%,91%)]">
                  <tr className="hover:bg-[#F8FAFC]/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-[hsl(217,71%,21%)]">Magnolia Court</div>
                      <div className="text-xs text-muted-foreground mt-0.5">412 Magnolia St, Mobile</div>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">Atlas Logistics</td>
                    <td className="px-6 py-4 text-right">
                      <div className="font-medium">11 / 12</div>
                      <div className="text-xs text-muted-foreground">92% occ</div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Status Badges</h2>
            <div className="flex gap-4">
              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700">Active</span>
              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-700">Expiring</span>
              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700">Inactive</span>
              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-rose-50 text-rose-700">Needs review</span>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Buttons</h2>
            <div className="flex items-center gap-4">
              <button className="px-4 py-2 bg-[hsl(217,71%,21%)] text-white rounded-xl text-sm font-medium shadow-md shadow-[hsl(217,71%,21%)]/20 hover:-translate-y-0.5 transition-transform">
                Primary Button
              </button>
              <button className="px-4 py-2 bg-white border border-[hsl(214,32%,91%)] rounded-xl text-sm font-medium shadow-sm hover:bg-[#F8FAFC] transition-colors text-[hsl(217,71%,21%)]">
                Secondary Button
              </button>
              <button className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-[hsl(217,71%,21%)] hover:bg-[#F8FAFC] transition-colors">
                Ghost Button
              </button>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
