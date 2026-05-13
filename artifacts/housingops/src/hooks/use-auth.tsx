import { useAuth as useClerkAuth, useUser } from "@clerk/react";

const LAST_ROUTE_STORAGE_KEY = "housingops:last-route";

export function readLastRoute(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(LAST_ROUTE_STORAGE_KEY);
    if (
      !value ||
      !value.startsWith("/") ||
      value === "/login" ||
      value.startsWith("/sign-in") ||
      value.startsWith("/sign-up")
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function writeLastRoute(path: string): void {
  if (typeof window === "undefined") return;
  if (
    !path.startsWith("/") ||
    path === "/login" ||
    path.startsWith("/sign-in") ||
    path.startsWith("/sign-up")
  ) {
    return;
  }
  try {
    window.localStorage.setItem(LAST_ROUTE_STORAGE_KEY, path);
  } catch {
    /* noop */
  }
}

function clearLastRoute(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LAST_ROUTE_STORAGE_KEY);
  } catch {
    /* noop */
  }
}

/**
 * Thin Clerk-backed shim that preserves the legacy `useAuth()` API
 * shape (`isAuthenticated`, `email`, `logout`) so the existing
 * sidebar / layouts keep working without per-call rewrites. Real auth
 * lives in Clerk; this hook is only here to bridge the call sites.
 */
export function useAuth(): {
  isAuthenticated: boolean;
  email: string | null;
  logout: () => void;
} {
  const { isSignedIn, signOut } = useClerkAuth();
  const { user } = useUser();
  return {
    isAuthenticated: !!isSignedIn,
    email:
      user?.primaryEmailAddress?.emailAddress ??
      user?.emailAddresses?.[0]?.emailAddress ??
      null,
    logout: () => {
      clearLastRoute();
      void signOut();
    },
  };
}

/** No-op kept for backwards compatibility with the previous AuthProvider. */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
