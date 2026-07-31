import React, { useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Building2, KeyRound, LogOut, FileText, CreditCard,
  LifeBuoy, HardHat, CheckCircle2, Circle, Palette, Check, Sun, Moon, Laptop,
} from "lucide-react";
import { fetchTickets, fmtMoney, fmtDate } from "./portalApi";
import {
  PageHeader, Card, CardHeader, InfoField, StatusPill, GOLD, GOLD_SOFT, HAIRLINE, SURFACE_ALT, TEXT, TEXT_MUTED, TEXT_FAINT, serif, mono,
  PORTAL_ACCENTS, getStoredPortalAccent, applyPortalAccent,
  PortalMode, getStoredPortalMode, applyPortalMode,
} from "./portalTheme";

type Ctx = { me: any; timeline: any; applicationId: number; applications: any[] };

const MODE_OPTIONS: { key: PortalMode; label: string; icon: any }[] = [
  { key: "light", label: "Light", icon: Sun },
  { key: "dark", label: "Dark", icon: Moon },
  { key: "system", label: "System", icon: Laptop },
];

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function MiniStat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-3" style={{ border: `1px solid ${HAIRLINE}` }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: GOLD_SOFT, color: GOLD }}><Icon size={14} /></div>
      <div className="min-w-0">
        <p className="text-sm font-semibold truncate" style={{ color: TEXT }}>{value}</p>
        <p className="text-[10px]" style={{ color: TEXT_FAINT }}>{label}</p>
      </div>
    </div>
  );
}

