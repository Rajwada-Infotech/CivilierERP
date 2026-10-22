import { useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Warehouse, RefreshCw, AlertCircle, X, FileText } from "lucide-react";
import { type StockTransfer } from "@/api/stockTransferApi";
import { createGRNFromTransfer } from "@/api/grnApi";
import { fmtNum, fmtDate } from "./config";

// ─── Make GRN from Transfer Modal ────────────────────────────────────────────
export function MakeGRNModal({
  transfer,
  onClose,
  onSuccess,
}: {
  transfer: StockTransfer;
  onClose: () => void;
  onSuccess: (grnNo: string) => void;
}) {
  const [remarks, setRemarks] = useState(
    `Auto-generated from Stock Transfer ${transfer.DocNo}`,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await createGRNFromTransfer(transfer.TransferID, {
        remarks,
      });
      onSuccess(result.grnNo);
    } catch (err: any) {
      setError(err.message || "Failed to create GRN");
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-500/10">
              <FileText size={16} className="text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Create GRN from Transfer
              </p>
              <p className="text-xs text-muted-foreground">
                Ref: {transfer.DocNo}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Route summary */}
        <div className="px-5 pt-4 flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-500/10 text-orange-600 border border-orange-400/20">
            <Warehouse size={10} /> {transfer.FromGodownName}
          </span>
          <ArrowRight size={12} className="text-muted-foreground" />
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-400/20">
            <Warehouse size={10} /> {transfer.ToGodownName}
          </span>
          <span className="ml-auto text-muted-foreground">
            {fmtDate(transfer.TransferDate)}
          </span>
        </div>

        {/* Items preview */}
        <div className="px-5 pt-3 pb-2">
          <p className="text-xs font-semibold text-muted-foreground mb-2">
            Items ({transfer.TransferItems.length})
          </p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    Item
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                    Qty
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    UOM
                  </th>
                </tr>
              </thead>
              <tbody>
                {transfer.TransferItems.map((item, i) => (
                  <tr
                    key={i}
                    className="border-b border-border last:border-0 hover:bg-muted/20"
                  >
                    <td className="px-3 py-2 text-foreground">
                      {item.itemName || item.itemId}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtNum(item.qty)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {item.uom || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Remarks */}
        <div className="px-5 pb-4">
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Remarks
          </label>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={2}
            className="w-full text-xs rounded-lg border border-border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Info note */}
        <div className="mx-5 mb-4 flex items-start gap-2 rounded-lg bg-emerald-500/[0.05] border border-emerald-400/20 px-3 py-2.5 text-xs text-emerald-700 dark:text-emerald-400">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span>
            Stock will be credited to <strong>{transfer.ToGodownName}</strong>.
            The GRN is created in Draft/Pending status and follows the normal
            approval workflow.
          </span>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mb-3 flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2.5 text-xs text-destructive">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-2.5 bg-muted/20">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={11} className="animate-spin" /> Creating…
              </>
            ) : (
              <>
                <FileText size={11} /> Create GRN
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
