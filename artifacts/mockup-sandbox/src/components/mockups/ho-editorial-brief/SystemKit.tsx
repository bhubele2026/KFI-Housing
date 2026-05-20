import React from "react";
import { GoogleFonts, Sidebar, StatBlock, StatusBadge, EdButton } from "./Shared";

export function SystemKit() {
  return (
    <div className="min-h-screen bg-[#f8fafc] p-12 font-['Inter'] flex flex-col gap-16">
      <GoogleFonts />
      
      <div className="max-w-[900px] mx-auto w-full flex flex-col gap-16">
        <div>
          <h1 className="text-4xl font-['Fraunces'] font-light tracking-tight text-slate-900 mb-2">Editorial Brief System Kit</h1>
          <p className="text-lg text-slate-500">Design language components and reference.</p>
        </div>

        <div className="grid grid-cols-2 gap-12">
          {/* Typography */}
          <div className="flex flex-col gap-6">
            <h2 className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-bold border-b border-slate-200 pb-2">Typography</h2>
            <div>
              <div className="text-[44px] font-['Fraunces'] font-light leading-tight mb-2">Fraunces 44px</div>
              <div className="text-xl text-slate-600 mb-2">Inter Regular 20px / Subtitle</div>
              <div className="text-[17px] text-slate-900 mb-2">Inter Medium 17px / Body</div>
              <div className="text-[11px] uppercase tracking-[0.15em] text-slate-500 font-bold">Inter Bold 11px / Eyebrow</div>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex flex-col gap-6">
            <h2 className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-bold border-b border-slate-200 pb-2">Buttons</h2>
            <div className="flex flex-wrap gap-4 items-start">
              <EdButton variant="primary">Primary Action</EdButton>
              <EdButton variant="secondary">Secondary Action</EdButton>
              <EdButton variant="ghost">Ghost Action</EdButton>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-12">
          {/* Stat Block */}
          <div className="flex flex-col gap-6">
            <h2 className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-bold border-b border-slate-200 pb-2">Stat Block</h2>
            <div className="bg-white p-8 border border-slate-100 shadow-sm">
              <StatBlock label="Monthly Yield" value="$14,250" delta="+4.2% MoM" deltaType="positive" />
            </div>
          </div>

          {/* Badges */}
          <div className="flex flex-col gap-6">
            <h2 className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-bold border-b border-slate-200 pb-2">Badges</h2>
            <div className="flex flex-wrap gap-4">
              <StatusBadge status="Active" />
              <StatusBadge status="Expiring" />
              <StatusBadge status="Needs review" />
              <StatusBadge status="Inactive" />
            </div>
          </div>
        </div>

        {/* Table Row */}
        <div className="flex flex-col gap-6">
          <h2 className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-bold border-b border-slate-200 pb-2">Table Row</h2>
          <div className="bg-white overflow-hidden shadow-sm border border-slate-100">
            <table className="w-full text-left">
              <tbody>
                <tr className="relative">
                  <td className="py-5 pl-6 relative w-1/3">
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#1e3a8a]" />
                    <div className="flex flex-col gap-1">
                      <span className="text-[17px] font-medium text-slate-900">Magnolia Court</span>
                      <span className="text-[15px] text-slate-500 font-light">412 Magnolia St, Mobile</span>
                    </div>
                  </td>
                  <td className="py-5 text-[17px] text-slate-700 w-1/3">Atlas Logistics</td>
                  <td className="py-5 text-[17px] tabular-nums text-slate-900 w-1/4">$3,420<span className="text-[14px] text-slate-500">/mo</span></td>
                  <td className="py-5 text-right pr-6">
                    <StatusBadge status="Active" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
