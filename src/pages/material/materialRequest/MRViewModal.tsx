import { createPortal } from "react-dom";
import { toast } from "sonner";
import { DocumentChainPanel } from "@/components/material/DocumentChainPanel";
import { FileText, Trash2, X, ClipboardList, Edit3, ShoppingCart, Printer, FileDown } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { loadMRCompany, mrDocFromRecord, printMaterialRequest, downloadMaterialRequestPdf } from "@/utils/materialRequestDocument";
import { PRIORITY_COLOR, fmtDate } from "./config";
import type { MRState } from "./useMaterialRequest";

// One request opened for reading: details, items, print / PDF, edit / delete, document chain.
export function MRViewModal({ m }: { m: MRState }) {
  const { rights, isAdmin, viewingRecord, setViewingRecord, header, pendingSummaryByMRId, deleteMutation, handleEdit } = m;
  if (!viewingRecord) return null;
  const items: any[] = viewingRecord.items || [];
  const priority = viewingRecord.Priority || "Normal";
  const closeOverlay = () => setViewingRecord(null);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) closeOverlay(); }}
    >
    <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-5xl max-h-[95vh] sm:max-h-[92vh] overflow-y-auto">

      {/* ── Sticky header ── */}
      <div className="sticky top-0 bg-card z-10 border-b border-border">
        <div className="flex items-start justify-between px-4 sm:px-6 py-4 gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20 shrink-0">
              <ClipboardList size={13} className="text-emerald-500" />
            </div>
            <h2 className="font-heading font-bold text-sm sm:text-base font-mono truncate max-w-[160px] sm:max-w-none">
              {viewingRecord.DocNo || `MR-${viewingRecord.MRId}`}
            </h2>
            <StatusBadge status={viewingRecord.Status || "Draft"} />
            {(() => {
              const pending = pendingSummaryByMRId.get(viewingRecord.MRId);
              if (!pending) return null;
              return pending.totalPending > 0 ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[0.6875rem] font-semibold bg-[#ffe2021a] text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  Pending &middot; {pending.totalPending} Qty
                </span>
              ) : pending.totalOrdered > 0 ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[0.6875rem] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  Completed
                </span>
              ) : null;
            })()}
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLOR[priority] ?? PRIORITY_COLOR.Normal}`}>
              {priority}
            </span>
          </div>
          <p className="text-[0.625rem] text-muted-foreground uppercase tracking-widest mt-0.5 ml-9">Material Request</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={async () => {
                const rec = viewingRecord;
                const company = await loadMRCompany(rec.CompanyId, rec.CompanyName);
                printMaterialRequest(mrDocFromRecord(rec, company));
              }}
              className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition"
            >
              <Printer size={13} /><span className="hidden sm:inline">Print</span>
            </button>
            <button
              onClick={async () => {
                const rec = viewingRecord;
                const toastId = toast.loading("Generating PDF...");
                try {
                  const company = await loadMRCompany(rec.CompanyId, rec.CompanyName);
                  await downloadMaterialRequestPdf(
                    mrDocFromRecord(rec, company),
                    `${String(rec.DocNo || `MR-${rec.MRId}`).replace(/[^\w-]+/g, "_")}.pdf`,
                  );
                  toast.success("PDF downloaded", { id: toastId });
                } catch {
                  toast.error("Could not generate PDF", { id: toastId });
                }
              }}
              className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition"
            >
              <FileDown size={13} /><span className="hidden sm:inline">Generate PDF</span>
            </button>
          {rights.canEdit && viewingRecord.Status !== "Short Closed" && (viewingRecord.Status === "Draft" || viewingRecord.Status === "Approved" || viewingRecord.Status === "Rejected" || isAdmin) && (
            <button
              onClick={() => { closeOverlay(); handleEdit(viewingRecord); }}
              className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-white text-xs font-semibold btn-module shadow-sm transition"
            >
              <Edit3 size={13} /><span className="hidden sm:inline">Edit</span>
            </button>
          )}
          {rights.canDelete && (
            <button
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (confirm("Delete this material request?")) {
                  deleteMutation.mutate(viewingRecord.MRId);
                  closeOverlay();
                }
              }}
              className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg border border-destructive/40 text-xs font-semibold text-destructive hover:bg-destructive/10 transition disabled:opacity-50"
            >
              <Trash2 size={13} /><span className="hidden sm:inline">{deleteMutation.isPending ? "Deleting…" : "Delete"}</span>
            </button>
          )}
          <button
            onClick={closeOverlay}
            className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          >
            <X size={16} />
          </button>
        </div>
        </div>
      </div>

      <div className="p-5 space-y-6">

        {/* ── Request Details ── */}
        <div>
          <p className="text-[0.625rem] uppercase tracking-widest font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
            <FileText size={10} className="text-emerald-500" /> Request Details
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {([
              { label: "Doc No", value: viewingRecord.DocNo, mono: true },
              { label: "Financial Year", value: viewingRecord.FinYearName },
              { label: "Request Date", value: fmtDate(viewingRecord.RequestDate) },
              { label: "Required By", value: fmtDate(viewingRecord.RequiredByDate) },
              { label: "Company", value: viewingRecord.CompanyName },
              { label: "Project / Site", value: viewingRecord.ProjectName },
              { label: "Created By", value: viewingRecord.CreatedBy },
            ] as { label: string; value: any; mono?: boolean }[]).map(({ label, value, mono }) => (
              <div key={label} className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                <p className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
                <p className={`text-xs font-semibold truncate ${mono ? "font-mono text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>{value || "—"}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Reason & Remarks ── */}
        {(viewingRecord.Reason || viewingRecord.Remarks) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {viewingRecord.Reason && (
              <div className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                <p className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground mb-1">Reason for Request</p>
                <p className="text-xs text-foreground leading-relaxed">{viewingRecord.Reason}</p>
              </div>
            )}
            {viewingRecord.Remarks && (
              <div className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                <p className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground mb-1">Remarks</p>
                <p className="text-xs text-foreground leading-relaxed">{viewingRecord.Remarks}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Requested Items ── */}
        <div>
          <p className="text-[0.625rem] uppercase tracking-widest font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
            <ShoppingCart size={10} className="text-emerald-500" /> Requested Items
            <span className="ml-1 font-mono text-[0.625rem] bg-muted px-1.5 py-0.5 rounded-full border border-border">{items.length}</span>
          </p>
          <div className="rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-xs" style={{ tableLayout: "auto" }}>
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  <th className="px-4 py-2.5 text-left text-[0.625rem] font-heading uppercase tracking-widest text-muted-foreground">Item</th>
                  <th className="px-4 py-2.5 text-left text-[0.625rem] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">UOM</th>
                  <th className="px-4 py-2.5 text-right text-[0.625rem] font-heading uppercase tracking-widest text-muted-foreground">Qty</th>
                  <th className="px-4 py-2.5 text-left text-[0.625rem] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {items.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No items found</td></tr>
                ) : (
                  items.map((it, i) => (
                    <tr key={i} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{it.ItemName || it.ItemId}</td>
                      <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{it.UOMName || it.UOMCode || "—"}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold">{Number(it.Quantity).toFixed(2)}</td>
                      <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{it.Remarks || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {items.length > 0 && (() => {
                // Quantities in different UOMs aren't fungible (bags vs.
                // metric tons), so a single blind sum across every row was
                // meaningless — total per UOM group instead, one row each.
                const totalsByUom = new Map<string, number>();
                for (const it of items) {
                  const uom = it.UOMName || it.UOMCode || "—";
                  totalsByUom.set(uom, (totalsByUom.get(uom) || 0) + Number(it.Quantity));
                }
                const uomTotals = Array.from(totalsByUom.entries());
                return (
                  <tfoot className="bg-muted/20 border-t border-border">
                    {uomTotals.map(([uom, qty], i) => (
                      <tr key={uom}>
                        <td className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">
                          {i === 0 ? "Total" : ""}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                          {uomTotals.length > 1 ? uom : ""}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          {qty.toFixed(2)}{uomTotals.length === 1 ? ` ${uom}` : ""}
                        </td>
                        <td className="hidden sm:table-cell" />
                      </tr>
                    ))}
                  </tfoot>
                );
              })()}
            </table>
          </div>
        </div>

        {/* ── Document chain — tagged PO doc ref is enough here, the full
            Linked Purchase Orders table was redundant with this ── */}
        <DocumentChainPanel docType="mr" id={viewingRecord.MRId} />

      </div>
    </div>
    </div>,
    document.body,
  );
}
