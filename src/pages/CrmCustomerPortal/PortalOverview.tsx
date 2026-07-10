import React from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import {
  CheckCircle2, Circle, Clock, Building2, CreditCard, FileText, LifeBuoy,
  ArrowRight, AlertTriangle, TrendingUp,
} from "lucide-react";
import { fmtMoney, fmtDate } from "./portalApi";

const STAGES = ["Application", "Booking", "Welcome Call", "Customer Details", "Agreement", "Payments", "Sales Deed", "Handover"];

type Ctx = { me: any; timeline: any };

function StatCard({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: string; sub?: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${tone}`}><Icon size={16} /></div>
      <p className="text-xl font-bold font-heading text-slate-800 leading-none">{value}</p>
      <p className="text-[11px] text-slate-500 mt-1.5">{label}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

const PortalOverview: React.FC = () => {
  const { me, timeline } = useOutletContext<Ctx>();
  const navigate = useNavigate();

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
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold font-heading text-slate-800">Welcome back, {me.ApplicantName?.split(" ")[0]}!</h1>
        <p className="text-sm text-slate-500 mt-0.5">Here's where things stand on your home, {timeline.booking?.ProjectName ? `at ${timeline.booking.ProjectName}` : "with us"}.</p>
      </div>

      {/* Holds */}
      {timeline.holds?.length > 0 && timeline.holds.map((h: any) => {
        const daysLeft = Math.max(0, Math.ceil((new Date(h.HoldUntil).getTime() - Date.now()) / 86400000));
        const label = h.EntityType === "Unit" ? `Unit ${h.UnitName}` : `Parking Slot ${h.SlotNo}`;
        return (
          <div key={h.Id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
            <Clock size={18} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-semibold text-amber-800">{label} is on hold for you</p>
              <p className="text-xs text-amber-700/80 mt-0.5">
                Expires in {daysLeft} day{daysLeft === 1 ? "" : "s"} ({fmtDate(h.HoldUntil)}) — confirm your booking before it releases.
              </p>
            </div>
          </div>
        );
      })}

      {/* Action items */}
      {actionItems.length > 0 && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 space-y-2">
          <h2 className="text-xs font-bold text-violet-700 uppercase tracking-wide flex items-center gap-1.5"><AlertTriangle size={13} /> Needs your attention</h2>
          {actionItems.map((a, i) => (
            <button key={i} onClick={() => navigate(a.to)}
              className="w-full flex items-center justify-between gap-3 bg-white rounded-xl px-4 py-3 text-left hover:shadow-sm transition-shadow border border-violet-100">
              <div>
                <p className="text-sm font-semibold text-slate-800">{a.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{a.sub}</p>
              </div>
              <ArrowRight size={16} className="text-violet-500 shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* Journey */}
      <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold text-slate-800 mb-4">Your Journey</h2>
        <div className="flex items-center justify-between overflow-x-auto pb-1">
          {STAGES.map((s, idx) => (
            <div key={s} className="flex-1 flex flex-col items-center relative min-w-[64px]">
              {idx > 0 && <div className={`absolute top-3 right-1/2 w-full h-0.5 ${idx <= currentStageIdx ? "bg-violet-500" : "bg-slate-200"}`} />}
              {idx < currentStageIdx ? <CheckCircle2 size={20} className="text-violet-500 relative z-10 bg-white" />
                : idx === currentStageIdx ? <Clock size={20} className="text-amber-500 relative z-10 bg-white" />
                : <Circle size={20} className="text-slate-300 relative z-10 bg-white" />}
              <span className="text-[10px] mt-1.5 text-center text-slate-500 leading-tight">{s}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Building2} label="Unit" value={timeline.booking?.UnitNo || "—"} sub={timeline.booking?.ProjectName} tone="bg-sky-100 text-sky-600" />
        <StatCard icon={TrendingUp} label="Payment Progress" value={`${pctPaid}%`} sub={`${fmtMoney(totalPaid)} of ${fmtMoney(totalDue)}`} tone="bg-emerald-100 text-emerald-600" />
        <StatCard icon={CreditCard} label="Next Payment" value={nextDue ? fmtMoney(nextDue.AmountDue) : "None due"} sub={nextDue?.MilestoneName} tone="bg-amber-100 text-amber-600" />
        <StatCard icon={FileText} label="Agreement" value={agreement?.CustomerApprovalStatus || "Not sent"} sub={agreement?.AgreementNo} tone="bg-violet-100 text-violet-600" />
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
            className="flex flex-col items-center gap-2 rounded-2xl border border-violet-100 bg-white p-4 hover:shadow-sm hover:border-violet-300 transition-all">
            <div className="w-9 h-9 rounded-xl bg-violet-100 text-violet-600 flex items-center justify-center"><Icon size={16} /></div>
            <span className="text-xs font-medium text-slate-700">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default PortalOverview;
