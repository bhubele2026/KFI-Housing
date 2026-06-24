import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { Search } from "lucide-react";

type Result = { type: string; id: string; label: string; href: string };

const baseUrl = (): string => import.meta.env.BASE_URL ?? "/";

/**
 * Global ⌘K / Ctrl+K command bar. Self-mounted in the app shell — owns its own
 * open state via a window keydown listener. Searches occupants/properties/
 * customers via GET /api/search?q= (direct-fetch; the endpoint isn't in the
 * generated client) and jumps to the chosen result.
 */
export function CommandBar() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global hotkey: ⌘K / Ctrl+K toggles the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("kfi:command-open", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("kfi:command-open", onOpen);
    };
  }, []);

  // Focus the input + reset when opened.
  useEffect(() => {
    if (open) {
      setQ("");
      setResults([]);
      setActive(0);
      // focus after paint
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term === "") {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let alive = true;
    const h = setTimeout(async () => {
      try {
        const res = await fetch(`${baseUrl()}api/search?q=${encodeURIComponent(term)}`);
        const body = (await res.json().catch(() => ({}))) as { results?: Result[] };
        if (alive) {
          setResults(Array.isArray(body.results) ? body.results : []);
          setActive(0);
        }
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 180);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [q, open]);

  const choose = useCallback(
    (r: Result | undefined) => {
      if (!r) return;
      setOpen(false);
      navigate(r.href);
    },
    [navigate],
  );

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 pt-[12vh]"
      onMouseDown={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_20px_60px_rgba(16,24,40,.25)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search className="h-4 w-4 text-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search associates, properties, clients…"
            className="w-full bg-transparent py-3.5 text-[15px] text-ink outline-none placeholder:text-faint"
          />
          <kbd className="rounded bg-track px-1.5 py-0.5 text-[10px] font-semibold text-faint">esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1.5">
          {loading && (
            <div className="space-y-1 px-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="mx-1 h-9 animate-pulse rounded-lg bg-track" />
              ))}
            </div>
          )}
          {!loading && q.trim() !== "" && results.length === 0 && (
            <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">No matches for “{q}”.</div>
          )}
          {!loading && q.trim() === "" && (
            <div className="px-4 py-6 text-center text-[13px] text-faint">Type to search across the whole portfolio.</div>
          )}
          {!loading &&
            results.map((r, i) => (
              <button
                key={`${r.type}-${r.id}`}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
                className={`mx-1.5 flex w-[calc(100%-12px)] items-center justify-between rounded-lg px-3 py-2 text-left text-[13.5px] ${
                  i === active ? "bg-accent text-ink" : "text-ink2 hover:bg-track"
                }`}
              >
                <span className="truncate font-medium">{r.label}</span>
                <span className="ml-3 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-faint">
                  {r.type}
                </span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
