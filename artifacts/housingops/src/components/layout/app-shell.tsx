import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { Users, Building2, ClipboardList, DollarSign, ChevronRight, Search } from "lucide-react";
import { KfiLogo } from "@/components/kfi-logo";
import { CommandBar } from "@/components/command-bar/command-bar";
import { AddMenu } from "@/components/add-menu/add-menu";
import { useData } from "@/context/data-store";
import { cn } from "@/lib/utils";

const GRAD = "bg-[linear-gradient(135deg,hsl(var(--grad1)),hsl(var(--grad2)))]";

type NavKey = "cust" | "props" | "roster" | "money";

function activeKey(path: string): NavKey | null {
  if (path.startsWith("/customers")) return "cust";
  if (path.startsWith("/properties") || path.startsWith("/beds")) return "props";
  if (path.startsWith("/roster")) return "roster";
  if (path.startsWith("/money") || path.startsWith("/finance") || path.startsWith("/economics") || path.startsWith("/accounting"))
    return "money";
  return null;
}

function NavBox({
  navKey,
  href,
  icon: Icon,
  label,
  big,
  sub,
  active,
}: {
  navKey: NavKey;
  href: string;
  icon: React.ElementType;
  label: string;
  big: React.ReactNode;
  sub: string;
  active: boolean;
}) {
  return (
    <Link href={href}>
      <div
        data-nav={navKey}
        className={cn(
          "cursor-pointer rounded-[18px] border border-transparent p-[18px] shadow-[0_1px_2px_rgba(16,24,40,.05),0_4px_14px_rgba(16,24,40,.06)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(16,24,40,.10)]",
          active ? GRAD : "bg-panel",
        )}
      >
        <div className="flex items-start justify-between">
          <span
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-[11px] text-lg",
              active ? "bg-white/[0.16] text-white" : "bg-chip text-chipink",
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <ChevronRight className={cn("h-[18px] w-[18px]", active ? "text-white/85" : "text-faint")} />
        </div>
        <div className={cn("mt-[15px] text-[11px] font-bold uppercase tracking-[0.6px]", active ? "text-white/85" : "text-faint")}>
          {label}
        </div>
        <div className={cn("text-[27px] font-extrabold leading-[1.1] tracking-[-0.4px] tabular-nums", active ? "text-white" : "text-ink")}>
          {big}
        </div>
        <div className={cn("mt-[3px] text-[12.5px]", active ? "text-white/85" : "text-muted-foreground")}>{sub}</div>
      </div>
    </Link>
  );
}

export function AppShell() {
  const [location] = useLocation();
  const active = activeKey(location);
  const { customers, properties, occupants, beds } = useData();

  const stats = useMemo(() => {
    const activeProps = properties.filter((p) => (p as { status?: string }).status !== "Inactive");
    const totalBeds = beds.length;
    const occ = beds.filter((b) => (b as { status?: string }).status === "Occupied").length;
    const pct = totalBeds > 0 ? Math.round((occ / totalBeds) * 100) : null;
    const housed = occupants.filter(
      (o) => (o as { bedId?: string }).bedId && (o as { status?: string }).status === "Active",
    ).length;
    return {
      customers: customers.length,
      properties: activeProps.length,
      propsSub: pct == null ? `${activeProps.length} locations` : `${pct}% full · ${totalBeds} beds`,
      housed,
    };
  }, [customers, properties, occupants, beds]);

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="border-b border-line bg-surface/70 backdrop-blur">
      <div className="mx-auto max-w-[1180px] px-6 pt-3.5">
        {/* slim top bar */}
        <div className="mb-4 flex items-center justify-between">
          <Link href="/dashboard">
            <div className="flex cursor-pointer items-center gap-3">
              <span className={cn("flex h-9 w-9 items-center justify-center rounded-[11px] p-1.5 text-white", GRAD)}>
                <KfiLogo variant="mark" className="h-full" />
              </span>
              <div className="leading-tight">
                <b className="text-[15px] text-ink">KFI Workforce Deployment</b>
                <small className="block text-[11px] font-semibold text-faint">Housing Operations</small>
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("kfi:command-open"))}
              className="flex items-center gap-1.5 rounded-[9px] border border-line bg-panel px-2.5 py-1.5 text-[12.5px] text-faint transition-colors hover:text-ink"
              aria-label="Search (Command+K)"
            >
              <Search className="h-3.5 w-3.5" /> Search
              <kbd className="rounded bg-track px-1 py-0.5 text-[10px] font-semibold">⌘K</kbd>
            </button>
            <AddMenu />
            <span className="hidden md:inline">{today}</span>
            <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#DCE7FB] text-[13px] font-bold text-brand">
              BH
            </span>
          </div>
        </div>
        <CommandBar />

        {/* four nav boxes */}
        <div className="grid grid-cols-2 gap-4 pb-5 md:grid-cols-4">
          <NavBox navKey="cust" href="/customers" icon={Users} label="Customers" big={stats.customers} sub="active clients" active={active === "cust"} />
          <NavBox navKey="props" href="/properties" icon={Building2} label="Properties" big={stats.properties} sub={stats.propsSub} active={active === "props"} />
          <NavBox navKey="roster" href="/roster" icon={ClipboardList} label="Roster" big={stats.housed} sub="housed associates" active={active === "roster"} />
          <NavBox navKey="money" href="/finance" icon={DollarSign} label="Money" big={<span className="text-[22px]">Review</span>} sub="week & month" active={active === "money"} />
        </div>
      </div>
    </div>
  );
}
