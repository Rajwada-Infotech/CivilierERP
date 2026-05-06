import React from "react";
import { Button } from "@/components/ui/button";
import { Edit, Trash2, Eye } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
import { computeBreakdown, fmt } from "./helpers";
import type { ExpenseRecord } from "./types";

interface Props {
  rec: ExpenseRecord;
  onEdit: () => void;
  onPreview: () => void;
  onDelete: () => void;
  onApprovalSuccess: () => void;
}

export function RecordCard({
  rec,
  onEdit,
  onDelete,
  onApprovalSuccess,
}: Props) {
  const rbd = computeBreakdown(
    rec.basicAmount,
    rec.cgstRate,
    rec.sgstRate,
    rec.discount,
  );

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] text-muted-foreground font-medium truncate">
            {rec.docTypeName || "No Doc Type"}
          </p>
          <p className="font-mono text-xs font-semibold text-primary">
            {rec.bookingReference || "—"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {rec.supplier}
          </p>
        </div>
        <StatusBadge status={rec.status} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div>
          <span className="text-muted-foreground">Date: </span>
          {rec.bookingDate}
        </div>
        <div>
          <span className="text-muted-foreground">Due: </span>
          {rec.dueDate || "-"}
        </div>
        <div>
          <span className="text-muted-foreground">PO: </span>
          <span className="font-mono">{rec.poId || "-"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Invoice: </span>
          <span className="font-mono">{rec.invoiceReference || "-"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Basic: </span>
          <span className="font-mono">Rs.{fmt(rec.basicAmount)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">EMI: </span>
          {rec.emi.enabled ? (
            <span className="text-primary font-medium">
              {rec.emi.installmentCount}x
            </span>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border">
        <div>
          <p className="text-[10px] text-muted-foreground">Net Payable</p>
          <p className="text-sm font-mono font-semibold text-foreground">
            Rs.{fmt(rbd.netAmount)}
          </p>
        </div>
        <div className="flex gap-1.5 items-center">
          <ApprovalActions
            status={rec.status}
            recordId={rec.id}
            endpoint="/api/expense-booking"
            submitOnly
            onSuccess={onApprovalSuccess}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onEdit}
          >
            <Edit size={13} />
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onDelete}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      </div>
    </div>
  );
}
