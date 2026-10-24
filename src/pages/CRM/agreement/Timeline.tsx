// The agreement's step bar and its Timeline tab.
import { CrmStatus } from "@/constants/crmStatuses";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Check, ArrowRight, BarChart3 } from "lucide-react";
import { AgrTab, StepState } from "./config";

export function AgreementStepper({ steps, activeTab, onStepClick }: { steps: { label: string; state: StepState; tab: AgrTab }[]; activeTab: AgrTab; onStepClick: (t: AgrTab) => void }) {
  return (
    <div className="flex items-center overflow-x-auto thin-scroll pb-1">
      {steps.map((s, i) => (
        <React.Fragment key={s.label}>
          <button onClick={() => onStepClick(s.tab)}
            className={`flex items-center gap-1.5 shrink-0 px-2 py-1.5 hover:bg-primary/10 transition-colors group ${activeTab === s.tab ? "bg-primary/10" : ""}`}>
            <span className={`w-6 h-6 flex items-center justify-center text-[0.625rem] font-bold shrink-0 border ${
              s.state === "done"
                ? "bg-foreground text-card border-foreground"
                : s.state === "current"
                ? "bg-card text-foreground border-foreground border-2"
                : "bg-card text-muted-foreground border-foreground/25"}`}>
              {s.state === "done" ? <Check size={11} /> : i + 1}
            </span>
            <span className={`text-[0.6875rem] font-semibold whitespace-nowrap leading-tight ${
              s.state === "done" ? "text-foreground"
              : s.state === "current" ? "text-foreground"
              : "text-muted-foreground/60"}`}>
              {s.label}
            </span>
          </button>
          {i < steps.length - 1 && (
            <div className={`w-4 h-px mx-0.5 shrink-0 ${steps[i + 1].state !== "upcoming" ? "bg-foreground" : "bg-foreground/20"}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
export const docStatusColor: Record<string, string> = {
  Pending:   "text-muted-foreground bg-card border-foreground/25 border-dashed",
  Requested: "text-foreground bg-card border-foreground/30",
  Uploaded:  "text-foreground bg-card border-foreground/40",
  Submitted: "text-foreground bg-card border-foreground/40",
  Verified:  "text-card bg-foreground border-foreground",
  Rejected:  "text-destructive bg-destructive/5 border-destructive/40",
};

export type TlState = "done" | "current" | "upcoming" | "blocked";
export function TlRow({ n, title, detailText, state, badge, onJump, last }: {
  n: number; title: string; detailText?: string; state: TlState; badge?: string;
  onJump: () => void; last?: boolean;
}) {
  const ring =
    state === "done" ? "bg-foreground text-card border border-foreground" :
    state === "current" ? "bg-card text-foreground border-2 border-foreground" :
    state === "blocked" ? "bg-muted text-muted-foreground" :
    "bg-muted text-muted-foreground";
  return (
    <button onClick={onJump} className="w-full text-left flex gap-3 group">
      <div className="flex flex-col items-center">
        <span className={`w-7 h-7 flex items-center justify-center text-[0.6875rem] font-bold shrink-0 ${ring}`}>
          {state === "done" ? <Check size={13} /> : n}
        </span>
        {!last && <span className={`w-px flex-1 my-1 ${state === "done" ? "bg-foreground" : "bg-foreground/20"}`} />}
      </div>
      <div className={`flex-1 min-w-0 pb-4 ${last ? "pb-0" : ""}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-semibold ${
            state === "done" ? "text-foreground"
            : state === "current" ? "text-foreground"
            : "text-muted-foreground"}`}>{title}</span>
          {badge && (
            <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border border-foreground/30 text-muted-foreground">{badge}</span>
          )}
          <ArrowRight size={12} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        {detailText && <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{detailText}</p>}
      </div>
    </button>
  );
}
export function AgreementTimeline({ agreement, bookingId, onJump, canViewAfsPay = true, canViewAfsReg = true }: { agreement: any; bookingId: number; onJump: (t: AgrTab) => void; canViewAfsPay?: boolean; canViewAfsReg?: boolean }) {
  const { data: afsQp } = useQuery({
    queryKey: ["crm-afs-query-payment-booking", bookingId],
    queryFn: async () => { const r = await fetchWithAuth(`/api/crm/afs-query-payment/booking/${bookingId}`); return r.ok ? r.json() : null; },
    staleTime: 15_000,
    enabled: canViewAfsPay && bookingId != null,
  });
  const { data: afsReg } = useQuery({
    queryKey: ["crm-afs-registry-booking", bookingId],
    queryFn: async () => { const r = await fetchWithAuth(`/api/crm/afs-registry/booking/${bookingId}`); return r.ok ? r.json() : null; },
    staleTime: 15_000,
    enabled: canViewAfsReg && bookingId != null,
  });

  const executed = agreement?.Status === CrmStatus.EXECUTED || agreement?.Status === CrmStatus.REGISTERED;
  const registered = agreement?.Status === CrmStatus.REGISTERED;
  const qpConfirmed = afsQp?.Status === "Confirmed";
  const regDone = afsReg?.Status === "Completed";

  const agrStageText = registered ? "Registered at Sub-Registrar"
    : executed ? "Executed — awaiting AFS registration"
    : agreement?.SentToCustomerAt ? "Sent to customer for approval"
    : agreement?.SeniorApprovalStatus === CrmStatus.APPROVED ? "Senior-approved — ready to send"
    : agreement?.LegalExecutiveId != null ? "Drafting / legal review"
    : "Not started — assign a Legal Executive";

  const allRows: { n: number; title: string; detailText: string; state: TlState; badge?: string; tab: AgrTab }[] = [
    {
      n: 1, title: "Agreement for Sale",
      detailText: agrStageText, state: registered ? "done" : executed ? "done" : "current",
      badge: agreement?.Status, tab: "Overview",
    },
    {
      n: 2, title: "Agreement Papers",
      detailText: "Supporting documents — request, upload and verify",
      state: executed ? "done" : agreement?.LegalExecutiveId != null ? "current" : "upcoming",
      tab: "Documents",
    },
    {
      n: 3, title: "AFS Query Payment",
      detailText: !executed ? "Unlocks once the Agreement is Executed"
        : qpConfirmed ? "Government fees confirmed paid"
        : afsQp ? `In progress — ${afsQp.Status === "InfoSent" ? "info sent, awaiting payment" : "started"}`
        : "Not started",
      state: !executed ? "blocked" : qpConfirmed ? "done" : afsQp ? "current" : "current",
      badge: afsQp?.Status, tab: "AFS Payment",
    },
    {
      n: 4, title: "AFS Registry (Sub-Registrar Visit 1)",
      detailText: !qpConfirmed ? "Unlocks once AFS Query Payment is Confirmed"
        : regDone ? (afsReg?.AfsRegistrationNo ? "Completed & registration no. recorded" : "Visit complete — record the AFS Reg No on the Agreement tab")
        : afsReg ? `In progress — ${afsReg.Status}`
        : "Not started",
      state: !qpConfirmed ? "blocked" : regDone ? "done" : afsReg ? "current" : "current",
      badge: afsReg?.Status, tab: "AFS Registry",
    },
  ];
  const rows = allRows
    .filter((r) =>
      r.tab === "AFS Payment" ? canViewAfsPay :
      r.tab === "AFS Registry" ? canViewAfsReg : true,
    )
    .map((r, i) => ({ ...r, n: i + 1 }));

  return (
    <div className="border border-border bg-card p-5">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-1.5">
        <BarChart3 size={15} className="text-primary" /> Workflow Timeline
      </h3>
      <div>
        {rows.map((r, i) => (
          <TlRow key={r.n} n={r.n} title={r.title} detailText={r.detailText}
            state={r.state} badge={r.badge} onJump={() => onJump(r.tab)} last={i === rows.length - 1} />
        ))}
      </div>
    </div>
  );
}
