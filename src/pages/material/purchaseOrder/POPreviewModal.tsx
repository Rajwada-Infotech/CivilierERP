import { DocumentChainPanel } from "@/components/material/DocumentChainPanel";
import { FileText, ShoppingCart, X, CheckCircle2, Truck, Link2, Printer, FileDown, FilePenLine, Package, Phone, Mail, MapPin, Building2, MessageCircle } from "lucide-react";
import { OrderChat } from "@/components/orders/OrderChat";
import { BodyPortal } from "@/components/ui/body-portal";
import { StatusChip } from "./config";
import type { POState } from "./usePurchaseOrder";

// One PO opened from the register: the document preview with its actions.
export function POPreviewModal({ m }: { m: POState }) {
  const { rights, viewingPO, setViewingPO, viewingPOSupplier, viewingPOCompany, viewingPOProject, viewingTab, setViewingTab, currentUser, lineItems, items, listData, handlePrintFromPreview, handleGeneratePdf, goToEdit } = m;
  return (
    <>
      {/* ── PO Preview Modal ─────────────────────────────────────────────── */}
      {viewingPO && (
        <BodyPortal><div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4 bw-modal-topmost">
          <div className="bg-card border border-foreground/30 w-full max-w-5xl max-h-[95vh] sm:max-h-[92vh] overflow-y-auto">
            {/* Modal header */}
            <div className="sticky top-0 bg-card z-10 border-b border-foreground/30">
              <div className="flex items-start justify-between px-4 sm:px-6 py-4 gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="w-7 h-7 flex items-center justify-center bg-card border border-foreground/40 shrink-0">
                    <ShoppingCart size={13} className="text-foreground" />
                  </div>
                  <h2 className="font-heading font-bold text-sm sm:text-base truncate max-w-[150px] sm:max-w-none">
                    {viewingPO.PurchaseOrderNo ?? viewingPO.poNumber ?? "—"}
                  </h2>
                  {viewingPO.Status && (
                    <StatusChip status={viewingPO.Status} />
                  )}
                </div>
                <p className="text-[0.625rem] text-muted-foreground uppercase tracking-[0.12em] mt-0.5 ml-9">
                  Purchase Order
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={handlePrintFromPreview}
                  className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 border border-foreground/30 text-xs font-semibold text-foreground hover:bg-primary/5 transition-colors"
                >
                  <Printer size={13} /><span className="hidden sm:inline">Print</span>
                </button>
                <button
                  onClick={() => handleGeneratePdf(viewingPO)}
                  className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 border border-foreground/30 text-xs font-semibold text-foreground hover:bg-primary/5 transition-colors"
                >
                  <FileDown size={13} /><span className="hidden sm:inline">Generate PDF</span>
                </button>
                {rights.canEdit && viewingPO.Status !== "Short Closed" && (
                  <button
                    onClick={() => {
                      const item = listData.find(
                        (r) =>
                          r._id ===
                          String(viewingPO.PurchaseOrderID ?? viewingPO._id),
                      );
                      setViewingPO(null);
                      if (item) goToEdit(item);
                    }}
                    className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 text-xs font-semibold bg-foreground text-card border border-foreground transition"
                  >
                    <FilePenLine size={13} /><span className="hidden sm:inline">Edit</span>
                  </button>
                )}
                <button
                  onClick={() => setViewingPO(null)}
                  className="p-2 hover:bg-primary/5 transition-colors text-muted-foreground"
                >
                  <X size={16} />
                </button>
              </div>
              </div>
            </div>

            {/* Tab strip */}
            <div className="flex items-center gap-1 px-6 pt-3 pb-0 border-b border-foreground/30 bg-card">
              {(["details", "supplier"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setViewingTab(tab)}
                  className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
                        viewingTab === tab
                          ? "border-primary text-primary bg-primary/5"
                          : "border-transparent text-muted-foreground hover:text-foreground hover:bg-primary/5"
                      }`}
                >
                  {tab === "details" ? <FileText size={12} /> : <MessageCircle size={12} />}
                  {tab === "details" ? "Details" : "Supplier"}
                </button>
              ))}
            </div>

            {viewingTab === "details" && (
            <div className="p-5 space-y-5">
              {/* Order details grid */}
              <div>
                <p className="text-[0.625rem] uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                  <FileText size={10} className="text-foreground" /> Order
                  Details
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {(
                    [
                      {
                        label: "PO Number",
                        value:
                          viewingPO.PurchaseOrderNo ?? viewingPO.poNumber,
                        mono: true,
                      },
                      {
                        label: "PO Type",
                        value: viewingPO.POType ?? viewingPO.poType ?? "—",
                      },
                      {
                        label: "PO Date",
                        value: viewingPO.PODate
                          ? new Date(viewingPO.PODate).toLocaleDateString(
                              "en-IN",
                            )
                          : (viewingPO.poDate ?? "—"),
                      },
                      {
                        label: "Expected Delivery",
                        value: viewingPO.ExpectedDeliveryDate
                          ? new Date(
                              viewingPO.ExpectedDeliveryDate,
                            ).toLocaleDateString("en-IN")
                          : "—",
                      },
                      {
                        label: "Supplier",
                        value:
                          viewingPO.SupplierName ?? viewingPO.supplierName,
                      },
                      {
                        label: "Company",
                        value: viewingPO.CompanyName ?? viewingPO.companyName,
                      },
                      {
                        label: "Project / Site",
                        value: viewingPO.ProjectName ?? viewingPO.projectName,
                      },
                      {
                        label: "Payment Terms",
                        value: viewingPO.PaymentTermDescription
                          ? `${viewingPO.PaymentTermDescription} (${viewingPO.PaymentTermDays} days)`
                          : "—",
                      },
                      {
                        label: "Total Amount",
                        value:
                          (viewingPO.TotalAmount ?? viewingPO.totalAmount) !=
                          null
                            ? `₹${Number(viewingPO.TotalAmount ?? viewingPO.totalAmount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
                            : "—",
                      },
                      {
                        label: "Status",
                        value: viewingPO.Status ?? viewingPO.status ?? "—",
                      },
                      {
                        label: "Created By",
                        value: viewingPO.CreatedByName ?? viewingPO.CreatedBy ?? "—",
                      },
                    ] as { label: string; value: any; mono?: boolean }[]
                  ).map(({ label, value, mono }) => (
                    <div
                      key={label}
                      className="px-3 py-2.5 bg-card border border-foreground/30"
                    >
                      <p className="text-[0.5625rem] uppercase tracking-[0.12em] text-muted-foreground mb-0.5">
                        {label}
                      </p>
                      <p
                        className={`text-xs font-semibold truncate ${mono ? "font-heading text-foreground" : "text-foreground"}`}
                      >
                        {value || "—"}
                      </p>
                    </div>
                  ))}
                </div>
                {/* Source document references */}
                {(viewingPO.EffectiveMRDocNo ||
                  viewingPO.SourceMRDocNo ||
                  viewingPO.SourceWODocNo ||
                  viewingPO.SourceWDDocNo) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(viewingPO.EffectiveMRDocNo || viewingPO.SourceMRDocNo) && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-card border border-foreground/40 text-[0.625rem] font-semibold text-foreground">
                        <Link2 size={9} />{" "}
                        {/* A PO merged from several Material Requests lists them all. */}
                        {Array.isArray(viewingPO.SourceMRs) && viewingPO.SourceMRs.length > 1
                          ? `MRs: ${viewingPO.SourceMRs.map((m: any) => m.DocNo || `#${m.MRId}`).join(", ")}`
                          : `MR: ${viewingPO.EffectiveMRDocNo || viewingPO.SourceMRDocNo}`}
                        {!viewingPO.SourceMRDocNo && viewingPO.EffectiveMRDocNo && (
                          <span className="opacity-60 font-normal">(via Quotation)</span>
                        )}
                      </span>
                    )}
                    {viewingPO.SourceWODocNo && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-card border border-foreground/40 text-[0.625rem] font-semibold text-foreground">
                        <Link2 size={9} /> WO: {viewingPO.SourceWODocNo}
                      </span>
                    )}
                    {viewingPO.SourceWDDocNo && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-card border border-foreground/40 text-[0.625rem] font-semibold text-foreground">
                        <Link2 size={9} /> WD: {viewingPO.SourceWDDocNo}
                      </span>
                    )}
                  </div>
                )}
                {/* Payment Terms */}
                {(viewingPO.PaymentTerms ?? viewingPO.paymentTerms) && (
                  <div className="mt-3 px-3 py-2.5 bg-card border border-foreground/30">
                    <p className="text-[0.5625rem] uppercase tracking-[0.12em] text-muted-foreground mb-1">
                      Payment Terms / T&C
                    </p>
                    <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                      {viewingPO.PaymentTerms ?? viewingPO.paymentTerms}
                    </p>
                  </div>
                )}
                <DocumentChainPanel
                  docType="po"
                  id={viewingPO.PurchaseOrderID ?? viewingPO.purchaseOrderID ?? null}
                />
              </div>

              {/* Supplier / Billing / Project panels */}
              {(viewingPOSupplier ||
                viewingPOCompany ||
                viewingPOProject) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {/* Supplier Details */}
                  {viewingPOSupplier && (
                    <div className="border border-foreground/30 bg-card p-4">
                      <p className="text-xs uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-2.5 flex items-center gap-1.5">
                        <Building2 size={11} className="text-foreground" />{" "}
                        Supplier Details
                      </p>
                      <dl className="space-y-1.5 text-xs">
                        {viewingPOSupplier.LHeadAddress && (
                          <div>
                            <dt className="text-[0.5625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                              Address
                            </dt>
                            <dd className="text-foreground font-medium mt-0.5">
                              {viewingPOSupplier.LHeadAddress}
                            </dd>
                          </div>
                        )}
                        {viewingPOSupplier.LHeadContactPerson && (
                          <div>
                            <dt className="text-[0.5625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                              Contact
                            </dt>
                            <dd className="text-foreground font-medium mt-0.5">
                              {viewingPOSupplier.LHeadContactPerson}
                            </dd>
                          </div>
                        )}
                        {viewingPOSupplier.LHeadPhone && (
                          <div>
                            <dt className="text-[0.5625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                              Phone
                            </dt>
                            <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1">
                              <Phone
                                size={10}
                                className="text-muted-foreground"
                              />
                              {viewingPOSupplier.LHeadPhone}
                            </dd>
                          </div>
                        )}
                        {viewingPOSupplier.LHeadEmail && (
                          <div>
                            <dt className="text-[0.5625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                              Email
                            </dt>
                            <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1">
                              <Mail
                                size={10}
                                className="text-muted-foreground"
                              />
                              {viewingPOSupplier.LHeadEmail}
                            </dd>
                          </div>
                        )}
                        {viewingPOSupplier.LGST && (
                          <div>
                            <dt className="text-[0.5625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                              GSTIN
                            </dt>
                            <dd className="font-heading text-[0.625rem] font-semibold text-foreground mt-0.5">
                              {viewingPOSupplier.LGST}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}
                  {/* Billing Details */}
                  {viewingPOCompany && (
                    <div className="border border-foreground/30 bg-card p-4">
                      <p className="text-xs uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-2.5 flex items-center gap-1.5">
                        <Building2 size={11} className="text-foreground" />{" "}
                        Billing Details
                      </p>
                      <dl className="space-y-1.5 text-xs">
                        {(viewingPOCompany.address ||
                          viewingPOCompany.city) && (
                          <div>
                            <dt className="text-[0.5625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                              Address
                            </dt>
                            <dd className="text-foreground font-medium mt-0.5">
                              {[
                                viewingPOCompany.address,
                                viewingPOCompany.city,
                                viewingPOCompany.state,
                                viewingPOCompany.pincode,
                              ]
                                .filter(Boolean)
                                .join(", ")}
                            </dd>
                          </div>
                        )}
                        {viewingPOCompany.phone_number && (
                          <div>
                            <dt className="text-[0.5625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                              Phone
                            </dt>
                            <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1">
                              <Phone
                                size={10}
                                className="text-muted-foreground"
                              />
                              {viewingPOCompany.phone_number}
                            </dd>
                          </div>
                        )}
                        {viewingPOCompany.email && (
                          <div>
                            <dt className="text-[0.5625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                              Email
                            </dt>
                            <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1">
                              <Mail
                                size={10}
                                className="text-muted-foreground"
                              />
                              {viewingPOCompany.email}
                            </dd>
                          </div>
                        )}
                        {viewingPOCompany.gst_no && (
                          <div>
                            <dt className="text-[0.5625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                              GSTIN
                            </dt>
                            <dd className="font-heading text-[0.625rem] font-semibold text-foreground mt-0.5">
                              {viewingPOCompany.gst_no}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}
                  {/* Project / Delivery Address */}
                  {viewingPOProject && (
                    <div className="border border-foreground/30 bg-card p-4">
                      <p className="text-xs uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-2.5 flex items-center gap-1.5">
                        <MapPin size={11} className="text-foreground" />{" "}
                        Project Details
                      </p>
                      <dl className="space-y-1.5 text-xs">
                        {(viewingPOProject.address ||
                          viewingPOProject.city) && (
                          <div>
                            <dt className="text-[0.5625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                              Delivery Address
                            </dt>
                            <dd className="text-foreground font-medium mt-0.5">
                              {[
                                viewingPOProject.address,
                                viewingPOProject.address_line2,
                                viewingPOProject.city,
                                viewingPOProject.state,
                                viewingPOProject.pincode,
                              ]
                                .filter(Boolean)
                                .join(", ")}
                            </dd>
                          </div>
                        )}
                        {viewingPOProject.phone_number && (
                          <div>
                            <dt className="text-[0.5625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                              Phone
                            </dt>
                            <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1">
                              <Phone
                                size={10}
                                className="text-muted-foreground"
                              />
                              {viewingPOProject.phone_number}
                            </dd>
                          </div>
                        )}
                        {viewingPOProject.gst_no && (
                          <div>
                            <dt className="text-[0.5625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                              GSTIN
                            </dt>
                            <dd className="font-heading text-[0.625rem] font-semibold text-foreground mt-0.5">
                              {viewingPOProject.gst_no}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}
                </div>
              )}

              {/* Line items */}
              {(() => {
                const lineItems: any[] = Array.isArray(viewingPO.LineItems)
                  ? viewingPO.LineItems
                  : Array.isArray(viewingPO.POItems)
                    ? viewingPO.POItems
                    : [];
                if (!lineItems.length) return null;
                return (
                  <div>
                    <p className="text-[0.625rem] uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Package size={10} className="text-foreground" /> Order
                      Items ({lineItems.length})
                    </p>
                    <div className="border border-foreground/30 overflow-x-auto">
                      <table
                        className="w-full text-xs"
                        style={{ tableLayout: "auto" }}
                      >
                        <thead className="bg-card border-b border-foreground/30">
                          <tr>
                            <th className="px-3 py-2 text-[0.5625rem] uppercase tracking-[0.12em] font-heading text-muted-foreground text-left">Item / Description</th>
                            <th className="px-3 py-2 text-[0.5625rem] uppercase tracking-[0.12em] font-heading text-muted-foreground text-right">Qty</th>
                            <th className="px-3 py-2 text-[0.5625rem] uppercase tracking-[0.12em] font-heading text-muted-foreground text-left hidden sm:table-cell">Unit</th>
                            <th className="px-3 py-2 text-[0.5625rem] uppercase tracking-[0.12em] font-heading text-muted-foreground text-right hidden sm:table-cell">Rate</th>
                            <th className="px-3 py-2 text-[0.5625rem] uppercase tracking-[0.12em] font-heading text-muted-foreground text-right hidden sm:table-cell">GST%</th>
                            <th className="px-3 py-2 text-[0.5625rem] uppercase tracking-[0.12em] font-heading text-muted-foreground text-right">Amount</th>
                            <th className="px-3 py-2 text-[0.5625rem] uppercase tracking-[0.12em] font-heading text-muted-foreground text-right hidden sm:table-cell">Received</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-foreground/10">
                          {lineItems.map((li: any, i: number) => {
                            const name =
                              li.ItemName ??
                              li.itemName ??
                              li.Description ??
                              li.itemDescription ??
                              "—";
                            const qty = Number(
                              li.Quantity ?? li.quantity ?? 0,
                            );
                            const unit =
                              li.UomName ?? li.UOMSymbol ?? li.unit ?? "—";
                            const rate = Number(li.Rate ?? li.rate ?? 0);
                            const tax = Number(li.TaxPct ?? li.tax ?? 0);
                            const amount = Number(
                              li.LineAmount ?? li.amount ?? qty * rate,
                            );
                            const received =
                              li.ReceivedQty != null
                                ? Number(li.ReceivedQty)
                                : null;
                            return (
                              <tr
                                key={i}
                                className="hover:bg-primary/5 transition-colors"
                              >
                                <td className="px-3 py-2 font-medium">{name}</td>
                                <td className="px-3 py-2 text-right">{qty}</td>
                                <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{unit}</td>
                                <td className="px-3 py-2 text-right hidden sm:table-cell">₹{rate.toLocaleString("en-IN")}</td>
                                <td className="px-3 py-2 text-right text-muted-foreground hidden sm:table-cell">{tax ? `${tax}%` : "—"}</td>
                                <td className="px-3 py-2 text-right font-semibold">
                                  ₹{amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                                </td>
                                <td className={`px-3 py-2 text-right hidden sm:table-cell ${received != null && received >= qty ? "text-foreground" : "text-muted-foreground"}`}>
                                  {received != null ? received : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* Remarks */}
              {(viewingPO.Remarks ?? viewingPO.remarks) && (
                <div className="px-3 py-2.5 bg-card border border-foreground/30">
                  <p className="text-[0.5625rem] uppercase tracking-[0.12em] text-muted-foreground mb-0.5">
                    Remarks
                  </p>
                  <p className="text-xs text-foreground">
                    {viewingPO.Remarks ?? viewingPO.remarks}
                  </p>
                </div>
              )}
            </div>
            )}

            {viewingTab === "supplier" && (
              <div className="p-5 space-y-5">
                {/* Dispatch status */}
                <div>
                  <p className="text-[0.625rem] uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Truck size={10} className="text-foreground" /> Dispatch Status
                  </p>
                  {viewingPO.SupplierAcknowledged ? (
                    <div className="border border-foreground/40 bg-card p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={15} className="text-foreground" />
                        <span className="text-sm font-semibold text-foreground">Supplier marked this as supplied</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
                        <div>
                          <p className="text-[0.625rem] text-muted-foreground uppercase tracking-wide">Supplied Date</p>
                          <p className="text-sm font-medium text-foreground mt-0.5">
                            {viewingPO.SuppliedDate ? new Date(viewingPO.SuppliedDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[0.625rem] text-muted-foreground uppercase tracking-wide">Challan Number</p>
                          <p className="text-sm font-medium text-foreground mt-0.5 font-heading">
                            {viewingPO.ChallanNumber || <span className="text-muted-foreground/60 font-sans italic">Not provided</span>}
                          </p>
                        </div>
                        {viewingPO.ExpectedDeliveryDate && viewingPO.SuppliedDate && (() => {
                          const e = new Date(viewingPO.ExpectedDeliveryDate); e.setHours(0, 0, 0, 0);
                          const s = new Date(viewingPO.SuppliedDate); s.setHours(0, 0, 0, 0);
                          const delta = Math.round((e.getTime() - s.getTime()) / 86_400_000);
                          return (
                            <div>
                              <p className="text-[0.625rem] text-muted-foreground uppercase tracking-wide">Vs. Expected</p>
                              <p className={`text-sm font-medium mt-0.5 ${delta >= 0 ? "text-foreground" : "text-foreground"}`}>
                                {delta === 0 ? "On time" : delta > 0 ? `${delta}d early` : `${Math.abs(delta)}d late`}
                              </p>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  ) : (
                    <div className="border border-dashed border-foreground/30 bg-card p-4 text-center">
                      <p className="text-xs text-muted-foreground">Not yet marked as supplied by the supplier.</p>
                    </div>
                  )}
                </div>

                {/* Chat log */}
                <div>
                  <p className="text-[0.625rem] uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                    <MessageCircle size={10} className="text-foreground" /> Conversation
                  </p>
                  <div className="border border-foreground/30 overflow-hidden h-[420px] flex flex-col">
                    {currentUser && (
                      <OrderChat
                        poId={viewingPO.PurchaseOrderID ?? Number(viewingPO._id)}
                        apiBase="/api/purchase-orders"
                        currentUser={{ id: Number(currentUser.id), name: currentUser.name, role: currentUser.role }}
                        className="flex-1 border-0"
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div></BodyPortal>
      )}
    </>
  );
}
