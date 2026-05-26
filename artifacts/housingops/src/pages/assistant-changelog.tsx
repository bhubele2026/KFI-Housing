import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Bot } from "lucide-react";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ChangelogEntry {
  id: string;
  conversationId: string;
  conversationTitle: string;
  toolName: string;
  summary: string;
  status: "approved" | "undone";
  resultId: string | null;
  reversible: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

function apiBase(): string {
  const b = import.meta.env.BASE_URL ?? "/";
  return `${b}api/assistant`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// Read-only audit trail of every write the in-app assistant has
// performed for the signed-in operator (task #645). The bubble's
// per-conversation Changes list only covers the active thread; this
// page is the cross-conversation record an operator can scroll back
// through when they need to find a change made days ago.
export default function AssistantChangelog() {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${apiBase()}/changelog`, {
          credentials: "include",
        });
        if (!r.ok) {
          if (!cancelled) setError(`HTTP ${r.status}`);
          return;
        }
        const data = await r.json();
        if (!cancelled) setEntries((data?.entries ?? []) as ChangelogEntry[]);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Network error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <MainLayout>
      <PageHeader
        title="Assistant changelog"
        description="Every change the in-app assistant has made on your behalf, across all conversations."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {error && (
            <div
              className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
              data-testid="assistant-changelog-error"
            >
              Couldn't load changelog: {error}
            </div>
          )}
          {entries === null ? (
            <div
              className="p-6 text-sm text-muted-foreground"
              data-testid="assistant-changelog-loading"
            >
              Loading…
            </div>
          ) : entries.length === 0 ? (
            <EmptyState
              icon={Bot}
              title="No assistant changes yet"
              description="When you approve a change suggested by the assistant, it will show up here."
            />
          ) : (
            <Table data-testid="assistant-changelog-table">
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Tool</TableHead>
                  <TableHead>Result id</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Conversation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow
                    key={e.id}
                    data-testid={`changelog-row-${e.id}`}
                    data-status={e.status}
                  >
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatWhen(e.resolvedAt ?? e.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm">{e.summary}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {e.toolName}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {e.resultId ? (
                        <code className="rounded bg-muted px-1.5 py-0.5">
                          {e.resultId}
                        </code>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          e.status === "undone" ? "outline" : "secondary"
                        }
                        className={
                          e.status === "undone"
                            ? "border-amber-400 text-amber-700 dark:text-amber-300"
                            : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                        }
                      >
                        {e.status === "undone" ? "Undone" : "Done"}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className="text-xs text-muted-foreground truncate max-w-[220px]"
                      title={e.conversationTitle}
                    >
                      {e.conversationTitle}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </MainLayout>
  );
}
