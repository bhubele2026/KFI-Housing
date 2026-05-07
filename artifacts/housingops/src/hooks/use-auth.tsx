import { createContext, useContext, useEffect, useState } from "react";

interface AuthContextType {
  isAuthenticated: boolean;
  email: string | null;
  login: (email: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_STORAGE_KEY = "housingops_auth";
const AUTH_EMAIL_STORAGE_KEY = "housingops_auth_email";
const LAST_ROUTE_STORAGE_KEY = "housingops:last-route";

function readAuthFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(AUTH_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function readEmailFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(AUTH_EMAIL_STORAGE_KEY);
  } catch {
    return null;
  }
}

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
  }
}

function clearLastRoute(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LAST_ROUTE_STORAGE_KEY);
  } catch {
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(readAuthFromStorage);
  const [email, setEmail] = useState<string | null>(readEmailFromStorage);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== AUTH_STORAGE_KEY && event.key !== null) return;
      setIsAuthenticated(readAuthFromStorage());
      setEmail(readEmailFromStorage());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const login = (userEmail: string) => {
    localStorage.setItem(AUTH_STORAGE_KEY, "true");
    localStorage.setItem(AUTH_EMAIL_STORAGE_KEY, userEmail);
    setIsAuthenticated(true);
    setEmail(userEmail);
  };

  const logout = () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_EMAIL_STORAGE_KEY);
    clearLastRoute();
    setIsAuthenticated(false);
    setEmail(null);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, email, login, logout }}>
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
