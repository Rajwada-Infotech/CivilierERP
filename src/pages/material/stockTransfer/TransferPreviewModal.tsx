import { SheetMark, statusTone } from "@/components/sheet/Sheet";
import { createPortal } from "react-dom";
import { ArrowRight, Warehouse, X, FileText } from "lucide-react";
import { type StockTransfer } from "@/api/stockTransferApi";
import { type TransferGRNSummary } from "@/api/grnApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
      <div className="sheet-frame w-full max-w-lg bg-card overflow-hidden" style={{ margin: 0 }} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between px-5 py-4 border-b border-foreground bg-card">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-card">
              
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
            className="p-1.5 hover:bg-primary/5 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 pt-4 flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-card text-foreground border border-foreground/40">
            <Warehouse size={10} /> {transfer.FromGodownName}
          </span>
          <ArrowRight size={12} className="text-muted-foreground" />
          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-card text-foreground border border-foreground/40">
            <Warehouse size={10} /> {transfer.ToGodownName}
          </span>
          <div className="ml-auto">
            <ApprovalStatusChain table="StockTransfers" recordId={transfer.TransferID} fallback={<SheetMark text={transfer.Status || "Draft"} tone={statusTone(transfer.Status || "Draft")} />} />
          </div>
        </div>

        <div className="px-5 pt-3 pb-2">
          <p className="text-xs font-semibold text-muted-foreground mb-2">
            Items ({transfer.TransferItems.length})
          </p>
          <div className="border border-foreground/30 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-card border-b border-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Item</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Qty</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">UOM</th>
                </tr>
              </thead>
              <tbody>
                {transfer.TransferItems.map((item, i) => (
                  <tr key={i} className="border-b border-foreground last:border-0 hover:bg-primary/5">
                    <td className="px-3 py-2 text-foreground">{item.itemName || item.itemId}</td>
                    <td className="px-3 py-2 text-right font-heading">{fmtNum(item.qty)}</td>
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
            <p className="text-xs text-foreground bg-card px-3 py-2">
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
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[0.625rem] bg-card text-muted-foreground border border-foreground/30 font-heading"
                >
                  <FileText size={9} /> {g.GRNNo || g.DocNo}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-foreground flex justify-end bg-card">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs border border-foreground/30 hover:bg-primary/5 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
