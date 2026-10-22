import { createPortal } from "react-dom";
import { ArrowRight, Warehouse, X, FileText } from "lucide-react";
import { type StockTransfer } from "@/api/stockTransferApi";
import { type TransferGRNSummary } from "@/api/grnApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtNum, fmtDate } from "./config";

export function TransferPreviewModal({
  transfer,
  linkedGRNs,
  onClose,
}: {
  transfer: StockTransfer;
  linkedGRNs: TransferGRNSummary[];
  onClose: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-muted">
              
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {transfer.DocNo}
              </p>
              <p className="text-xs text-muted-foreground">
                {fmtDate(transfer.TransferDate)} · by{" "}
                {transfer.CreatedBy?.split("@")[0] || "—"}
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

        <div className="px-5 pt-4 flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-500/10 text-orange-600 border border-orange-400/20">
            <Warehouse size={10} /> {transfer.FromGodownName}
          </span>
          <ArrowRight size={12} className="text-muted-foreground" />
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-400/20">
            <Warehouse size={10} /> {transfer.ToGodownName}
          </span>
          <div className="ml-auto">
            <ApprovalStatusChain table="StockTransfers" recordId={transfer.TransferID} fallback={<StatusBadge status={transfer.Status} />} />
          </div>
        </div>

        <div className="px-5 pt-3 pb-2">
          <p className="text-xs font-semibold text-muted-foreground mb-2">
            Items ({transfer.TransferItems.length})
          </p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Item</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Qty</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">UOM</th>
                </tr>
              </thead>
              <tbody>
                {transfer.TransferItems.map((item, i) => (
                  <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-2 text-foreground">{item.itemName || item.itemId}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtNum(item.qty)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{item.uom || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {transfer.Remarks && (
          <div className="px-5 pb-2">
            <p className="text-xs font-semibold text-muted-foreground mb-1">Remarks</p>
            <p className="text-xs text-foreground bg-muted/30 rounded-lg px-3 py-2">
              {transfer.Remarks}
            </p>
          </div>
        )}

        {linkedGRNs.length > 0 && (
          <div className="px-5 pb-4">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Linked GRN</p>
            <div className="flex flex-wrap gap-1.5">
              {linkedGRNs.map((g) => (
                <span
                  key={g.GRNID}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.625rem] bg-muted text-muted-foreground border border-border font-mono"
                >
                  <FileText size={9} /> {g.GRNNo || g.DocNo}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-border flex justify-end bg-muted/20">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs rounded-lg border border-border hover:bg-muted transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
