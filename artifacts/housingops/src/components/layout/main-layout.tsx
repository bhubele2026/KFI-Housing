import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Briefcase, Copy, Menu, Receipt, X } from "lucide-react";
import { Sidebar } from "./sidebar";
import { useAuth, writeLastRoute } from "@/hooks/use-auth";
import { Link, Redirect, useLocation } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { useData, type DroppedRow } from "@/context/data-store";
import { useToast } from "@/hooks/use-toast";
import { useListUnplacedPayroll } from "@workspace/api-client-react";

const COLLAPSED_STORAGE_KEY = "housingops:sidebar-collapsed";

/**
 * Read the persisted collapsed flag synchronously on first render so
 * the rail doesn't flash from expanded → collapsed on reload. Wrapped
 * in try/catch because Safari Private Mode and SSR both throw on
 * localStorage access.
 */
function readPersistedCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function MainLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(readPersistedCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { customerId, setCustomerId } = useCustomerScope();
  const { customers, dataIssues } = useData();
  const activeScopedCustomer =
    customerId !== ALL_CUSTOMERS
      ? customers.find((c) => c.id === customerId)
      : undefined;

  // Remember the last authenticated page so reopening the tab lands the
  // operator back where they left off instead of always on /dashboard.
  // Scoped to MainLayout so the /login route — which never mounts this
  // component — can't poison the value.
  useEffect(() => {
    if (!isAuthenticated) return;
    writeLastRoute(location);
  }, [isAuthenticated, location]);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      // Persistence is best-effort — losing the preference between
      // reloads is preferable to crashing the shell.
    }
  }, [collapsed]);

  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop / tablet rail. Hidden under md so narrow viewports
          don't have the sidebar competing with the data tables — those
          operators reach the nav through the hamburger drawer below. */}
      <div className="hidden md:flex">
        <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </div>

      {/* Mobile drawer copy of the sidebar. Reuses the same component
          (always expanded) so nav, customer scope, and footer actions
          stay in sync with the desktop rail. */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          className="p-0 w-64 max-w-[85vw] border-r-sidebar-border [&>button]:hidden"
          data-testid="sidebar-mobile-drawer"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar collapsed={false} onNavigate={closeDrawer} />
        </SheetContent>
      </Sheet>

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile header — only the hamburger trigger. On md+ the
            desktop rail is visible and this bar collapses away. */}
        <div className="md:hidden flex h-12 items-center gap-2 border-b border-border bg-background px-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            data-testid="button-open-mobile-nav"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <span className="text-sm font-semibold">HousingOps</span>
          {activeScopedCustomer ? (
            <div
              className="ml-auto flex min-w-0 items-center gap-1 rounded-md border border-border bg-accent/40 py-1 pl-2 pr-1"
              data-testid="mobile-header-customer-scope"
            >
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="flex min-w-0 items-center gap-1.5 text-left"
                aria-label={`Filtered by customer: ${activeScopedCustomer.name}. Open navigation.`}
              >
                <Briefcase className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                <span
                  className="truncate max-w-[40vw] text-xs font-medium"
                  title={activeScopedCustomer.name}
                  data-testid="text-mobile-header-customer-name"
                >
                  {activeScopedCustomer.name}
                </span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCustomerId(ALL_CUSTOMERS);
                }}
                className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                aria-label="Clear customer filter"
                data-testid="button-mobile-header-clear-customer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </div>
        <PayrollReviewBar />
        <main className="flex-1 overflow-y-auto">
          {/* Inline notice when the data store dropped one or more
              malformed rows from a list response. Keeps the page from
              going blank because of a single bad row — operators see
              what's hidden and can dig into the console for details. */}
          {dataIssues.length > 0 ? (
            <DataIssuesBanner
              issues={dataIssues}
            />
          ) : null}
          {/* Inner boundary so a crash inside the page body keeps the
              Sidebar (rendered above this line) mounted and clickable.
              The outer App-level boundary still wraps everything as a
              safety net for the unauthenticated routes (e.g. /login)
              that never mount MainLayout. */}
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

