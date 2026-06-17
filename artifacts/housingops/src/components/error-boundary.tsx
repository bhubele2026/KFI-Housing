import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { withTranslation, type WithTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { isChunkLoadError, attemptChunkReload } from "@/lib/lazy-with-reload";

interface Props extends WithTranslation {
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
class ErrorBoundaryInner extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // A stale-deploy chunk error that slipped past the lazyWithReload
    // wrapper (e.g. surfaced during render) gets the same one-shot
    // recovery: reload onto the fresh build instead of stranding the
    // user on an error card. attemptChunkReload no-ops for non-chunk
    // errors and is guarded against reload loops.
    if (attemptChunkReload(error)) return;
    // Surface the failure in the dev console so engineers debugging the
    // demo can pinpoint the offending component without instrumenting
    // a full reporter.
    console.error("[ErrorBoundary] caught error:", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // Chunk-load failure (new version deployed under an open tab): show a
    // brief "updating" state instead of a scary error card — the page is
    // already reloading onto the fresh build (see componentDidCatch).
    if (isChunkLoadError(error)) {
      return (
        <div className="flex min-h-[60vh] w-full items-center justify-center p-8">
          <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status">
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
            Loading the latest version…
          </div>
        </div>
      );
    }
    if (this.props.fallback) return this.props.fallback(this.reset, error);
    const { t } = this.props;

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
              {t("errorBoundary.title")}
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              {t("errorBoundary.description")}
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
            {t("common.tryAgain")}
          </Button>
        </div>
      </div>
    );
  }
}

export const ErrorBoundary = withTranslation()(ErrorBoundaryInner);
