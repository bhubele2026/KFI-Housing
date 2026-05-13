import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Users, Mail, Trash2, Plus, Loader2, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string | null;
  lastSeenAt: string | null;
}

interface TeamInvite {
  id: string;
  email: string;
  role: string;
  createdAt: string | null;
  inviteUrl: string | null;
}

interface InviteCreatedResponse {
  id: string;
  email: string;
  role: string;
  inviteUrl: string | null;
  emailSent: boolean;
}

interface TeamMe {
  id: string;
  email: string;
  name: string;
  role: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return "—";
  }
}

export function TeamSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"member" | "admin">("member");

  const meQuery = useQuery({
    queryKey: ["team", "me"],
    queryFn: () => customFetch<TeamMe>("/api/team/me"),
  });
  const membersQuery = useQuery({
    queryKey: ["team", "members"],
    queryFn: () => customFetch<TeamMember[]>("/api/team/members"),
  });
  const invitesQuery = useQuery({
    queryKey: ["team", "invites"],
    queryFn: () => customFetch<TeamInvite[]>("/api/team/invites"),
  });

  const isAdmin = meQuery.data?.role === "admin";

  const inviteMutation = useMutation({
    mutationFn: (vars: { email: string; role: string }) =>
      customFetch<InviteCreatedResponse>("/api/team/invites", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: (data) => {
      setNewEmail("");
      setNewRole("member");
      qc.invalidateQueries({ queryKey: ["team", "invites"] });
      if (data?.emailSent) {
        toast({
          title: "Invite sent",
          description: `An invite email was sent to ${data.email}.`,
        });
      } else {
        const url = data?.inviteUrl;
        if (url && typeof navigator !== "undefined" && navigator.clipboard) {
          void navigator.clipboard.writeText(url).catch(() => {});
        }
        toast({
          title: "Invite created — email not sent",
          description: url
            ? `Email delivery isn't configured yet, so the invite link was copied to your clipboard. Send it to ${data?.email} however you like (Slack, text, etc.).`
            : `Email delivery isn't configured. Use the "Copy link" button on the pending invite to share it manually.`,
        });
      }
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Could not invite that email.";
      toast({ title: "Invite failed", description: msg, variant: "destructive" });
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/team/invites/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team", "invites"] });
      toast({ title: "Invite revoked" });
    },
    onError: () =>
      toast({
        title: "Couldn't revoke invite",
        variant: "destructive",
      }),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/team/members/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team", "members"] });
      toast({ title: "Member removed" });
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Couldn't remove member.";
      toast({ title: "Remove failed", description: msg, variant: "destructive" });
    },
  });

  const handleInvite = () => {
    const email = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      toast({
        title: "Invalid email",
        description: "Enter a valid email like name@company.com.",
        variant: "destructive",
      });
      return;
    }
    inviteMutation.mutate({ email, role: newRole });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Team members
          </CardTitle>
        </CardHeader>
        <CardContent>
          {membersQuery.isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading members…
            </div>
          ) : !membersQuery.data || membersQuery.data.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No members yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  {isAdmin && (
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {membersQuery.data.map((m) => (
                  <TableRow key={m.id} data-testid="team-member-row">
                    <TableCell className="font-medium">
                      {m.name || "—"}
                      {m.id === meQuery.data?.id && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (you)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{m.email}</TableCell>
                    <TableCell>
                      <Badge
                        variant={m.role === "admin" ? "default" : "secondary"}
                      >
                        {m.role}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(m.createdAt)}</TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        {m.id !== meQuery.data?.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={removeMemberMutation.isPending}
                            onClick={() => removeMemberMutation.mutate(m.id)}
                            data-testid="team-remove-member-btn"
                            aria-label={`Remove ${m.email}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Invite a teammate
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              We'll email them a sign-up link. They get the role you choose as
              soon as they sign in with this email. If your email service isn't
              wired up, you can copy the invite link from the pending list and
              send it however you like.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                type="email"
                placeholder="teammate@company.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleInvite();
                }}
                className="flex-1"
                data-testid="team-invite-email"
              />
              <Select
                value={newRole}
                onValueChange={(v) => setNewRole(v as "member" | "admin")}
              >
                <SelectTrigger className="w-full sm:w-32" data-testid="team-invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={handleInvite}
                disabled={inviteMutation.isPending || !newEmail.trim()}
                data-testid="team-invite-btn"
              >
                {inviteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                <span className="ml-1">Invite</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Pending invites
          </CardTitle>
        </CardHeader>
        <CardContent>
          {invitesQuery.isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading invites…
            </div>
          ) : !invitesQuery.data || invitesQuery.data.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No pending invites.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Invited</TableHead>
                  {isAdmin && (
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitesQuery.data.map((inv) => (
                  <TableRow key={inv.id} data-testid="team-invite-row">
                    <TableCell className="font-medium">{inv.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{inv.role}</Badge>
                    </TableCell>
                    <TableCell>{formatDate(inv.createdAt)}</TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {inv.inviteUrl && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (
                                  typeof navigator !== "undefined" &&
                                  navigator.clipboard &&
                                  inv.inviteUrl
                                ) {
                                  void navigator.clipboard
                                    .writeText(inv.inviteUrl)
                                    .then(() =>
                                      toast({
                                        title: "Invite link copied",
                                        description: `Send it to ${inv.email}.`,
                                      }),
                                    )
                                    .catch(() =>
                                      toast({
                                        title: "Couldn't copy link",
                                        variant: "destructive",
                                      }),
                                    );
                                }
                              }}
                              data-testid="team-copy-invite-link-btn"
                              aria-label={`Copy invite link for ${inv.email}`}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={revokeInviteMutation.isPending}
                            onClick={() => revokeInviteMutation.mutate(inv.id)}
                            data-testid="team-revoke-invite-btn"
                            aria-label={`Revoke invite for ${inv.email}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
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
