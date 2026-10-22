import { createPortal } from "react-dom";
import { format } from "date-fns";
import { Edit3, X } from "lucide-react";
import { SheetMark, statusTone } from "@/components/sheet/Sheet";
import { ACT, HEAD, KEY_INK, LBL, RULE, TH, fmtQty } from "./config";
import type { IssueReturnState } from "./useIssueReturn";

// One return opened: its details and items, and edit when it can still be edited.
export function IRDetail({ m }: { m: IssueReturnState }) {
  const { detailRecord: d, setDetailRecord, rights, openEdit } = m;
  if (!d) return null;
  const close = () => setDetailRecord(null);
  const items: any[] = d.items || [];
  const fields: [string, string][] = [
    ["Return date", d.ReturnDate ? format(new Date(d.ReturnDate), "dd MMM yyyy") : "—"],
    ["Issue", d.IssueDocNo || "—"],
    ["Company", d.CompanyName || "—"],
    ["Project / site", d.ProjectName || "—"],
    ["Back to godown", d.GodownName || "—"],
    ["Reason", d.Reason || "—"],
    ["Created by", d.CreatedByName || "—"],
    ["Created", d.CreatedAt ? format(new Date(d.CreatedAt), "dd MMM yyyy") : "—"],
  ];

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet-frame bg-card w-full max-w-3xl max-h-[95vh] sm:max-h-[92vh] overflow-y-auto" style={{ margin: 0 }} role="dialog" aria-modal="true" aria-label={`Issue return ${d.DocNo}`}>
        <div className="sticky top-0 bg-card z-10 flex items-start justify-between gap-2 px-5 py-4" style={{ borderBottom: RULE }}>
          <div className="min-w-0">
            <p className={LBL}>Issue return</p>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <h2 className="font-heading font-bold text-base sm:text-lg tracking-tight truncate">{d.DocNo}</h2>
              <SheetMark text={d.Status || "Draft"} tone={statusTone(d.Status || "Draft")} />
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {["Draft", "Approved", "Rejected"].includes(d.Status) && rights.canEdit && (
              <button onClick={() => { close(); openEdit(d); }} className={`${KEY_INK} h-8 px-3`}>
                <Edit3 size={13} />
                <span className="hidden sm:inline">{d.Status === "Rejected" ? "Edit & re-submit" : "Edit"}</span>
              </button>
            )}
            <button onClick={close} className={`${ACT} hover:text-foreground hover:border-foreground`} aria-label="Close">
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <p className={`${HEAD} mb-3`}>Return details</p>
            <div className="grid grid-cols-2 sm:grid-cols-4" style={{ borderTop: RULE, borderLeft: RULE }}>
              {fields.map(([label, value]) => (
                <div key={label} className="px-3 py-2.5 min-w-0" style={{ borderRight: RULE, borderBottom: RULE }}>
                  <p className={LBL}>{label}</p>
                  <p className="text-xs font-semibold text-foreground truncate mt-0.5" title={value}>{value}</p>
                </div>
              ))}
            </div>
            {d.Remarks && (
              <div className="mt-3 px-3 py-2.5" style={{ border: RULE }}>
                <p className={LBL}>Remarks</p>
                <p className="text-xs text-foreground mt-0.5">{d.Remarks}</p>
              </div>
            )}
          </div>

          <div>
            <p className={`${HEAD} mb-3`}>
              Return items <span className="ml-1 font-normal tabular-nums text-muted-foreground">{items.length}</span>
            </p>
            <div className="overflow-x-auto" style={{ border: RULE }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: RULE }}>
                    <th className={TH}>Item</th>
                    <th className={`${TH} !text-right`}>Qty</th>
                    <th className={`${TH} hidden sm:table-cell`}>UOM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/10">
                  {items.length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No items</td></tr>
                  ) : (
                    items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-3 font-medium">{item.ItemName}</td>
                        <td className="px-4 py-3 text-right font-heading font-semibold tabular-nums">{Number.isFinite(Number(item.Quantity)) ? fmtQty(Number(item.Quantity)) : item.Quantity}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{item.UOMSymbol || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
