import { Trash2, ArrowLeft, Send, Printer } from "lucide-react";
import { SheetMark, statusTone } from "@/components/sheet/Sheet";
import { printStatusLabel } from "@/utils/printStatus";
import { fmtDate, HEAD, LBL, RULE, KEY, KEY_INK, KEY_LINE, spaced } from "./config";
import type { QtState } from "./useQuotation";

const thCls = "px-4 py-2.5 font-semibold";

// One quotation opened for reading: details, items, suppliers, print / send / delete.
export function QtView({ m }: { m: QtState }) {
  const { rights, viewingRecord, deleteMutation, sendMutation, goToList, handlePrint } = m;
  if (!viewingRecord) return null;
  const r = viewingRecord;
  const status = r.Status || "Draft";
  return (
    <div className="space-y-4">
      {/* View header */}
      <div className="bg-card flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ border: RULE }}>
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" onClick={goToList} className={`${KEY_LINE} h-8 px-3 shrink-0`}>
            <ArrowLeft size={12} /> Back
          </button>
          <div className="min-w-0">
            <p className={LBL}>Request for quotation</p>
            <div className="flex flex-wrap items-center gap-2 mt-0.5">
              <span className="font-heading font-bold tracking-tight text-foreground text-base">{r.DocNo}</span>
              <SheetMark text={spaced(printStatusLabel(status))} tone={statusTone(status)} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button type="button" onClick={() => handlePrint(r)} className={`${KEY_LINE} h-8 px-3`} title="Print">
            <Printer size={12} /> <span className="hidden sm:inline">Print</span>
          </button>
          {rights.canDelete && r.Status === "Draft" && (
            <button
              type="button"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (confirm(`Delete quotation ${r.DocNo}?`)) {
                  deleteMutation.mutate(r.QuotationId, { onSuccess: goToList });
                }
              }}
              className={`${KEY} h-8 px-3 border border-destructive text-destructive hover:bg-destructive/10`}
              title="Delete"
            >
              <Trash2 size={12} /> <span className="hidden sm:inline">Delete</span>
            </button>
          )}
          {rights.canEdit && r.Status === "Draft" && (
            <button type="button" onClick={() => sendMutation.mutate(r.QuotationId)} disabled={sendMutation.isPending} className={`${KEY_INK} h-8 px-4`}>
              <Send size={12} /> {sendMutation.isPending ? "Sending…" : "Send to suppliers"}
            </button>
          )}
        </div>
      </div>

      {/* Meta grid */}
      <div className="bg-card grid grid-cols-2 sm:grid-cols-4" style={{ border: RULE }}>
        {[
          { label: "Company", value: r.CompanyName },
          { label: "Project", value: r.ProjectName },
          { label: "Date", value: fmtDate(r.DocDate) },
          { label: "Source MR", value: r.SourceMRDocNo, strong: true },
        ].map(({ label, value, strong }, i) => (
          <div key={label} className="px-4 py-3" style={{ borderLeft: i % 4 ? "1px solid hsl(var(--foreground) / 0.2)" : undefined }}>
            <p className={`${LBL} mb-1`}>{label}</p>
            <p className={`text-sm truncate ${strong ? "font-heading font-semibold tracking-wide" : "font-medium"}`}>{value || "—"}</p>
          </div>
        ))}
      </div>

      {/* Items */}
      <div className="bg-card" style={{ border: RULE }}>
        <div className="px-4 py-3" style={{ borderBottom: RULE }}>
          <span className={HEAD}>
            Items <span className="font-normal text-muted-foreground tabular-nums ml-1">{(r.items || []).length}</span>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={`${LBL} text-left`} style={{ boxShadow: "inset 0 -1px 0 hsl(var(--foreground) / 0.3)" }}>
                <th className={`${thCls} w-10`}>#</th>
                <th className={thCls}>Item</th>
                <th className={`${thCls} text-right`}>UOM</th>
                <th className={`${thCls} text-right`}>Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/10">
              {(r.items || []).map((it: any, idx: number) => (
                <tr key={idx}>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs font-heading tabular-nums">{String(idx + 1).padStart(2, "0")}</td>
                  <td className="px-4 py-2.5 font-medium">{it.ItemName || it.ItemId}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-right">{it.UOMName || it.UOMCode}</td>
                  <td className="px-4 py-2.5 font-heading font-semibold tabular-nums text-right">{it.Quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Suppliers */}
      <div className="bg-card" style={{ border: RULE }}>
        <div className="px-4 py-3" style={{ borderBottom: RULE }}>
          <span className={HEAD}>
            Suppliers <span className="font-normal text-muted-foreground tabular-nums ml-1">{(r.suppliers || []).length}</span>
          </span>
        </div>
        {(!r.suppliers || r.suppliers.length === 0) ? (
          <p className="text-sm text-muted-foreground p-5 text-center">No suppliers tagged.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`${LBL} text-left`} style={{ boxShadow: "inset 0 -1px 0 hsl(var(--foreground) / 0.3)" }}>
                  <th className={thCls}>Supplier</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Invited</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/10">
                {r.suppliers.map((s) => (
                  <tr key={s.Id}>
                    <td className="px-4 py-2.5 font-medium">{s.SupplierName}</td>
                    <td className="px-4 py-2.5">
                      <SheetMark text={printStatusLabel(s.Status || "Pending")} tone={statusTone(s.Status || "Pending")} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{fmtDate(s.InvitedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
