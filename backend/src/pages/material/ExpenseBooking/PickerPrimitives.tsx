import React, { useState, useEffect } from "react";
import { format, parseISO } from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { CalendarDays, AlertCircle, ChevronRight, Truck, FileText, Wrench } from "lucide-react";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { fmt } from "./helpers";
import { SECTION_ICONS, inputCls } from "./constants";

// ─── Smooth date picker (popover calendar) ───────────────────────────────────
// Replaces native <input type="date"> — avoids the inconsistent, unstyled
// browser date-segment UI (e.g. "dd-----yyyy" placeholders) across browsers.
export function DateField({
  value,
  onChange,
  min,
  placeholder = "Select date…",
  disabled,
}: {
  value: string;
  onChange: (val: string) => void;
  min?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const parsed = value ? parseISO(value) : undefined;
  const minDate = min ? parseISO(min) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={`${inputCls} relative pl-8 flex items-center text-left disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          <CalendarDays
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <span className={parsed ? "text-foreground" : "text-muted-foreground/40"}>
            {parsed ? format(parsed, "dd MMM yyyy") : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={parsed}
          disabled={minDate ? { before: minDate } : undefined}
          onSelect={(date) => {
            if (!date) return;
            onChange(format(date, "yyyy-MM-dd"));
            setOpen(false);
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

// ─── Small UI helpers ─────────────────────────────────────────────────────────

export function SectionHeader({ label }: { label: string }) {
  const Icon = SECTION_ICONS[label];
  return (
    <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
      {Icon && (
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-emerald-500/10 shrink-0">
          <Icon size={12} className="text-emerald-500" />
        </div>
      )}
      <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

export function InfoPill({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border/50">
      <Icon size={11} className="text-muted-foreground shrink-0" />
      <span className="text-[10px] text-muted-foreground">{label}:</span>
      <span className="text-[10px] font-semibold text-foreground truncate">
        {value}
      </span>
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="py-10 text-center text-xs text-muted-foreground">
      <AlertCircle size={16} className="mx-auto mb-2 opacity-30" />
      {label}
    </div>
  );
}

export function PickerRow({
  icon,
  iconBg,
  primary,
  primaryColor,
  secondary,
  badge,
  amount,
  onClick,
}: {
  icon: React.ReactNode;
  iconBg: string;
  primary: string;
  primaryColor: string;
  secondary?: string;
  badge?: string;
  amount?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors border-b border-border/30 last:border-0 text-left group"
    >
      <div
        className={`w-7 h-7 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-mono text-xs font-bold ${primaryColor}`}>
            {primary}
          </span>
          {badge && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/50">
              {badge}
            </span>
          )}
        </div>
        {secondary && (
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
            {secondary}
          </p>
        )}
      </div>
      {amount != null && (
        <span className="font-mono text-xs text-muted-foreground shrink-0">
          ₹{fmt(amount)}
        </span>
      )}
      <ChevronRight size={12} className="text-muted-foreground/30 shrink-0" />
    </button>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  color,
  accentColor,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  accentColor?: string;
}) {
  return (
    <div
      className={`rounded-xl bg-card border border-border p-4 flex items-center gap-3 relative overflow-hidden ${accentColor ? `border-l-2 ${accentColor}` : ""}`}
    >
      <div className={`p-2 rounded-lg shrink-0 ${color}`}>
        <Icon size={15} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground font-heading uppercase tracking-wider truncate">
          {label}
        </p>
        <p className="text-base font-bold font-mono text-foreground mt-0.5">
          {value}
        </p>
      </div>
    </div>
  );
}

export function RateInput({
  value,
  onChange,
  highlighted,
}: {
  value: number;
  onChange: (v: number) => void;
  highlighted: boolean;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-semibold">
        %
      </span>
      <Input
        type="number"
        min={0}
        max={28}
        step={0.5}
        value={value ?? ""}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className={`pl-7 font-mono ${highlighted ? "border-emerald-500/40 bg-emerald-500/5" : ""}`}
        placeholder="0"
      />
    </div>
  );
}

export function GRNChainBadge({
  bookingId,
}: {
  bookingId: string | null | undefined;
}) {
  const [grns, setGrns] = useState<{ GRNNo: string }[]>([]);
  useEffect(() => {
    if (!bookingId) return;
    fetchWithAuth(`/api/expense-booking/${bookingId}/grns`)
      .then((r) => (r.ok ? r.json().catch(() => ({})) : []))
      .then((data) => setGrns(Array.isArray(data) ? data : []))
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "Something went wrong",
        );
      });
  }, [bookingId]);
  if (grns.length === 0)
    return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {grns.map((g) => (
        <span
          key={g.GRNNo}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 font-mono whitespace-nowrap"
        >
          <Truck size={9} className="shrink-0" />
          {g.GRNNo}
        </span>
      ))}
    </div>
  );
}

// ─── Linked Document Badge ────────────────────────────────────────────────────
// Shows the source document chain for a booking row in the invoice list.
//   GRN   → PO DocNo  ›  GRN DocNo(s)
//   PO    → PO DocNo
//   WO_PO → WO_PO DocNo
//   WORK_DONE → Work Done DocNo
//   TOD/null  → —
// All data comes from already-fetched ExpenseRecord fields — no extra API call.
type LinkedDocBadgeProps = {
  eSourceType?: string | null;
  sourceDocNo?: string | null;   // GRN DocNo | PO DocNo | WD DocNo
  linkedPODocNo?: string | null; // Parent PO DocNo (populated only for GRN rows)
  linkedGrnDocNos?: string[];    // Extra GRN DocNos for multi-GRN combined invoices
};
export function LinkedDocBadge({
  eSourceType,
  sourceDocNo,
  linkedPODocNo,
  linkedGrnDocNos,
}: LinkedDocBadgeProps) {
  if (!eSourceType || eSourceType === "TOD") {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  if (eSourceType === "GRN") {
    const grnNos = linkedGrnDocNos?.length
      ? linkedGrnDocNos
      : sourceDocNo
        ? [sourceDocNo]
        : [];
    return (
      <div className="flex flex-col gap-1">
        {linkedPODocNo && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 font-mono whitespace-nowrap">
            <FileText size={9} className="shrink-0" />
            {linkedPODocNo}
          </span>
        )}
        <div className="flex flex-wrap gap-1">
          {grnNos.length > 0 ? grnNos.map((g) => (
            <span
              key={g}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 font-mono whitespace-nowrap"
            >
              <Truck size={9} className="shrink-0" />
              {g}
            </span>
          )) : <span className="text-muted-foreground text-xs">—</span>}
        </div>
      </div>
    );
  }

  if (eSourceType === "PO" || eSourceType === "WO_PO") {
    return sourceDocNo ? (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 font-mono whitespace-nowrap">
        <FileText size={9} className="shrink-0" />
        {sourceDocNo}
      </span>
    ) : <span className="text-muted-foreground text-xs">—</span>;
  }

  if (eSourceType === "WORK_DONE") {
    return sourceDocNo ? (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 font-mono whitespace-nowrap">
        <Wrench size={9} className="shrink-0" />
        {sourceDocNo}
      </span>
    ) : <span className="text-muted-foreground text-xs">—</span>;
  }

  return <span className="text-muted-foreground text-xs">—</span>;
}