function PayrollReviewBar() {
  const [location, navigate] = useLocation();
  const { customerId } = useCustomerScope();
  const { customers } = useData();
  const { data: unplacedPayrollResult } = useListUnplacedPayroll();

  const unplacedPayroll = unplacedPayrollResult?.unmatched;
  const lowConfidencePayroll = unplacedPayrollResult?.lowConfidenceMatches;

  const scopedUnplacedCount = useMemo(() => {
    const rows = unplacedPayroll ?? [];
    if (customerId === ALL_CUSTOMERS) return rows.length;
    const customerName = customers.find((c) => c.id === customerId)?.name;
    if (!customerName) return 0;
    return rows.filter((r) => r.customer === customerName).length;
  }, [unplacedPayroll, customerId, customers]);

  const scopedLowConfidenceCount = useMemo(() => {
    const rows = lowConfidencePayroll ?? [];
    if (customerId === ALL_CUSTOMERS) return rows.length;
    const customerName = customers.find((c) => c.id === customerId)?.name;
    if (!customerName) return 0;
    return rows.filter((r) => r.customer === customerName).length;
  }, [lowConfidencePayroll, customerId, customers]);

  const totalCount = scopedUnplacedCount + scopedLowConfidenceCount;

  if (totalCount === 0) return null;

  const scrollTarget =
    scopedUnplacedCount > 0
      ? "card-unplaced-payroll"
      : "card-low-confidence-payroll";

  const handleClick = () => {
    const alreadyOnDashboard = location === "/dashboard" || location === "/";
    if (!alreadyOnDashboard) {
      navigate("/dashboard");
    }
    const tryScroll = (attempts = 0) => {
      const el = document.getElementById(scrollTarget);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (attempts < 10) {
        setTimeout(() => tryScroll(attempts + 1), 100);
      }
    };
    requestAnimationFrame(() => tryScroll());
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-1.5 text-left text-sm hover:bg-amber-100 transition-colors dark:border-amber-700 dark:bg-amber-950/40 dark:hover:bg-amber-950/60"
      data-testid="sticky-payroll-review-bar"
    >
      <Receipt className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
      <span className="font-semibold tabular-nums">{totalCount}</span>
      <span>
        payroll row{totalCount === 1 ? "" : "s"} need{totalCount === 1 ? "s" : ""} review
      </span>
      <span className="text-xs text-muted-foreground ml-1 tabular-nums">
        ({scopedUnplacedCount} unplaced · {scopedLowConfidenceCount} to confirm)
      </span>
    </button>
  );
}

/**
 * Inline notice listing the rows the data store dropped because they
 * failed schema validation. Renders the summary count first (back-compat
 * with the original task #354 banner) and then a per-row list so a
 * non-technical operator can navigate straight to the broken record
 * without opening DevTools — or copy the id when no detail page exists.
 */
function DataIssuesBanner({
  issues,
}: {
  issues: { kind: string; label: string; dropped: number; rows: DroppedRow[] }[];
}) {
  const { toast } = useToast();

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      toast({ title: "Copied", description: `Copied id ${id} to clipboard.` });
    } catch {
      // Older browsers / restrictive contexts may block writeText. Fall
      // back to a textarea + execCommand so the operator still gets the
      // id onto their clipboard instead of a silent failure.
      try {
        const ta = document.createElement("textarea");
        ta.value = id;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toast({ title: "Copied", description: `Copied id ${id} to clipboard.` });
      } catch {
        toast({
          title: "Could not copy",
          description: `Select and copy manually: ${id}`,
          variant: "destructive",
        });
      }
    }
  };

  return (
    <div
      role="status"
      data-testid="banner-data-issues"
      className="mx-4 mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <div data-testid="banner-data-issues-summary">
        {issues.map((i) => `${i.dropped} ${i.label}`).join(", ")} hidden — see
        console for details.
      </div>
      <ul className="mt-1.5 space-y-0.5">
        {issues.flatMap((issue) =>
          issue.rows.map((row, idx) => {
            // Strip the trailing "s" from "leases"/"properties"/etc. so
            // each list entry reads like "lease L2 …" rather than
            // "leases L2 …" — purely cosmetic but reads more naturally.
            const singular = issue.label.endsWith("s")
              ? issue.label.slice(0, -1)
              : issue.label;
            const key = `${issue.kind}:${row.id ?? idx}`;
            // Suffix per-row test ids with the row index so multiple
            // dropped rows of the same kind don't collide with the
            // first match in querySelector-based tests.
            const rowSuffix = `${issue.kind}-${idx}`;
            return (
              <li
                key={key}
                data-testid={`data-issue-row-${rowSuffix}`}
                data-issue-kind={issue.kind}
                className="flex flex-wrap items-center gap-1.5"
              >
                <span className="capitalize">{singular}</span>
                {row.label ? (
                  <span className="font-medium">{row.label}</span>
                ) : null}
                {row.id ? (
                  <code
                    className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px] dark:bg-amber-900/50"
                    data-testid={`data-issue-row-id-${issue.kind}`}
                  >
                    {row.id}
                  </code>
                ) : (
                  <span className="italic text-amber-800/80 dark:text-amber-300/80">
                    (no id — see console)
                  </span>
                )}
                {row.id && row.href ? (
                  <Link
                    href={row.href}
                    data-testid={`data-issue-row-open-${rowSuffix}`}
                    data-issue-kind={issue.kind}
                    className="underline underline-offset-2 hover:text-amber-950 dark:hover:text-amber-100"
                  >
                    Open
                  </Link>
                ) : row.id ? (
                  <button
                    type="button"
                    onClick={() => copyId(row.id!)}
                    data-testid={`data-issue-row-copy-${rowSuffix}`}
                    data-issue-kind={issue.kind}
                    className="inline-flex items-center gap-1 rounded border border-amber-300 px-1.5 py-0.5 text-[10px] hover:bg-amber-100 dark:border-amber-700/60 dark:hover:bg-amber-900/40"
                    aria-label={`Copy ${singular} id ${row.id}`}
                  >
                    <Copy className="h-3 w-3" />
                    Copy id
                  </button>
                ) : null}
              </li>
            );
          }),
        )}
      </ul>
    </div>
  );
}
