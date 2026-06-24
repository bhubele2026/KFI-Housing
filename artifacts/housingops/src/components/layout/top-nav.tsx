import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { KfiLogo } from "@/components/kfi-logo";
import { useData } from "@/context/data-store";
import { computeHousingAudit } from "@/components/housing-audit-panel";
import { Settings, ClipboardList, AlertTriangle, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

/**
 * Professional top navigation bar (navy), the primary "clicker" for the main
 * areas — like a bank's top nav. Collapsed (Stage 6) to the five areas a
 * manager works in: Dashboard · Clients · Properties · Roster · Money.
 * The money pages (Finance / Economics / Accounting) are grouped under the
 * single "Money" menu so the nav stops being a wall of tabs. Reconciliation /
 * Insurance / QBO stay reachable by their routes but off the top level.
 */
const PRIMARY = [
  { href: "/dashboard", key: "nav.dashboard", fallback: "Dashboard" },
  { href: "/customers", key: "nav.customers", fallback: "Clients" },
  { href: "/properties", key: "nav.properties", fallback: "Properties" },
  { href: "/roster", key: "nav.roster", fallback: "Roster" },
];

// Grouped under the "Money" menu.
const MONEY_GROUP = [
  { href: "/finance", key: "nav.finance", fallback: "Finance" },
  { href: "/economics", key: "nav.economics", fallback: "Economics" },
  { href: "/accounting", key: "nav.accounting", fallback: "Accounting" },
];

export function TopNav() {
  const [location] = useLocation();
  const { t } = useTranslation();
  const { properties, leases } = useData();
  const moneyActive = MONEY_GROUP.some(
    (m) => location === m.href || location.startsWith(m.href + "/"),
  );
  // Open data-quality issue count for the Review badge.
  const reviewCount = useMemo(() => {
    const a = computeHousingAudit(properties, leases);
    return a.missingRent.length + a.missingDates.length + a.rentAnomalies.length + a.duplicates.length;
  }, [properties, leases]);

  // Payroll-gap count: people we house that payroll doesn't know yet (Stage 3e).
  // Direct fetch — the endpoint isn't in the generated client.
  const [payrollGapCount, setPayrollGapCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const baseUrl = import.meta.env.BASE_URL ?? "/";
    fetch(`${baseUrl}api/zenople/unlinked`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { count?: number } | null) => {
        if (alive && b && typeof b.count === "number") setPayrollGapCount(b.count);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <header className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 bg-[#0b1f3a] px-4 py-2 text-white sm:px-6">
      <Link href="/dashboard" className="flex items-center" aria-label="KFI Workforce Deployment">
        <KfiLogo variant="mark" className="h-8 text-white" />
      </Link>

      <nav className="flex items-center gap-1">
        {PRIMARY.map((item) => {
          const active = location === item.href || location.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              data-testid={`topnav-${item.href.slice(1)}`}
              className={
                "relative rounded-md px-3 py-2 text-sm font-medium transition-colors " +
                (active
                  ? "text-white"
                  : "text-blue-100/70 hover:text-white hover:bg-white/5")
              }
            >
              {t(item.key, item.fallback)}
              {active && (
                <span className="absolute inset-x-3 -bottom-[2px] h-0.5 rounded-full bg-blue-300" />
              )}
            </Link>
          );
        })}

        {/* Money menu — groups Finance / Economics / Accounting. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid="topnav-money"
            className={
              "relative inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors " +
              (moneyActive
                ? "text-white"
                : "text-blue-100/70 hover:text-white hover:bg-white/5")
            }
          >
            {t("nav.money", "Money")}
            <ChevronDown className="h-3.5 w-3.5" />
            {moneyActive && (
              <span className="absolute inset-x-3 -bottom-[2px] h-0.5 rounded-full bg-blue-300" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {MONEY_GROUP.map((item) => (
              <DropdownMenuItem key={item.href} asChild>
                <Link href={item.href} data-testid={`topnav-${item.href.slice(1)}`}>
                  {t(item.key, item.fallback)}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <Link
          href="/zenople-review"
          data-testid="topnav-zenople-review"
          aria-label="Payroll gaps"
          title="Payroll gaps — housed people not yet deducted"
          className={
            "relative rounded-md p-2 transition-colors hover:bg-white/5 hover:text-white " +
            (location === "/zenople-review" ? "text-white" : "text-blue-100/70")
          }
        >
          <AlertTriangle className="h-5 w-5" />
          {payrollGapCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-4 text-white">
              {payrollGapCount > 99 ? "99+" : payrollGapCount}
            </span>
          )}
        </Link>
        <Link
          href="/review"
          data-testid="topnav-review"
          aria-label="Review"
          title="Review — data to clean up"
          className={
            "relative rounded-md p-2 transition-colors hover:bg-white/5 hover:text-white " +
            (location === "/review" ? "text-white" : "text-blue-100/70")
          }
        >
          <ClipboardList className="h-5 w-5" />
          {reviewCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-amber-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">
              {reviewCount > 99 ? "99+" : reviewCount}
            </span>
          )}
        </Link>
        <Link
          href="/settings"
          data-testid="topnav-settings"
          aria-label={t("nav.settings", "Settings")}
          title={t("nav.settings", "Settings")}
          className="rounded-md p-2 text-blue-100/70 transition-colors hover:bg-white/5 hover:text-white"
        >
          <Settings className="h-5 w-5" />
        </Link>
      </div>
    </header>
  );
}
