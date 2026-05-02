import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useSearch } from "wouter";
import { useData } from "@/context/data-store";

// Sentinel value for "no customer scope". Stored in state and used by
// callers as the selection for the dropdown's "All Customers" option.
export const ALL_CUSTOMERS = "All";

interface CustomerScopeContextValue {
  /** Currently scoped customer id, or {@link ALL_CUSTOMERS} for no scope. */
  customerId: string;
  /** Update the scope; also writes ?customer=<id> on the current page. */
  setCustomerId: (id: string) => void;
}

const CustomerScopeContext = createContext<CustomerScopeContextValue | undefined>(
  undefined,
);

// Collapse rapid follow-up filter changes (within this window) into the
// same history entry so quickly cycling through options doesn't flood
// browser history. Matches the original Dashboard behavior.
const HISTORY_DEBOUNCE_MS = 500;

// sessionStorage key for the cross-page scope. Using sessionStorage (not
// localStorage) means the selection lasts for the tab's lifetime and is
// automatically cleared when the tab closes — appropriate for a per-session
// working filter, and isolated per tab so two tabs can scope independently.
const STORAGE_KEY = "housingops:customer-scope";

function readFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeToStorage(value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value === ALL_CUSTOMERS) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    // sessionStorage may be unavailable (private mode, quota); fall back
    // to in-memory only — persistence across hard reloads is best-effort.
  }
}

function readInitialScope(): string {
  if (typeof window === "undefined") return ALL_CUSTOMERS;
  // The URL takes precedence on initial load so that a deep link like
  // /properties?customer=<id> always wins over whatever was in storage.
  const fromUrl = new URLSearchParams(window.location.search).get("customer");
  if (fromUrl && fromUrl.length > 0) return fromUrl;
  return readFromStorage() ?? ALL_CUSTOMERS;
}

/**
 * App-wide customer-scope provider. The selection persists across page
 * navigation (Dashboard → Beds → Finance, etc.) so a manager working with
 * one customer doesn't have to re-pick on every page.
 *
 * Sources of truth:
 *   • In-memory `customerId` state is the source of truth across pages.
 *   • The URL's `?customer=<id>` param is kept in sync on the active page
 *     so it stays shareable / bookmarkable (the long-standing behavior on
 *     Properties and Leases). Deep links to `/properties?customer=<id>`
 *     still pre-select correctly.
 *   • Browser Back/Forward updates the in-memory state from the URL via
 *     `popstate` so the dropdown reflects the URL the user just navigated
 *     to (including resetting to "All" when the param is gone).
 */
export function CustomerScopeProvider({ children }: { children: ReactNode }) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { customers, isLoading } = useData();

  const [customerId, setState] = useState<string>(readInitialScope);
  const lastChangeAtRef = useRef<number>(0);

  // Wrapper that keeps sessionStorage in sync with React state. All
  // mutations to scope state should go through here so storage never
  // drifts from what the dropdown shows.
  const updateState = useCallback((next: string) => {
    setState(next);
    writeToStorage(next);
  }, []);

  // If the initial scope was sourced from the URL (?customer=<id>) and
  // not from storage, sync it INTO storage on first mount so that future
  // hard navigations / reloads on pages without the param can restore
  // the same selection. Without this, a deep link to
  // /properties?customer=X would not propagate to a subsequent direct
  // visit to /dashboard in the same tab.
  useEffect(() => {
    if (customerId === ALL_CUSTOMERS) return;
    if (readFromStorage() === customerId) return;
    writeToStorage(customerId);
    // Run only once on mount with the bootstrapped value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adopt ?customer=<id> from the URL whenever a non-empty value appears
  // (programmatic navigation that includes the param, e.g. clicking a
  // customer chip on the Customers page that links to
  // `/properties?customer=<id>`). When the URL has NO param we
  // intentionally leave the in-memory scope alone — that's what carries
  // the selection between pages whose links don't include the param.
  useEffect(() => {
    const param = new URLSearchParams(search).get("customer");
    if (param && param !== customerId) updateState(param);
    // intentionally only re-run on URL changes, not on customerId changes,
    // to avoid feedback loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Browser Back / Forward must update the dropdown to match the URL —
  // including resetting to "All" when the user backs out of a filter
  // change to a prior history entry that has no `?customer=` param.
  // (We can't infer this from `search` changes alone because plain
  // page-to-page navigation also clears the param without any intent
  // to reset the scope.)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      const v = new URLSearchParams(window.location.search).get("customer");
      updateState(v && v.length > 0 ? v : ALL_CUSTOMERS);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [updateState]);

  // Once the customer list has loaded, drop unknown ids back to "All"
  // and strip the stale param from the URL if it's still there. This
  // keeps a deep link like /dashboard?customer=does-not-exist from
  // leaving the dropdown stuck on a phantom selection.
  useEffect(() => {
    if (isLoading) return;
    if (customerId === ALL_CUSTOMERS) return;
    if (customers.some((c) => c.id === customerId)) return;
    updateState(ALL_CUSTOMERS);
    const params = new URLSearchParams(window.location.search);
    if (params.get("customer") === customerId) {
      params.delete("customer");
      const qs = params.toString();
      const base = window.location.pathname;
      navigate(qs ? `${base}?${qs}` : base, { replace: true });
    }
  }, [customers, customerId, isLoading, navigate, updateState]);

  const setCustomerId = useCallback(
    (next: string) => {
      updateState(next);
      const params = new URLSearchParams(window.location.search);
      if (next === ALL_CUSTOMERS) params.delete("customer");
      else params.set("customer", next);
      const qs = params.toString();
      const base = window.location.pathname;
      const target = qs ? `${base}?${qs}` : base;
      const current = `${window.location.pathname}${window.location.search}`;
      // Don't add a no-op history entry if the URL is unchanged (the user
      // re-picked the current value).
      if (target === current) return;

      // Push a new entry so Back can undo the filter change, but collapse
      // rapid follow-up changes (within HISTORY_DEBOUNCE_MS) into the same
      // entry to avoid flooding history when the user cycles options.
      const now = Date.now();
      const isRapid =
        lastChangeAtRef.current !== 0 &&
        now - lastChangeAtRef.current < HISTORY_DEBOUNCE_MS;
      lastChangeAtRef.current = now;

      navigate(target, { replace: isRapid });
    },
    [navigate, updateState],
  );

  return (
    <CustomerScopeContext.Provider value={{ customerId, setCustomerId }}>
      {children}
    </CustomerScopeContext.Provider>
  );
}

export function useCustomerScope() {
  const ctx = useContext(CustomerScopeContext);
  if (!ctx) {
    throw new Error("useCustomerScope must be used within CustomerScopeProvider");
  }
  return ctx;
}
