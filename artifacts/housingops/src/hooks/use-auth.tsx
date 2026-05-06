import { createContext, useContext, useEffect, useState } from "react";

interface AuthContextType {
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_STORAGE_KEY = "housingops_auth";
const LAST_ROUTE_STORAGE_KEY = "housingops:last-route";

function readAuthFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(AUTH_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Returns the last route the operator was viewing before they closed the
 * tab, or null if nothing was saved (or storage is unavailable). The caller
 * is responsible for falling back to /dashboard. We require a leading "/"
 * and reject "/login" so a stale value can never trap the user on the
 * sign-in screen after they authenticate.
 */
export function readLastRoute(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(LAST_ROUTE_STORAGE_KEY);
    if (!value || !value.startsWith("/") || value === "/login") return null;
    return value;
  } catch {
    return null;
  }
}

export function writeLastRoute(path: string): void {
  if (typeof window === "undefined") return;
  if (!path.startsWith("/") || path === "/login") return;
  try {
    window.localStorage.setItem(LAST_ROUTE_STORAGE_KEY, path);
  } catch {
    // Best-effort persistence — Safari Private Mode etc.
  }
}

function clearLastRoute(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LAST_ROUTE_STORAGE_KEY);
  } catch {
    // ignored
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(readAuthFromStorage);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== AUTH_STORAGE_KEY && event.key !== null) return;
      setIsAuthenticated(readAuthFromStorage());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const login = () => {
    localStorage.setItem(AUTH_STORAGE_KEY, "true");
    setIsAuthenticated(true);
  };

  const logout = () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    clearLastRoute();
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
