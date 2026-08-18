import { AlertTriangle, IndianRupee } from "lucide-react";

const fmt = (n: number | null | undefined) =>
  n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";

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

  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <IndianRupee size={11} /> Financial Status
        </span>
        {overdueCount > 0 && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-700 font-medium flex items-center gap-1">
            <AlertTriangle size={11} /> {overdueCount} milestone{overdueCount > 1 ? "s" : ""} overdue
          </span>
        )}
      </div>

      <div className={`grid gap-2 ${compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-4"}`}>
        {/* Grand Total */}
        <div className="rounded-md bg-background border border-border px-2.5 py-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Grand Total</div>
          <div className={`font-bold text-foreground ${compact ? "text-xs" : "text-sm"}`}>{fmt(grandTotal)}</div>
        </div>

        {/* Cleared */}
        <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-2.5 py-2">
          <div className="text-[10px] text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">Cleared</div>
          <div className={`font-bold text-emerald-700 dark:text-emerald-400 ${compact ? "text-xs" : "text-sm"}`}>{fmt(cleared)}</div>
          {!compact && <div className="text-[10px] text-emerald-600 mt-0.5">Applied to milestones</div>}
        </div>

        {/* On Account — all money received, not yet applied */}
        <div className={`rounded-md border px-2.5 py-2 ${onAccount > 0 ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800" : "bg-background border-border"}`}>
          <div className={`text-[10px] uppercase tracking-wide ${onAccount > 0 ? "text-blue-700 dark:text-blue-400" : "text-muted-foreground"}`}>On Account</div>
          <div className={`font-bold ${onAccount > 0 ? "text-blue-700 dark:text-blue-400" : "text-muted-foreground"} ${compact ? "text-xs" : "text-sm"}`}>
            {onAccount > 0 ? fmt(onAccount) : "—"}
          </div>
          {!compact && onAccount > 0 && (
            <div className="text-[10px] text-blue-600 mt-0.5 space-y-0.5">
              {pendingReceipts > 0 && <div>{fmt(pendingReceipts)} received, not yet settled</div>}
              {approvedOnAccount > 0 && <div>{fmt(approvedOnAccount)} deposit, unapplied</div>}
            </div>
          )}
        </div>

        {/* Outstanding — truly not yet received */}
        <div className={`rounded-md border px-2.5 py-2 ${outstanding > 0 ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800"}`}>
          <div className={`text-[10px] uppercase tracking-wide ${outstanding > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>Outstanding</div>
          <div className={`font-bold ${outstanding > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"} ${compact ? "text-xs" : "text-sm"}`}>
            {outstanding > 0 ? fmt(outstanding) : "Fully Collected ✓"}
          </div>
          {!compact && <div className={`text-[10px] mt-0.5 ${outstanding > 0 ? "text-amber-600" : "text-emerald-600"}`}>Not yet received</div>}
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden flex">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${clearedPct}%` }} />
          <div className="h-full bg-blue-400 transition-all" style={{ width: `${onAccPct}%` }} />
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" /> {fmt(cleared)} cleared
            </span>
            {onAccount > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-400" /> {fmt(onAccount)} on account
              </span>
            )}
          </div>
          <span>{fmt(outstanding)} still due</span>
        </div>
      </div>
    </div>
  );
}
