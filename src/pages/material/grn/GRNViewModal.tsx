import { DocumentChainPanel } from "@/components/material/DocumentChainPanel";
import { X, FileText, Receipt, CheckCircle2, AlertCircle, AlertTriangle, FileWarning, Printer, FileDown, BookOpen, Landmark } from "lucide-react";
import { type UOM } from "@/api/grnApi";
import { BodyPortal } from "@/components/ui/body-portal";
import { GRNItemLine, RemainingItemsPanel, parseJsonArray, fmt, fmtQty, LinkedExpenseBookings, isTransferGRN } from "./config";
import type { GRNState } from "./useGRN";

// One GRN opened: details and posting tabs, print / PDF, edit / delete.
export function GRNViewModal({ m }: { m: GRNState }) {
  const { rights, setDebitNoteLine, setDebitNoteQty, setDebitNoteReason, viewingGrn, setViewingGrn, viewModalTab, setViewModalTab, grnPostingData, grnPostingLoading, grnPostingError, handleCreateGRNFromRemaining, handlePrintGRN, handleGeneratePdfGRN } = m;
  return (
    <>
      {viewingGrn &&
        (() => {
          // Only lines actually received — a GRN sourced from "remaining
          // items" can be saved with some lines still at 0 (the user chose
          // not to receive them in this lot), and those shouldn't show up
          // in a "Received Items" list.
          const items = parseJsonArray<GRNItemLine>(viewingGrn.GRNItems).filter(
            (i) => Number(i.receivedQty) > 0,
          );
          const subtotal = items.reduce(
            (s, i) => s + (Number(i.totalAmount) || 0),
            0,
          );
          const gstTotal = items.reduce(
            (s, i) => s + (Number(i.gstAmount) || 0),
            0,
          );
          const subtotalInclGST = subtotal + gstTotal;
          return (
            <BodyPortal><div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 bw-modal-topmost">
              <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] sm:max-h-[88vh] overflow-y-auto">
                {/* Modal header */}
                <div className="sticky top-0 bg-card z-10 flex items-center justify-between px-6 py-4 border-b border-border">
                  <div>
                    <h2 className="font-heading font-bold text-base">
                      {viewingGrn.GRNNo
                        ? viewingGrn.GRNNo.startsWith("GRN-")
                          ? viewingGrn.GRNNo
                          : `GRN-${viewingGrn.GRNNo}`
                        : "—"}
                    </h2>
                    <p className="text-[0.625rem] text-muted-foreground uppercase tracking-widest mt-0.5">
                      Goods Receipt Note
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {rights.canPrint && (
                      <button
                        onClick={() => handlePrintGRN(viewingGrn)}
                        title="Print GRN"
                        className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground print:hidden"
                      >
                        <Printer size={18} />
                      </button>
                    )}
                    {rights.canPrint && (
                      <button
                        onClick={() => handleGeneratePdfGRN(viewingGrn)}
                        title="Generate PDF"
                        className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground print:hidden"
                      >
                        <FileDown size={18} />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setViewingGrn(null);
                        setViewModalTab("details");
                      }}
                      className="p-2 hover:bg-muted rounded-lg transition-colors print:hidden"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>
                {/* ── Tab bar ─────────────────────────────────────────── */}
                <div className="flex items-center gap-1 px-6 pt-3 pb-0 border-b border-border bg-card print:hidden">
                  {(["details", "posting"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setViewModalTab(tab)}
                      className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors capitalize
                          ${
                            viewModalTab === tab
                              ? "border-primary text-primary bg-primary/5"
                              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
                          }`}
                    >
                      {tab === "details" ? (
                        <FileText size={12} />
                      ) : (
                        <Landmark size={12} />
                      )}
                      {tab === "details" ? "Details" : "Posting"}
                    </button>
                  ))}
                </div>
                {/* ── Details tab ─────────────────────────────────────── */}
                {viewModalTab === "details" && (
                  <div className="p-5 sm:p-6 space-y-6">
                    {/* Meta grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[
                        {
                          label: "Doc No",
                          value: viewingGrn.DocNo || viewingGrn.GRNNo || "—",
                          mono: true,
                        },
                        {
                          label: "Date",
                          value: viewingGrn.GRNDate
                            ? new Date(viewingGrn.GRNDate).toLocaleDateString(
                                "en-IN",
                              )
                            : "—",
                        },
                        {
                          label: "Supplier",
                          value: viewingGrn.SupplierName || "—",
                        },
                        {
                          label: "Purchase Order",
                          value: viewingGrn.PONumber || "—",
                        },
                        {
                          label: "Created By",
                          value: viewingGrn.CreatedBy || "—",
                        },
                        {
                          label: "Company",
                          value: viewingGrn.CompanyName || "—",
                        },
                        {
                          label: "Project",
                          value: viewingGrn.ProjectName || "—",
                        },
                        ...(viewingGrn.SourceMRDocNo
                          ? [
                              {
                                label: "Source MR",
                                value: viewingGrn.SourceMRDocNo,
                                mono: true,
                                color: "text-emerald-600 dark:text-emerald-400",
                              },
                            ]
                          : []),
                        ...(viewingGrn.SourceWODocNo
                          ? [
                              {
                                label: "Source WO",
                                value: viewingGrn.SourceWODocNo,
                                mono: true,
                                color: "text-orange-600 dark:text-orange-400",
                              },
                            ]
                          : []),
                        ...(viewingGrn.SourceWDDocNo
                          ? [
                              {
                                label: "Source WD",
                                value: viewingGrn.SourceWDDocNo,
                                mono: true,
                                color: "text-orange-600 dark:text-orange-400",
                              },
                            ]
                          : []),
                        ...(viewingGrn.VehicleInOutDocNo
                          ? [
                              {
                                label: "Vehicle In/Out",
                                value: viewingGrn.VehicleInOutVehicleNo
                                  ? `${viewingGrn.VehicleInOutDocNo} — ${viewingGrn.VehicleInOutVehicleNo}`
                                  : viewingGrn.VehicleInOutDocNo,
                                mono: true,
                                color: "text-sky-600 dark:text-sky-400",
                              },
                            ]
                          : !isTransferGRN(viewingGrn)
                            ? [
                                {
                                  label: "Entry Mode",
                                  value: "Direct Entry (no vehicle gate)",
                                  color: "text-amber-600 dark:text-amber-400",
                                },
                              ]
                            : []),
                        ...(viewingGrn.DirectEntryReason
                          ? [{ label: "Direct Entry Reason", value: viewingGrn.DirectEntryReason }]
                          : []),
                      ].map(({ label, value, mono, color }: any) => (
                        <div
                          key={label}
                          className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50"
                        >
                          <p className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground mb-0.5">
                            {label}
                          </p>
                          <p
                            className={`text-xs font-semibold ${mono ? "font-mono" : ""} ${color || "text-foreground"}`}
                          >
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>

                    <DocumentChainPanel docType="grn" id={viewingGrn.GRNID} />

                    {/* Items */}
                    <div>
                      <p className="text-[0.625rem] uppercase tracking-widest font-semibold text-muted-foreground mb-3">
                        Received Items
                      </p>

                      {/* Mobile */}
                      <div className="md:hidden space-y-3">
                        {items.length ? (
                          items.map((item, i) => (
                            <div
                              key={i}
                              className="border border-border rounded-xl p-4 space-y-2 bg-muted/20"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-sm">
                                  {item.itemName || "—"}
                                </span>
                                <span className="text-[0.625rem] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                  {item.uom || "—"}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                                {[
                                  ["Ordered", String(item.orderedQty), ""],
                                  [
                                    "Received",
                                    String(item.receivedQty),
                                    "font-semibold",
                                  ],
                                  [
                                    "Pending Qty",
                                    fmtQty(item.remainingQty),
                                    item.remainingQty > 0
                                      ? "text-amber-500 font-semibold"
                                      : "text-green-500 font-semibold",
                                  ],
                                ].map(([l, v, c]) => (
                                  <div key={l}>
                                    <p className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground mb-0.5">
                                      {l}
                                    </p>
                                    <p className={c}>{v}</p>
                                  </div>
                                ))}
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs pt-1 border-t border-border">
                                <div>
                                  <p className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground mb-0.5">
                                    Rate
                                  </p>
                                  <p>
                                    {item.rate
                                      ? `₹${fmt(Number(item.rate))}`
                                      : "—"}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground mb-0.5">
                                    Qty Bill
                                  </p>
                                  <p>{item.quantity ?? "—"}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground mb-0.5">
                                    Total
                                  </p>
                                  <p className="font-bold text-emerald-600 dark:text-emerald-400">
                                    {item.totalAmount
                                      ? `₹${fmt(Number(item.totalAmount))}`
                                      : "—"}
                                  </p>
                                </div>
                              </div>
                              {rights.canEdit && item.receivedQty > 0 && (
                                <button
                                  onClick={() => {
                                    setDebitNoteLine({ index: i, item });
                                    setDebitNoteQty("");
                                    setDebitNoteReason("");
                                  }}
                                  title="Raise a debit note if part of this line was found below the ordered grade"
                                  className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-rose-500/25 text-rose-600 dark:text-rose-400 text-[0.6875rem] font-semibold hover:bg-rose-600 hover:text-white hover:border-rose-600 transition-colors"
                                >
                                  <FileWarning size={12} /> Raise Debit Note
                                </button>
                              )}
                            </div>
                          ))
                        ) : (
                          <p className="text-center text-muted-foreground text-sm py-6">
                            No items
                          </p>
                        )}
                      </div>

                      {/* Desktop */}
                      <div className="hidden md:block border border-border rounded-xl overflow-x-auto">
                        <table className="w-full text-sm min-w-[680px]">
                          <thead>
                            <tr className="bg-muted/50 border-b border-border">
                              {[
                                "Item",
                                "UOM",
                                "Ordered",
                                "Received",
                                "Pending Qty",
                                "Rate (₹)",
                                "Qty",
                                "Total (₹)",
                                "",
                              ].map((h) => (
                                <th
                                  key={h}
                                  className={`px-3 py-2.5 text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground ${h === "Item" || h === "UOM" || h === "" ? "text-left" : "text-right"}`}
                                >
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {items.length ? (
                              items.map((item, i) => (
                                <tr
                                  key={i}
                                  className="hover:bg-muted/20 transition-colors"
                                >
                                  <td className="px-3 py-2.5 font-medium text-xs">
                                    {item.itemName || "—"}
                                  </td>
                                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                                    {item.uom || "—"}
                                  </td>
                                  <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">
                                    {item.orderedQty}
                                  </td>
                                  <td className="px-3 py-2.5 text-right text-xs font-semibold">
                                    {item.receivedQty}
                                  </td>
                                  <td
                                    className={`px-3 py-2.5 text-right text-xs font-semibold ${item.remainingQty > 0 ? "text-amber-500" : "text-green-500"}`}
                                  >
                                    {fmtQty(item.remainingQty)}
                                  </td>
                                  <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">
                                    {item.rate
                                      ? `₹${fmt(Number(item.rate))}`
                                      : "—"}
                                  </td>
                                  <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">
                                    {item.quantity ?? "—"}
                                  </td>
                                  <td className="px-3 py-2.5 text-right text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                    {item.totalAmount
                                      ? `₹${fmt(Number(item.totalAmount))}`
                                      : "—"}
                                  </td>
                                  <td className="px-3 py-2.5 text-right">
                                    {rights.canEdit && item.receivedQty > 0 && (
                                      <button
                                        onClick={() => {
                                          setDebitNoteLine({ index: i, item });
                                          setDebitNoteQty("");
                                          setDebitNoteReason("");
                                        }}
                                        title="Raise a debit note if part of this line was found below the ordered grade"
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-rose-500/25 text-rose-600 dark:text-rose-400 text-[0.6875rem] font-semibold hover:bg-rose-600 hover:text-white hover:border-rose-600 transition-colors whitespace-nowrap"
                                      >
                                        <FileWarning size={12} /> Debit Note
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td
                                  colSpan={9}
                                  className="px-4 py-6 text-center text-muted-foreground text-sm"
                                >
                                  No items
                                </td>
                              </tr>
                            )}
                          </tbody>
                          {subtotalInclGST > 0 && (
                            <tfoot>
                              <tr className="bg-emerald-500/[0.05] border-t-2 border-emerald-500/20">
                                <td
                                  colSpan={8}
                                  className="px-4 py-3 text-right text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground"
                                >
                                  GRN Total (received)
                                </td>
                                <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                                  ₹{fmt(subtotalInclGST)}
                                </td>
                              </tr>
                              {Number(viewingGrn.POTotalAmount) > 0 &&
                                (() => {
                                  const poTotal = Number(
                                    viewingGrn.POTotalAmount,
                                  );
                                  const diff = poTotal - subtotalInclGST;
                                  return (
                                    <>
                                      <tr className="bg-muted/30 border-t border-border/50">
                                        <td
                                          colSpan={8}
                                          className="px-4 py-2 text-right text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground"
                                        >
                                          PO Value (incl. GST)
                                        </td>
                                        <td className="px-4 py-2 text-right text-xs font-semibold text-foreground">
                                          ₹{fmt(poTotal)}
                                        </td>
                                      </tr>
                                      <tr
                                        className={
                                          diff > 0.005
                                            ? "bg-[#ffe2021a] border-t border-amber-500/20"
                                            : "bg-green-500/10 border-t border-green-500/20"
                                        }
                                      >
                                        <td
                                          colSpan={8}
                                          className="px-4 py-2 text-right text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground"
                                        >
                                          Balance on PO
                                        </td>
                                        <td
                                          className={`px-4 py-2 text-right text-xs font-bold ${diff > 0.005 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}
                                        >
                                          {diff > 0.005
                                            ? `₹${fmt(diff)}`
                                            : "Fully received"}
                                        </td>
                                      </tr>
                                    </>
                                  );
                                })()}
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>

                    {/* GST Breakdown */}
                    {(() => {
                      if (subtotal <= 0 || gstTotal <= 0) return null;

                      // Group by gstPct so lines with same rate are merged
                      const rateMap = new Map<number, number>();
                      items.forEach((i) => {
                        const pct = Number(i.gstPct || 0);
                        const amt = Number(i.gstAmount || 0);
                        if (pct > 0 && amt > 0)
                          rateMap.set(pct, (rateMap.get(pct) ?? 0) + amt);
                      });

                      if (rateMap.size === 0) return null;

                      return (
                        <div>
                          <p className="text-[0.625rem] uppercase tracking-widest font-semibold text-muted-foreground mb-3">
                            GST Breakdown
                          </p>
                          <div className="border border-border rounded-xl overflow-hidden text-sm">
                            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20 border-b border-border">
                              <span className="text-xs text-muted-foreground">
                                Subtotal (before GST)
                              </span>
                              <span className="font-medium">
                                ₹{fmt(subtotal)}
                              </span>
                            </div>
                            {Array.from(rateMap.entries()).map(
                              ([rate, amount], idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between px-4 py-2.5 border-b border-border"
                                >
                                  <span className="text-xs text-muted-foreground">
                                    GST{" "}
                                    <span className="font-mono text-[0.625rem] bg-muted px-1 rounded">
                                      {rate}%
                                    </span>
                                  </span>
                                  <span className="font-medium text-amber-600 dark:text-amber-400">
                                    +₹{fmt(amount)}
                                  </span>
                                </div>
                              ),
                            )}
                            <div className="flex items-center justify-between px-4 py-3 bg-emerald-500/[0.05] border-t-2 border-emerald-500/20">
                              <span className="text-xs font-semibold uppercase tracking-widest">
                                Grand Total (incl. GST)
                              </span>
                              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                ₹{fmt(subtotalInclGST)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Linked Expense Bookings */}
                    <div>
                      <p className="text-[0.625rem] uppercase tracking-widest font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
                        <Receipt
                          size={10}
                          className="text-emerald-600 dark:text-emerald-400"
                        />{" "}
                        Linked Expense Bookings
                      </p>
                      <LinkedExpenseBookings grnId={viewingGrn.GRNID} />
                    </div>

                    {/* Remaining Items — not yet expense-booked */}
                    <div>
                      <p className="text-[0.625rem] uppercase tracking-widest font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
                        <AlertTriangle size={10} className="text-amber-500" />{" "}
                        Remaining Items
                      </p>
                      <RemainingItemsPanel
                        grnId={viewingGrn.GRNID}
                        onCreateNewGRN={handleCreateGRNFromRemaining}
                      />
                    </div>

                    {/* Remarks */}
                    {viewingGrn.Remarks && (
                      <div>
                        <p className="text-[0.625rem] uppercase tracking-widest font-semibold text-muted-foreground mb-2">
                          Remarks
                        </p>
                        <p className="text-sm text-foreground bg-muted/40 rounded-xl px-4 py-3 border border-border/50">
                          {viewingGrn.Remarks}
                        </p>
                      </div>
                    )}
                  </div>
                )}{" "}
                {/* end details tab */}
                {/* ── Posting tab ─────────────────────────────────────── */}
                {viewModalTab === "posting" && (
                  <div className="p-5 sm:p-6 space-y-4">
                    {/* Header row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <BookOpen size={14} className="text-primary" />
                        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Journal Entry — GRN Posting
                        </span>
                      </div>
                      {grnPostingLoading ? (
                        <span className="text-[0.625rem] text-muted-foreground">Loading…</span>
                      ) : grnPostingData?.isPosted ? (
                        <span className="text-[0.625rem] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                          Posted · {grnPostingData.jvNo}
                        </span>
                      ) : null}
                    </div>

                    {/* Debit / Credit table */}
                    {grnPostingLoading ? (
                      <div className="rounded-xl border border-border py-10 text-center text-xs text-muted-foreground">
                        Loading posting details…
                      </div>
                    ) : !grnPostingData ? (
                      <div className="rounded-xl border border-dashed border-border py-10 text-center text-xs text-muted-foreground">
                        Could not load posting data.
                      </div>
                    ) : (() => {
                      const { baseAmount, taxAmount, costCentreBreakdown, accounts, items } = grnPostingData;
                      const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      type PostRow = { key: string; label: string; code: string | null; side: "debit" | "credit"; amount: number };
                      const purchaseLabel = accounts?.purchase?.name ?? accounts?.purchase?.label ?? "Purchase A/c";
                      const purchaseCode = accounts?.purchase?.code ?? null;
                      const pgrnLabel = accounts?.pgrn?.name ?? accounts?.pgrn?.label ?? "Provision for Pending GRN A/c";
                      const pgrnCode = accounts?.pgrn?.code ?? null;
                      const provisionalLabel = accounts?.provisional?.name ?? accounts?.provisional?.label ?? "Provisional Credit Available";
                      const provisionalCode = accounts?.provisional?.code ?? null;

                      // Base and tax post as two separate self-balancing
                      // pairs per item: Purchase Dr (base) = PGRN Cr (base),
                      // and Provisional Credit Dr (tax) = Purchase Cr (tax) —
                      // a same-account repetition rather than crediting PGRN
                      // with the GST-inclusive total. Mirrors backend
                      // /post-to-gl's `lines` construction exactly, just
                      // broken out per received item instead of lumped into
                      // one cumulative figure, so a reviewer can see exactly
                      // what each line item contributed.
                      // Each item posts its base/tax legs to its OWN tagged
                      // GL Account (Item Master → GL Account) when one is
                      // set, not the shared Purchase A/c — mirrors the
                      // backend's /post-to-gl leg construction exactly.
                      const buildRows = (idx: string, base: number, gst: number, glLabel?: string | null, glCode?: string | null, glIsExplicitTag?: boolean): PostRow[] => {
                        // Show the item's tagged GL Account (e.g. "Raw
                        // Material - Iron") alongside "Purchase A/c" in the
                        // same row, rather than replacing it — the reviewer
                        // sees both the actual posted account and the
                        // system ledger it's standing in for. This only
                        // applies to an explicit item-level tag; a Fixed
                        // Asset item's "Fixed Assets A/c" fallback replaces
                        // Purchase A/c outright (it was never a Purchase
                        // A/c candidate) so it's shown alone.
                        const baseLabel = glLabel ? (glIsExplicitTag ? `${glLabel} — ${purchaseLabel}` : glLabel) : purchaseLabel;
                        const baseCode = glLabel ? (glCode ?? null) : purchaseCode;
                        return [
                          { key: `purchase-base-${idx}`, label: baseLabel, code: baseCode, side: "debit", amount: base },
                          { key: `pgrn-${idx}`, label: pgrnLabel, code: pgrnCode, side: "credit", amount: base },
                          ...(gst > 0
                            ? [
                                { key: `provisional-${idx}`, label: provisionalLabel, code: provisionalCode, side: "debit" as const, amount: gst },
                                { key: `purchase-tax-${idx}`, label: baseLabel, code: baseCode, side: "credit" as const, amount: gst },
                              ]
                            : []),
                        ];
                      };

                      type ItemGroup = { key: string; itemName: string | null; qty: number | null; rate: number | null; uom: string | null; costCentre: { id: number; name: string; code: string | null } | null; rows: PostRow[] };
                      const itemGroups: ItemGroup[] =
                        Array.isArray(items) && items.length > 0
                          ? items.map((it: any, idx: number) => ({
                              key: String(it.itemId ?? idx),
                              itemName: it.itemName ?? null,
                              qty: it.qty ?? null,
                              rate: it.rate ?? null,
                              uom: it.uom ?? null,
                              costCentre: it.costCentre ?? null,
                              rows: buildRows(String(it.itemId ?? idx), Number(it.baseAmount) || 0, Number(it.gstAmount) || 0, it.glHeadName ?? null, it.glHeadCode ?? null, !!it.glHeadIsExplicitTag),
                            }))
                          : [{ key: "lumped", itemName: null, qty: null, rate: null, uom: null, costCentre: null, rows: buildRows("lumped", baseAmount, taxAmount) }];

                      const allRows = itemGroups.flatMap((g) => g.rows);
                      const totalDebit = allRows.filter(r => r.side === "debit").reduce((s, r) => s + r.amount, 0);
                      const totalCredit = allRows.filter(r => r.side === "credit").reduce((s, r) => s + r.amount, 0);

                      const gridCols = "grid-cols-[minmax(0,2.5fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] sm:grid-cols-[minmax(0,2.2fr)_1fr_1fr_1fr]";

                      // Cost-centre-wise money breakdown — same totals as
                      // the table above, regrouped by cost centre instead
                      // of by item, so a reviewer can see e.g. "Fixed
                      // Asset: ₹X · Consumption: ₹Y" at a glance.
                      const ccBreakdown: Array<{ costCentre: { id: number; name: string; code: string | null } | null; baseAmount: number; gstAmount: number; totalAmount: number }> =
                        Array.isArray(costCentreBreakdown) ? costCentreBreakdown : [];

                      return (
                        <div className="space-y-3">
                        {ccBreakdown.length > 1 && (
                          <div className="rounded-xl border border-border overflow-hidden">
                            <div className="px-3 sm:px-4 py-2 bg-muted/40 border-b border-border text-[0.625rem] uppercase tracking-widest text-muted-foreground font-semibold">
                              Cost Centre — Money Breakdown
                            </div>
                            <div className="divide-y divide-border/50">
                              {ccBreakdown.map((b, i) => (
                                <div key={b.costCentre?.id ?? `unassigned-${i}`} className="flex items-center justify-between px-3 sm:px-4 py-2.5 text-xs">
                                  <span className="text-foreground font-medium">{b.costCentre?.name || "Unassigned"}</span>
                                  <span className="font-mono text-muted-foreground">₹{fmt(b.totalAmount)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="rounded-xl border border-border overflow-hidden">
                          <div className={`grid ${gridCols} bg-muted/40 border-b border-border px-2 sm:px-4 py-2.5 text-[0.5625rem] sm:text-[0.625rem] uppercase tracking-widest text-muted-foreground font-semibold gap-1 sm:gap-2`}>
                            <span>Account</span>
                            <span className="text-center">Cost Centre</span>
                            <span className="text-right">Debit (₹)</span>
                            <span className="text-right">Credit (₹)</span>
                          </div>
                          {itemGroups.map((group) => (
                            <div key={group.key}>
                              {group.itemName && (
                                <div className="px-2 sm:px-4 pt-3 pb-1.5 bg-muted/10 flex items-baseline justify-between gap-2 border-b border-border/30">
                                  <span className="text-[0.6875rem] sm:text-xs font-semibold text-foreground truncate">{group.itemName}</span>
                                  {(group.qty != null || group.rate != null) && (
                                    <span className="text-[0.625rem] text-muted-foreground flex-shrink-0">
                                      {group.qty != null ? `${group.qty}${group.uom ? ` ${group.uom}` : ""}` : ""}
                                      {group.qty != null && group.rate != null ? " × " : ""}
                                      {group.rate != null ? `₹${fmt(group.rate)}` : ""}
                                    </span>
                                  )}
                                </div>
                              )}
                              {group.rows.map((row) => (
                                <div
                                  key={row.key}
                                  className={`grid ${gridCols} px-2 sm:px-4 py-3 border-b border-border/50 items-center gap-1 sm:gap-2`}
                                >
                                  <div className="flex items-center gap-2 min-w-0 pl-1">
                                    <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${row.side === "debit" ? "bg-emerald-500" : "bg-rose-500"}`} />
                                    <span className="text-[0.6875rem] sm:text-xs text-foreground break-words sm:truncate min-w-0" title={row.code ? `${row.label} (${row.code})` : row.label}>
                                      {row.label}{row.code ? ` (${row.code})` : ""}
                                    </span>
                                  </div>
                                  <span className="text-[0.6875rem] text-muted-foreground text-center truncate">{group.costCentre?.name || "Unassigned"}</span>
                                  <span className="text-xs text-right font-mono text-emerald-700 dark:text-emerald-400">
                                    {row.side === "debit" ? fmt(row.amount) : ""}
                                  </span>
                                  <span className="text-xs text-right font-mono text-rose-600 dark:text-rose-400">
                                    {row.side === "credit" ? fmt(row.amount) : ""}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ))}
                          <div className={`grid ${gridCols} px-2 sm:px-4 py-3 bg-muted/30 border-t-2 border-border text-xs font-bold gap-1 sm:gap-2`}>
                            <span className="uppercase tracking-widest text-muted-foreground text-[0.625rem]">Total</span>
                            <span />
                            <span className="text-right text-emerald-600 dark:text-emerald-400 font-mono">{fmt(totalDebit)}</span>
                            <span className="text-right text-rose-600 dark:text-rose-400 font-mono">{fmt(totalCredit)}</span>
                          </div>
                        </div>
                        </div>
                      );
                    })()}

                    {/* Posted / auto-posting status — posting happens
                        automatically the moment this tab's data loads, no
                        manual "Post to GL" click required. */}
                    {!grnPostingLoading && grnPostingData && (
                      grnPostingData.isPosted ? (
                        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                          <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
                          <p className="text-xs text-emerald-700 dark:text-emerald-400">
                            Posted to General Ledger as <span className="font-semibold">{grnPostingData.jvNo}</span>. Entries are visible in the Trial Balance.
                          </p>
                        </div>
                      ) : grnPostingError ? (
                        <div className="flex items-center gap-2.5 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
                          <AlertCircle size={13} className="text-destructive flex-shrink-0" />
                          <p className="text-xs text-destructive">
                            Auto-posting failed: {grnPostingError}
                          </p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/20 px-4 py-3">
                          <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
                          <p className="text-xs text-muted-foreground">
                            Posting to General Ledger…
                          </p>
                        </div>
                      )
                    )}
                  </div>
                )}{" "}
                {/* end posting tab */}
              </div>
            </div></BodyPortal>
          );
        })()}
    </>
  );
}
