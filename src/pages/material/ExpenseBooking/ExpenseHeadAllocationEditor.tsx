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
import { Plus, Trash2, AlertCircle, CheckCircle2 } from "lucide-react";
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

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row._key} className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <GLAccountSelect
              value={row.lHeadId}
              onChange={(id, label) => patchRow(row._key, { lHeadId: id, label })}
              placeholder="Select Expense Head..."
            />
          </div>
          <input
            type="number"
            step="0.01"
            value={row.amount || ""}
            disabled={readOnly}
            onChange={(e) => patchRow(row._key, { amount: Number(e.target.value) || 0 })}
            placeholder="Amount"
            className="w-28 sm:w-36 px-2.5 py-2 rounded-lg border border-border bg-background text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
          />
          {!readOnly && (
            <button
              type="button"
              onClick={() => removeRow(row._key)}
              className="p-2 text-muted-foreground hover:text-destructive transition-colors shrink-0"
              title="Remove"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}

      {!readOnly && (
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <Plus size={12} /> Add Expense Head
        </button>
      )}

      {rows.length > 0 && (
        <div
          className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg ${
            balanced
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          }`}
        >
          {balanced ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
          {balanced
            ? `Balanced — ₹${fmt(sum)} across ${rows.length} Expense Head${rows.length !== 1 ? "s" : ""}`
            : diff > 0
              ? `₹${fmt(diff)} remaining to allocate (invoice total ₹${fmt(targetAmount)})`
              : `₹${fmt(diff)} over-allocated (invoice total ₹${fmt(targetAmount)})`}
        </div>
      )}
    </div>
  );
}
