import React from "react";
import { useOutletContext } from "react-router-dom";
import { Building2, Phone, CheckCircle2, Landmark, Ruler, Map as MapIcon, Clock, MapPin } from "lucide-react";
import { fmtMoney, fmtDate } from "./portalApi";
import {
  Card, CardHeader, InfoField, StatusPill, Stepper, StepState,
  HeroStrip, HeroStatCard, UrgencyBanner,
  TEXT, TEXT_MUTED, TEXT_FAINT, GOLD, GOLD_SOFT, HAIRLINE, serif,
} from "./portalTheme";

type Ctx = { me: any; timeline: any; money: any };

const PortalBooking: React.FC = () => {
  const { timeline, money } = useOutletContext<Ctx>();
  const booking = timeline.booking;

  if (!booking) {
    return (
      <div>
        <HeroStrip eyebrow="My Property" title="My Booking" subtitle="Your booking details will appear here once confirmed." />
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: GOLD_SOFT }}>
            <Building2 size={28} style={{ color: GOLD }} />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold" style={{ color: TEXT }}>No active booking yet</p>
            <p className="text-sm mt-1 max-w-xs" style={{ color: TEXT_MUTED }}>
              Once your unit is confirmed, all the details will show up right here.
            </p>
          </div>
          {/* Anything held for the customer before booking, and until when */}
          {(timeline.holds || []).map((h: any) => (
            <UrgencyBanner key={h.Id} icon={Clock} level="warning"
              title={`${h.EntityType === "Parking" ? `Parking slot ${h.SlotNo || ""}`.trim() : `Unit ${h.UnitName || ""}`.trim()} is held for you`}
              sub={`Until ${fmtDate(h.HoldUntil)}. Complete your booking before then to keep it.`} />
          ))}
        </div>
      </div>
    );
  }

  const callDone = timeline.welcomeCall?.Outcome === "Welcomed";
  const agreementStarted = !!timeline.agreement;

  const bookingSteps: { label: string; state: StepState; note?: string }[] = [
    { label: "Booking Confirmed", state: "done", note: fmtDate(booking.BookingDate) },
    { label: "Welcome Call", state: callDone ? "done" : "current", note: timeline.welcomeCall?.Outcome || "Pending" },
    // PAN / Aadhaar / bank details are taken by the salesperson within the welcome call — not a step of their own.
    { label: "Agreement Prep", state: agreementStarted ? "done" : callDone ? "current" : "upcoming" },
  ];

  const doneSteps = bookingSteps.filter((s) => s.state === "done").length;

  return (
    <div className="space-y-5">
      {/* Premium hero */}
      <HeroStrip
        eyebrow="My Property"
        title={booking.IsPlotSale ? "My Plot" : "My Booking"}
        subtitle={booking.IsPlotSale ? "Everything about your plot, in one place." : "Everything about your unit, in one place."}
        gradient="violet"
      >
        <div className="grid grid-cols-3 gap-3">
          <HeroStatCard
            label={booking.IsPlotSale ? "Plot No." : "Unit No."}
            value={booking.UnitNo || "—"}
            sub={booking.ProjectName}
            highlight
          />
          <HeroStatCard
            label="Total Value"
            value={fmtMoney(booking.TotalValue)}
            sub={`Booking: ${fmtMoney(booking.BookingAmount)}`}
          />
          <HeroStatCard
            label="Onboarding"
            value={`${doneSteps}/${bookingSteps.length}`}
            sub={doneSteps === bookingSteps.length ? "Complete ✓" : "In progress"}
          />
        </div>
      </HeroStrip>

      {/* Welcome call not done yet — nudge */}
      {!callDone && (
        <UrgencyBanner
          icon={Phone}
          title="Your welcome call is pending"
          sub="Our team will reach out to you shortly. Please have your PAN and Aadhaar ready."
          level="info"
        />
      )}

      {/* Onboarding stepper */}
      <div
        className="rounded-2xl p-5"
        style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
      >
        <p className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: TEXT_FAINT }}>Onboarding Journey</p>
        <div className="overflow-x-auto pb-1">
          <div style={{ minWidth: 480 }}>
            <Stepper steps={bookingSteps} />
          </div>
        </div>
      </div>

      {/* Unit / booking details */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
          <h2 className="text-sm font-semibold flex items-center gap-2.5" style={{ ...serif, color: TEXT }}>
            <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: GOLD_SOFT, color: GOLD }}>
              <Building2 size={14} />
            </span>
            {booking.IsPlotSale ? "Plot & Booking Details" : "Unit & Booking Details"}
          </h2>
          <StatusPill status={booking.BookingStatus} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 p-5">
          <InfoField label="Booking No." value={booking.BookingNo} mono />
          <InfoField label="Project" value={booking.ProjectName} />
          <InfoField label={booking.IsPlotSale ? "Plot No." : "Unit No."} value={booking.UnitNo} />
          <InfoField label="Token Type" value={booking.TokenType} />
          <InfoField label="Token Value" value={booking.TokenType === "Amount" ? fmtMoney(booking.TokenValue) : `${booking.TokenValue ?? "—"}%`} />
          <InfoField label="Total Value" value={fmtMoney(booking.TotalValue)} />
          <InfoField label="Booking Amount" value={fmtMoney(booking.BookingAmount)} />
          <InfoField label="Booking Date" value={fmtDate(booking.BookingDate)} />
          {booking.LookedAfterBy && <InfoField label="Looked After By" value={booking.LookedAfterBy} />}
        </div>
      </div>

      {/* The project — the facts the server builds (same as the mobile app), and where it is on a map */}
      {timeline.project && (timeline.project.facts?.length > 0 || timeline.project.description) && (
        <div className="rounded-2xl p-5 space-y-4" style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold flex items-center gap-2" style={{ ...serif, color: TEXT }}><Building2 size={14} style={{ color: GOLD }} /> {timeline.project.name}</h2>
            {(timeline.project.location || timeline.project.mapQuery) && (
              <a target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-80"
                style={{ border: `1px solid ${HAIRLINE}`, color: TEXT }}
                href={`https://www.google.com/maps/search/?api=1&query=${timeline.project.location ? `${timeline.project.location.lat},${timeline.project.location.lng}` : encodeURIComponent(timeline.project.mapQuery)}`}>
                <MapPin size={13} /> Open in Maps
              </a>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
            {timeline.project.facts.map((f: any) => <InfoField key={f.label} label={f.label} value={f.value} />)}
          </div>
          {timeline.project.description && <p className="text-sm" style={{ color: TEXT_MUTED }}>{timeline.project.description}</p>}
        </div>
      )}

      {/* What the home is, and each plot — the facts the server builds (same as the mobile app) */}
      {(timeline.homeFacts?.length > 0 || timeline.plots?.length > 0) && (
        <div className="rounded-2xl p-5 space-y-5" style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}>
          {timeline.homeFacts?.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2 mb-3" style={{ ...serif, color: TEXT }}><Ruler size={14} style={{ color: GOLD }} /> Your home</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
                {timeline.homeFacts.map((f: any) => <InfoField key={f.label} label={f.label} value={f.value} />)}
              </div>
            </div>
          )}
          {timeline.plots?.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2 mb-3" style={{ ...serif, color: TEXT }}>
                <MapIcon size={14} style={{ color: GOLD }} /> {timeline.plots.length > 1 ? `Your plots (${timeline.plots.length})` : "Your plot"}
              </h2>
              <div className="space-y-3">
                {timeline.plots.map((p: any, i: number) => (
                  <div key={`${p.PlotNo}-${i}`} className="rounded-xl p-3" style={{ background: "var(--portal-surface-alt)" }}>
                    <p className="text-sm font-semibold mb-2" style={{ color: TEXT }}>Plot {p.PlotName || p.PlotNo}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
                      {p.facts.map((f: any) => <InfoField key={f.label} label={f.label} value={f.value} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Welcome call status */}
      <div
        className="rounded-2xl p-5"
        style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
      >
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: TEXT_FAINT }}>Welcome Call</p>
        {timeline.welcomeCall ? (
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: callDone ? "rgba(5,150,105,0.10)" : GOLD_SOFT, color: callDone ? "#059669" : GOLD }}
            >
              {callDone ? <CheckCircle2 size={16} /> : <Phone size={16} />}
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: TEXT }}>
                {callDone ? "Welcome call completed" : timeline.welcomeCall.Outcome || "Pending"}
              </p>
              {timeline.welcomeCall.CallDate && (
                <p className="text-xs mt-0.5" style={{ color: TEXT_FAINT }}>{fmtDate(timeline.welcomeCall.CallDate)}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: GOLD_SOFT, color: GOLD }}>
              <Phone size={16} />
            </div>
            <p className="text-sm" style={{ color: TEXT_MUTED }}>Our team will reach out to you shortly.</p>
          </div>
        )}
      </div>

      {/* How the price is made up — the money statement's lines (same as Payments and the app): they add up to the total */}
      {money?.price?.lines?.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}>
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
            <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: GOLD_SOFT, color: GOLD }}>
              <Landmark size={14} />
            </span>
            <h2 className="text-sm font-semibold" style={{ ...serif, color: TEXT }}>Price and GST Breakdown</h2>
          </div>
          <div className="p-5 space-y-2.5">
            {money.price.lines.map((l: any, i: number) => (
              <div key={`${l.key}-${i}`} className="flex items-start justify-between gap-4 text-sm">
                <div className="min-w-0">
                  <p style={{ color: TEXT }}>{l.title}</p>
                  {l.note && <p className="text-[0.6875rem]" style={{ color: TEXT_FAINT }}>{l.note}</p>}
                </div>
                <p className="tabular-nums font-medium shrink-0" style={{ color: l.amount < 0 ? "#059669" : TEXT }}>{fmtMoney(l.amount)}</p>
              </div>
            )).flatMap((row: any, i: number) => [row, ...((money.price.lines[i].parts || []) as any[]).map((pt: any) => (
              <div key={`${i}-${pt.title}`} className="flex items-start justify-between gap-4 text-xs pl-4">
                <div className="min-w-0">
                  <p style={{ color: TEXT_MUTED }}>{pt.title}</p>
                  {pt.note && <p style={{ color: TEXT_FAINT }}>{pt.note}</p>}
                </div>
                <p className="tabular-nums shrink-0" style={{ color: TEXT_MUTED }}>{fmtMoney(pt.amount)}</p>
              </div>
            ))])}
            <div className="flex items-center justify-between gap-4 pt-2.5 text-sm font-semibold" style={{ borderTop: `1px solid ${HAIRLINE}`, color: TEXT }}>
              <span>Total price</span><span className="tabular-nums">{fmtMoney(money.price.total)}</span>
            </div>
            <p className="text-xs" style={{ color: TEXT_MUTED }}>{money.price.gstIncluded > 0 ? `This price includes ${fmtMoney(money.price.gstIncluded)} of GST in all.` : "No GST is included in this price."}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PortalBooking;
