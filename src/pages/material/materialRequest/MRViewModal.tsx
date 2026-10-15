import { createPortal } from "react-dom";
import { toast } from "sonner";
import { DocumentChainPanel } from "@/components/material/DocumentChainPanel";
import { Trash2, X, Edit3, Printer, FileDown } from "lucide-react";
import { SheetMark, statusTone } from "@/components/sheet/Sheet";
import { loadMRCompany, mrDocFromRecord, printMaterialRequest, downloadMaterialRequestPdf } from "@/utils/materialRequestDocument";
import { PRIORITY_COLOR, fmtDate, HEAD, LBL, RULE, KEY, KEY_INK, KEY_LINE, ACT, TAG } from "./config";
import type { MRState } from "./useMaterialRequest";

// One request opened for reading: details, items, print / PDF, edit / delete, document chain.
export function MRViewModal({ m }: { m: MRState }) {
  const { rights, isAdmin, viewingRecord, setViewingRecord, pendingSummaryByMRId, deleteMutation, handleEdit } = m;
  if (!viewingRecord) return null;
  const items: any[] = viewingRecord.items || [];
  const priority = viewingRecord.Priority || "Normal";
  const status = viewingRecord.Status || "Draft";
  const closeOverlay = () => setViewingRecord(null);
  const pending = pendingSummaryByMRId.get(viewingRecord.MRId);
  const canEdit =
    rights.canEdit && status !== "Short Closed" && (status === "Draft" || status === "Approved" || status === "Rejected" || isAdmin);

  // Quantities in different UOMs aren't fungible (bags vs. metric tons), so a
  // single blind sum across every row would be meaningless — total per UOM.
  const uomTotals = (() => {
    const m = new Map<string, number>();
    for (const it of items) {
      const uom = it.UOMName || it.UOMCode || "—";
      m.set(uom, (m.get(uom) || 0) + Number(it.Quantity));
    }
    return Array.from(m.entries());
  })();

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) closeOverlay(); }}
    >
      <div className="sheet-frame bg-card w-full max-w-5xl max-h-[95vh] sm:max-h-[92vh] overflow-y-auto" style={{ margin: 0 }} role="dialog" aria-modal="true" aria-label="Material request">

        {/* ── Sticky header ── */}
        <div className="sticky top-0 bg-card z-10" style={{ borderBottom: RULE }}>
          <div className="flex items-start justify-between px-4 sm:px-6 py-4 gap-2">
            <div className="min-w-0">
              <p className={LBL}>Material request</p>
              <h2 className="font-heading font-bold text-lg tracking-tight text-foreground mt-1 truncate">
                {viewingRecord.DocNo || `MR-${viewingRecord.MRId}`}
              </h2>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <SheetMark text={status} tone={statusTone(status)} />
                {pending &&
                  (pending.totalPending > 0 ? (
                    <SheetMark text={`Pending · ${pending.totalPending} qty`} tone="waiting" />
                  ) : pending.totalOrdered > 0 ? (
                    <SheetMark text="Completed" tone="done" />
                  ) : null)}
                <span className={`${TAG} ${PRIORITY_COLOR[priority] ?? PRIORITY_COLOR.Normal}`}>{priority}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
              <button
                onClick={async () => {
                  const rec = viewingRecord;
                  const company = await loadMRCompany(rec.CompanyId, rec.CompanyName);
                  printMaterialRequest(mrDocFromRecord(rec, company));
                }}
                className={`${KEY_LINE} h-8 px-2.5`}
              >
                <Printer size={12} /><span className="hidden sm:inline">Print</span>
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
                className={`${KEY_LINE} h-8 px-2.5`}
              >
                <FileDown size={12} /><span className="hidden sm:inline">PDF</span>
              </button>
              {canEdit && (
                <button onClick={() => { closeOverlay(); handleEdit(viewingRecord); }} className={`${KEY_INK} h-8 px-2.5`}>
                  <Edit3 size={12} /><span className="hidden sm:inline">Edit</span>
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
                  className={`${KEY} h-8 px-2.5 border border-destructive text-destructive hover:bg-destructive/10`}
                >
                  <Trash2 size={12} /><span className="hidden sm:inline">{deleteMutation.isPending ? "Deleting…" : "Delete"}</span>
                </button>
              )}
              <button onClick={closeOverlay} className={`${ACT} hover:text-foreground hover:border-foreground`} aria-label="Close">
                <X size={15} />
              </button>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-6">

          {/* ── Request details ── */}
          <div>
            <p className={`${HEAD} mb-3`}>Request details</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" style={{ borderTop: "1px solid hsl(var(--foreground) / 0.2)", borderLeft: "1px solid hsl(var(--foreground) / 0.2)" }}>
              {([
                { label: "Doc no", value: viewingRecord.DocNo, strong: true },
                { label: "Financial year", value: viewingRecord.FinYearName },
                { label: "Request date", value: fmtDate(viewingRecord.RequestDate) },
                { label: "Required by", value: fmtDate(viewingRecord.RequiredByDate) },
                { label: "Company", value: viewingRecord.CompanyName },
                { label: "Project / site", value: viewingRecord.ProjectName },
                { label: "Created by", value: viewingRecord.CreatedBy },
              ] as { label: string; value: any; strong?: boolean }[]).map(({ label, value, strong }) => (
                <div key={label} className="px-3 py-2.5" style={{ borderRight: "1px solid hsl(var(--foreground) / 0.2)", borderBottom: "1px solid hsl(var(--foreground) / 0.2)" }}>
                  <p className={`${LBL} mb-1`}>{label}</p>
                  <p className={`text-xs truncate ${strong ? "font-heading font-bold tracking-wide text-foreground" : "font-semibold text-foreground"}`}>{value || "—"}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Reason & remarks ── */}
          {(viewingRecord.Reason || viewingRecord.Remarks) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {viewingRecord.Reason && (
                <div className="border-l-2 border-foreground/40 pl-3 py-0.5">
                  <p className={`${LBL} mb-1`}>Reason for request</p>
                  <p className="text-xs text-foreground leading-relaxed">{viewingRecord.Reason}</p>
                </div>
              )}
              {viewingRecord.Remarks && (
                <div className="border-l-2 border-foreground/40 pl-3 py-0.5">
                  <p className={`${LBL} mb-1`}>Remarks</p>
                  <p className="text-xs text-foreground leading-relaxed">{viewingRecord.Remarks}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Requested items ── */}
          <div>
            <p className={`${HEAD} mb-3`}>
              Requested items <span className="font-normal text-muted-foreground tabular-nums ml-1">{items.length}</span>
            </p>
            <div className="overflow-x-auto" style={{ border: RULE }}>
              <table className="w-full text-xs" style={{ tableLayout: "auto" }}>
                <thead>
                  <tr className={LBL} style={{ boxShadow: "inset 0 -1px 0 hsl(var(--foreground) / 0.3)" }}>
                    <th className="px-4 py-2.5 text-left font-semibold">Item</th>
                    <th className="px-4 py-2.5 text-left font-semibold hidden sm:table-cell">UOM</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Qty</th>
                    <th className="px-4 py-2.5 text-left font-semibold hidden sm:table-cell">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/10">
                  {items.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No items found</td></tr>
                  ) : (
                    items.map((it, i) => (
                      <tr key={i} className="hover:bg-primary/5 transition-colors">
                        <td className="px-4 py-3 font-medium text-foreground">{it.ItemName || it.ItemId}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{it.UOMName || it.UOMCode || "—"}</td>
                        <td className="px-4 py-3 text-right font-heading font-semibold tabular-nums">{Number(it.Quantity).toFixed(2)}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{it.Remarks || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {items.length > 0 && (
                  <tfoot style={{ borderTop: RULE }}>
                    {uomTotals.map(([uom, qty], i) => (
                      <tr key={uom}>
                        <td className={`px-4 py-2.5 ${LBL}`}>{i === 0 ? "Total" : ""}</td>
                        <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">{uomTotals.length > 1 ? uom : ""}</td>
                        <td className="px-4 py-2.5 text-right font-heading font-bold tabular-nums text-foreground">
                          {qty.toFixed(2)}{uomTotals.length === 1 ? ` ${uom}` : ""}
                        </td>
                        <td className="hidden sm:table-cell" />
                      </tr>
                    ))}
                  </tfoot>
                )}
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
