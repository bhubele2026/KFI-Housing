import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  /**
   * Rendered when {@link children} threw during render. Defaults to a
   * full-screen friendly error card with a "Try again" button that resets
   * the boundary's error state.
   */
  fallback?: (reset: () => void, error: Error) => ReactNode;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time exceptions inside its subtree so a single buggy
 * page can't blank the whole demo. The fallback offers a "Try again"
 * button that clears the error and re-renders {@link children}; if the
 * underlying issue is gone (e.g. transient network flake fixed by a
 * retry, stale state cleared by router navigation) the user is back in
 * business without a hard refresh. The sidebar lives outside this
 * boundary so navigation always remains available — see App.tsx.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // Surface the failure in the dev console so engineers debugging the
    // demo can pinpoint the offending component without instrumenting
    // a full reporter.
    console.error("[ErrorBoundary] caught error:", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset, error);

    return (
      <div className="flex min-h-[60vh] w-full items-center justify-center p-8">
        <div
          className="max-w-md w-full rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center space-y-4"
          role="alert"
          data-testid="error-boundary-fallback"
        >
          <div className="flex justify-center">
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Something went wrong on this page
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              The rest of the app is still working. Try again, or use the
              sidebar to go somewhere else.
            </p>
            {error.message && (
              <p
                className="text-xs text-muted-foreground/80 mt-3 font-mono break-words"
                data-testid="error-boundary-message"
              >
                {error.message}
              </p>
            )}
          </div>
          <Button
            onClick={this.reset}
            data-testid="button-error-boundary-retry"
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }
}
