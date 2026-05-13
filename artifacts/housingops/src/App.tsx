import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, useAuth as useClerkAuth } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, readLastRoute } from "@/hooks/use-auth";
import { DataProvider } from "@/context/data-store";
import { CustomerScopeProvider } from "@/context/customer-scope";
import { ErrorBoundary } from "@/components/error-boundary";
import { useGoogleMapsKeyErrorToastListener } from "@/hooks/use-google-maps-key-error";
import { useNewMonthHotelRateReminder } from "@/hooks/use-new-month-hotel-rate-reminder";

import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";
import Dashboard from "@/pages/dashboard";
import Customers from "@/pages/customers";
import CustomerDetail from "@/pages/customer-detail";
import Properties from "@/pages/properties";
import PropertyDetail from "@/pages/property-detail";
import Leases from "@/pages/leases";
import LeaseDetail from "@/pages/lease-detail";
import SnoozedLeaseAlerts from "@/pages/snoozed-lease-alerts";
import Beds from "@/pages/beds";
import Occupants from "@/pages/occupants";
import OccupantDetail from "@/pages/occupant-detail";
import Utilities from "@/pages/utilities";
import Finance from "@/pages/finance";
import InsuranceCertificates from "@/pages/insurance-certificates";
import SettingsPage from "@/pages/settings";

const CLERK_PUBLISHABLE_KEY = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const CLERK_PROXY_URL = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error(
    "Missing VITE_CLERK_PUBLISHABLE_KEY. Run setupClerkWhitelabelAuth() to provision Clerk.",
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
    mutations: { retry: false },
  },
});

function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={() => <Redirect to={readLastRoute() ?? "/dashboard"} />} />
      <Route path="/login" component={Login} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/customers" component={Customers} />
      <Route path="/customers/:id" component={CustomerDetail} />
      <Route path="/properties" component={Properties} />
      <Route path="/properties/:id" component={PropertyDetail} />
      <Route path="/properties/:id/buildings/:buildingId" component={PropertyDetail} />
      <Route path="/leases" component={Leases} />
      <Route path="/leases/snoozed" component={SnoozedLeaseAlerts} />
      <Route path="/leases/new" component={LeaseDetail} />
      <Route path="/leases/:id" component={LeaseDetail} />
      <Route path="/beds" component={Beds} />
      <Route path="/occupants" component={Occupants} />
      <Route path="/occupants/:id" component={OccupantDetail} />
      <Route path="/utilities" component={Utilities} />
      <Route path="/finance" component={Finance} />
      <Route path="/insurance" component={InsuranceCertificates} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function SignedInShell() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f6f1e7] text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!isSignedIn) {
    return <Redirect to="/sign-in" />;
  }
  return (
    <DataProvider>
      <CustomerScopeProvider>
        <ErrorBoundary>
          <AppRoutes />
        </ErrorBoundary>
        <NewMonthHotelRateReminder />
      </CustomerScopeProvider>
    </DataProvider>
  );
}

function MapsKeyErrorToastListener() {
  useGoogleMapsKeyErrorToastListener();
  return null;
}

function NewMonthHotelRateReminder() {
  useNewMonthHotelRateReminder();
  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      proxyUrl={CLERK_PROXY_URL}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      afterSignOutUrl={`${basePath}/sign-in`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <Switch>
              {/* Clerk's sign-in / sign-up routes are mounted OUTSIDE
                  the SignedIn gate so the auth flow itself works while
                  the user is signed-out. The optional-wildcard `/*?`
                  matches both the base path and Clerk's sub-paths
                  (factor-one, sso-callback, verify-email, etc.). */}
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              <Route>
                <SignedInShell />
              </Route>
            </Switch>
          </AuthProvider>
          <MapsKeyErrorToastListener />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
