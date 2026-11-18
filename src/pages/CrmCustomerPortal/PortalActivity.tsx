import React, { useMemo, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, CreditCard, FolderCheck, LifeBuoy, Radio, AlertTriangle, Scale, Home, FileSignature } from "lucide-react";
import { fetchActivity, fetchNeedsYou, fmtDateTime } from "./portalApi";
import {
  HeroStrip, UrgencyBanner, TimelineRow,
  GOLD, GOLD_SOFT, INK, HAIRLINE, TEXT, TEXT_MUTED, TEXT_FAINT, serif,
} from "./portalTheme";

type Ctx = { me: any; timeline: any; applicationId: number; applications: any[] };

const TYPE_META: Record<string, { icon: any; label: string; to: string; type: "agreement" | "payment" | "document" | "ticket" | "default" }> = {
  agreement: { icon: FileText, label: "Agreement", to: "/crm-client-portal/agreement", type: "agreement" },
  legal: { icon: Scale, label: "Legal & Registration", to: "/crm-client-portal/agreement", type: "agreement" },
  payment: { icon: CreditCard, label: "Payment", to: "/crm-client-portal/payments", type: "payment" },
  document: { icon: FolderCheck, label: "Document", to: "/crm-client-portal/agreement", type: "document" },
  ticket: { icon: LifeBuoy, label: "Support", to: "/crm-client-portal/tickets", type: "ticket" },
};

// Where each kind of waiting item is acted on, and its icon. The items themselves (and their wording) come from the
// server's one rule set — GET /needs-you — the same list the mobile app shows.
const NEEDS_TARGET: Record<string, string> = {
  documents: "/crm-client-portal/agreement", payments: "/crm-client-portal/payments",
  construction: "/crm-client-portal/construction", transferDeed: "/crm-client-portal/transfer-deed",
};
const NEEDS_ICON: Record<string, any> = {
  agreementReview: FileText, documentsNeeded: FolderCheck, agreementDate: FileText, salesDeedReview: FileText,
  govtPaymentProof: Scale, possessionNotice: Home, transferDeed: FileSignature, paymentDue: CreditCard,
};

const FILTERS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "agreement", label: "Agreement" },
  { key: "legal", label: "Legal" },
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
  const { applicationId } = useOutletContext<Ctx>();
  const navigate = useNavigate();
  const { data: feed = [], isLoading } = useQuery({ queryKey: ["portal-activity", applicationId], queryFn: () => fetchActivity(applicationId), staleTime: 30_000 });
  const { data: needs = [] } = useQuery({ queryKey: ["portal-needs-you", applicationId], queryFn: () => fetchNeedsYou(applicationId) });
  const [filter, setFilter] = useState("");

  const filtered = useMemo(
    () => (filter ? (feed as any[]).filter((e) => e.type === filter) : feed) as any[],
    [feed, filter]
  );

  const needsAction = (needs as any[]).map((x) => ({
    icon: NEEDS_ICON[x.kind] || AlertTriangle, label: x.label as string, sub: x.sub as string,
    to: NEEDS_TARGET[x.target] || "/crm-client-portal/activity", level: (x.urgent ? "error" : "warning") as "warning" | "error",
  }));

  return (
    <div className="space-y-5">
      {/* Premium hero */}
      <HeroStrip
        eyebrow="Updates"
        title="Updates & Approvals"
        subtitle="A live log of everything on your application — approvals, payments, documents, and support."
        gradient={needsAction.length > 0 ? "gold" : "violet"}
      >
        {needsAction.length > 0 && (
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl" style={{ background: "rgba(220,38,38,0.20)", border: "1px solid rgba(220,38,38,0.4)" }}>
            <AlertTriangle size={14} style={{ color: "#FCA5A5" }} />
            <span className="text-sm font-semibold text-white">{needsAction.length} action{needsAction.length > 1 ? "s" : ""} need your attention</span>
          </div>
        )}
      </HeroStrip>

      {/* Needs-action cards */}
      {needsAction.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: TEXT_FAINT }}>Needs Your Action</p>
          {needsAction.map((a, i) => (
            <UrgencyBanner
              key={i}
              icon={a.icon}
              title={a.label}
              sub={a.sub}
              cta="Go →"
              onCta={() => navigate(a.to)}
              level={a.level}
            />
          ))}
        </div>
      )}

      {/* Filter pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-full transition-all"
            style={filter === f.key
              ? { background: INK, color: "#fff", boxShadow: "0 2px 8px rgba(30,11,66,0.25)" }
              : { background: GOLD_SOFT, color: "#8A6D14" }
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div
        className="rounded-2xl p-5"
        style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
      >
        {isLoading ? (
          <div className="space-y-6 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-4">
                <div className="w-9 h-9 rounded-xl shrink-0" style={{ background: "var(--portal-surface-alt)" }} />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 rounded-lg" style={{ background: "var(--portal-surface-alt)" }} />
                  <div className="h-3 w-32 rounded-lg" style={{ background: "var(--portal-surface-alt)" }} />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: GOLD_SOFT }}>
              <Radio size={24} style={{ color: GOLD }} />
            </div>
            <div className="text-center">
              <p className="text-base font-semibold" style={{ color: TEXT }}>Nothing here yet</p>
              <p className="text-sm mt-1 max-w-xs" style={{ color: TEXT_MUTED }}>
                Updates will appear here the moment something happens on your application.
              </p>
            </div>
          </div>
        ) : (
          <div>
            {filtered.map((e: any, i: number) => {
              const meta = TYPE_META[e.type] || TYPE_META.agreement;
              const Icon = meta.icon;
              return (
                <TimelineRow
                  key={i}
                  icon={Icon}
                  title={e.title}
                  detail={e.detail}
                  time={fmtDateTime(e.at)}
                  type={meta.type}
                  isLast={i === filtered.length - 1}
                  onClick={() => navigate(meta.to)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Footer note */}
      {!isLoading && filtered.length > 0 && (
        <p className="text-center text-xs" style={{ color: TEXT_FAINT }}>
          Showing {filtered.length} update{filtered.length > 1 ? "s" : ""}
          {filter ? ` in ${FILTERS.find((f) => f.key === filter)?.label}` : ""}.
        </p>
      )}
    </div>
  );
};

export default PortalActivity;
