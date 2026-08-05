import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Clock, CreditCard, FileText, Eye, Download } from "lucide-react";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { API, authHeaders, fmtMoney, fmtDate, fetchInvoices } from "./portalApi";
import {
  PageHeader, Card, CardHeader, StatusPill, GOLD, HAIRLINE, TEXT, TEXT_FAINT, serif,
  PortalDialogContent as DialogContent, PortalDialogTitle as DialogTitle, PortalDialogDescription as DialogDescription,
} from "./portalTheme";

type Ctx = { me: any; timeline: any; applicationId: number; applications: any[] };

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
        <div className="flex items-center justify-center min-h-[300px] bg-slate-50 rounded-lg overflow-hidden">
          {!blobUrl ? <span className="text-sm text-slate-400">Loading preview…</span>
            : <iframe src={blobUrl} title={invoice.InvoiceNo} className="w-full h-[60vh] border-0" />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const PortalPayments: React.FC = () => {
  const { timeline, applicationId } = useOutletContext<Ctx>();
  const milestones = timeline.paymentMilestones || [];
  const { data: invoices = [] } = useQuery({ queryKey: ["portal-invoices", applicationId], queryFn: () => fetchInvoices(applicationId), staleTime: 30_000 });
  const [previewInvoice, setPreviewInvoice] = useState<any | null>(null);

  if (!milestones.length) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Finance" title="Payments" />
        <Card className="p-8 text-center text-sm text-slate-500">
          Your payment schedule will appear here once your booking is confirmed.
        </Card>
      </div>
    );
  }

  const totalDue = milestones.reduce((s: number, m: any) => s + Number(m.AmountDue || 0), 0);
  const totalPaid = milestones.reduce((s: number, m: any) => s + Number(m.AmountPaid || 0), 0);
  const pctPaid = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0;
  const today = new Date(new Date().toDateString());

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Finance" title="Payments" subtitle="Your full payment schedule, milestone by milestone." />

      <Card className="p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs" style={{ color: TEXT_FAINT }}>Total Paid</span>
          <span className="text-xs font-semibold" style={{ color: TEXT }}>{pctPaid}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pctPaid}%`, background: GOLD }} />
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4 text-center">
          <div>
            <p className="text-lg font-semibold" style={{ ...serif, color: TEXT }}>{fmtMoney(totalPaid)}</p>
            <p className="text-[11px]" style={{ color: TEXT_FAINT }}>Paid</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-amber-600" style={serif}>{fmtMoney(totalDue - totalPaid)}</p>
            <p className="text-[11px]" style={{ color: TEXT_FAINT }}>Remaining</p>
          </div>
          <div>
            <p className="text-lg font-semibold" style={{ ...serif, color: TEXT }}>{fmtMoney(totalDue)}</p>
            <p className="text-[11px]" style={{ color: TEXT_FAINT }}>Total</p>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader icon={CreditCard} title="Milestone Schedule" />
        {milestones.map((m: any) => {
          const isPaid = m.Status === "Paid";
          const isOverdue = !isPaid && m.DueDate && new Date(m.DueDate) < today;
          return (
            <div key={m.MilestoneNo} className="flex items-center gap-3 px-5 py-3.5 border-b last:border-0" style={{ borderColor: HAIRLINE }}>
              {isPaid ? <CheckCircle2 size={18} className="shrink-0" style={{ color: "#0F7A44" }} />
                : isOverdue ? <Clock size={18} className="text-rose-500 shrink-0" />
                : <Circle size={18} className="text-slate-300 shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: TEXT }}>{m.MilestoneName}</p>
                <p className="text-[11px]" style={{ color: TEXT_FAINT }}>{m.DueDate ? `Due ${fmtDate(m.DueDate)}` : "Due date to be set"}</p>
              </div>
              <div className="text-right shrink-0 flex flex-col items-end gap-1">
                <p className="text-sm font-bold" style={{ color: TEXT }}>{fmtMoney(m.AmountDue)}</p>
                {m.AmountPaid > 0 && !isPaid && <p className="text-[10px]" style={{ color: TEXT_FAINT }}>{fmtMoney(m.AmountPaid)} received</p>}
                <StatusPill status={isPaid ? "Paid" : isOverdue ? "Overdue" : "Pending"} />
              </div>
            </div>
          );
        })}
      </Card>

      {invoices.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader icon={FileText} title="Invoices" />
          {invoices.map((inv: any) => (
            <div key={inv.Id} className="flex items-center justify-between gap-3 px-5 py-3.5 border-b last:border-0" style={{ borderColor: HAIRLINE }}>
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: TEXT }}>{inv.InvoiceNo}</p>
                <p className="text-[11px]" style={{ color: TEXT_FAINT }}>{inv.InvoiceType} · {fmtDate(inv.InvoiceDate)}{inv.Description ? ` · ${inv.Description}` : ""}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <p className="text-sm font-bold" style={{ color: TEXT }}>{fmtMoney(inv.Amount)}</p>
                <button onClick={() => setPreviewInvoice(inv)}
                  className="flex items-center gap-1 text-xs font-medium hover:underline" style={{ color: GOLD }}>
                  <Eye size={13} /> View
                </button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {previewInvoice && (
        <InvoicePdfDialog invoice={previewInvoice} applicationId={applicationId} onClose={() => setPreviewInvoice(null)} />
      )}
    </div>
  );
};

export default PortalPayments;
