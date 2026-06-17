import { Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, useAuth as useClerkAuth } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { Toaster } from "@/components/ui/toaster";
import { VersionUpdatePrompt } from "@/components/version-update-prompt";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, readLastRoute } from "@/hooks/use-auth";
import { DataProvider } from "@/context/data-store";
import { CustomerScopeProvider } from "@/context/customer-scope";
import { ErrorBoundary } from "@/components/error-boundary";
import { lazyWithReload } from "@/lib/lazy-with-reload";
import { Skeleton } from "@/components/ui/skeleton";
import { useGoogleMapsKeyErrorToastListener } from "@/hooks/use-google-maps-key-error";
import { useNewMonthHotelRateReminder } from "@/hooks/use-new-month-hotel-rate-reminder";
import {
  getListCustomersQueryKey,
  getListPropertiesQueryKey,
  getListBuildingsQueryKey,
  getListLeasesQueryKey,
  getListUtilitiesQueryKey,
  getListOtherCostsQueryKey,
  getListInsuranceCertificatesQueryKey,
  getListBedsQueryKey,
  getListOccupantsQueryKey,
  getListRoomsQueryKey,
  getListRoomNightLogsQueryKey,
} from "@workspace/api-client-react";

// Auth + login pages stay eagerly imported so the sign-in flow never
// shows a flash of skeleton on initial load. Every other page is
// code-split so the first-load JS chunk only contains the routing
// scaffold + Clerk + the page the operator is actually landing on.
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";

const Dashboard = lazyWithReload(() => import("@/pages/dashboard"));
const Customers = lazyWithReload(() => import("@/pages/customers"));
const CustomerDetail = lazyWithReload(() => import("@/pages/customer-detail"));
const Properties = lazyWithReload(() => import("@/pages/properties"));
const PropertyDetail = lazyWithReload(() => import("@/pages/property-detail"));
const Leases = lazyWithReload(() => import("@/pages/leases"));
const LeaseDetail = lazyWithReload(() => import("@/pages/lease-detail"));
const SnoozedLeaseAlerts = lazyWithReload(() => import("@/pages/snoozed-lease-alerts"));
const Beds = lazyWithReload(() => import("@/pages/beds"));
const Occupants = lazyWithReload(() => import("@/pages/occupants"));
const OccupantDetail = lazyWithReload(() => import("@/pages/occupant-detail"));
const Utilities = lazyWithReload(() => import("@/pages/utilities"));
const Finance = lazyWithReload(() => import("@/pages/finance"));
const Economics = lazyWithReload(() => import("@/pages/economics"));
const RentalCompanies = lazyWithReload(() => import("@/pages/rental-companies"));
const Roster = lazyWithReload(() => import("@/pages/roster"));
const Reconciliation = lazyWithReload(() => import("@/pages/reconciliation"));
const QboMappingRules = lazyWithReload(() => import("@/pages/qbo-mapping-rules"));
const InsuranceCertificates = lazyWithReload(() => import("@/pages/insurance-certificates"));
const SettingsPage = lazyWithReload(() => import("@/pages/settings"));
const AssistantChangelog = lazyWithReload(() => import("@/pages/assistant-changelog"));
const TransportStub = lazyWithReload(() => import("@/pages/transport-stub"));
const Vehicles = lazyWithReload(() => import("@/pages/vehicles"));
const VehicleLeases = lazyWithReload(() => import("@/pages/vehicle-leases"));

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

// Per-resource staleTime tuning (task #632). Global default is bumped
// to 5 min so slow-changing entities (customers, properties, buildings,
// leases, utilities, otherCosts, insuranceCertificates) coast on the
// cache between navigations. Faster-moving resources (beds, occupants,
// roomNightLogs) keep the prior 30s freshness window via per-key
// overrides below. useRuntimeConfigQuery sets its own 30s staleTime +
// 60s refetchInterval explicitly and is unaffected.
const FIVE_MIN = 5 * 60_000;
const THIRTY_SEC = 30_000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: FIVE_MIN },
    mutations: { retry: false },
  },
});

for (const key of [
  getListBedsQueryKey(),
  getListOccupantsQueryKey(),
  getListRoomsQueryKey(),
  getListRoomNightLogsQueryKey(),
]) {
  queryClient.setQueryDefaults(key, { staleTime: THIRTY_SEC });
}
// Keep slow-changing entities at the explicit 5 min so the per-resource
// intent is documented at this surface even though it matches the new
// global default.
for (const key of [
  getListCustomersQueryKey(),
  getListPropertiesQueryKey(),
  getListBuildingsQueryKey(),
  getListLeasesQueryKey(),
  getListUtilitiesQueryKey(),
  getListOtherCostsQueryKey(),
  getListInsuranceCertificatesQueryKey(),
]) {
  queryClient.setQueryDefaults(key, { staleTime: FIVE_MIN });
}

function RouteFallback() {
  return (
    <div className="p-6 space-y-4" data-testid="route-suspense-fallback">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function AppRoutes() {
  const [loc] = useLocation();
  return (
    <Suspense fallback={<RouteFallback />}>
      {/* Per-navigation error boundary: a single page that throws shows the
          error inline (with its message) instead of blanking the whole app,
          and remounts fresh on the next navigation. */}
      <ErrorBoundary key={loc}>
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
        <Route path="/economics" component={Economics} />
        <Route path="/rental-companies" component={RentalCompanies} />
        <Route path="/roster" component={Roster} />
        <Route path="/reconciliation" component={Reconciliation} />
        <Route path="/qbo/mapping-rules" component={QboMappingRules} />
        <Route path="/insurance" component={InsuranceCertificates} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/assistant/changelog" component={AssistantChangelog} />
        <Route path="/transport/vehicles" component={Vehicles} />
        <Route path="/transport/vehicle-leases" component={VehicleLeases} />
        <Route path="/transport/drivers">
          <TransportStub titleKey="nav.transport.drivers" />
        </Route>
        <Route path="/transport/trips">
          <TransportStub titleKey="nav.transport.trips" />
        </Route>
        <Route path="/transport/maintenance">
          <TransportStub titleKey="nav.transport.maintenance" />
        </Route>
        <Route path="/transport/fuel-logs">
          <TransportStub titleKey="nav.transport.fuelLogs" />
        </Route>
        <Route path="/transport/routes">
          <TransportStub titleKey="nav.transport.routes" />
        </Route>
        <Route path="/transport/charges">
          <TransportStub titleKey="nav.transport.charges" />
        </Route>
        <Route component={NotFound} />
      </Switch>
      </ErrorBoundary>
    </Suspense>
  );
}

const PUBLIC_MODE =
  String(import.meta.env.VITE_PUBLIC_MODE ?? "").toLowerCase() === "true";

function SignedInShell() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  if (!PUBLIC_MODE) {
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
          <VersionUpdatePrompt />
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
