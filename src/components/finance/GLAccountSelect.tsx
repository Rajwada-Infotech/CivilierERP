import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Search, Check, ChevronsUpDown, X, BookOpen } from "lucide-react";

export interface GLOption {
  id: number;
  label: string;
  code: string | null;
}

/**
 * Single-select searchable dropdown for picking a GL Account straight from
 * the General Ledger master (dbo.AccountHeadMaster WHERE LHeadType='GL') —
 * replaces the old free-text "GL Account" input on the invoice form so the
 * booking always posts against a real ledger head instead of an arbitrary
 * typed string.
 */
export const GLAccountSelect: React.FC<{
  value: number | null | undefined;
  onChange: (id: number | null, label: string | null) => void;
  placeholder?: string;
  className?: string;
}> = ({ value, onChange, placeholder = "Select GL account...", className }) => {
  const [options, setOptions] = useState<GLOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    fetchWithAuth("/api/general-ledger/options")
      .then((res) => res.json().catch(() => ({})))
      .then((data: GLOption[]) => setOptions(Array.isArray(data) ? data : []))
      .catch(() => setOptions([]))
      .finally(() => setLoading(false));
  }, []);

  const selectedOption = useMemo(
    () => (value ? options.find((o) => o.id === value) ?? null : null),
    [value, options],
  );

  const reposition = () => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - 8;
    setPanelStyle({
      position: "fixed",
      left: r.left,
      top: r.bottom + 4,
      width: Math.max(r.width, 280),
      maxHeight: Math.min(360, spaceBelow),
      zIndex: 9999,
    });
  };

  useEffect(() => {
    if (open) {
      reposition();
      setTimeout(() => searchRef.current?.focus(), 60);
    } else {
      setSearch("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!triggerRef.current?.contains(e.target as Node) && !panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", () => setOpen(false));
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.code?.toLowerCase().includes(q),
    );
  }, [options, search]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-border bg-background hover:border-primary/40 text-sm transition-colors text-left focus:outline-none focus:ring-2 focus:ring-primary/20 ${className ?? ""}`}
      >
        <span className={`flex items-center gap-2 min-w-0 ${selectedOption ? "text-foreground" : "text-muted-foreground/50"}`}>
          {selectedOption ? (
            <>
              <BookOpen size={13} className="text-primary/70 shrink-0" />
              <span className="truncate">{selectedOption.label}</span>
              {selectedOption.code ? <span className="font-mono text-[10px] text-muted-foreground/50 shrink-0">({selectedOption.code})</span> : null}
            </>
          ) : (
            <span className="truncate">{placeholder}</span>
          )}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {selectedOption && (
            <X
              size={12}
              className="text-muted-foreground/40 hover:text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null, null);
              }}
            />
          )}
          <ChevronsUpDown size={13} className={`text-muted-foreground/40 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          style={panelStyle}
          className="flex flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in-0 zoom-in-95"
        >
          <div className="px-3 py-2.5 border-b border-border/60 shrink-0">
            <div className="relative">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or code…"
                className="w-full text-xs pl-7 pr-2 py-2 rounded-md bg-muted/40 border border-border/60 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-1.5">
            {loading ? (
              <p className="text-xs text-muted-foreground text-center py-6">Loading GL accounts…</p>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No matching GL accounts.</p>
            ) : (
              filtered.map((o) => {
                const isSelected = value === o.id;
                return (
                  <div
                    key={o.id}
                    onClick={() => {
                      onChange(o.id, o.label);
                      setOpen(false);
                    }}
                    className={`flex items-center gap-2 px-3 py-2 mx-1.5 rounded text-xs cursor-pointer transition-colors ${
                      isSelected ? "bg-primary/15 text-primary font-semibold" : "hover:bg-muted/60"
                    }`}
                  >
                    {isSelected && <Check size={11} className="shrink-0" />}
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.code ? <span className="font-mono text-[10px] text-muted-foreground/50 shrink-0">{o.code}</span> : null}
                  </div>
                );
              })
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};
