import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, Trash2, Plus, Loader2, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useListDigestRecipients,
  useCreateDigestRecipient,
  useDeleteDigestRecipient,
  getListDigestRecipientsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TeamSettings } from "@/components/team-settings";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function DigestRecipientsSection() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: recipients, isLoading } = useListDigestRecipients();
  const createMutation = useCreateDigestRecipient();
  const deleteMutation = useDeleteDigestRecipient();

  const [newEmail, setNewEmail] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const deletingRecipient = recipients?.find((r) => r.id === deletingId);

  const handleAdd = () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL_RE.test(email)) {
      toast({
        title: t("toasts.invalidEmailTitle"),
        description: t("toasts.invalidEmailDescription"),
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate(
      { data: { email } },
      {
        onSuccess: () => {
          setNewEmail("");
          queryClient.invalidateQueries({
            queryKey: getListDigestRecipientsQueryKey(),
          });
          toast({ title: t("toasts.recipientAddedTitle"), description: email });
        },
        onError: (err) => {
          const msg =
            err && typeof err === "object" && "message" in err
              ? (err as { message: string }).message
              : t("toasts.couldNotAddRecipient");
          toast({
            title: t("toasts.failedToAddTitle"),
            description: msg.includes("409")
              ? t("toasts.failedToAddDuplicate")
              : msg,
            variant: "destructive",
          });
        },
      },
    );
  };

  const confirmDelete = () => {
    if (!deletingId) return;
    deleteMutation.mutate(
      { id: deletingId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListDigestRecipientsQueryKey(),
          });
          toast({ title: t("toasts.recipientRemovedTitle") });
          setDeletingId(null);
        },
        onError: () => {
          toast({
            title: t("toasts.failedToRemoveTitle"),
            description: t("toasts.failedToRemoveDescription"),
            variant: "destructive",
          });
          setDeletingId(null);
        },
      },
    );
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {t("pages.settings.digestRecipientsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("pages.settings.digestRecipientsDescription")}
          </p>

          <div className="flex gap-2">
            <Input
              type="email"
              placeholder={t("pages.settings.emailPlaceholder")}
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              className="flex-1"
              data-testid="digest-email-input"
            />
            <Button
              onClick={handleAdd}
              disabled={createMutation.isPending || !newEmail.trim()}
              data-testid="digest-add-btn"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              <span className="ml-1">{t("pages.settings.addRecipient")}</span>
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              {t("pages.settings.loadingRecipients")}
            </div>
          ) : !recipients || recipients.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {t("pages.settings.noRecipients")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pages.settings.tableEmail")}</TableHead>
                  <TableHead className="w-20 text-right">
                    {t("pages.settings.tableActions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recipients.map((r) => (
                  <TableRow key={r.id} data-testid="digest-recipient-row">
                    <TableCell className="font-medium">{r.email}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeletingId(r.id)}
                        data-testid="digest-remove-btn"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!deletingId}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pages.settings.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("pages.settings.removeDescription", {
                email:
                  deletingRecipient?.email ??
                  t("pages.settings.removeFallbackEmail"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("pages.settings.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("pages.settings.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function Settings() {
  const { t } = useTranslation();
  return (
    <MainLayout>
      <PageHeader title={t("pages.settings.title")} />
      <div className="max-w-3xl space-y-6">
        <Tabs defaultValue="team" className="w-full">
          <TabsList>
            <TabsTrigger value="team" data-testid="settings-tab-team">
              <Users className="h-4 w-4 mr-2" />
              Team
            </TabsTrigger>
            <TabsTrigger value="digest" data-testid="settings-tab-digest">
              <Mail className="h-4 w-4 mr-2" />
              Email digest
            </TabsTrigger>
          </TabsList>
          <TabsContent value="team" className="mt-4">
            <TeamSettings />
          </TabsContent>
          <TabsContent value="digest" className="mt-4">
            <DigestRecipientsSection />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
