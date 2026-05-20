import React from "react";
import "./_group.css";
import { LayoutDashboard, Home, Briefcase, KeyRound, BedDouble, Users, Zap, DollarSign, ShieldCheck, Settings, Search, Plus, Bell, ChevronDown } from "lucide-react";

export const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "customers", label: "Customers", icon: Briefcase },
  { id: "properties", label: "Properties", icon: Home },
  { id: "leases", label: "Leases", icon: KeyRound },
  { id: "beds", label: "Beds", icon: BedDouble },
  { id: "occupants", label: "Occupants", icon: Users },
  { id: "utilities", label: "Utilities", icon: Zap },
  { id: "finance", label: "Finance", icon: DollarSign },
  { id: "insurance", label: "Insurance", icon: ShieldCheck },
];

export function Sidebar({ activeId }: { activeId: string }) {
  return (
    <div className="w-[56px] flex-shrink-0 border-r border-[hsl(216,50%,30%)] flex flex-col items-center py-4 bg-[hsl(216,62%,22%)] h-full fixed left-0 top-0 z-10">
      <div className="w-8 h-8 rounded bg-[#d4be8a] flex items-center justify-center mb-8 flex-shrink-0">
        <Home className="w-5 h-5 text-[hsl(222,47%,11%)]" />
      </div>
      <div className="flex flex-col gap-4 w-full items-center">
        {navItems.map((item) => {
          const isActive = item.id === activeId;
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              className={`w-10 h-10 rounded flex items-center justify-center cursor-pointer transition-colors ${
                isActive ? "bg-[hsl(222,47%,11%)] text-[#d4be8a] shadow-[inset_2px_0_0_0_#d4be8a]" : "text-white/60 hover:bg-white/10 hover:text-white"
              }`}
              title={item.label}
            >
              <Icon className="w-5 h-5" />
            </div>
          );
        })}
      </div>
      <div className="mt-auto flex flex-col gap-4 w-full items-center">
        <div className="w-10 h-10 rounded flex items-center justify-center cursor-pointer text-white/60 hover:bg-white/10 hover:text-white">
          <Settings className="w-5 h-5" />
        </div>
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-xs font-semibold text-white mb-2">
          JD
        </div>
      </div>
    </div>
  );
}

export function PageHeader({ title, activeTab, breadcrumb }: { title: string; activeTab?: string; breadcrumb?: React.ReactNode }) {
  return (
    <div className="border-b border-[hsl(216,50%,30%)] px-8 pt-6 bg-[hsl(216,62%,22%)] flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          {breadcrumb && <div className="text-[hsl(215,20%,65%)] text-sm">{breadcrumb}</div>}
          <h1 className="text-2xl font-heading text-white">{title}</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(215,20%,65%)]" />
            <input 
              type="text" 
              placeholder="Search..." 
              className="ho-arch-dark-input pl-9 pr-4 py-1.5 rounded text-sm w-64 focus:outline-none focus:border-[#d4be8a]"
            />
          </div>
          <button className="relative text-[hsl(215,20%,65%)] hover:text-white">
            <Bell className="w-5 h-5" />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#ef4444]"></span>
          </button>
        </div>
      </div>
      
      <div className="flex items-center gap-6 overflow-x-auto no-scrollbar">
        {navItems.map(item => (
          <div 
            key={item.id} 
            className={`pb-3 text-sm font-medium border-b-2 cursor-pointer whitespace-nowrap ${
              item.id === activeTab 
                ? "border-[#d4be8a] text-white" 
                : "border-transparent text-[hsl(215,20%,65%)] hover:text-white"
            }`}
          >
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Layout({ children, activeId, title, breadcrumb }: { children: React.ReactNode; activeId: string; title: string; breadcrumb?: React.ReactNode }) {
  return (
    <div className="ho-arch-dark flex h-screen overflow-hidden">
      <Sidebar activeId={activeId} />
      <div className="flex-1 ml-[56px] flex flex-col h-full overflow-hidden">
        <PageHeader title={title} activeTab={activeId} breadcrumb={breadcrumb} />
        <div className="flex-1 overflow-auto p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
