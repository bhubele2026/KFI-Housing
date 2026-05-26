import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Send, X, Trash2, Undo2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAssistant, type PendingProposal } from "./use-assistant";

export function AssistantBubble() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const {
    messages,
    proposals,
    busy,
    error,
    send,
    respondToProposal,
    undoProposal,
    reset,
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

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, proposals, open]);

  const handleSubmit = () => {
    const t = input.trim();
    if (!t || busy) return;
    setInput("");
    void send(t);
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
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">HousingOps Assistant</span>
            </div>
            <div className="flex items-center gap-1">
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

          <footer className="border-t border-border p-2">
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder="Ask or instruct… (Shift+Enter for newline)"
                rows={2}
                disabled={busy}
                className="resize-none text-sm min-h-[40px]"
                data-testid="input-assistant-message"
              />
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={busy || !input.trim()}
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
