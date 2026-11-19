import React from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { Clock, Building2, CreditCard, FileText, LifeBuoy, ArrowRight, AlertTriangle, TrendingUp, Landmark, ReceiptIndianRupee, BookMarked, CheckCircle2, ChevronRight } from "lucide-react";
import { fmtMoney, fmtDate, moneyFigures } from "./portalApi";
import { HeroStrip, HeroStatCard, Card, Stepper, StepState, GOLD, GOLD_SOFT, SURFACE, HAIRLINE, TEXT, TEXT_MUTED, TEXT_FAINT, INK, serif } from "./portalTheme";

type Ctx = { me: any; timeline: any; money: any; applicationId: number; applications: any[] };

// Stat card — slightly larger, more legible at a glance
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  highlight,
  progressPct,
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  progressPct?: number;
}) {
  return (
    <Card className="p-4 sm:p-5" style={highlight ? { borderColor: GOLD, borderWidth: 1.5 } : {}}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3" style={{ background: GOLD_SOFT, color: GOLD }}>
        <Icon size={16} />
      </div>
      <p className="text-2xl font-semibold leading-none" style={{ ...serif, color: TEXT }}>{value}</p>
      <p className="text-[0.6875rem] mt-1.5 font-medium" style={{ color: TEXT_MUTED }}>{label}</p>
      {sub && <p className="text-[0.625rem] mt-0.5 leading-snug" style={{ color: TEXT_FAINT }}>{sub}</p>}
      {progressPct != null && (
        <div className="mt-3 w-full h-1.5 rounded-full overflow-hidden" style={{ background: `${GOLD}25` }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.min(100, progressPct)}%`,
              background: progressPct >= 75 ? "#10965A" : progressPct >= 40 ? GOLD : "#1E70BF",
            }}
          />
        </div>
      )}
    </Card>
  );
}

// Quick nav link card — larger touch target with description
function QuickLink({ to, icon: Icon, label, description, badge }: { to: string; icon: any; label: string; description?: string; badge?: number }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(to)}
      className="flex items-center gap-3 rounded-2xl p-4 text-left hover:shadow-md active:scale-[0.98] transition-all w-full"
      style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
    >
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 relative" style={{ background: GOLD_SOFT, color: GOLD }}>
        <Icon size={18} />
        {!!badge && (
          <span
            className="absolute -top-1.5 -right-1.5 text-[0.5625rem] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5"
            style={{ background: GOLD, color: INK }}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-tight" style={{ color: TEXT }}>{label}</p>
        {description && <p className="text-[0.6875rem] mt-0.5 leading-tight" style={{ color: TEXT_MUTED }}>{description}</p>}
      </div>
      <ChevronRight size={15} className="shrink-0" style={{ color: TEXT_FAINT }} />
    </button>
  );
}

// Payment progress summary banner — prominent when there's a next payment due
function NextPaymentBanner({ nextDue, onNavigate }: { nextDue: any; onNavigate: () => void }) {
  const isOverdue = nextDue.DueDate && new Date(nextDue.DueDate) < new Date();
  return (
    <button
      onClick={onNavigate}
      className="w-full text-left flex items-center gap-4 cursor-pointer rounded-2xl p-4 sm:p-5 hover:shadow-md transition-shadow"
      style={{
        border: isOverdue ? "1.5px solid #DC2626" : `1.5px solid ${GOLD}`,
        background: isOverdue ? "rgba(220,38,38,0.04)" : GOLD_SOFT,
        boxShadow: "0 1px 3px rgba(30,11,66,0.07)",
      }}
    >
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: isOverdue ? "rgba(220,38,38,0.12)" : `${GOLD}25`, color: isOverdue ? "#DC2626" : GOLD }}
      >
        <CreditCard size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: isOverdue ? "#DC2626" : GOLD }}>
          {isOverdue ? "⚠ Payment Overdue" : "Next Payment Due"}
        </p>
        <p className="text-base font-semibold mt-0.5 leading-tight" style={{ color: TEXT }}>
          {fmtMoney(nextDue.Outstanding)}
        </p>
        <p className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>
          {nextDue.MilestoneName}
          {nextDue.DueDate && ` · ${isOverdue ? "Was due" : "Due"} ${fmtDate(nextDue.DueDate)}`}
        </p>
      </div>
      <ArrowRight size={18} className="shrink-0" style={{ color: isOverdue ? "#DC2626" : GOLD }} />
    </button>
  );
}

const PortalOverview: React.FC = () => {
  const { me, timeline, money, applicationId, applications } = useOutletContext<Ctx>();
  const navigate = useNavigate();

  // /me is the customer's shared identity (Id, Name, Mobile, ... — keyed by
  // CustomerId since migration 254), not any one application — ApplicationNo
  // and ApplicantName live on the per-application row instead.
  const selectedApp = (applications || []).find((a: any) => a.ApplicationId === applicationId);

  const agreement = timeline.agreement;

  const milestones = timeline.paymentMilestones || [];
  // Paid / total from the money statement — the same figures as Payments, Profile and the mobile app.
  const { total: totalDue, paid: totalPaid, pct: pctPaid } = moneyFigures(money);
  // Judged by money stage (Covered / Outstanding from the server), not Status — paid money held On Account leaves it "Pending".
  const nextDue = milestones.find((m: any) => !m.Covered && !m.Verifying && Number(m.Outstanding) > 0);
  const paidCount = milestones.filter((m: any) => m.Covered).length;

  // Payments (construction milestones) and the Legal chain (Sales Deed ->
  // Govt. Payment -> Registry -> Handover) are genuinely parallel tracks,
  // not one sequential chain — a still-pending construction milestone must
  // never freeze the stepper's legal stages at "upcoming" when Registry is
  // already Completed. Each stage's done/current state is evaluated off its
  // own data, branching independently off Agreement being approved.
  const agreementApproved = !!agreement && agreement.CustomerApprovalStatus === "Approved";
  const paymentsDone = milestones.length > 0 && milestones.every((m: any) => m.Covered);
  const salesDeedDone = !!timeline.salesDeed;
  const qpDone = timeline.queryPayment?.Status === "Confirmed";
  const registryDone = timeline.registry?.Status === "Completed";
  const handoverDone = !!timeline.handover;

  const journeySteps: { label: string; state: StepState }[] = [
    { label: "Application", state: "done" },
    { label: "Booking", state: timeline.booking ? "done" : "current" },
    { label: "Welcome Call", state: timeline.welcomeCall ? "done" : timeline.booking ? "current" : "upcoming" },
    // No separate "customer details" step: the salesperson takes PAN, Aadhaar and bank details within the welcome call.
    { label: "Agreement", state: agreementApproved ? "done" : timeline.welcomeCall ? "current" : "upcoming" },
    { label: "Payments", state: paymentsDone ? "done" : agreementApproved ? "current" : "upcoming" },
    { label: "Sales Deed", state: salesDeedDone ? "done" : agreementApproved ? "current" : "upcoming" },
    { label: "Govt. Payment", state: qpDone ? "done" : salesDeedDone ? "current" : "upcoming" },
    { label: "Registry", state: registryDone ? "done" : qpDone ? "current" : "upcoming" },
    { label: "Handover", state: handoverDone ? "done" : registryDone ? "current" : "upcoming" },
  ];

  // Find the current step label for the subtitle
  const currentStep = journeySteps.find((s) => s.state === "current");

  // The last stat card tracks whichever legal stage is furthest along —
  // Registry, then Query Payment, then Sales Deed, then Agreement — instead
  // of freezing on "Sales Deed" once the customer has actually moved past it.
  const legalStage = timeline.registry
    ? { icon: BookMarked, label: "Registry", value: timeline.registry.Status, sub: timeline.registry.RegNo }
    : timeline.queryPayment
    ? { icon: ReceiptIndianRupee, label: "Govt. Payment", value: timeline.queryPayment.Status, sub: timeline.queryPayment.QPNo }
    : timeline.salesDeed
    ? { icon: Landmark, label: "Sales Deed", value: timeline.salesDeed.CustomerApprovalStatus || timeline.salesDeed.Status, sub: timeline.salesDeed.DeedNo }
    : { icon: FileText, label: "Agreement", value: agreement?.CustomerApprovalStatus || "Not sent", sub: agreement?.AgreementNo };

  // Action items — with type info for icon/color
  const actionItems: { label: string; sub: string; to: string; type: "sign" | "payment" | "notice" }[] = [];
  if (agreement?.SentToCustomerAt && agreement?.CustomerApprovalStatus === "Pending") {
    actionItems.push({ label: "Your agreement is waiting for your review", sub: `${agreement.AgreementNo} — approve or request a recheck`, to: "/crm-client-portal/agreement", type: "sign" });
  }
  if (timeline.salesDeed?.SentToCustomerAt && timeline.salesDeed?.CustomerApprovalStatus === "Pending") {
    actionItems.push({ label: "Your sales deed is waiting for your review", sub: "Approve or request a recheck", to: "/crm-client-portal/agreement", type: "sign" });
  }
  if (timeline.possessionNotice?.Status === "Sent") {
    const n = timeline.possessionNotice;
    actionItems.push({ label: "Your possession letter is waiting for your response", sub: `${n.NoticeNo}${n.ResponseDeadline ? ` — respond by ${fmtDate(n.ResponseDeadline)}` : ""}`, to: "/crm-client-portal/construction", type: "notice" });
  }
  if (timeline.queryPayment?.Status === "InfoSent") {
    actionItems.push({ label: "Government payment proof needed", sub: `${fmtMoney(timeline.queryPayment.RequiredAmount)} — upload your proof once paid`, to: "/crm-client-portal/agreement", type: "payment" });
  }

  const actionTypeStyle = (type: "sign" | "payment" | "notice") => {
    if (type === "sign") return { border: "2px solid #DC2626", borderLeft: "4px solid #DC2626" };
    if (type === "payment") return { border: `2px solid ${GOLD}`, borderLeft: `4px solid ${GOLD}` };
    return { border: "2px solid #2563EB", borderLeft: "4px solid #2563EB" };
  };

  return (
    <div className="space-y-5">
      <HeroStrip
        eyebrow={`Application ${selectedApp?.ApplicationNo || ""}`}
        title={`Welcome back, ${(selectedApp?.ApplicantName || me.Name || "").split(" ")[0]} 👋`}
        subtitle={`${timeline.booking?.ProjectName ? `${timeline.booking.ProjectName} · ` : ""}${currentStep ? `Next step: ${currentStep.label}` : "Your home journey is complete 🎉"}`}
        gradient={actionItems.length > 0 ? "gold" : "violet"}
      >
        <div className="grid grid-cols-3 gap-3">
          <HeroStatCard
            label="Your unit"
            value={timeline.booking?.UnitNo || selectedApp?.UnitNo || "—"}
            sub={timeline.booking?.ProjectName || ""}
            highlight
          />
          <HeroStatCard
            label="Journey"
            value={`${journeySteps.filter((s) => s.state === "done").length}/${journeySteps.length}`}
            sub={currentStep ? currentStep.label : "Complete!"}
          />
          <HeroStatCard
            label="Next step"
            value={currentStep ? currentStep.label : "Done 🎉"}
            sub={actionItems.length > 0 ? `${actionItems.length} action needed` : "On track"}
          />
        </div>
      </HeroStrip>

      {/* Holds — no expiry; confirming the booking is what ends the hold. */}
      {timeline.holds?.length > 0 && timeline.holds.map((h: any) => {
        const label = h.EntityType === "Unit" ? `Unit ${h.UnitName}` : `Parking Slot ${h.SlotNo}`;
        return (
          <Card key={h.Id} className="p-4 flex items-start gap-3" style={{ borderColor: "#E8C766", borderWidth: 1.5 }}>
            <Clock size={18} className="mt-0.5 shrink-0" style={{ color: "#8A6D14" }} />
            <div className="text-sm">
              <p className="font-semibold" style={{ color: "#8A6D14" }}>{label} is on hold for you</p>
              <p className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>
                Confirm your booking to secure it.
              </p>
            </div>
          </Card>
        );
      })}

      {/* Next payment due — prominent banner, only if there's a due payment (not in action items) */}
      {nextDue && (
        <NextPaymentBanner nextDue={nextDue} onNavigate={() => navigate("/crm-client-portal/payments")} />
      )}

      {/* Action items — things needing the customer's response */}
      {actionItems.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <AlertTriangle size={13} style={{ color: "#DC2626" }} />
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#DC2626" }}>Needs your attention</p>
          </div>
          {actionItems.map((a, i) => (
            <button
              key={i}
              onClick={() => navigate(a.to)}
              className="w-full flex items-center justify-between gap-3 rounded-xl px-4 py-3.5 text-left hover:shadow-md active:scale-[0.99] transition-all"
              style={{ background: SURFACE, ...actionTypeStyle(a.type) }}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight" style={{ color: TEXT }}>{a.label}</p>
                <p className="text-xs mt-1 leading-snug" style={{ color: TEXT_MUTED }}>{a.sub}</p>
              </div>
              <ArrowRight size={16} className="shrink-0" style={{ color: GOLD }} />
            </button>
          ))}
        </div>
      )}

      {/* Stat cards — 2-col on mobile, 4-col on sm+ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={Building2}
          label={timeline.booking?.IsPlotSale ? "Your Plot" : "Your Unit"}
          value={timeline.booking?.UnitNo || "—"}
          sub={timeline.booking?.ProjectName}
        />
        <StatCard
          icon={TrendingUp}
          label="Paid so far"
          value={`${pctPaid}%`}
          sub={`${fmtMoney(totalPaid)} of ${fmtMoney(totalDue)}${paidCount > 0 ? ` · ${paidCount} milestones done` : ""}`}
          progressPct={pctPaid}
        />
        <StatCard
          icon={CreditCard}
          label="Next Payment"
          value={nextDue ? fmtMoney(nextDue.Outstanding) : "All paid ✓"}
          sub={nextDue?.MilestoneName || (milestones.length > 0 ? "No pending milestones" : undefined)}
          highlight={!!nextDue}
        />
        <StatCard icon={legalStage.icon} label={legalStage.label} value={legalStage.value || "Not sent"} sub={legalStage.sub} />
      </div>

      {/* Journey — with mobile-scroll wrapper and a hint */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h2 className="text-sm font-semibold" style={{ ...serif, color: TEXT }}>Your Journey</h2>
          {currentStep && (
            <span className="text-[0.6875rem] font-medium px-2 py-1 rounded-full" style={{ background: GOLD_SOFT, color: GOLD }}>
              {currentStep.label} →
            </span>
          )}
        </div>
        {/* Scrollable on mobile — 10 steps don't fit in <400px */}
        <div className="overflow-x-auto -mx-1 px-1 pb-2">
          <div style={{ minWidth: 640 }}>
            <Stepper steps={journeySteps} />
          </div>
        </div>
        <p className="text-[0.625rem] mt-2 text-center sm:hidden" style={{ color: TEXT_FAINT }}>← Scroll to see all steps →</p>
        {handoverDone && (
          <div className="mt-4 flex items-center gap-2 justify-center rounded-xl py-2.5" style={{ background: "rgba(16,150,80,0.08)" }}>
            <CheckCircle2 size={15} style={{ color: "#10965A" }} />
            <p className="text-xs font-semibold" style={{ color: "#10965A" }}>Congratulations — your home has been handed over! 🎉</p>
          </div>
        )}
      </Card>

      {/* Quick navigation links */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide mb-3 px-1" style={{ color: TEXT_FAINT }}>Quick access</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <QuickLink to="/crm-client-portal/booking" icon={Building2} label="My Booking" description="Unit details, floor plan & project info" />
          <QuickLink to="/crm-client-portal/agreement" icon={FileText} label="Agreement & Documents" description="View, sign or download your documents" badge={actionItems.filter(a => a.type === "sign").length || undefined} />
          <QuickLink to="/crm-client-portal/payments" icon={CreditCard} label="Payments" description="Milestones, invoices & payment receipts" badge={nextDue ? 1 : undefined} />
          <QuickLink to="/crm-client-portal/tickets" icon={LifeBuoy} label="Get Support" description="Raise a request — we reply within 24 hrs" />
        </div>
      </div>
    </div>
  );
};

export default PortalOverview;
