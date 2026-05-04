import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { DataProvider } from "@/context/data-store";
import { CustomerScopeProvider } from "@/context/customer-scope";
import { ErrorBoundary } from "@/components/error-boundary";
import { useGoogleMapsKeyErrorToastListener } from "@/hooks/use-google-maps-key-error";

import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Customers from "@/pages/customers";
import CustomerDetail from "@/pages/customer-detail";
import Properties from "@/pages/properties";
import PropertyDetail from "@/pages/property-detail";
import Leases from "@/pages/leases";
import LeaseDetail from "@/pages/lease-detail";
import Beds from "@/pages/beds";
import Occupants from "@/pages/occupants";
import Utilities from "@/pages/utilities";
import Finance from "@/pages/finance";

// Demo-grade defaults: never auto-retry mutations (a stale optimistic patch
// will get re-applied on top of fresh data, which is more confusing than a
// single visible error toast), and only retry queries once before surfacing
// a load failure. The data store rolls back optimistic patches on error so
// the user sees their last-good value, not the half-applied change.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <Redirect to="/dashboard" />} />
      <Route path="/login" component={Login} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/customers" component={Customers} />
      <Route path="/customers/:id" component={CustomerDetail} />
      <Route path="/properties" component={Properties} />
      <Route path="/properties/:id" component={PropertyDetail} />
      <Route path="/leases" component={Leases} />
      {/* Create-mode route is registered BEFORE the parameterized one so
          wouter's <Switch> matches it first; otherwise `/leases/new` would
          land on the edit page with id="new" and try to look up a lease
          that doesn't exist yet. */}
      <Route path="/leases/new" component={LeaseDetail} />
      <Route path="/leases/:id" component={LeaseDetail} />
      <Route path="/beds" component={Beds} />
      <Route path="/occupants" component={Occupants} />
      <Route path="/utilities" component={Utilities} />
      <Route path="/finance" component={Finance} />
      <Route component={NotFound} />
    </Switch>
  );
}

// Tiny render-less child of the QueryClientProvider tree that installs the
// global Google-Maps-key-error listeners (postMessage + window.gm_authFailure)
// and pumps the resulting events into the app's toast queue. Lives as its
// own component so the hook can call useToast without coupling App's body
// to the toast pipeline (Task #167).
function MapsKeyErrorToastListener() {
  useGoogleMapsKeyErrorToastListener();
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <DataProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <CustomerScopeProvider>
                {/* Boundary lives below WouterRouter so a buggy page only
                    blanks the main content area — the sidebar (rendered
                    inside MainLayout, also below the boundary) stays
                    available via the "Try again" button or by navigating
                    to a different route which remounts the subtree. */}
                <ErrorBoundary>
                  <Router />
                </ErrorBoundary>
              </CustomerScopeProvider>
            </WouterRouter>
          </DataProvider>
        </AuthProvider>
        <MapsKeyErrorToastListener />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
