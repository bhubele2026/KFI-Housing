import React from "react";
const Link = ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>;
import { navItems } from "../_housingops-fixtures/data";
import * as Icons from "lucide-react";
import "./_group.css";

export function Sidebar({ activeId }: { activeId: string }) {
  return (
    <div className="fixed left-4 top-4 bottom-4 w-16 spatial-sidebar rounded-2xl flex flex-col items-center py-6 shadow-xl border border-white/10 z-50">
      <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center mb-8 shrink-0">
        <Icons.Building2 className="w-5 h-5 text-white" />
      </div>
      
      <div className="flex-1 w-full flex flex-col items-center gap-4 overflow-y-auto hide-scrollbar">
        {navItems.map((item) => {
          const Icon = (Icons as any)[item.icon] || Icons.Circle;
          const isActive = item.id === activeId;
          return (
            <Link key={item.id} href={`/${item.id}`} className="group relative">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 ${
                  isActive 
                    ? "bg-[hsl(217,75%,55%)] text-white shadow-[0_0_15px_rgba(59,130,246,0.5)]" 
                    : "text-white/60 hover:text-white hover:bg-white/10"
                }`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <div className="absolute left-14 top-1/2 -translate-y-1/2 px-2 py-1 bg-[#1e293b] text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                {item.label}
              </div>
            </Link>
          );
        })}
      </div>
      
      <div className="w-10 h-10 rounded-full bg-white/20 mt-auto shrink-0 overflow-hidden border border-white/20">
        <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Admin" alt="User" className="w-full h-full object-cover" />
      </div>
    </div>
  );
}

export function PageHeader({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="h-20 flex items-center justify-between px-8 bg-white/50 backdrop-blur-md border-b border-[hsl(214,32%,91%)] sticky top-0 z-40 font-spatial">
      <h1 className="text-2xl font-semibold text-[hsl(217,71%,21%)] tracking-tight">{title}</h1>
      <div className="flex items-center gap-4">
        {children}
      </div>
    </div>
  );
}

export function Layout({ children, activeId, title, headerActions }: { children: React.ReactNode; activeId: string; title: React.ReactNode; headerActions?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F8FAFC] font-spatial text-[hsl(222,47%,11%)] flex">
      <Sidebar activeId={activeId} />
      <div className="flex-1 ml-24 min-w-0 flex flex-col h-screen overflow-hidden">
        <PageHeader title={title}>{headerActions}</PageHeader>
        <main className="flex-1 overflow-auto p-8 relative">
          {children}
        </main>
      </div>
    </div>
  );
}
