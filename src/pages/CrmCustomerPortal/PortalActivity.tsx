import React, { useMemo, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, CreditCard, FolderCheck, LifeBuoy, Radio, ArrowRight, AlertTriangle, ChevronRight } from "lucide-react";
import { fetchActivity, fetchAgreement, fetchAgreementDocuments, fmtMoney, fmtDate, fmtDateTime } from "./portalApi";
import { PageHeader, Card, GOLD, GOLD_SOFT, INK, HAIRLINE, TEXT, TEXT_MUTED, TEXT_FAINT, SURFACE_ALT, serif } from "./portalTheme";

type Ctx = { me: any; timeline: any; applicationId: number; applications: any[] };

const TYPE_META: Record<string, { icon: any; label: string; to: string }> = {
  agreement: { icon: FileText, label: "Agreement", to: "/crm-client-portal/agreement" },
  payment: { icon: CreditCard, label: "Payment", to: "/crm-client-portal/payments" },
  document: { icon: FolderCheck, label: "Document", to: "/crm-client-portal/agreement" },
  ticket: { icon: LifeBuoy, label: "Support", to: "/crm-client-portal/tickets" },
};

const FILTERS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "agreement", label: "Agreement" },
  { key: "payment", label: "Payments" },
  { key: "document", label: "Documents" },
  { key: "ticket", label: "Support" },
];

