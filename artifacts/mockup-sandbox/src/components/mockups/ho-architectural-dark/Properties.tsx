import React from "react";
import "./_group.css";
import { Layout } from "./Shared";
import { customers, properties } from "../_housingops-fixtures/data";
import { Plus, Filter, ArrowUpDown, MapPin, Building2, User } from "lucide-react";

export function Properties() {
  return (
    <Layout activeId="properties" title="Properties">
      <div className="flex flex-col gap-6">
        
        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="ho-arch-dark-card px-3 py-1.5 rounded flex items-center gap-2 text-sm text-white">
              <span className="ho-arch-dark-text-muted">Status:</span>
              <span>All</span>
              <ArrowUpDown className="w-3 h-3 ml-1 ho-arch-dark-text-muted" />
            </div>
            <div className="ho-arch-dark-card px-3 py-1.5 rounded flex items-center gap-2 text-sm text-white">
              <span className="ho-arch-dark-text-muted">Customer:</span>
              <span>All</span>
              <ArrowUpDown className="w-3 h-3 ml-1 ho-arch-dark-text-muted" />
            </div>
            <button className="text-sm ho-arch-dark-text-muted flex items-center gap-1 hover:text-white px-2">
              <Filter className="w-4 h-4" /> More Filters
            </button>
          </div>
          
          <button className="ho-arch-dark-btn-primary px-4 py-2 text-sm flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add Property
          </button>
        </div>

        {/* Board / Table */}
        <div className="ho-arch-dark-card rounded-lg overflow-hidden border border-[hsl(216,50%,30%)]">
          <table className="w-full text-left border-collapse ho-arch-dark-table">
            <thead>
              <tr>
                <th>Property</th>
                <th>Location</th>
                <th>Customer</th>
                <th>Status</th>
                <th className="text-right">Occupancy</th>
                <th className="text-right">Rent/Bed</th>
                <th className="text-right">Total Rent</th>
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => {
                const customer = customers.find(c => c.id === p.customerId);
                const occPct = Math.round((p.occupied / p.totalBeds) * 100);
                
                let statusClass = "ho-arch-dark-badge-neutral";
                if (p.status === "Active") statusClass = "ho-arch-dark-badge-green";
                else if (p.status === "Inactive") statusClass = "ho-arch-dark-badge-red";

                return (
                  <tr key={p.id} className="hover:bg-white/[0.02] cursor-pointer">
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-[hsl(216,50%,30%)] flex items-center justify-center flex-shrink-0">
                          <Building2 className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <div className="font-medium text-white">{p.name}</div>
                          <div className="text-xs ho-arch-dark-text-muted">{p.address}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5 text-sm">
                        <MapPin className="w-3.5 h-3.5 ho-arch-dark-text-muted" />
                        <span>{p.city}, {p.state}</span>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5 text-sm">
                        <User className="w-3.5 h-3.5 ho-arch-dark-text-muted" />
                        <span>{customer?.name || "Unknown"}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`px-2 py-0.5 rounded text-xs ${statusClass}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="text-right">
                      <div className="flex flex-col items-end gap-1">
                        <div className="text-sm font-medium tabular-nums">
                          {p.occupied} / {p.totalBeds}
                        </div>
                        <div className="w-16 h-1.5 rounded-full bg-black/40 overflow-hidden">
                          <div 
                            className="h-full bg-[#d4be8a]" 
                            style={{ width: `${occPct}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="text-right text-sm tabular-nums">
                      ${p.rentPerBed}
                    </td>
                    <td className="text-right font-medium tabular-nums text-white">
                      ${p.totalRent.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      </div>
    </Layout>
  );
}
