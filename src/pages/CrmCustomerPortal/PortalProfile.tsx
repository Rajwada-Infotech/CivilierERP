import React, { useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Building2, KeyRound, LogOut, FileText, CreditCard,
  LifeBuoy, HardHat, CheckCircle2, Circle, Palette, Check, Sun, Moon, Laptop, TrendingUp,
} from "lucide-react";
import { fetchTickets, fmtMoney, fmtDate } from "./portalApi";
import {
  Card, CardHeader, InfoField, StatusPill,
  HeroStrip, PulseBar,
  GOLD, GOLD_SOFT, HAIRLINE, SURFACE_ALT, TEXT, TEXT_MUTED, TEXT_FAINT, INK, serif, mono,
  PORTAL_ACCENTS, getStoredPortalAccent, applyPortalAccent,
  PortalMode, getStoredPortalMode, applyPortalMode,
} from "./portalTheme";

type Ctx = { me: any; timeline: any; applicationId: number; applications: any[] };

const MODE_OPTIONS: { key: PortalMode; label: string; icon: any }[] = [
  { key: "light", label: "Light", icon: Sun },
  { key: "dark", label: "Dark", icon: Moon },
  { key: "system", label: "Auto", icon: Laptop },
];

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
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
  // Includes money held in On Account but not yet swept onto a milestone —
  // same fix as PortalPayments.tsx / PortalOverview.tsx.
  const totalPaid = milestones.reduce((s: number, m: any) => s + Number(m.AmountPaid || 0), 0)
    + Number(timeline.onAccountTotalReceived || 0);
  const pctPaid = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0;
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
    <div className="space-y-5">
      {/* Premium hero */}
      <HeroStrip eyebrow="Account" title="Customer 360" subtitle="Your complete record — identity, finances, and journey at a glance." gradient="violet">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl px-4 py-3" style={{ background: "rgba(201,162,39,0.18)", border: "1px solid rgba(201,162,39,0.4)" }}>
            <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-1" style={{ color: "rgba(201,162,39,0.9)" }}>Unit</p>
            <p className="text-xl font-semibold text-white leading-tight" style={{ fontFamily: "'Fraunces', serif" }}>
              {timeline.booking?.UnitNo || "—"}
            </p>
            <p className="text-[0.6875rem] mt-0.5" style={{ color: "rgba(255,255,255,0.42)" }}>{timeline.booking?.ProjectName || selectedApp?.InterestedProject || ""}</p>
          </div>
          <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
            <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.5)" }}>Paid</p>
            <p className="text-xl font-semibold text-white leading-tight tabular-nums" style={{ fontFamily: "'Fraunces', serif" }}>{pctPaid}%</p>
            <p className="text-[0.6875rem] mt-0.5" style={{ color: "rgba(255,255,255,0.42)" }}>{fmtMoney(totalPaid)} of {fmtMoney(totalDue)}</p>
          </div>
          <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
            <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.5)" }}>Tickets</p>
            <p className="text-xl font-semibold text-white leading-tight tabular-nums" style={{ fontFamily: "'Fraunces', serif" }}>{openTickets}</p>
            <p className="text-[0.6875rem] mt-0.5" style={{ color: "rgba(255,255,255,0.42)" }}>open {openTickets === 1 ? "ticket" : "tickets"}</p>
          </div>
        </div>
      </HeroStrip>

      {/* Identity card — premium avatar treatment */}
      <div
        className="rounded-2xl p-5"
        style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
      >
        <div className="flex items-center gap-4 mb-5 pb-5" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold shrink-0"
            style={{
              background: `linear-gradient(135deg, ${INK}, var(--portal-violet-deep))`,
              color: GOLD,
              boxShadow: `0 4px 16px rgba(30,11,66,0.3)`,
            }}
          >
            {initials(displayName)}
          </div>
          <div>
            <p className="text-xl font-semibold leading-tight" style={{ ...serif, color: TEXT }}>{displayName}</p>
            <p className="text-xs mt-0.5" style={{ ...mono, color: TEXT_FAINT }}>{selectedApp?.ApplicationNo}</p>
            {selectedApp?.ApplicationStatus && (
              <div className="mt-1.5"><StatusPill status={selectedApp.ApplicationStatus} /></div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
          <InfoField label="Mobile" value={me.Mobile} />
          <InfoField label="Email" value={me.Email} />
          <InfoField label="Project" value={selectedApp?.InterestedProject} />
        </div>
      </div>

      {/* Payment progress */}
      {totalDue > 0 && (
        <div
          className="rounded-2xl p-5"
          style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp size={15} style={{ color: GOLD }} />
              <p className="text-sm font-semibold" style={{ color: TEXT }}>Payment progress</p>
            </div>
            <span className="text-xl font-bold tabular-nums" style={{ ...serif, color: GOLD }}>{pctPaid}%</span>
          </div>
          <PulseBar pct={pctPaid} height={10} />
          <div className="flex justify-between mt-2 text-xs" style={{ color: TEXT_FAINT }}>
            <span>{fmtMoney(totalPaid)} paid</span>
            <span>{fmtMoney(totalDue - totalPaid)} remaining</span>
          </div>
        </div>
      )}

      {/* Key dates */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
      >
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
          <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: GOLD_SOFT, color: GOLD }}>
            <HardHat size={14} />
          </span>
          <h2 className="text-sm font-semibold" style={{ ...serif, color: TEXT }}>Key Milestones</h2>
        </div>
        <div className="p-5 space-y-3">
          {keyDates.map((d) => (
            <div key={d.label} className="flex items-center gap-3">
              <div
                className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: d.done ? "rgba(5,150,105,0.10)" : GOLD_SOFT, color: d.done ? "#059669" : GOLD }}
              >
                {d.done ? <CheckCircle2 size={13} /> : <Circle size={13} />}
              </div>
              <span className="text-sm flex-1" style={{ color: d.done ? TEXT : TEXT_MUTED }}>{d.label}</span>
              <span className="text-sm font-semibold tabular-nums" style={{ color: d.done ? TEXT : TEXT_FAINT }}>
                {d.value ? fmtDate(d.value) : "—"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent tickets */}
      {(tickets as any[]).length > 0 && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
        >
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
            <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: GOLD_SOFT, color: GOLD }}>
              <LifeBuoy size={14} />
            </span>
            <h2 className="text-sm font-semibold" style={{ ...serif, color: TEXT }}>Recent Support</h2>
          </div>
          {(tickets as any[]).slice(0, 3).map((t) => (
            <div key={t.Id} className="flex items-center justify-between gap-3 px-5 py-3.5 border-b last:border-0" style={{ borderColor: HAIRLINE }}>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: TEXT }}>{t.Subject}</p>
                <p className="text-[0.6875rem]" style={{ color: TEXT_FAINT }}>{t.TicketNo} · {fmtDate(t.CreatedAt)}</p>
              </div>
              <StatusPill status={t.Status} />
            </div>
          ))}
        </div>
      )}

      {/* Theme customization */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
      >
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
          <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: GOLD_SOFT, color: GOLD }}>
            <Palette size={14} />
          </span>
          <div>
            <h2 className="text-sm font-semibold" style={{ ...serif, color: TEXT }}>Portal Theme</h2>
          </div>
        </div>
        <div className="p-5 space-y-5">
          <p className="text-xs" style={{ color: TEXT_MUTED }}>
            Personalize how your portal looks — just for you, no effect on your record with us.
          </p>

          {/* Appearance mode */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: TEXT_FAINT }}>Appearance</p>
            <div className="grid grid-cols-3 gap-2">
              {MODE_OPTIONS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => handleModeChange(key)}
                  className="flex flex-col items-center gap-1.5 rounded-xl py-3 transition-all hover:shadow-sm"
                  style={{
                    border: mode === key ? `2px solid ${GOLD}` : `1px solid ${HAIRLINE}`,
                    background: mode === key ? GOLD_SOFT : SURFACE_ALT,
                    boxShadow: mode === key ? `0 2px 8px rgba(201,162,39,0.2)` : "none",
                  }}
                >
                  <Icon size={16} style={{ color: mode === key ? GOLD : TEXT_MUTED }} />
                  <span className="text-[0.6875rem] font-medium" style={{ color: mode === key ? TEXT : TEXT_MUTED }}>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Accent color */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: TEXT_FAINT }}>Accent Colour</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(PORTAL_ACCENTS).map(([key, a]) => (
                <button
                  key={key}
                  onClick={() => handleAccentChange(key)}
                  className="flex flex-col items-center gap-2 rounded-xl p-3 transition-all hover:shadow-sm"
                  style={{
                    border: accent === key ? `2px solid ${a.gold}` : `1px solid ${HAIRLINE}`,
                    boxShadow: accent === key ? `0 2px 8px ${a.gold}30` : "none",
                  }}
                >
                  <div
                    className="w-full h-9 rounded-lg relative overflow-hidden"
                    style={{ background: `linear-gradient(135deg, ${a.ink} 0%, ${a.violet} 100%)` }}
                  >
                    <span className="absolute right-2 bottom-2 w-3 h-3 rounded-full" style={{ background: a.gold }} />
                    {accent === key && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <Check size={14} className="text-white" />
                      </span>
                    )}
                  </div>
                  <span className="text-[0.6875rem] font-medium text-center leading-tight" style={{ color: TEXT }}>{a.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Account actions */}
      <div
        className="rounded-2xl p-5 space-y-2.5"
        style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
      >
        <h2 className="text-sm font-semibold mb-3" style={{ ...serif, color: TEXT }}>Account</h2>
        <button
          onClick={() => navigate("/crm-client-portal/change-password")}
          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all hover:shadow-sm"
          style={{ border: `1px solid ${HAIRLINE}`, background: SURFACE_ALT }}
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: GOLD_SOFT, color: GOLD }}>
            <KeyRound size={15} />
          </div>
          <span className="text-sm font-medium" style={{ color: TEXT }}>Change Password</span>
        </button>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-rose-50 transition-colors"
          style={{ border: "1px solid rgba(220,38,38,0.2)", background: "rgba(220,38,38,0.03)" }}
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(220,38,38,0.10)", color: "#DC2626" }}>
            <LogOut size={15} />
          </div>
          <span className="text-sm font-medium text-rose-600">Sign Out</span>
        </button>
      </div>
    </div>
  );
};

export default PortalProfile;
