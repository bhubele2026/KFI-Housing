import React, { useState } from "react";
import { Layout } from "./Shared";
import { propertyDetail } from "../_housingops-fixtures/data";
import { ChevronLeft, MapPin, Building2, Users, DollarSign, BedDouble, Star } from "lucide-react";
const Link = ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>;
import "./_group.css";

export function PropertyDetail() {
  const { property, customer, beds, finance, tabs } = propertyDetail;
  const [activeTab, setActiveTab] = useState(tabs[0]);

  return (
    <Layout
      activeId="properties"
      title={
        <div className="flex items-center gap-3">
          <Link href="/properties" className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/5 transition-colors text-muted-foreground hover:text-foreground">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{customer.name}</span>
            <span>{property.name}</span>
          </div>
        </div>
      }
      headerActions={
        <button className="px-4 py-2 bg-[hsl(217,71%,21%)] text-white rounded-xl text-sm font-medium shadow-md shadow-[hsl(217,71%,21%)]/20 hover:shadow-lg hover:-translate-y-0.5 transition-all">
          Edit Property
        </button>
      }
    >
      <div className="absolute inset-0 z-0 bg-[#E2E8F0] overflow-hidden pointer-events-none">
        {/* Faux Map Background */}
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: 'radial-gradient(circle at 2px 2px, hsl(217 71% 21%) 1px, transparent 0)',
          backgroundSize: '32px 32px'
        }} />
        <div className="absolute left-[30%] top-[40%]">
          <div className="w-4 h-4 bg-[hsl(217,71%,21%)] rounded-full shadow-[0_0_0_4px_rgba(30,58,138,0.2)] animate-pulse" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-white/90" />
      </div>

      <div className="relative z-10 w-[640px] ml-auto h-full flex flex-col pt-4 pb-8">
        <div className="spatial-glass rounded-2xl border border-white/50 shadow-2xl flex flex-col h-full overflow-hidden">
          
          <div className="p-8 border-b border-white/40 shrink-0">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-3xl font-bold text-[hsl(217,71%,21%)] mb-2 tracking-tight">{property.name}</h2>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="w-4 h-4 text-[hsl(217,75%,55%)]" />
                  <span>{property.address}, {property.city}, {property.state}</span>
                </div>
              </div>
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[hsl(217,75%,55%)] to-[hsl(217,71%,21%)] flex items-center justify-center text-white shadow-lg">
                <Building2 className="w-8 h-8" />
              </div>
            </div>

            <div className="flex gap-2 p-1 bg-black/5 rounded-xl">
              {tabs.map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-medium transition-all ${
                    activeTab === tab 
                      ? "bg-white text-[hsl(217,71%,21%)] shadow-sm" 
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-auto p-8 pt-6 hide-scrollbar">
            {activeTab === "Overview" && (
              <div className="flex flex-col gap-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white/60 p-4 rounded-xl border border-white/50">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1"><BedDouble className="w-3 h-3"/> Occupancy</div>
                    <div className="text-2xl font-semibold text-[hsl(217,71%,21%)]">{property.occupied} / {property.totalBeds}</div>
                  </div>
                  <div className="bg-white/60 p-4 rounded-xl border border-white/50">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1"><DollarSign className="w-3 h-3"/> Monthly Rent</div>
                    <div className="text-2xl font-semibold text-[hsl(217,71%,21%)]">${finance.monthlyRent.toLocaleString()}</div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-[hsl(217,71%,21%)] mb-3">Recent Finance</h3>
                  <div className="h-32 bg-white/60 rounded-xl border border-white/50 p-4 flex items-end gap-2">
                    {finance.last6.map((val, i) => {
                      const max = Math.max(...finance.last6);
                      const height = `${(val / max) * 100}%`;
                      return (
                        <div key={i} className="flex-1 flex flex-col justify-end group">
                          <div className="w-full bg-[hsl(217,75%,55%)]/20 hover:bg-[hsl(217,75%,55%)] rounded-t-sm transition-colors relative" style={{ height }}>
                            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[#1e293b] text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity">
                              ${val}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "Beds" && (
              <div className="bg-white/80 rounded-xl border border-white/50 overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-black/5 text-[hsl(215,16%,47%)] font-medium">
                    <tr>
                      <th className="px-4 py-3">Bed</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Occupant</th>
                      <th className="px-4 py-3 text-right">Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5">
                    {beds.map(bed => (
                      <tr key={bed.id} className="hover:bg-black/5 transition-colors">
                        <td className="px-4 py-3 font-medium text-[hsl(217,71%,21%)]">{bed.label}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${
                            bed.status === "Occupied" ? "bg-emerald-100 text-emerald-700" :
                            bed.status === "Pending" ? "bg-blue-100 text-blue-700" :
                            "bg-slate-200 text-slate-700"
                          }`}>
                            {bed.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{bed.occupant || "—"}</td>
                        <td className="px-4 py-3 text-right font-medium">${bed.rate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            
            {activeTab !== "Overview" && activeTab !== "Beds" && (
              <div className="flex items-center justify-center h-48 text-muted-foreground bg-white/40 rounded-xl border border-white/50 border-dashed">
                Content for {activeTab}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
