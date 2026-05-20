import React from "react";
import "./_group.css";

export function SystemKit() {
  return (
    <div className="ho-arch-dark min-h-screen p-8 flex flex-col gap-12 font-sans bg-[hsl(216,62%,22%)] overflow-auto">
      
      <div>
        <h1 className="text-3xl font-heading text-white mb-2">Architectural Dark</h1>
        <p className="text-[hsl(215,20%,65%)] max-w-2xl leading-relaxed">
          Premium dark canvas. Financial/operations tools feel expensive in dark. A single warm accent (cream/gold) carries primary actions and totals. Architectural, gravitas, total cohesion.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-8">
        {/* Buttons */}
        <div className="ho-arch-dark-card p-6 rounded-lg flex flex-col gap-6">
          <h3 className="text-sm font-medium ho-arch-dark-text-muted uppercase tracking-wider mb-2">Buttons</h3>
          <div className="flex flex-col gap-4">
            <button className="ho-arch-dark-btn-primary px-4 py-2 w-full text-center">Primary Action</button>
            <button className="ho-arch-dark-btn-secondary px-4 py-2 w-full text-center">Secondary Action</button>
            <button className="text-[hsl(215,20%,65%)] hover:text-white px-4 py-2 w-full text-center border border-transparent hover:bg-white/5 rounded">Ghost Action</button>
          </div>
        </div>

        {/* Badges */}
        <div className="ho-arch-dark-card p-6 rounded-lg flex flex-col gap-6">
          <h3 className="text-sm font-medium ho-arch-dark-text-muted uppercase tracking-wider mb-2">Status Badges</h3>
          <div className="flex flex-col items-start gap-4">
            <span className="ho-arch-dark-badge-green px-2 py-0.5 rounded text-xs font-semibold tracking-wide">ACTIVE</span>
            <span className="ho-arch-dark-badge-amber px-2 py-0.5 rounded text-xs font-semibold tracking-wide">EXPIRING</span>
            <span className="ho-arch-dark-badge-red px-2 py-0.5 rounded text-xs font-semibold tracking-wide">INACTIVE</span>
            <span className="ho-arch-dark-badge-neutral px-2 py-0.5 rounded text-xs font-semibold tracking-wide">NEEDS REVIEW</span>
          </div>
        </div>

        {/* KPI Tile */}
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-medium ho-arch-dark-text-muted uppercase tracking-wider">KPI Tile (Good)</h3>
          <div className="ho-arch-dark-card p-5 rounded-lg border-t-2 border-t-[#d4be8a] relative overflow-hidden flex flex-col">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-sm font-medium ho-arch-dark-text-muted uppercase tracking-wider">Monthly Rent</h3>
            </div>
            <div className="text-3xl font-heading font-semibold text-white tabular-nums">$17,879</div>
            <div className="text-xs ho-arch-dark-text-muted mt-2">Across all active leases</div>
          </div>
        </div>
      </div>

      {/* Table Row */}
      <div className="flex flex-col gap-4">
        <h3 className="text-sm font-medium ho-arch-dark-text-muted uppercase tracking-wider">Table Row & Density</h3>
        <div className="ho-arch-dark-card rounded-lg overflow-hidden">
          <table className="w-full text-left ho-arch-dark-table">
            <thead>
              <tr>
                <th>Property</th>
                <th>Location</th>
                <th>Status</th>
                <th className="text-right">Rent/Bed</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-medium text-white">Magnolia Court</td>
                <td className="text-sm ho-arch-dark-text-muted">Mobile, AL</td>
                <td><span className="ho-arch-dark-badge-green px-2 py-0.5 rounded text-xs font-semibold">ACTIVE</span></td>
                <td className="text-right tabular-nums text-white">$285</td>
              </tr>
              <tr>
                <td className="font-medium text-white">Pinecrest Lodge</td>
                <td className="text-sm ho-arch-dark-text-muted">Daphne, AL</td>
                <td><span className="ho-arch-dark-badge-red px-2 py-0.5 rounded text-xs font-semibold">INACTIVE</span></td>
                <td className="text-right tabular-nums text-white">$0</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
