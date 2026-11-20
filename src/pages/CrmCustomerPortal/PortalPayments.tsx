import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Clock, CreditCard, FileText, Eye, Download, Receipt, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { API, authHeaders, fmtMoney, fmtDate, fetchInvoices, fetchCreditNotes, creditNotesSeenKey, writeSeen, downloadReceiptPdf, moneyFigures } from "./portalApi";
import {
  GOLD, GOLD_SOFT, HAIRLINE, TEXT, TEXT_FAINT, TEXT_MUTED, SURFACE_ALT, INK, VIOLET, serif, mono,
  HeroStrip, HeroStatCard, PulseBar, UrgencyBanner,
  PortalDialogContent as DialogContent, PortalDialogTitle as DialogTitle, PortalDialogDescription as DialogDescription,
} from "./portalTheme";

type Ctx = { me: any; timeline: any; money: any; applicationId: number; applications: any[] };

// Same blob-preview pattern PortalAgreement.tsx already uses for agreement
// documents — the portal's Bearer-token auth means a plain <a href> can't
// carry the Authorization header, so the PDF has to be fetched as a blob
// first and turned into an object URL for both the iframe preview and the
// download link.
function InvoicePdfDialog({ invoice, applicationId, onClose }: { invoice: any; applicationId: number; onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    fetch(`${API}/invoices/${invoice.Id}/pdf?applicationId=${applicationId}`, { headers: authHeaders() })
      .then((r) => r.blob())
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setBlobUrl(objectUrl); })
      .catch(() => setBlobUrl(null));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [invoice.Id, applicationId]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <div>
              <DialogTitle>{invoice.InvoiceNo}</DialogTitle>
              <DialogDescription>{invoice.InvoiceType} · {fmtMoney(invoice.Amount)}</DialogDescription>
            </div>
            {blobUrl && (
              <a href={blobUrl} download={`${invoice.InvoiceNo}.pdf`}
                style={{ background: GOLD }}
                className="shrink-0 px-3 py-1.5 text-sm text-white rounded-lg font-medium flex items-center gap-1.5 hover:opacity-90">
                <Download size={14} /> Download PDF
              </a>
            )}
          </div>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[300px] rounded-lg overflow-hidden" style={{ background: SURFACE_ALT }}>
          {!blobUrl ? <span className="text-sm" style={{ color: TEXT_FAINT }}>Loading preview…</span>
            : <iframe src={blobUrl} title={invoice.InvoiceNo} className="w-full h-[60vh] border-0" />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Milestone card with premium styling ──────────────────────────────────────
function MilestoneCard({ m, today }: { m: any; today: Date }) {
  // Paid = settled, or covered by verified money held On Account (server money stage) — Status alone stays "Pending".
  const isPaid = !!m.Covered;
  const isOverdue = !isPaid && !m.Verifying && m.DueDate && new Date(m.DueDate) < today;
  // Part paid counts money held for it too (Outstanding below the amount due), not only money settled on it.
  const partialPaid = !isPaid && Number(m.Outstanding) < Number(m.AmountDue);

  const railColor = isPaid ? "#059669" : isOverdue ? "#DC2626" : GOLD;
  const bgColor = isPaid ? "rgba(5,150,105,0.04)" : isOverdue ? "rgba(220,38,38,0.04)" : "transparent";

  return (
    <div
      className="relative flex items-start gap-4 px-5 py-4 border-b last:border-0"
      style={{ borderColor: HAIRLINE, background: bgColor }}
    >
      {/* Left status rail */}
      <div
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full"
        style={{ background: railColor, opacity: isPaid ? 1 : isOverdue ? 1 : 0.5 }}
      />

      {/* Status icon */}
      <div
        className="mt-0.5 w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{
          background: isPaid ? "rgba(5,150,105,0.10)" : isOverdue ? "rgba(220,38,38,0.10)" : "rgba(201,162,39,0.10)",
          color: isPaid ? "#059669" : isOverdue ? "#DC2626" : GOLD,
        }}
      >
        {isPaid ? <CheckCircle2 size={18} /> : isOverdue ? <Clock size={18} /> : <Circle size={18} />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: TEXT }}>{m.MilestoneName}</p>
            <p className="text-[0.6875rem] mt-0.5" style={{ color: TEXT_FAINT }}>
              {m.DueDate ? (isOverdue ? `Was due ${fmtDate(m.DueDate)}` : `Due ${fmtDate(m.DueDate)}`) : "Due date to be set"}
            </p>
            {partialPaid && (
              <div className="mt-2">
                <div className="flex justify-between items-center mb-1">
                  <p className="text-[0.6875rem]" style={{ color: TEXT_MUTED }}>{fmtMoney(m.AmountPaid)} received</p>
                  <p className="text-[0.6875rem]" style={{ color: TEXT_FAINT }}>
                    {Math.round((m.AmountPaid / m.AmountDue) * 100)}%
                  </p>
                </div>
                <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: HAIRLINE }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.min(100, (m.AmountPaid / m.AmountDue) * 100)}%`, background: GOLD }}
                  />
                </div>
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-base font-bold tabular-nums" style={{ ...serif, color: TEXT }}>{fmtMoney(m.AmountDue)}</p>
            <span
              className="text-[0.625rem] font-semibold px-2 py-0.5 rounded-full inline-block mt-1"
              style={{
                background: isPaid ? "rgba(5,150,105,0.12)" : isOverdue ? "rgba(220,38,38,0.12)" : "rgba(201,162,39,0.12)",
                color: isPaid ? "#059669" : isOverdue ? "#DC2626" : "#8A6D14",
              }}
            >
              {isPaid ? "Paid" : isOverdue ? "Overdue" : "Pending"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const PortalPayments: React.FC = () => {
  const { timeline, money, applicationId, me } = useOutletContext<Ctx>();
  const milestones = timeline.paymentMilestones || [];
  const { data: invoices = [] } = useQuery({ queryKey: ["portal-invoices", applicationId], queryFn: () => fetchInvoices(applicationId), staleTime: 30_000 });
  const [previewInvoice, setPreviewInvoice] = useState<any | null>(null);
  const [downloadingReceiptId, setDownloadingReceiptId] = useState<number | null>(null);
  const [openPay, setOpenPay] = useState<number | null>(null);

  const handleDownloadReceipt = async (receiptId: number) => {
    try {
      setDownloadingReceiptId(receiptId);
      const blob = await downloadReceiptPdf(receiptId, applicationId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (err) {
      console.error("Could not download receipt:", err);
    } finally {
      setDownloadingReceiptId(null);
    }
  };

  if (!milestones.length) {
    return (
      <div>
        <HeroStrip eyebrow="Finance" title="Payments" subtitle="Your full payment schedule will appear here once your booking is confirmed." />
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(201,162,39,0.10)" }}>
            <CreditCard size={28} style={{ color: GOLD }} />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold" style={{ color: TEXT }}>No payment schedule yet</p>
            <p className="text-sm mt-1 max-w-xs" style={{ color: TEXT_MUTED }}>
              Once your booking is confirmed, your milestone-wise payment plan will appear here automatically.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Every headline figure from the money statement — the same as Overview, Profile and the mobile app.
  const { total: totalDue, paid: totalPaid, pct: pctPaid, balance: remaining, verifying, overPrice, price, closed } = moneyFigures(money);
  const today = new Date(new Date().toDateString());
  const overdueCount = milestones.filter((m: any) => !m.Covered && !m.Verifying && m.DueDate && new Date(m.DueDate) < today).length;
  const nextDue = milestones.find((m: any) => !m.Covered && !m.Verifying && Number(m.Outstanding) > 0);

  return (
    <div className="space-y-5">
      {/* Premium hero strip with inline stats */}
      <HeroStrip
        eyebrow="Finance"
        title="Payments"
        subtitle="Your milestone-by-milestone payment plan"
        gradient={overdueCount > 0 ? "red" : "violet"}
      >
        <div className="grid grid-cols-3 gap-3">
          <HeroStatCard label={closed ? "You paid in total" : "Paid so far"} value={fmtMoney(totalPaid)} highlight />
          <HeroStatCard label="Remaining" value={fmtMoney(remaining)} />
          <HeroStatCard label="Payment plan" value={fmtMoney(totalDue)} />
        </div>
      </HeroStrip>

      {/* Overdue alert */}
      {overdueCount > 0 && (
        <UrgencyBanner
          icon={Clock}
          title={`${overdueCount} payment${overdueCount > 1 ? "s are" : " is"} overdue`}
          sub="Please contact our team to discuss your payment plan."
          level="error"
        />
      )}

      {/* Progress card */}
      <div
        className="rounded-2xl p-5"
        style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} style={{ color: GOLD }} />
            <span className="text-sm font-semibold" style={{ color: TEXT }}>Overall progress</span>
          </div>
          <span className="text-2xl font-bold tabular-nums" style={{ ...serif, color: pctPaid >= 100 ? "#059669" : GOLD }}>
            {pctPaid}%
          </span>
        </div>
        <PulseBar pct={pctPaid} height={12} />
        <div className="flex justify-between mt-2 text-[0.6875rem]" style={{ color: TEXT_FAINT }}>
          <span>{fmtMoney(totalPaid)} paid</span>
          <span>{fmtMoney(remaining)} remaining</span>
        </div>
        {verifying > 0 && !closed && (
          <p className="mt-2 text-xs" style={{ color: GOLD }}>{fmtMoney(verifying)} more is being verified. It will count once confirmed.</p>
        )}
        {overPrice > 0 && (
          <p className="mt-2 text-xs" style={{ color: TEXT_MUTED }}>
            You have paid {fmtMoney(overPrice)} more than your total price of {fmtMoney(price)}. Please contact us about refunding or adjusting the difference.
          </p>
        )}
        {nextDue && (
          <div
            className="mt-4 pt-4 flex items-center justify-between gap-3"
            style={{ borderTop: `1px solid ${HAIRLINE}` }}
          >
            <div>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-wide" style={{ color: GOLD }}>Next payment due</p>
              <p className="text-sm font-semibold mt-0.5" style={{ color: TEXT }}>{nextDue.MilestoneName}</p>
              {nextDue.DueDate && <p className="text-xs" style={{ color: TEXT_MUTED }}>Due {fmtDate(nextDue.DueDate)}</p>}
            </div>
            <p className="text-xl font-bold tabular-nums shrink-0" style={{ ...serif, color: TEXT }}>{fmtMoney(nextDue.Outstanding)}</p>
          </div>
        )}
      </div>

      {/* Milestone schedule */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
      >
        <div
          className="flex items-center gap-3 px-5 py-4"
          style={{ borderBottom: `1px solid ${HAIRLINE}` }}
        >
          <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(201,162,39,0.10)", color: GOLD }}>
            <CreditCard size={14} />
          </span>
          <h2 className="text-sm font-semibold" style={{ ...serif, color: TEXT }}>Milestone Schedule</h2>
          <span className="ml-auto text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(201,162,39,0.10)", color: "#8A6D14" }}>
            {milestones.filter((m: any) => m.Covered).length} / {milestones.length} paid
          </span>
        </div>
        {milestones.map((m: any) => (
          <MilestoneCard key={m.MilestoneNo} m={m} today={today} />
        ))}
      </div>

      {/* Invoices */}
      {(invoices as any[]).length > 0 && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
        >
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
            <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(201,162,39,0.10)", color: GOLD }}>
              <FileText size={14} />
            </span>
            <h2 className="text-sm font-semibold" style={{ ...serif, color: TEXT }}>Invoices</h2>
          </div>
          {(invoices as any[]).map((inv: any) => (
            <div key={inv.Id} className="flex items-center justify-between gap-3 px-5 py-4 border-b last:border-0" style={{ borderColor: HAIRLINE }}>
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: TEXT }}>{inv.InvoiceNo}</p>
                <p className="text-[0.6875rem]" style={{ color: TEXT_FAINT }}>
                  {inv.InvoiceType} · {fmtDate(inv.InvoiceDate)}{inv.Description ? ` · ${inv.Description}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <p className="text-sm font-bold" style={{ color: TEXT }}>{fmtMoney(inv.Amount)}</p>
                <button
                  data-row-view
                  onClick={() => setPreviewInvoice(inv)}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80"
                  style={{ background: "rgba(201,162,39,0.10)", color: "#8A6D14" }}
                >
                  <Eye size={13} /> View
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Every payment the customer made — from the money statement, with how they paid and where it stands */}
      {(money?.payments || []).length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}>
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
            <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(5,150,105,0.10)", color: "#059669" }}>
              <Receipt size={14} />
            </span>
            <h2 className="text-sm font-semibold" style={{ ...serif, color: TEXT }}>Every payment you've made</h2>
          </div>
          {[...(money.payments as any[])].reverse().map((p: any, i: number) => {
            const shown = openPay === i;
            const faint = p.stage === "bounced" || p.stage === "returned";
            return (
              <div key={i} className="border-b last:border-0" style={{ borderColor: HAIRLINE }}>
                <button type="button" onClick={() => setOpenPay(shown ? null : i)} className="w-full text-left flex items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold tabular-nums" style={{ ...serif, color: faint ? TEXT_FAINT : TEXT }}>{fmtMoney(p.amount)}</p>
                      <span className="text-[0.625rem] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: GOLD_SOFT, color: TEXT_MUTED }}>{p.status.label}</span>
                    </div>
                    <p className="text-[0.6875rem] mt-0.5" style={{ color: TEXT_FAINT }}>
                      {[p.date ? fmtDate(p.date) : null, p.mode, p.milestone ? `for ${p.milestone}` : null].filter(Boolean).join(" · ")}
                    </p>
                    {p.status.sub && <p className="text-[0.6875rem]" style={{ color: TEXT_MUTED }}>{p.status.sub}</p>}
                  </div>
                  {shown ? <ChevronUp size={15} style={{ color: TEXT_FAINT }} /> : <ChevronDown size={15} style={{ color: TEXT_FAINT }} />}
                </button>
                {shown && (
                  <div className="px-5 pb-4 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 rounded-xl p-3" style={{ background: "var(--portal-surface-alt)" }}>
                      {p.details.map((d: any) => (
                        <div key={d.label}>
                          <p className="text-[0.625rem] uppercase tracking-wide" style={{ color: TEXT_FAINT }}>{d.label}</p>
                          <p className="text-sm" style={{ color: TEXT }}>{d.value}</p>
                        </div>
                      ))}
                    </div>
                    {p.receiptId ? (
                      <button type="button" disabled={downloadingReceiptId === p.receiptId} onClick={() => handleDownloadReceipt(p.receiptId)}
                        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80 disabled:opacity-40"
                        style={{ background: "rgba(5,150,105,0.10)", color: "#065F46" }}>
                        <Download size={13} /> {downloadingReceiptId === p.receiptId ? "Opening…" : `Download receipt ${p.receiptNo}`}
                      </button>
                    ) : p.receiptNo ? <p className="text-xs" style={{ color: TEXT_MUTED }}>The receipt can be downloaded here once our accounts team approves it.</p> : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <RefundDocuments customerId={me?.Id} />

      {previewInvoice && (
        <InvoicePdfDialog invoice={previewInvoice} applicationId={applicationId} onClose={() => setPreviewInvoice(null)} />
      )}
    </div>
  );
};

/** Refund vouchers / credit notes for money given back to this customer (all their bookings). */
function RefundDocuments({ customerId }: { customerId: any }) {
  const { data: notes = [] } = useQuery<any[]>({ queryKey: ["portal-gst-notes"], queryFn: fetchCreditNotes });
  // Seen here: the "new credit note" badge on Payments clears.
  useEffect(() => {
    if (notes.length && customerId != null) writeSeen(creditNotesSeenKey(customerId), Math.max(...notes.map((n: any) => Number(n.Id))));
  }, [notes, customerId]);
  if (!notes.length) return null;
  const open = async (id: number) => {
    const r = await fetch(`${API}/gst-notes/${id}/pdf`, { headers: authHeaders() });
    if (r.ok) window.open(URL.createObjectURL(await r.blob()), "_blank");
  };
  const label = (n: any) => (n.Status === "TimeBarred" ? "GST paid certificate" : n.DocType === "CreditNote" ? "Credit note" : "Credit note (refund voucher)");
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
    >
      <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(201,162,39,0.10)", color: GOLD }}>
          <FileText size={14} />
        </span>
        <h2 className="text-sm font-semibold" style={{ ...serif, color: TEXT }}>Credit Notes</h2>
      </div>
      <p className="px-5 pt-3 pb-1 text-xs" style={{ color: TEXT_MUTED }}>
        Your credit notes for money we've returned — keep them for your records and tax filings.
      </p>
      {notes.map((n) => (
        <div key={n.Id} className="flex items-center gap-3 px-5 py-3.5 border-t" style={{ borderColor: HAIRLINE }}>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium" style={{ color: TEXT }}>
              {label(n)} {n.DocNo ? <span style={{ color: TEXT_MUTED }}>· {n.DocNo}</span> : null}
            </div>
            <div className="text-xs mt-0.5" style={{ color: TEXT_FAINT }}>
              {n.Property} · {fmtDate(n.DocDate)} · refund {n.RefundNo}
            </div>
          </div>
          <div className="text-sm font-bold tabular-nums shrink-0" style={{ color: TEXT }}>{fmtMoney(n.TotalAmount)}</div>
          <button
            onClick={() => open(n.Id)}
            className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-opacity hover:opacity-80"
            style={{ background: "rgba(201,162,39,0.10)", color: "#8A6D14" }}
          >
            <Download size={13} /> PDF
          </button>
        </div>
      ))}
    </div>
  );
}

export default PortalPayments;