// A single chronological trail of everything that's actually happened —
// agreement approvals, dates proposed/confirmed, payments received,
// documents reviewed, tickets raised/resolved — pulled from the same real
// tables the staff side writes to (CrmAgreementApprovalLog, CrmPaymentReceipt,
// CrmAgreementDocument, CrmServiceTicket), not a separate notification
// system that could drift out of sync with what actually happened.
//
// Plus a "Needs Your Action" section up top: this page is titled "Updates &
// Approvals", and a history log with nothing to actually approve from it
// isn't what that name promises — so anything genuinely awaiting the
// customer's own action surfaces here first, with a direct link to where
// they take it (the real approve/respond/upload UI already lives on the
// Agreement/Payments pages — this doesn't duplicate that, it routes to it).
const PortalActivity: React.FC = () => {
  const { timeline, applicationId } = useOutletContext<Ctx>();
  const navigate = useNavigate();
  const { data: feed = [], isLoading } = useQuery({ queryKey: ["portal-activity", applicationId], queryFn: () => fetchActivity(applicationId), staleTime: 30_000 });
  const { data: agreement } = useQuery({ queryKey: ["portal-agreement", applicationId], queryFn: () => fetchAgreement(applicationId) });
  const { data: documents = [] } = useQuery({ queryKey: ["portal-agreement-documents", applicationId], queryFn: () => fetchAgreementDocuments(applicationId) });
  const [filter, setFilter] = useState("");

  const filtered = useMemo(
    () => (filter ? (feed as any[]).filter((e) => e.type === filter) : feed) as any[],
    [feed, filter]
  );

  const needsAction: { icon: any; label: string; sub: string; to: string }[] = [];
  if (agreement?.SentToCustomerAt && agreement?.CustomerApprovalStatus === "Pending") {
    needsAction.push({ icon: FileText, label: "Your agreement is waiting for your review", sub: `${agreement.AgreementNo} — approve or request a recheck`, to: "/crm-client-portal/agreement" });
  }
  const mandatoryDocs = (documents as any[]).filter((d) => (d.Status === "Requested" || d.Status === "Rejected") && d.IsMandatory);
  if (mandatoryDocs.length > 0) {
    needsAction.push({ icon: FolderCheck, label: `${mandatoryDocs.length} required document${mandatoryDocs.length > 1 ? "s" : ""} needed`, sub: mandatoryDocs.map((d) => d.Label || d.DocumentType).join(", "), to: "/crm-client-portal/agreement" });
  }
  if (agreement?.CustomerApprovalStatus === "Approved" && !agreement?.AgreementDate && agreement?.DateApprovalStatus !== "Pending") {
    needsAction.push({ icon: FileText, label: "Propose an agreement date", sub: agreement?.ProposedDateByCompany ? `We proposed ${fmtDate(agreement.ProposedDateByCompany)}` : "Suggest a date that works for you", to: "/crm-client-portal/agreement" });
  }
  if (timeline?.salesDeed?.SentToCustomerAt && timeline?.salesDeed?.CustomerApprovalStatus === "Pending") {
    needsAction.push({ icon: FileText, label: "Your sales deed is waiting for your review", sub: "Approve or request a recheck", to: "/crm-client-portal/agreement" });
  }
  const nextDue = (timeline?.paymentMilestones || []).find((m: any) => m.Status === "Pending");
  if (nextDue) {
    needsAction.push({ icon: CreditCard, label: `${nextDue.MilestoneName} payment is due`, sub: `${fmtMoney(nextDue.AmountDue)}${nextDue.DueDate ? ` · Due ${fmtDate(nextDue.DueDate)}` : ""}`, to: "/crm-client-portal/payments" });
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Account" title="Updates & Approvals" subtitle="A running log of everything that's happened on your application — agreement approvals, dates, payments, documents, and support." />

      {needsAction.length > 0 && (
        <Card className="p-4 space-y-2" style={{ background: GOLD_SOFT, borderColor: "#E8C766" }}>
          <h2 className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "#8A6D14" }}>
            <AlertTriangle size={13} /> Needs Your Action
          </h2>
          {needsAction.map((a, i) => (
            <button key={i} onClick={() => navigate(a.to)}
              className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left hover:shadow-sm transition-shadow" style={{ background: "#fff", border: "1px solid #E8E1D3" }}>
              <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: GOLD_SOFT, color: GOLD }}>
                <a.icon size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold" style={{ color: INK }}>{a.label}</p>
                <p className="text-xs mt-0.5 truncate" style={{ color: "#8A6D14" }}>{a.sub}</p>
              </div>
              <ArrowRight size={16} className="shrink-0" style={{ color: GOLD }} />
            </button>
          ))}
        </Card>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className="px-3 py-1.5 text-xs font-semibold rounded-full transition-colors"
            style={filter === f.key ? { background: INK, color: "#fff" } : { background: GOLD_SOFT, color: "#8A6D14" }}>
            {f.label}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: TEXT_FAINT }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <div className="w-11 h-11 mx-auto rounded-full flex items-center justify-center mb-3" style={{ background: GOLD_SOFT, color: GOLD }}>
              <Radio size={20} />
            </div>
            <p className="text-sm font-medium" style={{ color: TEXT }}>Nothing here yet</p>
            <p className="text-xs mt-1" style={{ color: TEXT_MUTED }}>Updates will show up here the moment something happens on your application.</p>
          </div>
        ) : (
          <div>
            {filtered.map((e: any, i: number) => {
              const meta = TYPE_META[e.type] || TYPE_META.agreement;
              const Icon = meta.icon;
              return (
                <button key={i} onClick={() => navigate(meta.to)}
                  className="w-full flex items-start gap-3 px-5 py-3.5 border-b last:border-0 text-left hover:bg-black/[0.02] transition-colors"
                  style={{ borderColor: HAIRLINE }}>
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: SURFACE_ALT, color: GOLD }}>
                    <Icon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium" style={{ ...serif, color: TEXT }}>{e.title}</p>
                    {e.detail && <p className="text-[12px] mt-0.5" style={{ color: TEXT_MUTED }}>{e.detail}</p>}
                    <p className="text-[11px] mt-1" style={{ color: TEXT_FAINT }}>{fmtDateTime(e.at)}</p>
                  </div>
                  <ChevronRight size={15} className="shrink-0 mt-1" style={{ color: TEXT_FAINT }} />
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};

export default PortalActivity;
