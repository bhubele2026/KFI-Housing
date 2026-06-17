import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { KfiLogo } from "@/components/kfi-logo";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { useData } from "@/context/data-store";
import { Briefcase, X, Settings } from "lucide-react";

/**
 * Professional top navigation bar (navy), the primary "clicker" for the main
 * areas — like a bank's top nav. Sits above the page content; the sidebar
 * stays for the full list. Flat, brand-consistent, active section underlined.
 */
const PRIMARY = [
  { href: "/dashboard", key: "nav.dashboard", fallback: "Dashboard" },
  { href: "/properties", key: "nav.properties", fallback: "Properties" },
  { href: "/leases", key: "nav.leases", fallback: "Leases" },
  { href: "/economics", key: "nav.economics", fallback: "Economics" },
  { href: "/roster", key: "nav.roster", fallback: "Roster" },
  { href: "/rental-companies", key: "nav.rentalCompanies", fallback: "Rental Companies" },
  { href: "/finance", key: "nav.finance", fallback: "Finance" },
];

export function TopNav() {
  const [location] = useLocation();
  const { t } = useTranslation();
  const { customerId, setCustomerId } = useCustomerScope();
  const { customers } = useData();
  const scoped =
    customerId !== ALL_CUSTOMERS ? customers.find((c) => c.id === customerId) : undefined;

  return (
    <header className="hidden md:flex h-14 items-center gap-6 bg-[#0b1f3a] px-6 text-white">
      <Link href="/dashboard" className="flex items-center" aria-label="KFI Workforce Deployment">
        <KfiLogo variant="mark" className="h-8 text-white" />
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
        {scoped && (
          <span className="flex items-center gap-1.5 rounded-full bg-white/10 py-1 pl-2.5 pr-1 text-xs">
            <Briefcase className="h-3.5 w-3.5 text-blue-200" />
            <span className="max-w-[180px] truncate">{scoped.name}</span>
            <button
              type="button"
              onClick={() => setCustomerId(ALL_CUSTOMERS)}
              className="rounded-full p-0.5 hover:bg-white/15"
              aria-label={t("nav.clearCustomerFilter", "Clear customer filter")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>
    </header>
  );
}
