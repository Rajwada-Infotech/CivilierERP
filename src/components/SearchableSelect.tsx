import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

export interface SearchableOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
}

const GAP = 6;
const MAX_PANEL = 320;
const MIN_PANEL = 140;
const SEARCH_BAR = 46;

// A searchable dropdown that is aware of where it sits on screen: the panel
// is portalled to document.body (so no ancestor's overflow can clip it),
// opens upward when there is more room above the trigger than below, sizes
// its list to the space actually available, stays inside the viewport
// horizontally, and follows the trigger if the page scrolls or resizes.
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "— Select —",
  searchPlaceholder = "Search…",
  disabled,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const updateRect = useCallback(() => {
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    if (!open) return;
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [open, updateRect]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  useEffect(() => setActive(0), [query, open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const selected = options.find((o) => o.value === value);

  const pick = (o: SearchableOption | undefined) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      triggerRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(filtered[active]);
    }
  };

  let panel: React.ReactNode = null;
  if (open && rect) {
    const spaceBelow = window.innerHeight - rect.bottom - GAP - 8;
    const spaceAbove = rect.top - GAP - 8;
    const openUp = spaceBelow < MIN_PANEL && spaceAbove > spaceBelow;
    const available = Math.max(MIN_PANEL, openUp ? spaceAbove : spaceBelow);
    const panelMax = Math.min(MAX_PANEL, available);
    const width = Math.max(rect.width, 260);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));

    panel = createPortal(
      <div
        ref={panelRef}
        style={{
          position: "fixed",
          left,
          width,
          zIndex: 9999,
          ...(openUp ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
        }}
        className="rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl overflow-hidden"
      >
        <div className="p-1.5 border-b border-border">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              className="w-full pl-7 pr-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>
        </div>
        <div ref={listRef} style={{ maxHeight: Math.max(80, panelMax - SEARCH_BAR) }} className="overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground text-center">No matches</p>
          ) : (
            filtered.map((o, i) => (
              <button
                key={o.value}
                type="button"
                data-idx={i}
                disabled={o.disabled}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
                className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  i === active ? "bg-emerald-500/10 text-foreground" : "text-foreground"
                }`}
              >
                <span className="flex-1 truncate">{o.label}</span>
                {o.value === value && <Check size={13} className="text-emerald-500 shrink-0" />}
              </button>
            ))
          )}
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border bg-background text-sm text-left focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50 ${className}`}
      >
        <span className={`truncate ${selected ? "text-foreground" : "text-muted-foreground"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
      </button>
      {panel}
    </>
  );
}
