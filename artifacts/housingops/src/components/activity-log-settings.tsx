import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { History, Users, Loader2 } from "lucide-react";

interface ActivityEntry {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  method: string;
  path: string;
  action: string;
  createdAt: string | null;
}

interface ActivitySummaryUser {
  userId: string;
  userEmail: string;
  userName: string;
  role: string;
  actionCount: number;
  lastActiveAt: string | null;
  activeInWindow: boolean;
  joinedAt: string | null;
}

interface ActivitySummary {
  days: number;
  activeUsers: number;
  totalUsers: number;
  users: ActivitySummaryUser[];
}

const RANGE_LABELS: Record<string, string> = {
  "7": "7 days",
  "14": "2 weeks",
  "21": "3 weeks",
  "30": "30 days",
};

const ENTRY_LIMIT = 2000;

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "—";
  }
}

function relativeTime(value: string | null): string {
  if (!value) return "—";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function ActivityLogSettings() {
  const [days, setDays] = useState("21");

  const summaryQuery = useQuery({
    queryKey: ["activity", "summary", days],
    queryFn: () =>
      customFetch<ActivitySummary>(`/api/activity/summary?days=${days}`),
  });
  const entriesQuery = useQuery({
    queryKey: ["activity", "entries", days],
    queryFn: () =>
      customFetch<ActivityEntry[]>(
        `/api/activity?days=${days}&limit=${ENTRY_LIMIT}`,
      ),
  });

  const rangeLabel = RANGE_LABELS[days] ?? `${days} days`;
  const entryCount = entriesQuery.data?.length ?? 0;
  const isTruncated = entryCount >= ENTRY_LIMIT;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Who's been active
            </CardTitle>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger
                className="w-36"
                data-testid="activity-range-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 2 weeks</SelectItem>
                <SelectItem value="21">Last 3 weeks</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {summaryQuery.data
              ? `${summaryQuery.data.activeUsers} of ${
                  summaryQuery.data.totalUsers
                } ${
                  summaryQuery.data.totalUsers === 1 ? "person" : "people"
                } with access used the app in the last ${rangeLabel}. "Last active" is each person's most recent visit, even from before activity logging began.`
              : "Everyone with access and when they were last active."}
          </p>

          {summaryQuery.isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading activity…
            </div>
          ) : summaryQuery.isError ? (
            <div className="text-center py-8 text-destructive text-sm">
              Couldn't load activity. Please try again.
            </div>
          ) : !summaryQuery.data || summaryQuery.data.users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No activity recorded in this period yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Last active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaryQuery.data.users.map((u) => (
                  <TableRow key={u.userId} data-testid="activity-user-row">
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {u.userName || u.userEmail || "—"}
                        {u.activeInWindow ? (
                          <Badge variant="secondary" className="font-normal">
                            Active
                          </Badge>
                        ) : null}
                      </span>
                      {u.userName && u.userEmail ? (
                        <span className="block text-xs text-muted-foreground">
                          {u.userEmail}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {u.role || "—"}
                    </TableCell>
                    <TableCell>
                      <span title={formatDateTime(u.lastActiveAt)}>
                        {relativeTime(u.lastActiveAt)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {u.actionCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Recent activity
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {entryCount > 0
              ? `${
                  isTruncated
                    ? `Showing the ${ENTRY_LIMIT.toLocaleString()} most recent entries`
                    : `Showing all ${entryCount} ${
                        entryCount === 1 ? "entry" : "entries"
                      }`
                } from the last ${rangeLabel}. Scroll to see them all. Activity is recorded from when this log was turned on, so earlier history isn't listed here.`
              : `Every recorded change and visit will appear here. Activity is recorded from when this log was turned on, so earlier history isn't listed here.`}
          </p>
          {entriesQuery.isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading activity…
            </div>
          ) : entriesQuery.isError ? (
            <div className="text-center py-8 text-destructive text-sm">
              Couldn't load activity. Please try again.
            </div>
          ) : !entriesQuery.data || entriesQuery.data.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No activity recorded in this period yet.
            </div>
          ) : (
            <div className="max-h-[28rem] overflow-y-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entriesQuery.data.map((e) => (
                    <TableRow key={e.id} data-testid="activity-entry-row">
                      <TableCell className="font-medium">
                        {e.userName || e.userEmail || "—"}
                      </TableCell>
                      <TableCell className="capitalize">{e.action}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <span title={formatDateTime(e.createdAt)}>
                          {relativeTime(e.createdAt)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
