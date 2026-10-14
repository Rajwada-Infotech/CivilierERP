import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { FileText, CalendarClock, ChevronDown, Search } from "lucide-react";
import { type CustomerOption } from "@/api/loanSanctionApi";
import { fmt } from "./shared";

export function SectionLabel({ icon: _Icon, label }: { icon: typeof FileText; label: string }) {
  return (
    <div className="flex items-center gap-3 -mb-1 pt-1">
      <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground shrink-0">
        {label}
      </span>
      <div className="flex-1 h-px bg-foreground" />
    </div>
  );
}

export function InfoCard({
  label,
  value,
  accent,
  icon: Icon,
}: {
  label: string;
  value: string;
  accent?: boolean;
  icon?: typeof FileText;
}) {
  return (
    <div className={`border px-3 py-2.5 ${accent ? "border-foreground" : "border-foreground/30"}`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground leading-tight">
          {label}
        </p>
        {Icon && <Icon size={11} className={accent ? "text-foreground" : "text-muted-foreground"} />}
      </div>
      <p className={`truncate ${accent ? "font-heading text-base font-bold tabular-nums text-foreground" : "text-sm font-semibold text-foreground"}`} title={value}>
        {value}
      </p>
    </div>
  );
}

export function StatTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof CalendarClock;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="border border-foreground/30 p-3.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={12} className="text-muted-foreground" />
        <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      </div>
      <p className="font-heading text-lg font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export function ChainNode({
  icon,
  title,
  subtitle,
  done,
  isLast,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  done: boolean;
  isLast: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={`w-7 h-7 flex items-center justify-center shrink-0 border ${
            done ? "bg-foreground text-card border-foreground" : "border-dashed border-foreground text-foreground"
          }`}
        >
          {icon}
        </div>
        {!isLast && <div className="w-px flex-1 bg-foreground/40 my-1.5" />}
      </div>
      <div className={`flex-1 flex items-center justify-between gap-3 ${isLast ? "pb-0" : "pb-8"}`}>
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        {action}
      </div>
    </div>
  );
}

// ── PostingCard ─────────────────────────────────────────────────────────────
// One company's own books for one posted GL entry (sanction or a single
// repayment) — same Dr/Cr card layout as Payment.tsx's own "GL Postings —
// Full Payment Chain" Posting tab, reused so the loan's sanction entry and
// every repayment entry render identically.
export function PostingCard({ p }: { p: { companyId: number | null; companyName: string | null; voucherNo: string; lines: any[] } }) {
  const total = p.lines.reduce((s: number, l: any) => s + (l.debit || 0), 0);
  return (
    <div className="border border-foreground overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-foreground">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">
            {p.companyName || "Company"}'s books
          </span>
          <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{p.voucherNo}</span>
        </div>
        <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 bg-foreground text-card whitespace-nowrap">
          Posted
        </span>
      </div>
      <div className="divide-y divide-foreground/15">
        <div className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] px-4 py-1.5 font-heading text-[0.5625rem] uppercase tracking-[0.12em] text-muted-foreground font-semibold gap-2">
          <span>Account</span>
          <span className="text-right">Debit (₹)</span>
          <span className="text-right">Credit (₹)</span>
        </div>
        {p.lines.map((l: any, li: number) => (
          <div key={li} className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] px-4 py-2.5 items-center gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`font-heading text-[0.5625rem] font-semibold w-5 shrink-0 ${l.debit > 0 ? "text-foreground" : "text-muted-foreground"}`}>{l.debit > 0 ? "Dr" : "Cr"}</span>
              <span className="text-xs text-foreground truncate">
                {l.lHeadName || `Head #${l.lHeadId}`}{l.groupName ? ` (${l.groupName})` : ""}
              </span>
            </div>
            <span className="text-xs text-right font-heading tabular-nums text-foreground">
              {l.debit > 0 ? fmt(l.debit) : ""}
            </span>
            <span className="text-xs text-right font-heading tabular-nums text-foreground">
              {l.credit > 0 ? fmt(l.credit) : ""}
            </span>
          </div>
        ))}
        <div className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] px-4 py-2 border-t border-foreground text-xs font-bold gap-2">
          <span className="font-heading uppercase tracking-[0.12em] text-muted-foreground text-[0.5625rem]">Total</span>
          <span className="text-right text-foreground font-heading tabular-nums">{fmt(total)}</span>
          <span className="text-right text-foreground font-heading tabular-nums">{fmt(total)}</span>
        </div>
      </div>
    </div>
  );
}

