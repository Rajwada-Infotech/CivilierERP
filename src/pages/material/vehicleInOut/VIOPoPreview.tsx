import { X, FileText, RefreshCw } from "lucide-react";
import { BodyPortal } from "@/components/ui/body-portal";
import type { VIOState } from "./useVehicleInOut";

// The linked PO, opened above the entry.
export function VIOPoPreview({ m }: { m: VIOState }) {
  const { viewingRec, showPODetails, setShowPODetails, viewingPODetail, loadingPODetail } = m;
  return (
    <>
      {/* ── PO Preview pop-out (above view modal) ── */}
      {showPODetails && viewingRec && (
        <BodyPortal><div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
          <div className="bg-card border border-foreground/30 w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-card z-10 flex items-center justify-between px-5 py-4 border-b border-foreground/30">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 flex items-center justify-center bg-card border border-foreground/40">
                    <FileText size={12} className="text-foreground" />
                  </div>
                  <h2 className="font-heading font-bold text-sm text-foreground">
                    {loadingPODetail ? "Loading…" : (viewingPODetail as any)?.PurchaseOrderNo || viewingRec.PONumber}
                  </h2>
                </div>
                <p className="text-[0.625rem] text-muted-foreground uppercase tracking-[0.12em] mt-0.5 ml-8">Purchase Order</p>
              </div>
              <button
                onClick={() => setShowPODetails(false)}
                className="p-2 hover:bg-primary/5 transition-colors text-muted-foreground"
              >
                <X size={16} />
              </button>
            </div>

            {loadingPODetail ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                <RefreshCw size={14} className="animate-spin" />
                Loading PO details…
              </div>
            ) : viewingPODetail ? (
              <div className="p-5 space-y-4">
                {/* Meta grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: "PO Number", value: (viewingPODetail as any).PurchaseOrderNo, blue: true },
                    { label: "PO Date", value: (viewingPODetail as any).PODate ? new Date((viewingPODetail as any).PODate).toLocaleDateString("en-IN") : "—" },
                    { label: "Expected Delivery", value: (viewingPODetail as any).ExpectedDeliveryDate ? new Date((viewingPODetail as any).ExpectedDeliveryDate).toLocaleDateString("en-IN") : "—" },
                    { label: "Supplier", value: (viewingPODetail as any).SupplierName },
                    { label: "Company", value: (viewingPODetail as any).CompanyName },
                    { label: "Project / Site", value: (viewingPODetail as any).ProjectName },
                    { label: "Payment Terms", value: (viewingPODetail as any).PaymentTerms || "—" },
                    { label: "Status", value: (viewingPODetail as any).Status },
                    { label: "Total Amount", value: (viewingPODetail as any).TotalAmount != null ? `₹${Number((viewingPODetail as any).TotalAmount).toLocaleString("en-IN")}` : "—" },
                  ].map(({ label, value, blue }: any) => (
                    <div key={label} className="px-3 py-2.5 bg-card border border-foreground/30">
                      <p className="text-[0.5625rem] uppercase tracking-[0.12em] text-muted-foreground mb-0.5">{label}</p>
                      <p className={`text-xs font-semibold truncate ${blue ? "font-heading text-foreground" : "text-foreground"}`}>{value || "—"}</p>
                    </div>
                  ))}
                </div>

                {/* Line items */}
                {Array.isArray((viewingPODetail as any).LineItems) && (viewingPODetail as any).LineItems.length > 0 && (
                  <div>
                    <p className="text-[0.625rem] uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-2">Order Items</p>
                    <div className="border border-foreground/30 overflow-hidden">
                      <table className="w-full text-xs" style={{ tableLayout: "fixed" }}>
                        <thead className="bg-card border-b border-foreground/30">
                          <tr>
                            {[["Description", "38%"], ["Qty", "12%"], ["Unit", "10%"], ["Rate", "15%"], ["Amount", "15%"], ["GST", "10%"]].map(([h, w]) => (
                              <th key={h} className={`px-3 py-2 text-[0.5625rem] uppercase tracking-[0.12em] font-heading text-muted-foreground ${h === "Qty" || h === "Rate" || h === "Amount" || h === "GST" ? "text-right" : "text-left"}`} style={{ width: w }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-foreground/10">
                          {(viewingPODetail as any).LineItems.map((item: any, i: number) => (
                            <tr key={i} className="hover:bg-primary/5 transition-colors">
                              <td className="px-3 py-2 truncate font-medium">{item.ItemName || item.Description || "—"}</td>
                              <td className="px-3 py-2 text-right">{item.Quantity}</td>
                              <td className="px-3 py-2 text-muted-foreground">{item.UomName || item.Unit || "—"}</td>
                              <td className="px-3 py-2 text-right">₹{Number(item.Rate || 0).toLocaleString("en-IN")}</td>
                              <td className="px-3 py-2 text-right font-semibold">₹{Number(item.LineAmount || 0).toLocaleString("en-IN")}</td>
                              <td className="px-3 py-2 text-right text-muted-foreground">{item.TaxPct ? `${item.TaxPct}%` : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {(viewingPODetail as any).Remarks && (
                  <div className="px-3 py-2.5 bg-card border border-foreground/30">
                    <p className="text-[0.5625rem] uppercase tracking-[0.12em] text-muted-foreground mb-0.5">Remarks</p>
                    <p className="text-xs text-foreground">{(viewingPODetail as any).Remarks}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <FileText size={28} className="opacity-30" />
                <p className="text-sm">PO details not available</p>
              </div>
            )}
          </div>
        </div></BodyPortal>
      )}
    </>
  );
}
