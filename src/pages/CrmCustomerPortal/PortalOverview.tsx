import React from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { Clock, Building2, CreditCard, FileText, LifeBuoy, ArrowRight, AlertTriangle, TrendingUp, Landmark } from "lucide-react";
import { fmtMoney, fmtDate } from "./portalApi";
import { PageHeader, Card, Stepper, StepState, GOLD, GOLD_SOFT, SURFACE, HAIRLINE, TEXT, TEXT_MUTED, TEXT_FAINT, serif } from "./portalTheme";

const STAGES = ["Application", "Booking", "Welcome Call", "Customer Details", "Agreement", "Payments", "Sales Deed", "Handover"];

type Ctx = { me: any; timeline: any; applicationId: number; applications: any[] };

function StatCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3" style={{ background: GOLD_SOFT, color: GOLD }}><Icon size={16} /></div>
      <p className="text-xl font-semibold leading-none" style={{ ...serif, color: TEXT }}>{value}</p>
      <p className="text-[11px] mt-1.5" style={{ color: TEXT_MUTED }}>{label}</p>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: TEXT_FAINT }}>{sub}</p>}
    </Card>
  );
}

const PortalOverview: React.FC = () => {
  const { me, timeline, applicationId, applications } = useOutletContext<Ctx>();
  const navigate = useNavigate();

  // /me is the customer's shared identity (Id, Name, Mobile, ... — keyed by
  // CustomerId since migration 254), not any one application — ApplicationNo
  // and ApplicantName live on the per-application row instead.
  const selectedApp = (applications || []).find((a: any) => a.ApplicationId === applicationId);

  const agreement = timeline.agreement;
  const customerDetailsComplete = !!timeline.customerDetails?.IsComplete;
  const currentStageIdx = !timeline.booking ? 0
    : !timeline.welcomeCall ? 1
    : !customerDetailsComplete ? 2
    : !agreement ? 3
    : agreement.CustomerApprovalStatus !== "Approved" ? 4
    : timeline.paymentMilestones?.some((m: any) => m.Status === "Pending") ? 5
    : !timeline.salesDeed ? 6
    : !timeline.handover ? 7 : 7;

  const milestones = timeline.paymentMilestones || [];
  const totalDue = milestones.reduce((s: number, m: any) => s + Number(m.AmountDue || 0), 0);
  const totalPaid = milestones.reduce((s: number, m: any) => s + Number(m.AmountPaid || 0), 0);
  const pctPaid = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0;
  const nextDue = milestones.find((m: any) => m.Status === "Pending");

  const actionItems: { label: string; sub: string; to: string }[] = [];
  if (agreement?.SentToCustomerAt && agreement?.CustomerApprovalStatus === "Pending") {
    actionItems.push({ label: "Your agreement is waiting for your review", sub: `${agreement.AgreementNo} — approve or request a recheck`, to: "/crm-client-portal/agreement" });
  }
  if (timeline.salesDeed?.SentToCustomerAt && timeline.salesDeed?.CustomerApprovalStatus === "Pending") {
    actionItems.push({ label: "Your sales deed is waiting for your review", sub: "Approve or request a recheck", to: "/crm-client-portal/agreement" });
  }
  if (nextDue) {
    actionItems.push({ label: `${nextDue.MilestoneName} payment is due`, sub: `${fmtMoney(nextDue.AmountDue)} · ${nextDue.DueDate ? `Due ${fmtDate(nextDue.DueDate)}` : "No due date set yet"}`, to: "/crm-client-portal/payments" });
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={`Application ${selectedApp?.ApplicationNo || ""}`} title={`Welcome back, ${(selectedApp?.ApplicantName || me.Name || "").split(" ")[0]}`}
        subtitle={`Here's where things stand on your home${timeline.booking?.ProjectName ? ` at ${timeline.booking.ProjectName}` : ""}.`} />

      {/* Holds */}
      {timeline.holds?.length > 0 && timeline.holds.map((h: any) => {
        const daysLeft = Math.max(0, Math.ceil((new Date(h.HoldUntil).getTime() - Date.now()) / 86400000));
        const label = h.EntityType === "Unit" ? `Unit ${h.UnitName}` : `Parking Slot ${h.SlotNo}`;
        return (
          <Card key={h.Id} className="p-4 flex items-start gap-3" style={{ borderColor: "#E8C766" }}>
            <Clock size={18} className="mt-0.5 shrink-0" style={{ color: "#8A6D14" }} />
            <div className="text-sm">
              <p className="font-semibold" style={{ color: "#8A6D14" }}>{label} is on hold for you</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Expires in {daysLeft} day{daysLeft === 1 ? "" : "s"} ({fmtDate(h.HoldUntil)}) — confirm your booking before it releases.
              </p>
            </div>
          </Card>
        );
      })}

      {/* Action items */}
      {actionItems.length > 0 && (
        <Card className="p-4 space-y-2" style={{ background: GOLD_SOFT, borderColor: "#E8C766" }}>
          <h2 className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "#8A6D14" }}><AlertTriangle size={13} /> Needs your attention</h2>
          {actionItems.map((a, i) => (
            <button key={i} onClick={() => navigate(a.to)}
              className="w-full flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-left hover:shadow-sm transition-shadow" style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}>
              <div>
                <p className="text-sm font-semibold" style={{ color: TEXT }}>{a.label}</p>
                <p className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>{a.sub}</p>
              </div>
              <ArrowRight size={16} className="shrink-0" style={{ color: GOLD }} />
            </button>
          ))}
        </Card>
      )}

      {/* Journey */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-4" style={{ ...serif, color: TEXT }}>Your Journey</h2>
        <Stepper
          steps={STAGES.map((s, idx): { label: string; state: StepState } => ({
            label: s,
            state: idx < currentStageIdx ? "done" : idx === currentStageIdx ? "current" : "upcoming",
          }))}
        />
      </Card>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Building2} label="Unit" value={timeline.booking?.UnitNo || "—"} sub={timeline.booking?.ProjectName} />
        <StatCard icon={TrendingUp} label="Payment Progress" value={`${pctPaid}%`} sub={`${fmtMoney(totalPaid)} of ${fmtMoney(totalDue)}`} />
        <StatCard icon={CreditCard} label="Next Payment" value={nextDue ? fmtMoney(nextDue.AmountDue) : "None due"} sub={nextDue?.MilestoneName} />
        <StatCard icon={timeline.salesDeed ? Landmark : FileText}
          label={timeline.salesDeed ? "Sales Deed" : "Agreement"}
          value={(timeline.salesDeed ? timeline.salesDeed.CustomerApprovalStatus : agreement?.CustomerApprovalStatus) || "Not sent"}
          sub={timeline.salesDeed ? timeline.salesDeed.DeedNo : agreement?.AgreementNo} />
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { to: "/crm-client-portal/booking", icon: Building2, label: "My Booking" },
          { to: "/crm-client-portal/agreement", icon: FileText, label: "Agreement" },
          { to: "/crm-client-portal/payments", icon: CreditCard, label: "Payments" },
          { to: "/crm-client-portal/tickets", icon: LifeBuoy, label: "Support" },
        ].map(({ to, icon: Icon, label }) => (
          <button key={to} onClick={() => navigate(to)}
            className="flex flex-col items-center gap-2 rounded-2xl p-4 hover:shadow-sm transition-all"
            style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: GOLD_SOFT, color: GOLD }}><Icon size={16} /></div>
            <span className="text-xs font-medium" style={{ color: TEXT }}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default PortalOverview;
