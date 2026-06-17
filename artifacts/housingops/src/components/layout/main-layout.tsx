import { ReactNode, useEffect } from "react";
import { Copy } from "lucide-react";
import { TopNav } from "./top-nav";
import { useAuth, writeLastRoute } from "@/hooks/use-auth";
import { Link, Redirect, useLocation } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { AssistantBubble } from "@/components/assistant/assistant-bubble";
import { useData, type DroppedRow } from "@/context/data-store";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

export function MainLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [location] = useLocation();
  const { dataIssues } = useData();

  // Remember the last authenticated page so reopening the tab lands the
  // operator back where they left off instead of always on /dashboard.
  // Scoped to MainLayout so the /login route — which never mounts this
  // component — can't poison the value.
  useEffect(() => {
    if (!isAuthenticated) return;
    writeLastRoute(location);
  }, [isAuthenticated, location]);

  const publicMode =
    String(import.meta.env.VITE_PUBLIC_MODE ?? "").toLowerCase() === "true";
  if (!publicMode && !isAuthenticated) {
    return <Redirect to="/login" />;
  }

  // Sidebar fully removed — the top bar (TopNav) is the only nav now, on
  // every screen size. Content sits full-width beneath it.
  return (
    <div className="flex h-screen flex-col bg-background overflow-hidden">
      <TopNav />
      <main className="flex-1 overflow-y-auto">
        {/* Inline notice when the data store dropped one or more
            malformed rows from a list response, so a single bad row can't
            blank the page. */}
        {dataIssues.length > 0 ? <DataIssuesBanner issues={dataIssues} /> : null}
        {/* Inner boundary so a crash inside the page body keeps the top
            bar mounted and clickable. */}
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
      <AssistantBubble />
    </div>
  );
}

/**
 * Inline notice listing the rows the data store dropped because they
 * failed schema validation. Renders the summary count first (back-compat
 * with the original task #354 banner) and then a per-row list so a
 * non-technical operator can navigate straight to the broken record
 * without opening DevTools — or copy the id when no detail page exists.
 */
function DataIssuesBanner({
  issues,
}: {
  issues: { kind: string; label: string; dropped: number; rows: DroppedRow[] }[];
}) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      toast({ title: t("toasts.copiedTitle"), description: t("toasts.copiedIdDescription", { id }) });
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = id;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toast({ title: t("toasts.copiedTitle"), description: t("toasts.copiedIdDescription", { id }) });
      } catch {
        toast({
          title: t("toasts.couldNotCopyTitle"),
          description: t("toasts.couldNotCopyDescription", { id }),
          variant: "destructive",
        });
      }
    }
  };

  return (
    <div
      role="status"
      data-testid="banner-data-issues"
      className="mx-4 mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <div data-testid="banner-data-issues-summary">
        {t("mainLayout.dataIssuesHidden", { summary: issues.map((i) => `${i.dropped} ${i.label}`).join(", ") })}
      </div>
      <ul className="mt-1.5 space-y-0.5">
        {issues.flatMap((issue) =>
          issue.rows.map((row, idx) => {
            // Strip the trailing "s" from "leases"/"properties"/etc. so
            // each list entry reads like "lease L2 …" rather than
            // "leases L2 …" — purely cosmetic but reads more naturally.
            const singular = issue.label.endsWith("s")
              ? issue.label.slice(0, -1)
              : issue.label;
            const key = `${issue.kind}:${row.id ?? idx}`;
            // Suffix per-row test ids with the row index so multiple
            // dropped rows of the same kind don't collide with the
            // first match in querySelector-based tests.
            const rowSuffix = `${issue.kind}-${idx}`;
            return (
              <li
                key={key}
                data-testid={`data-issue-row-${rowSuffix}`}
                data-issue-kind={issue.kind}
                className="flex flex-wrap items-center gap-1.5"
              >
                <span className="capitalize">{singular}</span>
                {row.label ? (
                  <span className="font-medium">{row.label}</span>
                ) : null}
                {row.id ? (
                  <code
                    className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px] dark:bg-amber-900/50"
                    data-testid={`data-issue-row-id-${issue.kind}`}
                  >
                    {row.id}
                  </code>
                ) : (
                  <span className="italic text-amber-800/80 dark:text-amber-300/80">
                    {t("mainLayout.dataIssueNoId")}
                  </span>
                )}
                {row.id && row.href ? (
                  <Link
                    href={row.href}
                    data-testid={`data-issue-row-open-${rowSuffix}`}
                    data-issue-kind={issue.kind}
                    className="underline underline-offset-2 hover:text-amber-950 dark:hover:text-amber-100"
                  >
                    {t("mainLayout.dataIssueOpen")}
                  </Link>
                ) : row.id ? (
                  <button
                    type="button"
                    onClick={() => copyId(row.id!)}
                    data-testid={`data-issue-row-copy-${rowSuffix}`}
                    data-issue-kind={issue.kind}
                    className="inline-flex items-center gap-1 rounded border border-amber-300 px-1.5 py-0.5 text-[10px] hover:bg-amber-100 dark:border-amber-700/60 dark:hover:bg-amber-900/40"
                    aria-label={t("mainLayout.dataIssueCopyAria", { type: singular, id: row.id })}
                  >
                    <Copy className="h-3 w-3" />
                    {t("mainLayout.dataIssueCopyId")}
                  </button>
                ) : null}
              </li>
            );
          }),
        )}
      </ul>
    </div>
  );
}
