import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardHead } from "@/components/kit-v2";

/**
 * Per-person activity timeline (refinement #13). The /api/activity endpoint
 * returns recent CHANGE entries app-wide (no per-entity filter param), so we
 * pull the window and filter client-side to entries whose request `path`
 * references this occupant id. Bed-level moves keyed only by bedId won't match
 * (a known limitation of the global audit log).
 */
interface ActivityEntry {
  id: string;
  userName?: string | null;
  method?: string;
  path?: string;
  action?: string;
  createdAt?: string | null;
}

function whenLabel(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  );
}

function prettyAction(e: ActivityEntry): string {
  const a = (e.action ?? "").trim();
  if (a) return a.charAt(0).toUpperCase() + a.slice(1);
  const m = (e.method ?? "").toUpperCase();
  if (m === "POST") return "Created / assigned";
  if (m === "PATCH" || m === "PUT") return "Updated";
  if (m === "DELETE") return "Removed";
  return "Change";
}

export function OccupantTimeline({ occupantId }: { occupantId: string }) {
  const q = useQuery({
    queryKey: ["activity", "occupant", occupantId],
    queryFn: () =>
      customFetch<ActivityEntry[]>(`/api/activity?days=120&limit=2000`),
  });
  const all: ActivityEntry[] = Array.isArray(q.data) ? q.data : [];
  const entries = all.filter(
    (e) => typeof e.path === "string" && e.path.includes(occupantId),
  );

  return (
    <Card className="mt-6" testId="card-occupant-timeline">
      <CardHead label="Activity timeline" />
      {q.isLoading ? (
        <div className="space-y-2" data-testid="timeline-loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-4 w-full animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div
          className="py-6 text-center text-sm text-muted-foreground"
          data-testid="timeline-empty"
        >
          No activity yet — changes to this associate will show here.
        </div>
      ) : (
        <ul className="space-y-3" data-testid="timeline-list">
          {entries.slice(0, 20).map((e) => (
            <li key={e.id} className="flex items-start gap-3 text-sm">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
              <div className="min-w-0 flex-1">
                <div className="text-ink">{prettyAction(e)}</div>
                <div className="text-xs tabular-nums text-muted-foreground">
                  {whenLabel(e.createdAt)}
                  {e.userName ? ` · ${e.userName}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
