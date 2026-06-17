import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { KfiLogo } from "@/components/kfi-logo";
import { useData } from "@/context/data-store";
import { computeHousingAudit } from "@/components/housing-audit-panel";
import { Settings, ClipboardList } from "lucide-react";

/**
 * Professional top navigation bar (navy), the primary "clicker" for the main
 * areas — like a bank's top nav. Sits above the page content; the sidebar
 * stays for the full list. Flat, brand-consistent, active section underlined.
 */
// Top bar is now the ONLY nav (sidebar removed). Keep it to the core
// areas; Transportation is intentionally hidden for now.
const PRIMARY = [
  { href: "/dashboard", key: "nav.dashboard", fallback: "Dashboard" },
  { href: "/customers", key: "nav.customers", fallback: "Customers" },
  { href: "/roster", key: "nav.roster", fallback: "Roster" },
  { href: "/economics", key: "nav.economics", fallback: "Economics" },
  { href: "/finance", key: "nav.finance", fallback: "Finance" },
];

export function TopNav() {
  const [location] = useLocation();
  const { t } = useTranslation();
  const { properties, leases } = useData();
  // Open data-quality issue count for the Review badge.
  const reviewCount = useMemo(() => {
    const a = computeHousingAudit(properties, leases);
    return a.missingRent.length + a.missingDates.length + a.rentAnomalies.length + a.duplicates.length;
  }, [properties, leases]);

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
      </nav>

      <div className="ml-auto flex items-center gap-3">
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