// ── CustomerComboField ─────────────────────────────────────────────────────
// Searchable customer picker that shows a CRM / AH source pill beside each
// option and fires onChange(id, source) so the form can track which table the
// customer belongs to.
// Panel is portalled to document.body so overflow:hidden on ancestors never
// clips it.
export function CustomerComboField({
  customers,
  value,
  onChange,
  inputClassName,
}: {
  customers: CustomerOption[];
  value: string;
  onChange: (id: string, source: "AH" | "CRM") => void;
  inputClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updateRect = useCallback(() => {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect());
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
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        panelRef.current  && !panelRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = customers.find((c) => String(c.id) === value);
  const filtered = query
    ? customers.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    : customers;

  const PANEL_MAX = 256;
  const GAP = 8;
  const spaceBelow = rect ? window.innerHeight - rect.bottom - GAP : 0;
  const spaceAbove = rect ? rect.top - GAP : 0;
  const openUpward = spaceAbove > spaceBelow;
  const maxHeight  = Math.min(PANEL_MAX, openUpward ? spaceAbove : spaceBelow);

  const panel = open && rect && createPortal(
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        ...(openUpward
          ? { bottom: window.innerHeight - rect.top + GAP }
          : { top: rect.bottom + GAP }
        ),
        left: rect.left,
        width: rect.width,
        maxHeight,
        zIndex: 9999,
        boxShadow: "5px 5px 0 hsl(var(--foreground) / 0.12)",
      }}
      className="overflow-y-auto border border-foreground bg-card py-1"
    >
      {filtered.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground text-center">No customers found</p>
      ) : (
        filtered.map((c) => (
          <button
            key={`${c.source}-${c.id}`}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onChange(String(c.id), c.source); setOpen(false); setQuery(""); }}
            className={`w-full text-left px-4 py-3 text-sm hover:bg-primary/5 transition-colors flex items-center justify-between gap-2 ${
              String(c.id) === value && selected?.source === c.source
                ? "text-foreground font-semibold bg-primary/10"
                : "text-foreground"
            }`}
          >
            <span className="truncate">{c.label}</span>
            <span className={`shrink-0 px-1.5 py-0.5 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-foreground border ${
              c.source === "CRM" ? "border-foreground" : "border-dashed border-foreground/60"
            }`}>
              {c.source}
            </span>
          </button>
        ))
      )}
    </div>,
    document.body,
  );

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          className={`${inputClassName} pr-8`}
          placeholder="Search customer…"
          value={open ? query : (selected?.label ?? "")}
          onFocus={() => { setOpen(true); setQuery(""); updateRect(); }}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => { setOpen((o) => !o); updateRect(); }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {panel}
    </div>
  );
}

// Dropdown-cum-text field — pick a standard value from an app-styled panel,
// or just type a custom one. Panel portalled to document.body so it is never
// clipped by overflow:hidden on ancestor containers.
export function ComboField({
  value,
  onChange,
  options,
  placeholder,
  inputClassName,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  inputClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updateRect = useCallback(() => {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect());
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
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        panelRef.current  && !panelRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const PANEL_MAX = 224;
  const GAP = 8;
  const spaceBelow = rect ? window.innerHeight - rect.bottom - GAP : 0;
  const spaceAbove = rect ? rect.top - GAP : 0;
  const openUpward = spaceAbove > spaceBelow;
  const maxHeight  = Math.min(PANEL_MAX, openUpward ? spaceAbove : spaceBelow);

  const panel = open && rect && createPortal(
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        ...(openUpward
          ? { bottom: window.innerHeight - rect.top + GAP }
          : { top: rect.bottom + GAP }
        ),
        left: rect.left,
        width: rect.width,
        maxHeight,
        zIndex: 9999,
        boxShadow: "5px 5px 0 hsl(var(--foreground) / 0.12)",
      }}
      className="overflow-y-auto border border-foreground bg-card py-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { onChange(o.value); setOpen(false); }}
          className={`w-full text-left px-4 py-3 text-sm hover:bg-primary/5 transition-colors ${
            value === o.value ? "text-foreground font-semibold bg-primary/10" : "text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>,
    document.body,
  );

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          className={`${inputClassName} pr-8`}
          placeholder={placeholder}
          value={value}
          onFocus={() => { setOpen(true); updateRect(); }}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => { setOpen((o) => !o); updateRect(); }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {panel}
    </div>
  );
}
