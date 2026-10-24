import { AlertTriangle, IndianRupee } from "lucide-react";

// Rupees in Indian grouping; paise shown as two places when there are any ("₹80,56,156.50", never "…156.5").
export const fmtRupees = (n: number | null | undefined) => {
  if (n == null) return "—";
  const v = Number(n);
  const frac = Math.round(v * 100) % 100 !== 0;
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 })}`;
};
const fmt = fmtRupees;

interface FinancialStatusBarProps {
  grandTotal: number;
  /** Amount applied to milestones — Finance approved */
  cleared: number;
  /** Money received from customer (Pending + Approved MRs) not yet cleared to milestones */
  pendingReceipts?: number;
  /** Approved on-account deposits not yet swept to a milestone */
  approvedOnAccount?: number;
  overdueCount?: number;
  /** compact = smaller tiles, no progress legend — for sidebar/card use */
  compact?: boolean;
}

const RULE = "1px solid hsl(var(--foreground))";
const RULE_SOFT = "1px solid hsl(var(--foreground) / 0.15)";
const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
// On account is money in hand but not yet applied: hatched, between cleared (solid) and due (open).
const HATCH = "repeating-linear-gradient(135deg, hsl(var(--foreground)) 0, hsl(var(--foreground)) 1px, transparent 1px, transparent 3px)";

export function FinancialStatusBar({
  grandTotal,
  cleared,
  pendingReceipts = 0,
  approvedOnAccount = 0,
  overdueCount = 0,
  compact = false,
}: FinancialStatusBarProps) {
  const onAccount = pendingReceipts + approvedOnAccount;
  const outstanding = Math.max(0, grandTotal - cleared - onAccount);
  const clearedPct = grandTotal > 0 ? Math.min(100, Math.round((cleared / grandTotal) * 100)) : 0;
  const onAccPct = grandTotal > 0 ? Math.min(100 - clearedPct, Math.round((onAccount / grandTotal) * 100)) : 0;
  const figure = `font-heading font-bold tabular-nums text-foreground ${compact ? "text-sm" : "text-lg"} leading-tight mt-1`;

  const tiles: { label: string; value: string; note?: React.ReactNode; muted?: boolean }[] = [
    { label: "Grand total", value: fmt(grandTotal) },
    { label: "Cleared", value: fmt(cleared), note: "Applied to milestones" },
    {
      label: "On account", value: onAccount > 0 ? fmt(onAccount) : "—", muted: onAccount <= 0,
      note: onAccount > 0 ? <>{pendingReceipts > 0 && <span className="block">{fmt(pendingReceipts)} received, not yet settled</span>}{approvedOnAccount > 0 && <span className="block">{fmt(approvedOnAccount)} deposit, unapplied</span>}</> : "Nothing held",
    },
    { label: "Outstanding", value: outstanding > 0 ? fmt(outstanding) : "Fully collected", note: outstanding > 0 ? "Not yet received" : "Nothing due" },
  ];

  return (
    <div className="bg-card" style={{ border: RULE }}>
      <div className="px-3 py-2 flex items-center justify-between gap-2 flex-wrap" style={{ borderBottom: RULE }}>
        <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground flex items-center gap-1.5">
          <IndianRupee size={11} /> Financial status
        </span>
        {overdueCount > 0 && (
          <span className="text-[0.6875rem] font-semibold text-destructive flex items-center gap-1">
            <AlertTriangle size={11} /> {overdueCount} milestone{overdueCount > 1 ? "s" : ""} overdue
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ background: "hsl(var(--foreground) / 0.15)", borderBottom: RULE_SOFT }}>
        {tiles.map((t) => (
          <div key={t.label} className="bg-card px-3 py-2.5 min-w-0">
            <div className={LBL}>{t.label}</div>
            <div className={`${figure} ${t.muted ? "!text-muted-foreground" : ""}`}>{t.value}</div>
            {!compact && t.note && <div className="text-[0.625rem] text-muted-foreground mt-0.5">{t.note}</div>}
          </div>
        ))}
      </div>

      <div className="px-3 py-2.5 space-y-1.5">
        <div className="h-2 w-full flex" style={{ border: RULE_SOFT }}>
          <div className="h-full bg-foreground transition-all" style={{ width: `${clearedPct}%` }} />
          <div className="h-full transition-all" style={{ width: `${onAccPct}%`, background: HATCH }} />
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap text-[0.625rem] text-muted-foreground tabular-nums">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5 bg-foreground" /> {fmt(cleared)} cleared</span>
            {onAccount > 0 && <span className="flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5" style={{ background: HATCH, border: RULE_SOFT }} /> {fmt(onAccount)} on account</span>}
          </div>
          <span>{fmt(outstanding)} still due</span>
        </div>
      </div>
    </div>
  );
}
