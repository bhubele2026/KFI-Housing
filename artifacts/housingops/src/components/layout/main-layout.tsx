import { ReactNode, useCallback, useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "./sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

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
  const [collapsed, setCollapsed] = useState<boolean>(readPersistedCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
        </div>
        <main className="flex-1 overflow-y-auto">
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
