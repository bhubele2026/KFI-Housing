import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Send, X, Trash2, Undo2, Paperclip, BellOff, Clock, Download, FileSpreadsheet, FileText, History } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  useAssistant,
  type PendingProposal,
  type AssistantAttachment,
  type ExportChip,
} from "./use-assistant";
import { useAssistantChips, type PageChip } from "./use-assistant-chips";
import { renderPreview } from "./proposal-preview";
import {
  useAssistantNudges,
  useDismissNudge,
  useSnoozeNudge,
  useNudgeCtaTap,
  type AssistantNudge,
  type SnoozePreset,
} from "./use-assistant-nudges";
import { useRecentExports, type RecentExport } from "./use-recent-exports";

export function AssistantBubble() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // After tapping a chip we hide the chip row for the rest of this
  // turn so the operator doesn't see stale chips next to their own
  // freshly-sent message. The flag is cleared automatically once the
  // assistant turn finishes (busy flips false).
  const [chipsSuppressedForTurn, setChipsSuppressedForTurn] = useState(false);
  // Task #683 — collapsible "Recent exports" tray in the header.
  // Fetched lazily (only while the bubble is open AND the tray is
  // expanded) so we never poll the endpoint in the background.
  const [recentExportsOpen, setRecentExportsOpen] = useState(false);
  const {
    messages,
    proposals,
    exports,
    busy,
    error,
    send,
    respondToProposal,
    undoProposal,
    reset,
    uploadFile,
    pageFocusCustomer,
    markExportDownloaded,
  } = useAssistant();
  const hasPendingProposal = proposals.some((p) => p.status === "pending");
  const chipsQuery = useAssistantChips({
    enabled: open && !busy && !hasPendingProposal,
  });
  const nudgesQuery = useAssistantNudges();
  const recentExportsQuery = useRecentExports({
    enabled: open && recentExportsOpen,
  });
  const recentExports = recentExportsQuery.data?.exports ?? [];
  const dismissNudge = useDismissNudge();
  const snoozeNudge = useSnoozeNudge();
  const nudgeCtaTap = useNudgeCtaTap();
  const nudges = nudgesQuery.data?.nudges ?? [];
  const activeNudgeCount = nudges.length;
  useEffect(() => {
    if (!busy) setChipsSuppressedForTurn(false);
  }, [busy]);
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

  const handleChipTap = (chip: PageChip) => {
    if (busy || uploading) return;
    setInput("");
    setChipsSuppressedForTurn(true);
    void send(chip.prompt, attachments);
    setAttachments([]);
  };

  // Render the chip row only when: bubble is open, no in-flight turn,
  // no pending proposal awaiting confirm, not suppressed for this turn,
  // and the query has actually returned data (no-flash gating).
  const showChips =
    open &&
    !busy &&
    !hasPendingProposal &&
    !chipsSuppressedForTurn &&
    chipsQuery.isSuccess &&
    (chipsQuery.data?.chips.length ?? 0) > 0;

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
          {activeNudgeCount > 0 && (
            <span
              data-testid="assistant-nudge-badge"
              data-count={activeNudgeCount}
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-semibold flex items-center justify-center shadow"
            >
              {activeNudgeCount > 9 ? "9+" : activeNudgeCount}
            </span>
          )}
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
                onClick={() => setRecentExportsOpen((v) => !v)}
                aria-label="Recent exports"
                aria-expanded={recentExportsOpen}
                data-testid="button-assistant-recent-exports"
                title="Recent exports (last 24h)"
              >
                <History className="h-4 w-4" />
              </Button>
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

          {recentExportsOpen && (
            <RecentExportsTray
              loading={recentExportsQuery.isLoading}
              error={
                recentExportsQuery.isError
                  ? (recentExportsQuery.error as Error)?.message ??
                    "Couldn't load recent exports."
                  : null
              }
              items={recentExports}
              onClose={() => setRecentExportsOpen(false)}
            />
          )}

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

            {messages.map((m) => {
              // Task #681: render any export chips produced while THIS
              // assistant message was streaming directly underneath it,
              // so the download card appears at the point in the
              // conversation where it was generated.
              const chipsForMsg = exports.filter(
                (e) => e.afterMessageId === m.id,
              );
              return (
                <div key={m.id} className="space-y-3">
                  <MessageBubble role={m.role} text={m.text} pending={m.pending} />
                  {chipsForMsg.map((e) => (
                    <ExportChipCard
                      key={e.id}
                      chip={e}
                      onDownloaded={() => markExportDownloaded(e.id)}
                    />
                  ))}
                </div>
              );
            })}

            {/* Orphan chips (no parent message — e.g. hydrated after
                reload before the chip's parent message arrived) render
                at the tail so they're never lost. */}
            {exports
              .filter(
                (e) =>
                  !e.afterMessageId ||
                  !messages.some((m) => m.id === e.afterMessageId),
              )
              .map((e) => (
                <ExportChipCard
                  key={e.id}
                  chip={e}
                  onDownloaded={() => markExportDownloaded(e.id)}
                />
              ))}

            {nudges.length > 0 && (
              <div
                className="space-y-1.5"
                data-testid="assistant-nudges"
                data-count={nudges.length}
              >
                {nudges.map((n) => (
                  <NudgeCard
                    key={n.id}
                    nudge={n}
                    onAct={(prompt) => {
                      // Spec requires the card to disappear after the
                      // CTA fires: log a CTA tap for telemetry, then
                      // dismiss the row so it doesn't linger above
                      // the response. Both calls are best-effort —
                      // the prompt always goes regardless of either
                      // network result.
                      nudgeCtaTap.mutate(n);
                      dismissNudge.mutate(n);
                      setChipsSuppressedForTurn(true);
                      void send(prompt, attachments);
                      setAttachments([]);
                    }}
                    onDismiss={() => dismissNudge.mutate(n)}
                    onSnooze={(until) =>
                      snoozeNudge.mutate({ nudge: n, until })
                    }
                    disabled={busy}
                  />
                ))}
              </div>
            )}

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
            {showChips && (
              <div
                className="flex gap-1.5 overflow-x-auto flex-wrap"
                data-testid="assistant-page-chips"
              >
                {chipsQuery.data!.chips.map((chip) => (
                  <Button
                    key={chip.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleChipTap(chip)}
                    disabled={busy || uploading}
                    className="h-7 px-2.5 text-[11px] font-normal max-w-[28ch] truncate"
                    title={chip.prompt}
                    data-testid={`assistant-chip-${chip.label}`}
                  >
                    {chip.label}
                  </Button>
                ))}
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

function NudgeCard({
  nudge,
  onAct,
  onDismiss,
  onSnooze,
  disabled,
}: {
  nudge: AssistantNudge;
  onAct: (prompt: string) => void;
  onDismiss: () => void;
  onSnooze: (until: SnoozePreset) => void;
  disabled: boolean;
}) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const severityClasses =
    nudge.severity === "critical"
      ? "border-destructive/40 bg-destructive/5"
      : nudge.severity === "warn"
        ? "border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30"
        : "border-sky-300 bg-sky-50 dark:border-sky-700/60 dark:bg-sky-950/30";
  const dotClasses =
    nudge.severity === "critical"
      ? "bg-destructive"
      : nudge.severity === "warn"
        ? "bg-amber-500"
        : "bg-sky-500";
  return (
    <div
      className={`rounded-lg border p-2.5 space-y-1.5 ${severityClasses}`}
      data-testid={`assistant-nudge-${nudge.ruleKey}`}
      data-nudge-source={nudge.source}
      data-nudge-severity={nudge.severity}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dotClasses}`}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{nudge.title}</div>
          {nudge.body && (
            <div className="text-xs text-muted-foreground whitespace-pre-wrap">
              {nudge.body}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {nudge.ctaPrompt && nudge.ctaLabel && (
          <Button
            type="button"
            size="sm"
            variant="default"
            className="h-7 px-2.5 text-[11px]"
            onClick={() => onAct(nudge.ctaPrompt!)}
            disabled={disabled}
            data-testid={`button-nudge-act-${nudge.ruleKey}`}
          >
            {nudge.ctaLabel}
          </Button>
        )}
        <div className="relative">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px] text-muted-foreground"
            onClick={() => setSnoozeOpen((v) => !v)}
            title="Snooze this reminder"
            data-testid={`button-nudge-snooze-${nudge.ruleKey}`}
          >
            <Clock className="h-3 w-3 mr-1" />
            Snooze
          </Button>
          {snoozeOpen && (
            <div
              className="absolute z-10 left-0 top-full mt-1 rounded-md border bg-popover shadow-md py-1 min-w-[100px]"
              role="menu"
              data-testid={`menu-nudge-snooze-${nudge.ruleKey}`}
              onMouseLeave={() => setSnoozeOpen(false)}
            >
              {([
                { label: "1 day", value: "1d" as const },
                { label: "3 days", value: "3d" as const },
                { label: "1 week", value: "1w" as const },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className="block w-full text-left px-2.5 py-1 text-[11px] hover:bg-accent"
                  onClick={() => {
                    setSnoozeOpen(false);
                    onSnooze(opt.value);
                  }}
                  data-testid={`button-nudge-snooze-${opt.value}-${nudge.ruleKey}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px] text-muted-foreground"
          onClick={onDismiss}
          title="Dismiss"
          data-testid={`button-nudge-dismiss-${nudge.ruleKey}`}
        >
          <BellOff className="h-3 w-3 mr-1" />
          Dismiss
        </Button>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function ExportChipCard({
  chip,
  onDownloaded,
}: {
  chip: ExportChip;
  onDownloaded: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const handleDownload = async () => {
    setDownloading(true);
    setErr(null);
    try {
      const r = await fetch(chip.downloadUrl, { credentials: "include" });
      if (!r.ok) {
        if (r.status === 410)
          throw new Error("This export has expired. Re-run the export to download it again.");
        throw new Error(`Download failed (HTTP ${r.status})`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = chip.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onDownloaded();
    } catch (e: any) {
      setErr(e?.message ?? "Download failed");
    } finally {
      setDownloading(false);
    }
  };
  const Icon = chip.format === "pdf" ? FileText : FileSpreadsheet;
  const dimmed = chip.downloadedAt ? "opacity-60" : "";
  return (
    <div
      className={`rounded-lg border border-border bg-background/80 p-2.5 flex items-center gap-2 ${dimmed}`}
      data-testid={`export-chip-${chip.id}`}
      data-export-format={chip.format}
    >
      <Icon className="h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{chip.filename}</div>
        <div className="text-[11px] text-muted-foreground">
          {chip.rowCount.toLocaleString()} rows · {formatBytes(chip.sizeBytes)} ·{" "}
          {chip.format.toUpperCase()}
        </div>
        {err && (
          <div className="text-[11px] text-destructive mt-0.5">{err}</div>
        )}
      </div>
      <Button
        type="button"
        size="sm"
        variant="default"
        className="h-7 px-2.5 text-[11px] shrink-0"
        onClick={handleDownload}
        disabled={downloading}
        data-testid={`export-chip-download-${chip.id}`}
      >
        <Download className="h-3 w-3 mr-1" />
        {downloading ? "…" : "Download"}
      </Button>
    </div>
  );
}

function RecentExportsTray({
  loading,
  error,
  items,
  onClose,
}: {
  loading: boolean;
  error: string | null;
  items: RecentExport[];
  onClose: () => void;
}) {
  return (
    <div
      data-testid="assistant-recent-exports-tray"
      data-count={items.length}
      className="border-b border-border bg-muted/30 px-3 py-2 space-y-1.5 max-h-48 overflow-y-auto"
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Recent exports (last 24h)
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={onClose}
          aria-label="Close recent exports"
          data-testid="button-assistant-recent-exports-close"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      {loading && (
        <div
          className="text-[11px] text-muted-foreground"
          data-testid="assistant-recent-exports-loading"
        >
          Loading…
        </div>
      )}
      {error && (
        <div
          className="text-[11px] text-destructive"
          data-testid="assistant-recent-exports-error"
        >
          {error}
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div
          className="text-[11px] text-muted-foreground italic"
          data-testid="assistant-recent-exports-empty"
        >
          No exports yet. Ask me to export a list and a download will
          appear here.
        </div>
      )}
      {items.map((e) => {
        const Icon = e.format === "pdf" ? FileText : FileSpreadsheet;
        return (
          <a
            key={e.id}
            href={e.downloadUrl}
            download={e.filename}
            className="flex items-center gap-2 rounded border border-border bg-background/80 px-2 py-1.5 hover:bg-accent"
            data-testid={`recent-export-${e.id}`}
            data-export-format={e.format}
          >
            <Icon className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate">{e.filename}</div>
              <div className="text-[10px] text-muted-foreground">
                {e.rowCount.toLocaleString()} rows · {formatBytes(e.sizeBytes)} ·{" "}
                {(e.format || "").toUpperCase()}
              </div>
            </div>
            <Download className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </a>
        );
      })}
    </div>
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
          {renderPreview(proposal.tool, proposal.preview)}
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
