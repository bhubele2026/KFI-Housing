import React, { useState, useMemo } from "react";
import { Layout } from "./Shared";
import { properties, customers, Property } from "../_housingops-fixtures/data";
import { Search, List, LayoutGrid, MapPin, MoreHorizontal, BedDouble, Users, DollarSign } from "lucide-react";
import "./_group.css";

export function Properties() {
  const [view, setView] = useState<"board" | "table">("board");

  const customersWithProps = useMemo(() => {
    return customers.map(c => ({
      ...c,
      properties: properties.filter(p => p.customerId === c.id)
    })).filter(c => c.properties.length > 0);
  }, []);

  return (
    <Layout
      activeId="properties"
      title="Properties"
      headerActions={
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search properties..." 
              className="pl-9 pr-4 py-2 bg-white border border-[hsl(214,32%,91%)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(217,75%,55%)] w-64 transition-all"
            />
          </div>
          <div className="flex items-center bg-[hsl(214,32%,91%)]/50 p-1 rounded-xl">
            <button 
              onClick={() => setView("board")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${view === "board" ? "bg-white text-[hsl(217,71%,21%)] shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <LayoutGrid className="w-4 h-4" /> Board
            </button>
            <button 
              onClick={() => setView("table")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${view === "table" ? "bg-white text-[hsl(217,71%,21%)] shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <List className="w-4 h-4" /> Table
            </button>
          </div>
        </div>
      }
    >
      {view === "board" ? (
        <div className="flex gap-6 overflow-x-auto pb-8 h-full items-start">
          {customersWithProps.map(customer => (
            <div key={customer.id} className="w-80 shrink-0 flex flex-col gap-4">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[hsl(217,75%,55%)]" />
                  <h3 className="font-semibold text-[hsl(217,71%,21%)]">{customer.name}</h3>
                </div>
                <span className="text-xs font-medium bg-white px-2 py-0.5 rounded-full text-muted-foreground shadow-sm">
                  {customer.properties.length}
                </span>
              </div>
              
              <div className="flex flex-col gap-4">
                {customer.properties.map(prop => (
                  <PropertyCard key={prop.id} property={prop} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[hsl(214,32%,91%)] shadow-sm overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-[#F8FAFC] text-[hsl(215,16%,47%)] font-medium border-b border-[hsl(214,32%,91%)]">
              <tr>
                <th className="px-6 py-4 font-medium">Property</th>
                <th className="px-6 py-4 font-medium">Customer</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium text-right">Beds</th>
                <th className="px-6 py-4 font-medium text-right">Rent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(214,32%,91%)]">
              {properties.map(prop => {
                const customer = customers.find(c => c.id === prop.customerId);
                return (
                  <tr key={prop.id} className="hover:bg-[#F8FAFC]/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-[hsl(217,71%,21%)]">{prop.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{prop.address}, {prop.city}</div>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">{customer?.name}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${
                        prop.status === "Active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"
                      }`}>
                        {prop.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="font-medium">{prop.occupied} / {prop.totalBeds}</div>
                      <div className="text-xs text-muted-foreground">{Math.round((prop.occupied/prop.totalBeds)*100)}% occ</div>
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-[hsl(217,71%,21%)]">
                      ${prop.totalRent.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}

function PropertyCard({ property }: { property: Property }) {
  const customer = customers.find(c => c.id === property.customerId);
  const occPct = Math.round((property.occupied / property.totalBeds) * 100);
  
  return (
    <div className="spatial-card cursor-pointer group flex flex-col overflow-hidden">
      <div className="h-24 relative overflow-hidden bg-[hsl(217,40%,65%)]">
        <div 
          className="absolute inset-0 opacity-40 mix-blend-multiply transition-transform duration-700 group-hover:scale-110"
          style={{ background: `linear-gradient(135deg, hsl(${property.thumbnailHue}, 70%, 40%), hsl(${property.thumbnailHue + 40}, 60%, 30%))` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(217,71%,21%)]/80 to-transparent" />
        <div className="absolute top-3 right-3">
          <button className="w-8 h-8 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-white hover:bg-white/30 transition-colors">
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
        <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
          <div className="text-white">
            <div className="text-xs font-medium opacity-80 mb-0.5 drop-shadow-md">{customer?.shortName}</div>
            <div className="font-semibold leading-tight drop-shadow-md truncate">{property.name}</div>
          </div>
        </div>
      </div>
      
      <div className="p-4 flex flex-col gap-4">
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-[hsl(217,75%,55%)]" />
          <span className="leading-snug">{property.address}<br/>{property.city}, {property.state}</span>
        </div>
        
        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-[hsl(214,32%,91%)]">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1"><BedDouble className="w-3 h-3"/> Beds</span>
            <span className="font-semibold text-[hsl(217,71%,21%)]">{property.totalBeds}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1"><Users className="w-3 h-3"/> Occ</span>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-[hsl(217,71%,21%)]">{occPct}%</span>
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1"><DollarSign className="w-3 h-3"/> Rent</span>
            <span className="font-semibold text-[hsl(217,71%,21%)]">${property.totalRent.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
