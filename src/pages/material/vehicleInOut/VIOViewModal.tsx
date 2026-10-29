import * as vehApi from "@/api/vehicleInOutApi";
import { DocumentChainPanel } from "@/components/material/DocumentChainPanel";
import { parseJsonArray } from "@/utils/parseJsonArray";
import { OrderChat } from "@/components/orders/OrderChat";
import { X, Paperclip, FileWarning, Edit3, MessageCircle, Printer, FileDown } from "lucide-react";
import { BodyPortal } from "@/components/ui/body-portal";
import { AttachmentThumb, LinePhotoThumb, fmtServerDateTime } from "./config";
import { bridge } from "./config";
import type { VIOState } from "./useVehicleInOut";

// One entry opened: details, lines, attachments, print / PDF, edit / delete.
export function VIOViewModal({ m }: { m: VIOState }) {
  const { rights, currentUser, viewingRec, setViewingRec, viewTab, setViewTab, setShowPODetails, setDebitNoteItem, setDebitNoteQty, setDebitNoteReason, records, handlePrintVehicleRec, handleGeneratePdfVehicleRec } = m;
  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* VIEW MODAL                                                          */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {viewingRec && (
        <BodyPortal><div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4">
          <div className="bg-card border border-foreground/30 w-full max-w-2xl max-h-[92vh] sm:max-h-[88vh] overflow-y-auto">
            {/* Modal header */}
            <div className="sticky top-0 bg-card z-10 flex items-center justify-between px-6 py-4 border-b border-foreground/30">
              <div>
                <h2 className="font-heading font-bold text-base">
                  {viewingRec.DocNo || "Vehicle In/Out"}
                </h2>
                <p className="text-[0.625rem] text-muted-foreground uppercase tracking-[0.12em] mt-0.5">
                  Vehicle In/Out Entry
                </p>
              </div>
              <button
                onClick={() => { setViewingRec(null); setShowPODetails(false); }}
                className="p-2 hover:bg-primary/5 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Tabs — Supplier only makes sense once this entry is linked
                to a PO (chat is scoped to the PO, same conversation the
                supplier sees on their own "Received by Customer" card). */}
            {viewingRec.POID && (
              <div className="sticky top-[57px] bg-card z-10 flex border-b border-foreground/30 px-6 gap-1">
                {[
                  { id: "details" as const, label: "Details" },
                  { id: "supplier" as const, label: "Supplier", icon: MessageCircle },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setViewTab(t.id)}
                    className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                      viewTab === t.id
                        ? "border-foreground/40 text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t.icon && <t.icon size={12} />}
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            {viewTab === "supplier" && viewingRec.POID ? (
              <div className="p-5 sm:p-6 h-[60vh]">
                {currentUser && (
                  <OrderChat
                    poId={viewingRec.POID}
                    apiBase="/api/vehicle-in-out/po-chat"
                    currentUser={{ id: Number(currentUser.id), name: currentUser.name, role: currentUser.role }}
                    className="h-full"
                  />
                )}
              </div>
            ) : (
            <div className="p-5 sm:p-6 space-y-5">
              {/* Meta grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  {
                    label: "Doc No",
                    value: viewingRec.DocNo || "—",
                    mono: true,
                  },
                  {
                    label: "Doc Date",
                    value: viewingRec.DocDate
                      ? new Date(viewingRec.DocDate).toLocaleDateString(
                          "en-IN",
                        )
                      : "—",
                  },
                  { label: "Fin Year", value: viewingRec.FinYear || "—" },
                  { label: "Created By", value: viewingRec.CreatedByName || viewingRec.CreatedBy || "—" },
                  { label: "Company", value: viewingRec.CompanyName || "—" },
                  { label: "Project", value: viewingRec.ProjectName || "—" },
                  {
                    label: "Supplier",
                    value: viewingRec.SupplierName || "—",
                  },
                  {
                    label: "Vehicle No",
                    value: viewingRec.VehicleNo || "—",
                    mono: true,
                  },
                  { label: "Challan No", value: viewingRec.ChallanNo || "—" },
                ].map(({ label, value, mono }: any) => (
                  <div
                    key={label}
                    className="px-3 py-2.5 bg-card border border-foreground/30"
                  >
                    <p className="text-[0.5625rem] uppercase tracking-[0.12em] text-muted-foreground mb-0.5">
                      {label}
                    </p>
                    <p
                      className={`text-xs font-semibold ${mono ? "font-heading" : ""} text-foreground`}
                    >
                      {value}
                    </p>
                  </div>
                ))}

                {/* PO Reference */}
                {viewingRec.PONumber ? (
                  <button
                    onClick={() => setShowPODetails(true)}
                    className="px-3 py-2.5 bg-card border border-foreground/40 text-left hover:bg-primary/5 transition-colors"
                  >
                    <p className="text-[0.5625rem] uppercase tracking-[0.12em] text-muted-foreground mb-0.5">
                      PO Reference
                    </p>
                    <p className="text-xs font-semibold font-heading text-foreground flex items-center gap-1.5">
                      {viewingRec.PONumber}

                    </p>
                  </button>
                ) : (
                  <div className="px-3 py-2.5 bg-card border border-foreground/30">
                    <p className="text-[0.5625rem] uppercase tracking-[0.12em] text-muted-foreground mb-0.5">PO Reference</p>
                    <p className="text-xs text-muted-foreground">—</p>
                  </div>
                )}
              </div>

              {/* Full chain — PO this lot came from, and (via the PO)
                  whichever Material Request or Quotation it's tagged to */}
              <DocumentChainPanel docType="vio" id={viewingRec.VehicleInOutID} />

              {/* Times */}
              <div className="grid grid-cols-2 gap-3">
                <div className="px-3 py-2.5 bg-card border border-foreground/40">
                  <p className="text-[0.5625rem] uppercase tracking-[0.12em] text-muted-foreground mb-0.5">
                    Entry Time
                  </p>
                  <p className="text-xs font-semibold font-heading text-foreground">
                    {viewingRec.EntryTime
                      ? fmtServerDateTime(viewingRec.EntryTime)
                      : "—"}
                  </p>
                </div>
                <div className="px-3 py-2.5 bg-card border border-foreground/30">
                  <p className="text-[0.5625rem] uppercase tracking-[0.12em] text-muted-foreground mb-0.5">
                    Exit Time
                  </p>
                  <p className="text-xs font-semibold font-heading text-foreground">
                    {viewingRec.ExitTime
                      ? fmtServerDateTime(viewingRec.ExitTime)
                      : "Not yet exited"}
                  </p>
                </div>
              </div>

              {/* Received Items — quality inspection can flag part or all
                  of a line as inferior and raise a debit note against it
                  (e.g. ordered Grade A steel, 20 of 100 tonnes received
                  turn out inferior on inspection). */}
              {Array.isArray(viewingRec.Items) && viewingRec.Items.length > 0 && (
                <div>
                  <p className="text-[0.625rem] uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-2">
                    Received Items
                  </p>
                  <div className="border border-foreground/30 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-card">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground text-[0.625rem] uppercase tracking-wide">Item</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground text-[0.625rem] uppercase tracking-wide">Received</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground text-[0.625rem] uppercase tracking-wide">Weight</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground text-[0.625rem] uppercase tracking-wide"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-foreground/10">
                        {viewingRec.Items.map((it: any) => (
                          <tr key={it.VehicleInOutItemID}>
                            <td className="px-3 py-2 font-medium text-foreground">
                              <span className="inline-flex items-center gap-1.5">
                                <LinePhotoThumb src={it.PhotoBase64} alt={`${it.ItemName || "Item"} photo`} />
                                {it.ItemName || "—"}
                                {it.Brand && (
                                  <span className="text-[0.625rem] font-normal text-muted-foreground">
                                    ({it.Brand})
                                  </span>
                                )}
                                {it.Quality && (
                                  <span
                                    className={`inline-flex items-center px-1.5 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wide border ${
                                      it.Quality === "Excellent"
                                        ? "bg-card text-foreground border-foreground/40"
                                        : it.Quality === "Good"
                                          ? "bg-card text-foreground border-foreground/40"
                                          : "bg-card text-foreground border-foreground/40"
                                    }`}
                                  >
                                    {it.Quality}
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-heading text-foreground">
                              {it.ReceivedQty} {it.UomName || ""}
                            </td>
                            <td className="px-3 py-2 text-right font-heading text-foreground whitespace-nowrap">
                              {Number(it.Weight) > 0 ? `${Number(it.Weight).toLocaleString("en-IN")} ${it.WeightUnit || "kg"}` : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {rights.canEdit && (
                                <button
                                  onClick={() => {
                                    setDebitNoteItem(it);
                                    setDebitNoteQty("");
                                    setDebitNoteReason("");
                                  }}
                                  title="Raise a debit note if part of this line was found below the ordered grade"
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-foreground/40 text-foreground text-[0.6875rem] font-semibold hover:bg-primary/5 hover:border-foreground transition-colors"
                                >
                                  <FileWarning size={12} /> Debit Note
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Attachments — new records use the DB-backed Attachments[]
                  (binary stored in dbo.VehicleInOutAttachments); older
                  records created before this change may still only have
                  legacy disk paths in AttachmentPath. */}
              {Array.isArray(viewingRec.Attachments) &&
              viewingRec.Attachments.length > 0 ? (
                <div>
                  <p className="text-[0.625rem] uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-2">
                    Attachments ({viewingRec.Attachments.length})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {viewingRec.Attachments.map(
                      (a: vehApi.VehicleAttachment) => (
                        <AttachmentThumb key={a.id} attachment={a} />
                      ),
                    )}
                  </div>
                </div>
              ) : (
                (() => {
                  // Legacy fallback: pre-migration rows that still hold
                  // disk paths (single string or JSON array) instead of
                  // DB-backed attachment rows.
                  const legacyPaths = parseJsonArray<string>(
                    viewingRec.AttachmentPath,
                  ).length
                    ? parseJsonArray<string>(viewingRec.AttachmentPath)
                    : viewingRec.AttachmentPath
                      ? [viewingRec.AttachmentPath]
                      : [];
                  if (legacyPaths.length === 0) return null;
                  return (
                    <div>
                      <p className="text-[0.625rem] uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-2">
                        Attachments ({legacyPaths.length})
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {legacyPaths.map((p) => {
                          const isImage =
                            /\.(jpe?g|png|gif|webp|heic)$/i.test(p);
                          return (
                            <a
                              key={p}
                              href={p}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 text-sm text-primary font-medium hover:bg-primary/10 transition-colors"
                            >
                              {isImage ? (
                                <img
                                  src={p}
                                  alt="attachment"
                                  className="h-7 w-7 object-cover"
                                />
                              ) : (
                                <Paperclip size={13} />
                              )}
                              <span className="truncate max-w-[160px]">
                                {p.split("/").pop()}
                              </span>
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()
              )}

              {/* Remarks */}
              {viewingRec.Remarks && (
                <div>
                  <p className="text-[0.625rem] uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-2">
                    Remarks
                  </p>
                  <p className="text-sm text-foreground bg-card px-4 py-3 border border-foreground/30">
                    {viewingRec.Remarks}
                  </p>
                </div>
              )}

              {/* Print / Edit buttons */}
              <div className="flex justify-end gap-2 pt-2 border-t border-foreground/30">
                <button
                  onClick={() => handlePrintVehicleRec(viewingRec)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-card border border-foreground/30 text-sm font-medium hover:bg-primary/5 transition-colors"
                >
                  <Printer size={13} /> Print
                </button>
                <button
                  onClick={() => handleGeneratePdfVehicleRec(viewingRec)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-card border border-foreground/30 text-sm font-medium hover:bg-primary/5 transition-colors"
                >
                  <FileDown size={13} /> Generate PDF
                </button>
                {rights.canEdit && (
                  <button
                    onClick={() => {
                      setViewingRec(null);
                      bridge.onEdit(viewingRec);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-card border border-foreground/30 text-sm font-medium hover:bg-primary/5 transition-colors"
                  >
                    <Edit3 size={13} /> Edit
                  </button>
                )}
              </div>
            </div>
            )}
          </div>
        </div></BodyPortal>
      )}
    </>
  );
}
