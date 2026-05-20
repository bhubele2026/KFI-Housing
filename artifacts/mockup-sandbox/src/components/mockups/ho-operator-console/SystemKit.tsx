import React from "react";
import { Sidebar, PageHeader, StatusDot } from "./Properties";
import "./_group.css";

const SystemBlock = ({ title, children }: { title: string, children: React.ReactNode }) => (
  <div className="mb-8">
    <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">{title}</h3>
    <div className="bg-white border rounded shadow-sm p-4 flex gap-6 items-start flex-wrap">
      {children}
    </div>
  </div>
);

export function SystemKit() {
  return (
    <div className="operator-console min-h-screen bg-[#fbfcfd] p-8 text-[13px] font-sans">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-8">Operator Console : System Kit</h1>
        
        <SystemBlock title="Colors & Typography">
          <div className="flex flex-col gap-2 w-full">
            <div className="flex gap-2">
              <div className="w-8 h-8 rounded bg-primary"></div>
              <div className="w-8 h-8 rounded bg-sidebar"></div>
              <div className="w-8 h-8 rounded bg-sidebar-primary"></div>
              <div className="w-8 h-8 rounded bg-chart-1"></div>
              <div className="w-8 h-8 rounded bg-chart-2"></div>
            </div>
            <div className="mt-2 flex gap-4">
              <span className="font-sans">Inter Sans-Serif</span>
              <span className="operator-console-mono">JetBrains Mono 1234.56</span>
            </div>
          </div>
        </SystemBlock>

        <SystemBlock title="Status Indicators">
          <StatusDot status="Active" />
          <StatusDot status="Expiring" />
          <StatusDot status="Needs review" />
          <StatusDot status="Inactive" />
        </SystemBlock>

        <SystemBlock title="Buttons">
          <button className="h-7 px-3 bg-[#12223a] text-white rounded shadow-sm text-xs font-medium hover:bg-[#1a2c4a] transition-colors">Primary Action</button>
          <button className="h-7 px-3 bg-white border rounded text-xs font-medium hover:bg-muted transition-colors shadow-sm">Secondary</button>
          <button className="h-7 px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors">Ghost</button>
        </SystemBlock>

        <SystemBlock title="KPI Tile">
          <div className="w-48 bg-white border rounded shadow-sm p-3 flex flex-col justify-between h-20">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Active Properties</div>
            <div className="flex items-baseline gap-2">
              <div className="text-xl font-bold operator-console-mono leading-none tracking-tight text-foreground">12</div>
              <div className="text-[11px] text-muted-foreground">Total</div>
            </div>
          </div>
        </SystemBlock>

        <SystemBlock title="Page Header">
          <div className="w-full">
            <PageHeader breadcrumb="HousingOps" title="Settings" />
          </div>
        </SystemBlock>

        <SystemBlock title="Table Row (32px)">
          <div className="w-full border rounded overflow-hidden">
            <table className="w-full text-left border-collapse">
              <tbody className="text-xs">
                <tr className="operator-console-table-row bg-white">
                  <td className="px-3 font-medium">Magnolia Court</td>
                  <td className="px-3 text-muted-foreground">Atlas Logistics</td>
                  <td className="px-3 text-right operator-console-mono">12</td>
                  <td className="px-3"><StatusDot status="Active" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </SystemBlock>
        
        <SystemBlock title="Sidebar Mini">
          <div className="h-64 border rounded overflow-hidden">
            <Sidebar />
          </div>
        </SystemBlock>

      </div>
    </div>
  );
}