/**
 * ExpenseHeadAllocationEditor.tsx
 *
 * Replaces the old single "GL Account" dropdown on a direct (Other
 * Expenses / TOD) booking with a repeatable list: pick an Expense Head +
 * enter an amount, add as many rows as needed. The rows must sum to the
 * invoice's own net amount — that's what gets debited (one leg per row)
 * against a single Supplier credit when the invoice is posted to GL (see
 * backend/routes/expenseBooking.js POST /:id/post-to-gl).
 */
import { Plus, Trash2, AlertCircle, CheckCircle2, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GLAccountSelect } from "@/components/finance/GLAccountSelect";
import type { ExpenseHeadAllocationRow } from "./types";

function makeKey() {
  return `eha-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function blankAllocationRow(amount = 0): ExpenseHeadAllocationRow {
  return { _key: makeKey(), lHeadId: null, label: null, code: null, amount };
}

interface Props {
  rows: ExpenseHeadAllocationRow[];
  onChange: (rows: ExpenseHeadAllocationRow[]) => void;
  /** The invoice's own net amount — rows must sum to exactly this. */
  targetAmount: number;
  readOnly?: boolean;
}

export function ExpenseHeadAllocationEditor({ rows, onChange, targetAmount, readOnly }: Props) {
  const sum = Math.round(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100;
  const diff = Math.round((targetAmount - sum) * 100) / 100;
  const balanced = rows.length > 0 && Math.abs(diff) < 0.5;
  const fmt = (n: number) => Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const addRow = () => onChange([...rows, blankAllocationRow(diff > 0 ? diff : 0)]);
  const removeRow = (key: string) => onChange(rows.filter((r) => r._key !== key));
  const patchRow = (key: string, delta: Partial<ExpenseHeadAllocationRow>) =>
    onChange(rows.map((r) => (r._key === key ? { ...r, ...delta } : r)));

  // Same GL head picked twice silently double-counts against it once posted
  // (one debit leg per row — see the file header comment), so flag it as a
  // soft warning rather than blocking, since mid-edit a head is briefly
  // "duplicate" while the user is still choosing the next row's head.
  const duplicateLHeadIds = new Set(
    Object.entries(
      rows.reduce<Record<number, number>>((acc, r) => {
        if (r.lHeadId != null) acc[r.lHeadId] = (acc[r.lHeadId] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .filter(([, count]) => count > 1)
      .map(([id]) => Number(id)),
  );
  const hasDuplicates = duplicateLHeadIds.size > 0;

  return (
    <div className="space-y-2.5">
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 rounded-xl border border-dashed border-border/50 text-center">
          <BookOpen size={20} className="text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">
            No Expense Heads yet.{" "}
            {!readOnly && (
              <button type="button" onClick={addRow} className="text-primary font-medium hover:underline">
                Add one
              </button>
            )}
          </p>
        </div>
      ) : (
        rows.map((row, i) => {
          const isDuplicate = row.lHeadId != null && duplicateLHeadIds.has(row.lHeadId);
          return (
          <div
            key={row._key}
            className={`flex items-center gap-2.5 p-2 rounded-xl border transition-colors ${
              isDuplicate ? "border-amber-500/40 bg-amber-500/[0.06]" : "border-border/60 bg-muted/20"
            }`}
          >
            <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-[11px] font-semibold font-mono">
              {i + 1}
            </span>

            <div className="flex-1 min-w-0">
              <GLAccountSelect
                value={row.lHeadId}
                onChange={(id, label) => patchRow(row._key, { lHeadId: id, label })}
                placeholder="Select Expense Head..."
              />
              {isDuplicate && (
                <p className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                  <AlertCircle size={10} className="shrink-0" /> Already used in another row
                </p>
              )}
            </div>

            <div className="relative w-28 sm:w-36 shrink-0">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/50 pointer-events-none">
                ₹
              </span>
              <input
                type="number"
                step="0.01"
                value={row.amount || ""}
                disabled={readOnly}
                onChange={(e) => patchRow(row._key, { amount: Number(e.target.value) || 0 })}
                placeholder="0.00"
                className="w-full pl-6 pr-2.5 py-2 rounded-lg border border-border bg-background text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
              />
            </div>

            {!readOnly && (
              <button
                type="button"
                onClick={() => removeRow(row._key)}
                className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Remove"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          );
        })
      )}

      {!readOnly && rows.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRow}
          className="h-7 px-2.5 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
        >
          <Plus size={12} />
          Add Expense Head
        </Button>
      )}

      {hasDuplicates && (
        <div className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <AlertCircle size={11} className="shrink-0" />
          {duplicateLHeadIds.size === 1
            ? "One Expense Head is used in more than one row — each row posts its own debit leg, so this will double-post that head."
            : `${duplicateLHeadIds.size} Expense Heads are each used in more than one row — each row posts its own debit leg, so this will double-post those heads.`}
        </div>
      )}

      {rows.length > 0 && (
        <div
          className={`flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg ${
            balanced
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          }`}
        >
          {balanced ? <CheckCircle2 size={11} className="shrink-0" /> : <AlertCircle size={11} className="shrink-0" />}
          <span className="tabular-nums">
            {balanced
              ? `Balanced — ₹${fmt(sum)} across ${rows.length} Expense Head${rows.length !== 1 ? "s" : ""}`
              : diff > 0
                ? `₹${fmt(diff)} remaining to allocate (invoice total ₹${fmt(targetAmount)})`
                : `₹${fmt(diff)} over-allocated (invoice total ₹${fmt(targetAmount)})`}
          </span>
        </div>
      )}
    </div>
  );
}
