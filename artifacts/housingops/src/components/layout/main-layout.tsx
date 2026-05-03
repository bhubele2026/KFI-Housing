import { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";

export function MainLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
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
