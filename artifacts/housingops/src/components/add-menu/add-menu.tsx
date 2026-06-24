import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Plus } from "lucide-react";

type Item = { label: string; sub?: string; href: string };

/**
 * Context-aware "＋ Add" menu in the top bar. The actual creation lives on the
 * destination pages (the Properties "drop a lease" card, a bed board's add-
 * associate, etc.) — this just routes the operator to the right place based on
 * where they are.
 */
function itemsFor(path: string): Item[] {
  if (path.startsWith("/properties/") || path.startsWith("/beds")) {
    // on a property's bed board
    return [
      { label: "Add associate", sub: "assign someone to an open bed", href: path },
      { label: "Add a property", sub: "drop a lease PDF", href: "/properties" },
    ];
  }
  if (path.startsWith("/properties")) {
    return [{ label: "Add a property", sub: "drop a lease PDF", href: "/properties" }];
  }
  if (path.startsWith("/customers/")) {
    return [
      { label: "Add a property for this client", sub: "drop a lease PDF", href: "/properties" },
    ];
  }
  // default
  return [
    { label: "Add a property", sub: "drop a lease PDF", href: "/properties" },
    { label: "Go to Roster", sub: "everyone housed", href: "/roster" },
  ];
}

export function AddMenu() {
  const [location, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const items = itemsFor(location);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-[10px] bg-[linear-gradient(135deg,hsl(var(--grad1)),hsl(var(--grad2)))] px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm transition-transform hover:-translate-y-px"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Plus className="h-4 w-4" /> Add
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-panel py-1 shadow-[0_12px_36px_rgba(16,24,40,.16)]"
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate(it.href);
              }}
              className="block w-full px-3.5 py-2 text-left hover:bg-track"
            >
              <div className="text-[13.5px] font-medium text-ink">{it.label}</div>
              {it.sub && <div className="text-[11.5px] text-muted-foreground">{it.sub}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
