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

    // Phase 2/14/19 — quiet, inline fallback. A throwing child must NEVER
    // paint a giant colored rectangle (the old min-h-[60vh] bg-destructive/5
    // card was the "red dead-block" framing the bed boards + the "red
    // popover"). This is a small, neutral notice that stays inline so the
    // surrounding layout (top bar, sibling cards) is untouched, with the
    // message + a quiet retry for operators.
    return (
      <div
        className="my-2 flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-xs text-muted-foreground"
        role="alert"
        data-testid="error-boundary-fallback"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
        <span className="min-w-0 flex-1">
          {t("errorBoundary.description")}
          {error.message ? (
            <span
              className="ml-1 font-mono text-muted-foreground/70 break-words"
              data-testid="error-boundary-message"
            >
              — {error.message}
            </span>
          ) : null}
        </span>
        <Button
          onClick={this.reset}
          size="sm"
          variant="ghost"
          className="h-6 shrink-0 px-2 text-xs"
          data-testid="button-error-boundary-retry"
        >
          <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
          {t("common.tryAgain")}
        </Button>
      </div>
    );
  }
}

export const ErrorBoundary = withTranslation()(ErrorBoundaryInner);
