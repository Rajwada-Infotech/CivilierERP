import { formatINR } from "@/utils/formatCurrency";
import { partnerLineKind } from "@/pages/finance/journalVoucher/ledgerGroups";
import { Package } from "lucide-react";
import type { ApprovalReviewState } from "./useApprovalReview";
import { AttachmentThumb, LinePhotoThumb } from "@/pages/material/vehicleInOut/config";
import type { VehicleAttachment } from "@/api/vehicleInOutApi";

// The record's line items.
export function ReviewLineItems({ r }: { r: ApprovalReviewState }) {
  const { effectiveAmount, lineItems, isMaterialRequest, isVehicleInOut, isJournalVoucher, isInterCompanyTransfer, detail } = r;
  const vioAttachments = isVehicleInOut && Array.isArray((detail as any)?.Attachments) ? ((detail as any).Attachments as VehicleAttachment[]) : [];
  return (
    <>
      {/* Vehicle In/Out: the files and photos attached to the entry. */}
      {vioAttachments.length > 0 && (
        <div>
          <p className="text-[0.625rem] font-semibold font-heading uppercase tracking-[0.12em] text-muted-foreground mb-2">
            Attachments ({vioAttachments.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {vioAttachments.map((a) => <AttachmentThumb key={a.id} attachment={a} />)}
          </div>
        </div>
      )}
      {/* Line items */}
      {lineItems.length > 0 && (
        <div>
          <p className="text-[0.625rem] font-semibold font-heading uppercase tracking-[0.12em] text-muted-foreground mb-2 flex items-center gap-1.5">
            <Package size={10} className="text-muted-foreground" />
            {isJournalVoucher ? "Journal Entry" : `Items (${lineItems.length})`}
          </p>
          {isJournalVoucher ? (
            <div className="border border-foreground/25 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-foreground">
                  <tr>
                    <th className="px-3 py-2 text-[0.5625rem] font-heading uppercase tracking-[0.12em] font-heading text-muted-foreground text-left">Ledger</th>
                    <th className="px-3 py-2 text-[0.5625rem] font-heading uppercase tracking-[0.12em] font-heading text-muted-foreground text-right">Debit (₹)</th>
                    <th className="px-3 py-2 text-[0.5625rem] font-heading uppercase tracking-[0.12em] font-heading text-muted-foreground text-right">Credit (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/10">
                  {lineItems.map((li, i) => {
                    const debit = Number(li.DebitAmount) || 0;
                    const credit = Number(li.CreditAmount) || 0;
                    const kind = partnerLineKind({
                      LHeadType: li.LHeadType as string | undefined,
                      LHeadCode: li.LHeadCode as string | null | undefined,
                    });
                    return (
                      <tr key={i} className="hover:bg-primary/5 transition-colors">
                        <td className="px-3 py-2 font-medium">
                          <span className="flex items-center gap-2">
                            <span className={`font-heading text-[0.5625rem] font-semibold w-5 shrink-0 ${debit > 0 ? "text-foreground" : "text-muted-foreground"}`}>{debit > 0 ? "Dr" : "Cr"}</span>
                            {(li.LHeadName as string) || "—"}
                            {kind && (
                              <span className={`shrink-0 text-[0.5625rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 ${
                                kind === "Investment"
                                  ? "text-foreground border border-foreground/50"
                                  : "text-foreground border border-dashed border-foreground/50"
                              }`}>
                                {kind}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-foreground tabular-nums">
                          {debit > 0 ? formatINR(debit) : ""}
                        </td>
                        <td className="px-3 py-2 text-right text-foreground tabular-nums">
                          {credit > 0 ? formatINR(credit) : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t border-foreground font-semibold">
                  <tr>
                    <td className="px-3 py-2 text-[0.625rem] font-heading uppercase tracking-[0.12em] text-muted-foreground">Total</td>
                    <td className="px-3 py-2 text-right text-foreground tabular-nums">
                      {formatINR(lineItems.reduce((s, li) => s + (Number(li.DebitAmount) || 0), 0))}
                    </td>
                    <td className="px-3 py-2 text-right text-foreground tabular-nums">
                      {formatINR(lineItems.reduce((s, li) => s + (Number(li.CreditAmount) || 0), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : isVehicleInOut ? (
            <div className="border border-foreground/25 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-foreground">
                  <tr>
                    <th className="px-3 py-2 text-[0.5625rem] font-heading uppercase tracking-[0.12em] text-muted-foreground text-left">Item</th>
                    <th className="px-3 py-2 text-[0.5625rem] font-heading uppercase tracking-[0.12em] text-muted-foreground text-left">Quality</th>
                    <th className="px-3 py-2 text-[0.5625rem] font-heading uppercase tracking-[0.12em] text-muted-foreground text-right">Received</th>
                    <th className="px-3 py-2 text-[0.5625rem] font-heading uppercase tracking-[0.12em] text-muted-foreground text-right">Weight</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/10">
                  {lineItems.map((li, i) => {
                    const weight = Number(li.Weight) || 0;
                    return (
                      <tr key={i} className="hover:bg-primary/5 transition-colors">
                        <td className="px-3 py-2 font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            <LinePhotoThumb src={li.PhotoBase64 as string | null} alt={`${(li.ItemName as string) || "Item"} photo`} />
                            <span>
                              {(li.ItemName as string) || "—"}
                              {li.Brand ? <span className="ml-1 font-normal text-muted-foreground">({li.Brand as string})</span> : null}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {li.Quality ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wide border border-foreground/40">{li.Quality as string}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {Number(li.ReceivedQty ?? 0).toLocaleString("en-IN")}{li.UomName ? ` ${li.UomName as string}` : ""}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {weight > 0 ? `${weight.toLocaleString("en-IN")} ${(li.WeightUnit as string) || "kg"}` : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : isMaterialRequest ? (
            <div className="border border-foreground/25 divide-y divide-foreground/10">
              {lineItems.map((li, i) => {
                const name = (li.ItemName ?? li.itemName ?? "—") as string;
                const qty = Number(li.Quantity ?? li.quantity ?? 0);
                const uom = (li.UOMName ?? li.UomName ?? li.UOMSymbol ?? li.UOMCode ?? li.uomCode ?? "") as string;
                return (
                  <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-primary/5 transition-colors">
                    <span className="font-medium text-foreground">{name}</span>
                    <span className="text-muted-foreground shrink-0">
                      {qty.toLocaleString("en-IN")}{uom ? ` ${uom}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="border border-foreground/25 overflow-x-auto">

          <table className="w-full text-xs">
                <thead className="border-b border-foreground">
                  <tr>
                    <th className="px-3 py-2 text-[0.5625rem] font-heading uppercase tracking-[0.12em] font-heading text-muted-foreground text-left">Item</th>
                    <th className="px-3 py-2 text-[0.5625rem] font-heading uppercase tracking-[0.12em] font-heading text-muted-foreground text-right">Qty</th>
                    <th className="px-3 py-2 text-[0.5625rem] font-heading uppercase tracking-[0.12em] font-heading text-muted-foreground text-left">UOM</th>
                    <th className="px-3 py-2 text-[0.5625rem] font-heading uppercase tracking-[0.12em] font-heading text-muted-foreground text-right">Rate</th>
                    <th className="px-3 py-2 text-[0.5625rem] font-heading uppercase tracking-[0.12em] font-heading text-muted-foreground text-right">
                      {isInterCompanyTransfer ? "Amount (Incl. GST)" : "Amount"}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/10">
                  {lineItems.map((li, i) => {
                    const name = (li.ItemName ?? li.itemName ?? li.Description ?? li.itemDescription ?? "—") as string;
                    const qty = Number(li.Quantity ?? li.quantity ?? 0);
                    // Every line-item shape across PO/WO/GRN/etc. spells this
                    // differently — same fallback chain the Material Request
                    // list above uses, so a doc missing one field still shows
                    // whichever of the others it actually carries.
                    const uom = (li.UOMName ?? li.UomName ?? li.uomName ?? li.UOMSymbol ?? li.Symbol ?? li.UOMCode ?? li.uomCode ?? li.Unit ?? li.unit ?? li.uom ?? "") as string;
                    const rate = Number(li.Rate ?? li.rate ?? 0);
                    // Inter-Company Transfer items carry AmountInclGst
                    // separately from their excl-GST Amount — preferring it
                    // here keeps this column's sum in line with the incl-GST
                    // "Total Amount" hero above instead of silently falling
                    // back to qty*rate (excl-GST), which used to make the
                    // two totals on the same screen disagree.
                    const amount = Number(li.LineAmount ?? li.AmountInclGst ?? li.amount ?? qty * rate);
                    return (
                      <tr key={i} className="hover:bg-primary/5 transition-colors">
                        <td className="px-3 py-2 font-medium">{name}</td>
                        <td className="px-3 py-2 text-right">{qty.toLocaleString("en-IN")}</td>
                        <td className="px-3 py-2 text-muted-foreground">{uom || "—"}</td>
                        <td className="px-3 py-2 text-right">{formatINR(rate)}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatINR(amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {isInterCompanyTransfer && lineItems.length > 0 && (
                  <tfoot className="border-t border-foreground font-semibold">
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-[0.625rem] font-heading uppercase tracking-[0.12em] text-muted-foreground text-right">Total (Incl. GST)</td>
                      <td className="px-3 py-2 text-right">{formatINR(effectiveAmount ?? 0)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
