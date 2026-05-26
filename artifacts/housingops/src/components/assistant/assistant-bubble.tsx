import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Send, X, Trash2, Undo2, Paperclip } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  useAssistant,
  type PendingProposal,
  type AssistantAttachment,
} from "./use-assistant";

export function AssistantBubble() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const {
    messages,
    proposals,
    busy,
    error,
    send,
    respondToProposal,
    undoProposal,
    reset,
    uploadFile,
    pageFocusCustomer,
  } = useAssistant();
  // Only the *most recent* approved & reversible change can be undone
  // from the bubble — older approved changes might have been built on
  // top of by newer edits, so we hide the Undo button to keep the
  // interaction safe and intentional.
  const undoableId = useMemo(() => {
    for (let i = proposals.length - 1; i >= 0; i--) {
      const p = proposals[i];
      if (p.status === "approved" && p.reversible) return p.id;
    }
    return null;
  }, [proposals]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, proposals, open]);

  const handleSubmit = () => {
    const t = input.trim();
    if ((!t && attachments.length === 0) || busy) return;
    const text = t || "(see attached file)";
    const toSend = attachments;
    setInput("");
    setAttachments([]);
    setUploadError(null);
    void send(text, toSend);
  };

  const handlePickFile = () => {
    setUploadError(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const att = await uploadFile(file);
      setAttachments((prev) => [...prev, att]);
    } catch (err: any) {
      setUploadError(err?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (uploadId: string) => {
    setAttachments((prev) => prev.filter((a) => a.uploadId !== uploadId));
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open HousingOps assistant"
          data-testid="button-open-assistant"
          className="fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all"
        >
          <Bot className="h-5 w-5" />
        </button>
      )}

      {open && (
        <div
          data-testid="assistant-panel"
          className="fixed bottom-5 right-5 z-50 flex h-[min(640px,calc(100vh-2.5rem))] w-[420px] max-w-[calc(100vw-2.5rem)] flex-col rounded-xl border border-border bg-background shadow-2xl"
        >
          <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <Bot className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-semibold shrink-0">HousingOps Assistant</span>
              {pageFocusCustomer && (
                <span
                  data-testid="assistant-page-focus-badge"
                  data-customer-id={pageFocusCustomer.id}
                  title={`Writes from this chat will be limited to ${pageFocusCustomer.name} because the page you're on belongs to that customer. Change the customer dropdown to override.`}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary min-w-0"
                >
                  <span className="opacity-70 shrink-0">Scoped to:</span>
                  <span className="truncate" data-testid="assistant-page-focus-badge-name">
                    {pageFocusCustomer.name}
                  </span>
                  <span className="opacity-70 shrink-0">via page</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={reset}
                aria-label="Start new conversation"
                data-testid="button-assistant-reset"
                title="New conversation"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
                data-testid="button-close-assistant"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </header>

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-sm"
            data-testid="assistant-messages"
          >
            {messages.length === 0 && proposals.length === 0 && (
              <div className="text-muted-foreground text-xs space-y-2 mt-2">
                <p>Ask me anything about your portfolio. Examples:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>"Which properties have vacant beds?"</li>
                  <li>"Move Sarah Jones to bed 3 at Penda."</li>
                  <li>"Add a $1200 monthly utility for property p-7 (Internet)."</li>
                  <li>"Show me all leases expiring in the next 60 days."</li>
                </ul>
                <p className="pt-1 italic">
                  Any change (create / update / delete) will ask you to confirm first.
                </p>
              </div>
            )}

            {messages.map((m) => (
              <MessageBubble key={m.id} role={m.role} text={m.text} pending={m.pending} />
            ))}

            {proposals
              .filter((p) => p.status === "pending")
              .map((p) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  onDecide={(approve) => respondToProposal(p.id, approve)}
                  disabled={busy}
                />
              ))}

            {proposals.some((p) => p.status !== "pending") && (
              <ChangesList
                proposals={proposals.filter((p) => p.status !== "pending")}
                undoableId={undoableId}
                onUndo={undoProposal}
                disabled={busy}
              />
            )}

            {error && (
              <div
                className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
                data-testid="assistant-error"
              >
                {error}
              </div>
            )}
          </div>

          <footer className="border-t border-border p-2 space-y-1.5">
            {attachments.length > 0 && (
              <div
                className="flex flex-wrap gap-1.5"
                data-testid="assistant-attachments"
              >
                {attachments.map((a) => (
                  <span
                    key={a.uploadId}
                    className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[11px]"
                    data-testid={`attachment-chip-${a.uploadId}`}
                  >
                    <Paperclip className="h-3 w-3" />
                    <span className="max-w-[180px] truncate">{a.filename}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.uploadId)}
                      className="ml-0.5 text-muted-foreground hover:text-foreground"
                      aria-label={`Remove ${a.filename}`}
                      data-testid={`attachment-remove-${a.uploadId}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {uploadError && (
              <div className="text-[11px] text-destructive" data-testid="assistant-upload-error">
                {uploadError}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileChange}
                className="hidden"
                data-testid="input-assistant-file"
                accept=".xlsx,.xls,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handlePickFile}
                disabled={busy || uploading}
                aria-label="Attach file"
                title="Attach file (.xlsx, .pdf)"
                data-testid="button-assistant-attach"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder={
                  uploading
                    ? "Uploading…"
                    : "Ask or instruct… (Shift+Enter for newline)"
                }
                rows={2}
                disabled={busy || uploading}
                className="resize-none text-sm min-h-[40px]"
                data-testid="input-assistant-message"
              />
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={busy || uploading || (!input.trim() && attachments.length === 0)}
                size="icon"
                aria-label="Send message"
                data-testid="button-assistant-send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </footer>
        </div>
      )}
    </>
  );
}

function MessageBubble({
  role,
  text,
  pending,
}: {
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end" data-testid="assistant-user-message">
        <div className="rounded-lg bg-primary px-3 py-1.5 text-primary-foreground max-w-[85%] whitespace-pre-wrap">
          {text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start" data-testid="assistant-assistant-message">
      <div className="rounded-lg bg-muted px-3 py-1.5 max-w-[85%] whitespace-pre-wrap">
        {text || (pending ? <span className="opacity-60">Thinking…</span> : null)}
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  onDecide,
  disabled,
}: {
  proposal: PendingProposal;
  onDecide: (approve: boolean) => void;
  disabled: boolean;
}) {
  const isDestructive = proposal.tool.startsWith("delete_");
  return (
    <div
      data-testid={`proposal-card-${proposal.id}`}
      data-proposal-tool={proposal.tool}
      className={`rounded-lg border p-2.5 space-y-2 ${
        isDestructive
          ? "border-destructive/40 bg-destructive/5"
          : "border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30"
      }`}
    >
      <div className="text-xs font-medium">
        {isDestructive ? "Destructive change — confirm:" : "Pending change — confirm:"}
      </div>
      <div className="text-sm">{proposal.summary}</div>
      {proposal.preview !== undefined && proposal.preview !== null && (
        <div
          className="rounded border border-border bg-background/60 p-1.5 text-[11px] space-y-1"
          data-testid={`proposal-preview-${proposal.id}`}
        >
          <div className="font-medium text-muted-foreground">What will change:</div>
          <PreviewBlock data={proposal.preview} />
        </div>
      )}
      {proposal.previewError && (
        <div
          className="rounded border border-amber-300/60 bg-amber-50 px-1.5 py-1 text-[11px] text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
          data-testid={`proposal-preview-error-${proposal.id}`}
        >
          Preview unavailable: {proposal.previewError}
        </div>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Details</summary>
        <pre className="mt-1 overflow-x-auto rounded bg-background/60 p-1.5 text-[11px]">
          {JSON.stringify(proposal.input, null, 2)}
        </pre>
      </details>
      <div className="flex gap-2 pt-0.5">
        <Button
          type="button"
          size="sm"
          variant={isDestructive ? "destructive" : "default"}
          onClick={() => onDecide(true)}
          disabled={disabled}
          data-testid={`button-proposal-approve-${proposal.id}`}
        >
          Confirm
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onDecide(false)}
          disabled={disabled}
          data-testid={`button-proposal-reject-${proposal.id}`}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function statusLabel(status: PendingProposal["status"]): string {
  switch (status) {
    case "approved":
      return "Done";
    case "rejected":
      return "Cancelled";
    case "failed":
      return "Failed";
    case "undone":
      return "Undone";
    default:
      return status;
  }
}

function statusColor(status: PendingProposal["status"]): string {
  switch (status) {
    case "approved":
      return "text-emerald-600 dark:text-emerald-400";
    case "failed":
      return "text-destructive";
    case "undone":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

function PreviewBlock({ data }: { data: unknown }) {
  if (data === null || data === undefined) return null;
  if (typeof data !== "object") {
    return <div>{String(data)}</div>;
  }
  if (Array.isArray(data)) {
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap break-words">
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  }
  const entries = Object.entries(data as Record<string, unknown>);
  return (
    <ul className="space-y-0.5">
      {entries.map(([k, v]) => (
        <li key={k} className="flex gap-1.5">
          <span className="text-muted-foreground">{k}:</span>
          <span className="break-words">
            {typeof v === "object" && v !== null ? (
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px]">
                {JSON.stringify(v, null, 2)}
              </pre>
            ) : (
              String(v)
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ChangesList({
  proposals,
  undoableId,
  onUndo,
  disabled,
}: {
  proposals: PendingProposal[];
  undoableId: string | null;
  onUndo: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <div
      data-testid="assistant-changes-list"
      className="rounded-md border border-border bg-muted/30 p-2 space-y-1.5"
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Changes ({proposals.length})
        </div>
        <Link
          href="/assistant/changelog"
          className="text-[11px] text-primary hover:underline"
          data-testid="link-assistant-changelog"
        >
          View all
        </Link>
      </div>
      {proposals.map((p) => (
        <div
          key={`r-${p.id}`}
          className="flex items-start gap-2 text-xs"
          data-testid={`proposal-resolved-${p.id}`}
          data-proposal-status={p.status}
        >
          <span className={`font-medium ${statusColor(p.status)}`}>
            {statusLabel(p.status)}:
          </span>
          <span className="flex-1 text-muted-foreground">
            {p.summary}
            {p.resultId && (
              <code
                className="ml-1 rounded bg-background/60 px-1 py-0.5 text-[10px]"
                data-testid={`proposal-result-id-${p.id}`}
              >
                {p.resultId}
              </code>
            )}
            {p.error && (
              <span className="text-destructive" title={p.error}>
                {" "}
                — {p.error}
              </span>
            )}
          </span>
          {p.id === undoableId && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onUndo(p.id)}
              disabled={disabled}
              className="h-6 px-2 text-[11px]"
              data-testid={`button-proposal-undo-${p.id}`}
            >
              <Undo2 className="h-3 w-3 mr-1" />
              Undo
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
