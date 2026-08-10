import React from "react";
import { Eye, Edit, Trash2, CreditCard } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
import { computeBreakdown, computeGrnNetWithTerms, fmt } from "./helpers";
import type { ExpenseRecord } from "./types";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";

interface Props {
  rec: ExpenseRecord;
  onEdit: () => void;
  onPreview: () => void;
  onDelete: () => void;
  onApprovalSuccess: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
}

export function RecordCard({
  rec,
  onEdit,
  onPreview,
  onDelete,
  onApprovalSuccess,
  canEdit = true,
  canDelete = true,
}: Props) {
  const effectiveNet = (() => {
    if (rec.eSourceType === "GRN" && rec.grnTotalAmount != null) {
      const terms =
        rec.billingTerms && rec.billingTerms.length > 0
          ? rec.billingTerms
          : rec.discount
            ? [rec.discount]
            : [];
      return computeGrnNetWithTerms(rec.grnTotalAmount, terms, rec.basicAmount);
    }
    const rbd = computeBreakdown(
      rec.basicAmount,
      rec.cgstRate,
      rec.sgstRate,
      rec.billingTerms && rec.billingTerms.length > 0
        ? rec.billingTerms
        : rec.discount,
    );
    return rec.netAmount && rec.netAmount > 0 ? rec.netAmount : rbd.netAmount;
  })();

  const adjustedAmount = rec.onAccountAdjusted ?? 0;
  const isFullyAdjusted = adjustedAmount > 0 && adjustedAmount >= effectiveNet;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] text-muted-foreground font-medium truncate">
            {rec.docTypeName || rec.materialCategory || "Invoice"}
          </p>
          <p className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400 truncate max-w-[200px]">
            {rec.bookingReference || "—"}
          </p>
          {rec.supplier && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {rec.supplier}
            </p>
          )}
        </div>
        <StatusBadge status={rec.status} />
      </div>

      {adjustedAmount > 0 && (
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 w-fit">
          Adjusted {isFullyAdjusted ? "(Full)" : "(Partial)"} · ₹{fmt(adjustedAmount)}
        </div>
      )}

      {/* Detail grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div>
          <span className="text-muted-foreground">Date: </span>
          <span>{rec.bookingDate || "—"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Due: </span>
          <span>{rec.dueDate || "—"}</span>
        </div>
        {rec.companyName && (
          <div className="col-span-2 truncate">
            <span className="text-muted-foreground">Company: </span>
            <span>{rec.companyName}</span>
          </div>
        )}
        <div>
          <span className="text-muted-foreground">Basic: </span>
          <span className="font-mono">₹{fmt(rec.basicAmount)}</span>
        </div>
        {rec.emi?.enabled ? (
          <div className="flex items-center gap-1">
            <CreditCard size={10} className="text-violet-500 shrink-0" />
            <span className="text-violet-600 dark:text-violet-400 font-medium text-[11px]">
              {rec.emi.installmentCount}x EMI
            </span>
          </div>
        ) : (
          <div>
            <span className="text-muted-foreground">GST: </span>
            <span className="font-mono">
              {(rec.cgstRate || 0) + (rec.sgstRate || 0)}%
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-border gap-2">
        <div>
          <p className="text-[10px] text-muted-foreground">Net Payable</p>
          <p className="text-sm font-mono font-semibold text-foreground">
            ₹{fmt(effectiveNet)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <ApprovalStatusChain
            table="ExpenseBooking"
            recordId={rec.id}
            compact
            fallback={<StatusBadge status={rec.status} className="text-[10px] px-2 py-0.5" />}
          />
          <div className="flex items-center gap-1">
            <ApprovalActions
              status={rec.status}
              recordId={rec.id}
              endpoint="/api/expense-booking"
              submitOnly
              onSuccess={onApprovalSuccess}
            />
            <button
              type="button"
              onClick={onPreview}
              className="p-1.5 rounded-lg text-sky-500 hover:bg-sky-500/10 border border-transparent hover:border-sky-500/20 transition-colors"
              title="Preview"
            >
              <Eye size={14} />
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted border border-transparent hover:border-border transition-colors"
                title="Edit / Amend"
              >
                <Edit size={14} />
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/20 transition-colors"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
