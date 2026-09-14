import React from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, X } from "lucide-react";

export interface DebitNoteLineItem {
  itemName: string;
  uomName?: string | null;
  receivedQty: number;
}

/**
 * Shared "raise a quality-rejection debit note against this received line"
 * modal — used from both Vehicle In/Out and GRN views. The two callers
 * differ only in how they identify the line to the backend
 * (vehicleInOutItemId vs. grnId+grnItemIndex); this component only knows
 * about the qty/reason inputs and hands the submit back to the caller.
 */
export function RaiseDebitNoteModal({
  item,
  qty,
  onQtyChange,
  reason,
  onReasonChange,
  onClose,
  onSubmit,
  isPending,
}: {
  item: DebitNoteLineItem;
  qty: string;
  onQtyChange: (value: string) => void;
  reason: string;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  isPending: boolean;
}) {
  const qtyNum = parseFloat(qty) || 0;
  const receivedQty = Number(item.receivedQty) || 0;
  const overLimit = qtyNum > receivedQty + 1e-6;
  const percentBad = receivedQty > 0 ? Math.round((qtyNum / receivedQty) * 10000) / 100 : 0;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-card z-10 flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-rose-500/10 border border-rose-500/20">
              <AlertTriangle size={13} className="text-rose-500" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-sm">Raise Debit Note</h2>
              <p className="text-[10px] text-muted-foreground">{item.itemName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">Received Quantity</p>
            <p className="text-sm font-semibold font-mono text-foreground">
              {receivedQty} {item.uomName || ""}
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground mb-1.5 block">
              Rejected / Inferior Quantity
            </label>
            <Input
              type="number"
              min={0}
              max={receivedQty}
              step="any"
              value={qty}
              onChange={(e) => onQtyChange(e.target.value)}
              placeholder="0"
              className={overLimit ? "border-destructive text-destructive" : ""}
            />
            {qtyNum > 0 && (
              <p className={`text-xs mt-1.5 ${overLimit ? "text-destructive" : "text-muted-foreground"}`}>
                {overLimit
                  ? `Cannot reject more than the ${receivedQty} received.`
                  : `${percentBad}% of this delivery — debit note will be raised for the rejected quantity at the PO rate.`}
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-foreground mb-1.5 block">Reason (optional)</label>
            <textarea
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="e.g. Visible rust and cracks on inspected batch"
              rows={3}
              className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-card border-t border-border px-5 py-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!(qtyNum > 0) || overLimit || isPending}
            onClick={onSubmit}
            className="bg-rose-600 hover:bg-rose-700 text-white"
          >
            {isPending ? "Raising…" : "Raise Debit Note"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
