import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, AlertCircle, CheckCircle2, X, Building2, FileText, BookOpen } from "lucide-react";
import { getInterCompanyTransfer, getInterCompanyTransferPosting, getIctFaCodes } from "@/api/interCompanyTransferApi";
import { fmtNum, fmtRate, fmtDate } from "./config";

export function ICTPreviewModal({
  ictId,
  onClose,
}: {
  ictId: number;
  onClose: () => void;
}) {
  const { data: detail, isLoading, isError } = useQuery({
    queryKey: ["inter-company-transfer", ictId],
    queryFn: () => getInterCompanyTransfer(ictId),
    retry: 1,
  });

  const { data: faCodes = [] } = useQuery({
    queryKey: ["inter-company-transfer-fa-codes", ictId, detail?.Status],
    queryFn: () => getIctFaCodes(ictId),
    enabled: !!detail,
  });

  const [tab, setTab] = useState<"details" | "posting">("details");
  const { data: posting, isLoading: postingLoading } = useQuery({
    queryKey: ["inter-company-transfer-posting", ictId],
    queryFn: () => getInterCompanyTransferPosting(ictId),
    enabled: tab === "posting",
  });

  const DOC_LINKS = detail
    ? [
        { label: "Sale Order", id: detail.SaleOrderId },
        { label: "Sale Invoice", id: detail.SaleInvoiceId },
        { label: "Received Payment", id: detail.ReceivedPaymentId },
        { label: "Purchase Order", id: detail.PurchaseOrderId },
        { label: "GRN", id: detail.GRNId },
        { label: "Expense Booking", id: detail.ExpenseBookingId },
        { label: "Payment Made", id: detail.NewPaymentId },
      ]
    : [];

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-muted">
              <Building2 size={16} className="text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {detail?.DocNo || "Inter-Company Transfer"}
              </p>
              <p className="text-xs text-muted-foreground">
                {detail ? fmtDate(detail.TransferDate) : ""} · by{" "}
                {detail?.CreatedBy?.split("@")[0] || "—"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {!isLoading && !isError && detail && (
          <div className="flex items-center gap-1 px-5 pt-3 border-b border-border">
            {(["details", "posting"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs font-semibold border-b-2 -mb-px transition-colors capitalize ${
                  tab === t
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "posting" ? "Posting" : "Details"}
              </button>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="px-5 py-10 text-center text-xs text-muted-foreground">
            Loading…
          </div>
        ) : isError || !detail ? (
          <div className="px-5 py-10 text-center text-xs text-destructive">
            Could not load transfer details. Please try again or open the full record.
          </div>
        ) : tab === "details" ? (
          <>
            <div className="px-5 pt-4 flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-500/10 text-orange-600 border border-orange-400/20">
                <Building2 size={10} /> {detail.SenderProjectName} ({detail.SenderCompanyName})
              </span>
              <ArrowRight size={12} className="text-muted-foreground shrink-0" />
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-400/20">
                <Building2 size={10} /> {detail.ReceiverProjectName} ({detail.ReceiverCompanyName})
              </span>
            </div>


            <div className="px-5 pt-3 pb-2">
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                Items ({detail.items.length}) — priced at the sender's last purchase rate
              </p>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 border-b border-border">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Item</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Qty</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Rate</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Excl. GST</th>
                      <th className="px-3 py-2 text-right font-medium text-amber-600 dark:text-amber-400">GST</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Incl. GST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item) => {
                      const gstPct = item.GstPct ?? 0;
                      const gstAmt = item.GstAmount ?? 0;
                      const inclAmt = item.AmountInclGst ?? item.Amount;
                      return (
                        <tr key={item.ICTItemId} className="border-b border-border last:border-0 hover:bg-muted/20">
                          <td className="px-3 py-2 text-foreground">{item.ItemName || item.ItemId}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmtNum(item.Quantity)}</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmtRate(item.Rate)}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmtNum(item.Amount)}</td>
                          <td className="px-3 py-2 text-right font-mono text-amber-600 dark:text-amber-400">
                            {gstPct > 0 ? `${gstPct}% = ${fmtNum(gstAmt)}` : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold">{fmtNum(inclAmt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-muted/30 border-t border-border">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-right text-muted-foreground font-medium">Total</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtNum(detail.TotalAmount)}</td>
                      <td className="px-3 py-2 text-right font-mono text-amber-600 dark:text-amber-400">
                        {(detail.TotalGstAmount ?? 0) > 0 ? `+${fmtNum(detail.TotalGstAmount!)}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-foreground">
                        {fmtNum(detail.TotalAmountInclGst ?? detail.TotalAmount)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {faCodes.length > 0 && (
              <div className="px-5 pb-4">
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                  Fixed Asset codes
                </p>
                <div className="rounded-lg border border-border overflow-hidden text-xs">
                  {faCodes.map((c) => (
                    <div key={c.ICTAssetId} className="flex items-center justify-between gap-3 px-3 py-1.5 border-b border-border/60 last:border-0">
                      <span className="font-mono text-muted-foreground">{c.FAItemCode}</span>
                      {c.TransferredToCode ? (
                        <span className="font-mono text-teal-700 dark:text-teal-300">→ {c.TransferredToCode}</span>
                      ) : c.TagStatus === "Transferred" ? (
                        <span className="text-amber-600 dark:text-amber-400">Transferred — awaiting new code</span>
                      ) : (
                        <span className="text-muted-foreground/70 italic">reserved — moves on approval</span>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[0.625rem] text-muted-foreground/80 mt-1">
                  On approval the old code becomes Not Available / Transferred (no further depreciation or posting); the receiving company gets a fresh entry with a new FA Code and sets up its own depreciation.
                </p>
              </div>
            )}

            {DOC_LINKS.filter((d) => d.id).length > 0 ? (
              <div className="px-5 pb-4">
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                  Auto-generated documents
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {DOC_LINKS.filter((d) => d.id).map((d) => (
                    <span
                      key={d.label}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.625rem] bg-muted text-muted-foreground border border-border"
                    >
                      <FileText size={9} /> {d.label} #{d.id}
                    </span>
                  ))}
                </div>
              </div>
            ) : detail.Status !== "Completed" && (
              <div className="px-5 pb-4">
                <p className="text-xs text-muted-foreground/70 italic">
                  Documents (Sale Invoice, GRN, Payment, etc.) will appear here once the transfer completes.
                </p>
              </div>
            )}

          </>
        ) : postingLoading || !posting ? (
          <div className="px-5 py-10 text-center text-xs text-muted-foreground">
            Loading posting details…
          </div>
        ) : (
          <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
            <div className="flex items-center gap-2">
              <BookOpen size={13} className="text-primary" />
              <span className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">
                Journal Entry — Inter-Company Transfer Posting
              </span>
            </div>

            {posting.vouchers.map((v, vi) => {
              const totalDebit = v.rows.filter((r) => r.side === "debit").reduce((s, r) => s + r.amount, 0);
              const totalCredit = v.rows.filter((r) => r.side === "credit").reduce((s, r) => s + r.amount, 0);
              return (
                <div key={vi} className="rounded-lg border border-border overflow-hidden">
                  <div className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] bg-muted/40 border-b border-border px-3 py-2 text-[0.5625rem] uppercase tracking-widest text-muted-foreground font-semibold gap-2">
                    <span>
                      {v.companyName ? `${v.companyName} — ` : ""}Account
                      {v.jvNo ? ` · ${v.jvNo}` : ""}
                    </span>
                    <span className="text-right">Debit</span>
                    <span className="text-right">Credit</span>
                  </div>
                  {v.rows.map((row, ri) => (
                    <div key={ri} className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] px-3 py-2 border-b border-border/50 last:border-0 items-center gap-2 text-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${row.side === "debit" ? "bg-emerald-500" : "bg-rose-500"}`} />
                        <span className="text-foreground truncate">{row.label}</span>
                      </div>
                      <span className="text-right font-mono text-emerald-700 dark:text-emerald-400">
                        {row.side === "debit" ? fmtNum(row.amount) : ""}
                      </span>
                      <span className="text-right font-mono text-rose-600 dark:text-rose-400">
                        {row.side === "credit" ? fmtNum(row.amount) : ""}
                      </span>
                    </div>
                  ))}
                  <div className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] px-3 py-2 bg-muted/30 border-t-2 border-border text-xs font-bold gap-2">
                    <span className="uppercase tracking-widest text-muted-foreground text-[0.5625rem]">Total</span>
                    <span className="text-right text-emerald-600 dark:text-emerald-400 font-mono">{fmtNum(totalDebit)}</span>
                    <span className="text-right text-rose-600 dark:text-rose-400 font-mono">{fmtNum(totalCredit)}</span>
                  </div>
                </div>
              );
            })}

            {posting.isPosted ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                <p className="text-[0.6875rem] text-emerald-700 dark:text-emerald-400">
                  Posted to General Ledger. Entries are visible in the Trial Balance.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                <AlertCircle size={12} className="text-muted-foreground shrink-0" />
                <p className="text-[0.6875rem] text-muted-foreground">
                  Not yet posted — this is a preview of what will post once the transfer is approved.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="px-5 py-3 border-t border-border flex justify-end bg-muted/20">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs rounded-lg border border-border hover:bg-muted transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
