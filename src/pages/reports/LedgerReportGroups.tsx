import React, { useState, useMemo } from "react";
import { fmt } from "@/pages/reports/format";

// ── Ledger Report: one row per GL head, expand to see its own postings ─────
// Same "singular head, click to see the postings" shape the user asked for
// here — modeled on WorkerAttendanceLogGroups' collapsed-group pattern
// above, just grouped by GL head (LHeadName) instead of by date/activity.
export const LedgerReportGroups: React.FC<{
  rows: Record<string, unknown>[];
  onRowClick: (row: Record<string, unknown>) => void;
}> = ({ rows, onRowClick }) => {
  const [collapsedHeads, setCollapsedHeads] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const byHead = new Map<
      string,
      { name: string; groupName: string; expenseType: string; debit: number; credit: number; rows: Record<string, unknown>[] }
    >();
    for (const row of rows) {
      const name = (row.LHeadName as string) || "—";
      const existing = byHead.get(name);
      const debit = Number(row.DebitAmount) || 0;
      const credit = Number(row.CreditAmount) || 0;
      if (existing) {
        existing.debit += debit;
        existing.credit += credit;
        existing.rows.push(row);
      } else {
        byHead.set(name, {
          name,
          groupName: (row.GroupName as string) || "—",
          expenseType: (row.ExpenseType as string) || "—",
          debit,
          credit,
          rows: [row],
        });
      }
    }
    return Array.from(byHead.values()).sort((a, b) => b.rows.length - a.rows.length);
  }, [rows]);

  const toggleHead = (name: string) =>
    setCollapsedHeads((prev) => ({ ...prev, [name]: !prev[name] }));

  return (
    <div>
      {groups.map((group) => {
        const collapsed = collapsedHeads[group.name] !== false; // default collapsed
        return (
          <div key={group.name} className="border-b border-border/60 last:border-0">
            <button
              type="button"
              onClick={() => toggleHead(group.name)}
              className="w-full flex items-center gap-2.5 px-4 sm:px-5 py-3 hover:bg-muted/20 transition-colors text-left"
            >
              <span className="text-xs font-medium text-foreground truncate">{group.name}</span>
              <span className="text-[0.6875rem] text-muted-foreground truncate hidden sm:inline">
                · {group.groupName}
                {group.expenseType !== "—" && ` · ${group.expenseType}`}
              </span>
              <span className="ml-auto flex items-center gap-3 shrink-0">
                <span className="text-[0.625rem] tabular-nums text-emerald-600 dark:text-emerald-400">
                  Dr {fmt(group.debit)}
                </span>
                <span className="text-[0.625rem] tabular-nums text-rose-600 dark:text-rose-400">
                  Cr {fmt(group.credit)}
                </span>
                <span className="text-[0.625rem] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {group.rows.length} txn{group.rows.length === 1 ? "" : "s"}
                </span>
              </span>
            </button>

            {!collapsed && (
              <div className="overflow-x-auto bg-muted/5">
                <table className="w-full text-xs min-w-[1140px]">
                  <thead>
                    <tr className="text-muted-foreground uppercase tracking-wide text-[0.625rem] font-heading">
                      <th className="text-left pl-11 pr-3 py-2">Date</th>
                      <th className="text-left px-3 py-2">Source</th>
                      <th className="text-left px-3 py-2">Doc No</th>
                      <th className="text-left px-3 py-2">Paid To</th>
                      <th className="text-left px-3 py-2">Company</th>
                      <th className="text-left px-3 py-2">Project</th>
                      <th className="text-left px-3 py-2">Narration</th>
                      <th className="text-right px-3 py-2">Debit</th>
                      <th className="text-right px-4 sm:px-5 py-2">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {group.rows.map((r, i) => (
                      <tr
                        key={i}
                        onClick={() => onRowClick(r)}
                        className="hover:bg-muted/20 transition-colors cursor-pointer"
                      >
                        <td className="pl-11 pr-3 py-2 whitespace-nowrap text-muted-foreground">
                          {r.VoucherDate ? String(r.VoucherDate).slice(0, 10) : "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{(r.SourceType as string) ?? "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-mono text-muted-foreground">
                          {(r.DocNo as string) ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-foreground max-w-[180px] truncate" title={(r.PaidTo as string) ?? ""}>
                          {(r.PaidTo as string) || "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-foreground max-w-[140px] truncate" title={(r.CompanyName as string) ?? ""}>
                          {(r.CompanyName as string) || "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-foreground max-w-[140px] truncate" title={(r.ProjectName as string) ?? ""}>
                          {(r.ProjectName as string) || "—"}
                        </td>
                        <td className="px-3 py-2 text-foreground max-w-[280px] truncate" title={(r.Narration as string) ?? ""}>
                          {(r.Narration as string) ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                          {Number(r.DebitAmount) > 0 ? fmt(Number(r.DebitAmount)) : "—"}
                        </td>
                        <td className="px-4 sm:px-5 py-2 text-right tabular-nums text-rose-600 dark:text-rose-400">
                          {Number(r.CreditAmount) > 0 ? fmt(Number(r.CreditAmount)) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
