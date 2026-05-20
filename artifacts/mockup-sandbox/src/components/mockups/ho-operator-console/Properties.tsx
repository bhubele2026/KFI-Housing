import React from "react";
const Link = ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>;
import { LayoutDashboard, Home, Briefcase, KeyRound, BedDouble, Users, Zap, DollarSign, ShieldCheck, Settings, Search, Plus, Filter, MoreHorizontal } from "lucide-react";
import { navItems, properties, type Property, customers } from "../_housingops-fixtures/data";
import "./_group.css";

// --- Shared Components ---

export const Sidebar = () => (
  <div className="w-[56px] h-full flex flex-col items-center bg-[#15233b] py-3 shrink-0 border-r border-[#1a2c4a]">
    <div className="w-8 h-8 rounded bg-[#4182f2] flex items-center justify-center mb-6 text-white font-bold text-sm shadow-sm shadow-black/20">
      HO
    </div>

    <div className="flex flex-col gap-1 w-full px-2">
      {navItems.map((item, i) => {
        const Icon = {
          LayoutDashboard, Home, Briefcase, KeyRound, BedDouble, Users, Zap, DollarSign, ShieldCheck, Settings
        }[item.icon] as any;
        
        const isOps = ["Dashboard", "Customers", "Properties", "Leases", "Beds", "Occupants"].includes(item.label);
        const isFin = ["Utilities", "Finance", "Insurance"].includes(item.label);

        return (
          <React.Fragment key={item.id}>
            {i === 0 && <div className="text-[9px] uppercase tracking-widest text-[#6984ae] font-semibold text-center mt-2 mb-1">APP</div>}
            {i === 1 && <div className="text-[9px] uppercase tracking-widest text-[#6984ae] font-semibold text-center mt-4 mb-1">OPS</div>}
            {i === 6 && <div className="text-[9px] uppercase tracking-widest text-[#6984ae] font-semibold text-center mt-4 mb-1">FIN</div>}
            {i === 9 && <div className="text-[9px] uppercase tracking-widest text-[#6984ae] font-semibold text-center mt-4 mb-1">SYS</div>}

            <Link href={`/${item.id}`} className={`group relative w-10 h-10 rounded flex items-center justify-center transition-colors ${item.active ? 'bg-[#4182f2] text-white shadow-sm' : 'text-[#8ca8d1] hover:bg-[#1a2c4a] hover:text-white'}`}>
              <Icon size={16} strokeWidth={item.active ? 2.5 : 2} />
              <div className="absolute left-12 px-2 py-1 bg-[#1a2c4a] text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none z-50 whitespace-nowrap border border-[#2b4168]">
                {item.label}
              </div>
            </Link>
          </React.Fragment>
        );
      })}
    </div>
  </div>
);

export const PageHeader = ({ breadcrumb, title, actions, filters }: { breadcrumb: string, title: string, actions?: React.ReactNode, filters?: React.ReactNode }) => (
  <div className="h-12 border-b flex items-center justify-between px-4 shrink-0 bg-white">
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
        <span>{breadcrumb}</span>
        <span className="text-border">/</span>
        <span className="text-foreground">{title}</span>
      </div>
      {filters && (
        <>
          <div className="w-px h-4 bg-border mx-1" />
          {filters}
        </>
      )}
    </div>
    <div className="flex items-center gap-2">
      {actions}
    </div>
  </div>
);

export const Sparkline = ({ data }: { data: number[] }) => {
  if (!data || data.length === 0) return <svg width="60" height="16" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 60;
  const h = 16;
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((d - min) / range) * (h - 2) - 1;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <polyline points={points} fill="none" stroke="hsl(217 40% 65%)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

export const StatusDot = ({ status }: { status: string }) => {
  let color = "bg-muted-foreground";
  if (status === "Active") color = "bg-[#22c55e]";
  if (status === "Expiring") color = "bg-[#f59e0b]";
  if (status === "Needs review") color = "bg-[#ef4444]";
  if (status === "Inactive") color = "bg-[#94a3b8]";

  return (
    <div className="flex items-center gap-1.5 justify-end">
      <div className={`w-1.5 h-1.5 rounded-full ${color}`} />
      <span className="text-[11px] text-muted-foreground font-medium">{status}</span>
    </div>
  );
};

// --- Page ---

export function Properties() {
  const getCustomerShortName = (id: string) => customers.find(c => c.id === id)?.shortName || id;

  return (
    <div className="operator-console h-screen w-full flex bg-[#fbfcfd] overflow-hidden text-[13px]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader 
          breadcrumb="HousingOps"
          title="Properties"
          filters={
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-white border rounded px-2 h-7 gap-1.5 shadow-sm">
                <Search size={12} className="text-muted-foreground" />
                <input type="text" placeholder="Filter properties..." className="bg-transparent border-none outline-none text-xs w-48 placeholder:text-muted-foreground/60" />
              </div>
              <div className="flex items-center gap-1 bg-white border rounded px-2 h-7 shadow-sm text-xs font-medium hover:bg-muted cursor-pointer transition-colors">
                <Filter size={12} className="text-muted-foreground" />
                <span>Active</span>
              </div>
            </div>
          }
          actions={
            <button className="flex items-center gap-1.5 bg-[#12223a] text-white px-3 h-7 rounded shadow-sm text-xs font-medium hover:bg-[#1a2c4a] transition-colors">
              <Plus size={14} />
              <span>New Property</span>
            </button>
          }
        />
        
        <div className="flex-1 overflow-auto p-4">
          <div className="bg-white border rounded shadow-sm overflow-hidden flex flex-col">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b bg-[#f8f9fa] text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  <th className="py-2 px-3 w-[20%]">Property</th>
                  <th className="py-2 px-3">Trend</th>
                  <th className="py-2 px-3">Customer</th>
                  <th className="py-2 px-3 text-right">Beds</th>
                  <th className="py-2 px-3 text-right">Occ.</th>
                  <th className="py-2 px-3 text-right">Rent/Bed</th>
                  <th className="py-2 px-3 text-right">Rating</th>
                  <th className="py-2 px-3 text-right">Status</th>
                  <th className="py-2 px-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="text-xs">
                {properties.map(p => (
                  <tr key={p.id} className="operator-console-table-row hover:bg-blue-50/40 transition-colors group">
                    <td className="px-3 font-medium truncate">
                      <div className="flex items-center gap-2">
                        {p.name}
                      </div>
                    </td>
                    <td className="px-3">
                      <Sparkline data={p.trend} />
                    </td>
                    <td className="px-3 text-muted-foreground truncate">{getCustomerShortName(p.customerId)}</td>
                    <td className="px-3 text-right operator-console-mono text-muted-foreground">{p.totalBeds}</td>
                    <td className="px-3 text-right operator-console-mono">{p.occupied}</td>
                    <td className="px-3 text-right operator-console-mono text-muted-foreground">${p.rentPerBed}</td>
                    <td className="px-3 text-right operator-console-mono">{p.rating.toFixed(1)}</td>
                    <td className="px-3">
                      <StatusDot status={p.status} />
                    </td>
                    <td className="px-3 text-center">
                      <button className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-all">
                        <MoreHorizontal size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="h-8 bg-[#f8f9fa] border-t flex items-center px-4 justify-between text-[11px] text-muted-foreground">
              <span>{properties.length} properties</span>
              <span>Updated just now</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}