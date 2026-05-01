import { Link, useLocation } from "wouter";
import { Building2, LayoutDashboard, Home, KeyRound, BedDouble, Users, Zap, DollarSign, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/properties", label: "Properties", icon: Home },
  { href: "/leases", label: "Leases", icon: KeyRound },
  { href: "/beds", label: "Beds", icon: BedDouble },
  { href: "/occupants", label: "Occupants", icon: Users },
  { href: "/utilities", label: "Utilities", icon: Zap },
  { href: "/finance", label: "Finance", icon: DollarSign },
];

export function Sidebar() {
  const [location] = useLocation();
  const { logout } = useAuth();

  return (
    <div className="flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border shadow-lg">
      <div className="flex h-16 items-center px-6 border-b border-sidebar-border bg-sidebar-accent/30">
        <Building2 className="mr-3 h-6 w-6 text-primary" />
        <span className="text-xl font-bold tracking-tight">HousingOps</span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-6 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <span
                className={cn(
                  "group flex items-center rounded-md px-3 py-2 text-sm font-medium transition-all duration-200 cursor-pointer",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon
                  className={cn(
                    "mr-3 h-5 w-5 flex-shrink-0 transition-colors",
                    isActive ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/50 group-hover:text-sidebar-accent-foreground"
                  )}
                  aria-hidden="true"
                />
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-4 bg-sidebar-accent/10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold text-sm shadow-sm">
              AM
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium">Admin Manager</p>
              <p className="text-xs text-sidebar-foreground/60">admin@housingops.com</p>
            </div>
          </div>
        </div>
        <Button variant="outline" className="w-full justify-start text-muted-foreground border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={logout}>
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </Button>
      </div>
    </div>
  );
}
