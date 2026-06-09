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
  actionCount: number;
  lastActiveAt: string | null;
}

interface ActivitySummary {
  days: number;
  activeUsers: number;
  users: ActivitySummaryUser[];
}

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
      customFetch<ActivityEntry[]>(`/api/activity?days=${days}&limit=200`),
  });

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
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="21">Last 21 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {summaryQuery.data
              ? `${summaryQuery.data.activeUsers} ${
                  summaryQuery.data.activeUsers === 1 ? "person" : "people"
                } used the app in the last ${days} days.`
              : "How many people used the app recently and when."}
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
                  <TableHead>Last active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaryQuery.data.users.map((u) => (
                  <TableRow key={u.userId} data-testid="activity-user-row">
                    <TableCell className="font-medium">
                      {u.userName || u.userEmail || "—"}
                      {u.userName && u.userEmail ? (
                        <span className="block text-xs text-muted-foreground">
                          {u.userEmail}
                        </span>
                      ) : null}
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
        <CardContent>
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
            <Table>
              <TableHeader>
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
