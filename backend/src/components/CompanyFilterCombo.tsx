import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Building2, ChevronDown, Search, X as XIcon } from "lucide-react";
import type { CompanyOption } from "@/api/bankMasterApi";

// A "Company" scope filter that behaves like a real filter, not a gate:
// "All companies" is a real, always-visible, always-selectable option (not
// placeholder text that blocks the page's data until something else is
// picked), and the list is searchable — same combo-picker pattern as the
// Payment page's FilterBar/VendorCombo. Panel is portalled to document.body
// so overflow:hidden on ancestors never clips it.
export function CompanyFilterCombo({
  companies,
  value,
  onChange,
}: {
  companies: CompanyOption[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updateRect = useCallback(() => {
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
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
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        panelRef.current && !panelRef.current.contains(e.target as Node)
      ) { setOpen(false); setQuery(""); }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = value != null ? companies.find((c) => c.id === value) : null;
  const filtered = query.trim()
    ? companies.filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase()))
    : companies;

  const PANEL_MAX = 260;
  const GAP = 6;
  const spaceBelow = rect ? window.innerHeight - rect.bottom - GAP : 0;
  const spaceAbove = rect ? rect.top - GAP : 0;
  const openUpward = spaceAbove > spaceBelow && spaceBelow < PANEL_MAX;

  const panel = open && rect && createPortal(
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        ...(openUpward
          ? { bottom: window.innerHeight - rect.top + GAP }
          : { top: rect.bottom + GAP }),
        left: rect.left,
        width: Math.max(rect.width, 220),
        zIndex: 9999,
      }}
      className="rounded-lg border border-border bg-card shadow-2xl overflow-hidden"
    >
      <div className="p-1.5 border-b border-border">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search company…"
            className="w-full pl-6 pr-2 py-1.5 text-xs bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
      <div className="overflow-y-auto py-1" style={{ maxHeight: (openUpward ? spaceAbove : spaceBelow) - 44 }}>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { onChange(null); setOpen(false); setQuery(""); }}
          className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-muted/60 ${
            value == null ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-foreground"
          }`}
        >
          All companies
        </button>
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No companies found</p>
        ) : (
          filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(c.id); setOpen(false); setQuery(""); }}
              className={`w-full text-left px-3 py-2 text-sm truncate transition-colors hover:bg-muted/60 ${
                c.id === value ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-foreground"
              }`}
            >
              {c.label}
            </button>
          ))
        )}
      </div>
    </div>,
    document.body,
  );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { setOpen((o) => !o); updateRect(); }}
        className="flex items-center gap-1.5 h-7 min-w-[150px] rounded-md border border-border bg-background px-2.5 text-xs hover:border-emerald-500/40 transition-colors"
      >
        <Building2 size={11} className="text-muted-foreground shrink-0" />
        <span className={`flex-1 text-left truncate ${selected ? "text-foreground font-medium" : "text-muted-foreground"}`}>
          {selected ? selected.label : "All companies"}
        </span>
        {selected && (
          <span
            role="button"
            tabIndex={-1}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onChange(null); setQuery(""); }}
            className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
          >
            <XIcon size={10} />
          </span>
        )}
        <ChevronDown size={11} className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {panel}
    </div>
  );
}
