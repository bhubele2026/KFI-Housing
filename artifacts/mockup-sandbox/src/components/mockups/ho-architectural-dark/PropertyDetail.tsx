import React from "react";
import "./_group.css";
import { Layout } from "./Shared";
import { propertyDetail } from "../_housingops-fixtures/data";
import { MapPin, User, Building2, Star, TrendingUp, AlertTriangle } from "lucide-react";

export function PropertyDetail() {
  const { property, customer, beds, finance } = propertyDetail;

  const breadcrumb = (
    <div className="flex items-center gap-2">
      <span className="hover:text-white cursor-pointer">Properties</span>
      <span>/</span>
      <span className="text-white">{property.name}</span>
    </div>
  );

  return (
    <Layout activeId="properties" title={property.name} breadcrumb={breadcrumb}>
      <div className="flex flex-col gap-6">
        
        {/* Hero Section */}
        <div className="ho-arch-dark-card rounded-lg p-6 flex items-start justify-between relative overflow-hidden">
          {/* Abstract architectural bg element */}
          <div className="absolute -right-20 -top-20 w-64 h-64 border border-[hsl(216,50%,30%)] rounded-full opacity-20 pointer-events-none"></div>
          <div className="absolute right-10 -bottom-10 w-40 h-40 border border-[#d4be8a] rounded-full opacity-10 pointer-events-none"></div>

          <div className="flex gap-6 relative z-10">
            <div className="w-24 h-24 rounded bg-[hsl(216,50%,30%)] flex items-center justify-center flex-shrink-0">
              <Building2 className="w-10 h-10 text-white opacity-80" />
            </div>
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-2xl font-heading font-semibold text-white">{property.name}</h2>
                <span className="ho-arch-dark-badge-green px-2 py-0.5 rounded text-xs uppercase tracking-wider font-bold">Active</span>
              </div>
              <div className="flex items-center gap-6 text-sm ho-arch-dark-text-muted">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4" />
                  {property.address}, {property.city}, {property.state}
                </div>
                <div className="flex items-center gap-1.5">
                  <User className="w-4 h-4" />
                  {customer.name}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-8 relative z-10">
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider ho-arch-dark-text-muted mb-1">Occupancy</div>
              <div className="text-2xl font-semibold tabular-nums text-white">
                {property.occupied} <span className="text-lg text-[hsl(215,20%,65%)]">/ {property.totalBeds}</span>
              </div>
            </div>
            <div className="w-px h-12 bg-[hsl(216,50%,30%)]"></div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider ho-arch-dark-text-muted mb-1">Total Rent</div>
              <div className="text-2xl font-semibold tabular-nums text-[#d4be8a]">
                ${finance.monthlyRent.toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-3 gap-6">
          
          {/* Left Col: Beds */}
          <div className="col-span-2 flex flex-col gap-6">
            <div className="ho-arch-dark-card rounded-lg">
              <div className="p-5 border-b border-[hsl(216,50%,30%)] flex justify-between items-center">
                <h3 className="font-heading font-medium text-lg text-white">Beds ({property.totalBeds})</h3>
                <button className="ho-arch-dark-btn-secondary px-3 py-1.5 text-xs">Manage Beds</button>
              </div>
              <table className="w-full text-left ho-arch-dark-table">
                <thead>
                  <tr>
                    <th>Bed</th>
                    <th>Occupant</th>
                    <th>Rate</th>
                    <th className="text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {beds.map((b) => {
                    let statusClass = "ho-arch-dark-badge-neutral";
                    if (b.status === "Occupied") statusClass = "ho-arch-dark-badge-green";
                    else if (b.status === "Pending") statusClass = "ho-arch-dark-badge-amber";
                    else if (b.status === "Vacant") statusClass = "ho-arch-dark-badge-neutral";

                    return (
                      <tr key={b.id}>
                        <td className="font-medium tabular-nums">{b.label}</td>
                        <td className={b.occupant ? "text-white" : "ho-arch-dark-text-muted italic"}>
                          {b.occupant || "Unassigned"}
                        </td>
                        <td className="tabular-nums">${b.rate}/mo</td>
                        <td className="text-right">
                          <span className={`${statusClass} px-2 py-0.5 rounded text-xs`}>{b.status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Col: Finance & Ratings */}
          <div className="col-span-1 flex flex-col gap-6">
            <div className="ho-arch-dark-card rounded-lg">
              <div className="p-5 border-b border-[hsl(216,50%,30%)]">
                <h3 className="font-heading font-medium text-lg text-white">Financial Summary</h3>
              </div>
              <div className="p-5 flex flex-col gap-4">
                <div className="flex justify-between items-center">
                  <span className="ho-arch-dark-text-muted text-sm">Per Bed Rent</span>
                  <span className="font-medium tabular-nums text-white">${finance.perBedRent}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="ho-arch-dark-text-muted text-sm">Per Bed Electric</span>
                  <span className="font-medium tabular-nums text-white">${finance.perBedElectric}</span>
                </div>
                <div className="w-full h-px bg-[hsl(216,50%,30%)] my-2"></div>
                <div className="flex justify-between items-center">
                  <span className="ho-arch-dark-text-muted text-sm">Monthly Rent</span>
                  <span className="font-medium tabular-nums text-white">${finance.monthlyRent}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="ho-arch-dark-text-muted text-sm">Est. Electric</span>
                  <span className="font-medium tabular-nums text-white">${finance.monthlyElectric}</span>
                </div>
              </div>
            </div>

            <div className="ho-arch-dark-card rounded-lg">
              <div className="p-5 border-b border-[hsl(216,50%,30%)]">
                <h3 className="font-heading font-medium text-lg text-white">Ratings</h3>
              </div>
              <div className="p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between p-3 bg-white/5 rounded">
                  <span className="font-medium text-sm text-white uppercase tracking-wider">Overall</span>
                  <div className="flex items-center gap-2">
                    <Star className="w-4 h-4 text-[#d4be8a] fill-[#d4be8a]" />
                    <span className="font-bold tabular-nums text-[#d4be8a]">{property.rating.toFixed(1)}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="ho-arch-dark-text-muted">Landlord</span>
                  <span className="tabular-nums text-white">{property.ratings.landlord}/5</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="ho-arch-dark-text-muted">Cleanliness</span>
                  <span className="tabular-nums text-white">{property.ratings.cleanliness}/5</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="ho-arch-dark-text-muted">Amenities</span>
                  <span className="tabular-nums text-white">{property.ratings.amenities}/5</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </Layout>
  );
}
