import React from "react";
const Link = ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>;
import { Home, LayoutDashboard, Briefcase, KeyRound, BedDouble, Users, Zap, DollarSign, Settings, ShieldCheck, ChevronRight } from "lucide-react";

export const GoogleFonts = () => (
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..900&family=Inter:wght@400;500;600&display=swap" />
);

export function Sidebar({ activeId }: { activeId: string }) {
  const nav = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "customers", label: "Customers", icon: Briefcase },
    { id: "properties", label: "Properties", icon: Home },
    { id: "leases", label: "Leases", icon: KeyRound },
    { id: "beds", label: "Beds", icon: BedDouble },
    { id: "occupants", label: "Occupants", icon: Users },
    { id: "utilities", label: "Utilities", icon: Zap },
    { id: "finance", label: "Finance", icon: DollarSign },
    { id: "insurance", label: "Insurance", icon: ShieldCheck },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="w-64 flex-shrink-0 bg-[#1e2a3b] text-white flex flex-col min-h-screen">
      <div className="h-20 flex items-center px-8">
        <span className="font-['Fraunces'] text-2xl font-light tracking-wide text-white">HousingOps</span>
      </div>
      <div className="flex-1 py-6 px-4 flex flex-col gap-2">
        {nav.map(item => {
          const isActive = activeId === item.id;
          return (
            <div key={item.id} className={`flex items-center gap-4 px-4 py-2.5 rounded text-[15px] font-medium transition-colors cursor-pointer ${isActive ? 'bg-[#3b82f6]/20 text-[#60a5fa]' : 'text-slate-300 hover:text-white hover:bg-white/5'}`}>
              <item.icon className="w-[18px] h-[18px] opacity-80" />
              <span className="tracking-wide">{item.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  );
}

export function Layout({ children, activeId }: { children: React.ReactNode, activeId: string }) {
  return (
    <div className="flex min-h-screen bg-white text-slate-900 font-['Inter'] font-light">
      <GoogleFonts />
      <Sidebar activeId={activeId} />
      <div className="flex-1 flex flex-col min-w-0 max-w-[1200px] mx-auto">
        {children}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, breadcrumbs }: { title: string, subtitle?: string, breadcrumbs?: string[] }) {
  return (
    <div className="pt-16 pb-12 px-12">
      {breadcrumbs && (
        <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
          {breadcrumbs.map((b, i) => (
            <React.Fragment key={i}>
              <span>{b}</span>
              {i < breadcrumbs.length - 1 && <ChevronRight className="w-3 h-3" />}
            </React.Fragment>
          ))}
        </div>
      )}
      <h1 className="text-5xl font-['Fraunces'] font-light tracking-tight text-slate-900 mb-4">{title}</h1>
      {subtitle && <p className="text-xl text-slate-500 max-w-2xl leading-relaxed">{subtitle}</p>}
    </div>
  );
}

export function StatBlock({ label, value, delta, deltaType }: { label: string, value: string | number, delta?: string, deltaType?: 'positive'|'negative'|'neutral' }) {
  return (
    <div className="flex flex-col border-b border-slate-200 pb-5">
      <span className="text-[11px] uppercase tracking-[0.15em] text-slate-500 font-medium mb-3">{label}</span>
      <span className="text-[44px] font-['Fraunces'] font-light tracking-tight leading-none text-slate-900 mb-2 tabular-nums">{value}</span>
      {delta && (
        <span className={`text-sm ${deltaType === 'positive' ? 'text-emerald-600' : deltaType === 'negative' ? 'text-rose-600' : 'text-slate-500'}`}>
          {delta}
        </span>
      )}
    </div>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const getStyle = () => {
    switch (status.toLowerCase()) {
      case 'active': return 'text-[#1e3a8a] bg-blue-50 border-blue-200';
      case 'expiring': return 'text-amber-800 bg-amber-50 border-amber-200';
      case 'inactive': return 'text-slate-600 bg-slate-100 border-slate-200';
      case 'needs review': return 'text-rose-800 bg-rose-50 border-rose-200';
      default: return 'text-slate-600 bg-slate-100 border-slate-200';
    }
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${getStyle()}`}>
      {status}
    </span>
  );
}

export function EdButton({ children, variant = 'primary', className = '' }: { children: React.ReactNode, variant?: 'primary'|'secondary'|'ghost', className?: string }) {
  const base = "inline-flex items-center justify-center px-6 py-2.5 text-sm font-medium transition-colors focus:outline-none";
  const variants = {
    primary: "bg-[#1e3a8a] text-white hover:bg-[#1e3a8a]/90 rounded-none",
    secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200 rounded-none",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900 rounded-none"
  };
  return <button className={`${base} ${variants[variant]} ${className}`}>{children}</button>;
}