// A real 360° snapshot — identity, property, finance, and support activity
// all pulled from the same live tables the staff CRM reads, in one glance,
// instead of a bare contact-details form.
const PortalProfile: React.FC = () => {
  const { me, timeline, applicationId, applications } = useOutletContext<Ctx>();
  const navigate = useNavigate();

  // /me is the customer's shared identity (Name, Mobile, Email — keyed by
  // CustomerId since migration 254); ApplicantName/ApplicationNo/
  // InterestedProject/Status are all per-application, so they come from the
  // selected row in `applications` instead, not from `me`.
  const selectedApp = (applications || []).find((a: any) => a.ApplicationId === applicationId);
  const displayName = selectedApp?.ApplicantName || me.Name;
  const { data: tickets = [] } = useQuery({ queryKey: ["portal-tickets", applicationId], queryFn: () => fetchTickets(applicationId) });
  const [accent, setAccentState] = useState(getStoredPortalAccent());
  const [mode, setModeState] = useState<PortalMode>(getStoredPortalMode());

  const handleAccentChange = (key: string) => {
    applyPortalAccent(key);
    setAccentState(key);
  };
  const handleModeChange = (key: PortalMode) => {
    applyPortalMode(key);
    setModeState(key);
  };

  const handleLogout = () => {
    localStorage.removeItem("crm_portal_token");
    navigate("/crm-client-portal/login");
  };

  const milestones = timeline.paymentMilestones || [];
  const totalDue = milestones.reduce((s: number, m: any) => s + Number(m.AmountDue || 0), 0);
  const totalPaid = milestones.reduce((s: number, m: any) => s + Number(m.AmountPaid || 0), 0);
  const openTickets = (tickets as any[]).filter((t) => t.Status !== "Resolved" && t.Status !== "Closed").length;

  const keyDates = [
    { label: "Booking Date", value: timeline.booking?.BookingDate, done: !!timeline.booking?.BookingDate },
    { label: "Welcome Call", value: timeline.welcomeCall?.CallDate, done: !!timeline.welcomeCall },
    { label: "Agreement Sent", value: timeline.agreement?.SentToCustomerAt, done: !!timeline.agreement?.SentToCustomerAt },
    { label: "Agreement Date", value: timeline.agreement?.AgreementDate, done: !!timeline.agreement?.AgreementDate },
    { label: "Sales Deed", value: timeline.salesDeed?.DeedDate, done: !!timeline.salesDeed },
    { label: "Handover", value: timeline.handover?.ActualHandoverDate, done: !!timeline.handover },
  ];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Account" title="Customer 360" subtitle="A complete snapshot of your record with us." />

      {/* Identity card */}
      <Card className="p-5">
        <div className="flex items-center gap-4 mb-4 pb-4" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold shrink-0"
            style={{ background: GOLD_SOFT, color: GOLD, border: `1px solid #E8C766` }}>
            {initials(displayName)}
          </div>
          <div>
            <p className="text-lg font-semibold" style={{ ...serif, color: TEXT }}>{displayName}</p>
            <p className="text-xs" style={{ ...mono, color: TEXT_FAINT }}>{selectedApp?.ApplicationNo}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <InfoField label="Mobile" value={me.Mobile} />
          <InfoField label="Email" value={me.Email} />
          <InfoField label="Interested Project" value={selectedApp?.InterestedProject} />
          <div>
            <p className="text-[10px] uppercase tracking-wide" style={{ color: TEXT_FAINT }}>Application Status</p>
            <div className="mt-1"><StatusPill status={selectedApp?.ApplicationStatus} /></div>
          </div>
        </div>
      </Card>

      {/* Snapshot stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat icon={Building2} label="Unit" value={timeline.booking?.UnitNo || "—"} />
        <MiniStat icon={CreditCard} label="Paid of Total" value={`${fmtMoney(totalPaid)} / ${fmtMoney(totalDue)}`} />
        <MiniStat icon={FileText} label="Agreement" value={timeline.agreement?.CustomerApprovalStatus || "Not sent"} />
        <MiniStat icon={LifeBuoy} label="Open Tickets" value={String(openTickets)} />
      </div>

      {/* Key dates timeline */}
      <Card>
        <CardHeader icon={HardHat} title="Key Dates" />
        <div className="p-5 space-y-3">
          {keyDates.map((d) => (
            <div key={d.label} className="flex items-center gap-3">
              {d.done ? <CheckCircle2 size={15} style={{ color: "#0F7A44" }} className="shrink-0" /> : <Circle size={15} className="text-slate-300 shrink-0" />}
              <span className="text-sm flex-1" style={{ color: TEXT_MUTED }}>{d.label}</span>
              <span className="text-sm font-medium" style={{ color: TEXT }}>{d.value ? fmtDate(d.value) : "—"}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Recent tickets */}
      {tickets.length > 0 && (
        <Card>
          <CardHeader icon={LifeBuoy} title="Recent Support Activity" />
          {(tickets as any[]).slice(0, 3).map((t) => (
            <div key={t.Id} className="flex items-center justify-between gap-3 px-5 py-3 border-b last:border-0" style={{ borderColor: HAIRLINE }}>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: TEXT }}>{t.Subject}</p>
                <p className="text-[11px]" style={{ color: TEXT_FAINT }}>{t.TicketNo} · {fmtDate(t.CreatedAt)}</p>
              </div>
              <StatusPill status={t.Status} />
            </div>
          ))}
        </Card>
      )}

      {/* Theme */}
      <Card>
        <CardHeader icon={Palette} title="Portal Theme" />
        <div className="p-5 space-y-5">
          <p className="text-xs" style={{ color: TEXT_MUTED }}>Personalize how your portal looks — this is just for you and doesn't affect anything on our end.</p>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: TEXT_FAINT }}>Appearance</p>
            <div className="grid grid-cols-3 gap-2">
              {MODE_OPTIONS.map(({ key, label, icon: Icon }) => (
                <button key={key} onClick={() => handleModeChange(key)}
                  className="flex flex-col items-center gap-1.5 rounded-xl py-3 transition-shadow hover:shadow-sm"
                  style={{
                    border: mode === key ? `2px solid ${GOLD}` : `1px solid ${HAIRLINE}`,
                    background: mode === key ? GOLD_SOFT : SURFACE_ALT,
                  }}>
                  <Icon size={16} style={{ color: mode === key ? GOLD : TEXT_MUTED }} />
                  <span className="text-[11px] font-medium" style={{ color: mode === key ? TEXT : TEXT_MUTED }}>{label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: TEXT_FAINT }}>Accent</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(PORTAL_ACCENTS).map(([key, a]) => (
                <button key={key} onClick={() => handleAccentChange(key)}
                  className="flex flex-col items-center gap-2 rounded-xl p-3 transition-shadow hover:shadow-sm"
                  style={{ border: accent === key ? `2px solid ${a.gold}` : `1px solid ${HAIRLINE}` }}>
                  <div className="w-full h-8 rounded-lg relative overflow-hidden"
                    style={{ background: `linear-gradient(135deg, ${a.ink} 0%, ${a.violet} 100%)` }}>
                    <span className="absolute right-1.5 bottom-1.5 w-3 h-3 rounded-full" style={{ background: a.gold }} />
                    {accent === key && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <Check size={14} className="text-white" />
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-medium text-center leading-tight" style={{ color: TEXT }}>{a.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Account actions */}
      <Card className="p-5 space-y-3">
        <h2 className="text-sm font-semibold mb-1" style={{ ...serif, color: TEXT }}>Account</h2>
        <button onClick={() => navigate("/crm-client-portal/change-password")}
          className="w-full flex items-center gap-2.5 px-4 py-3 rounded-xl transition-colors" style={{ border: `1px solid ${HAIRLINE}` }}>
          <KeyRound size={15} style={{ color: GOLD }} />
          <span className="text-sm font-medium" style={{ color: TEXT_MUTED }}>Change Password</span>
        </button>
        <button onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-4 py-3 rounded-xl hover:bg-rose-50 transition-colors border border-rose-100">
          <LogOut size={15} className="text-rose-600" />
          <span className="text-sm font-medium text-rose-600">Sign Out</span>
        </button>
      </Card>
    </div>
  );
};

export default PortalProfile;
