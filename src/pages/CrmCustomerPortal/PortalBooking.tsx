import React from "react";
import { useOutletContext } from "react-router-dom";
import { Building2, Phone, CheckCircle2, User, Landmark } from "lucide-react";
import { fmtMoney, fmtDate } from "./portalApi";
import {
  Card, CardHeader, InfoField, StatusPill, Stepper, StepState,
  HeroStrip, HeroStatCard, UrgencyBanner,
  TEXT, TEXT_MUTED, TEXT_FAINT, GOLD, GOLD_SOFT, HAIRLINE, serif,
} from "./portalTheme";

type Ctx = { me: any; timeline: any };

const PortalBooking: React.FC = () => {
  const { timeline } = useOutletContext<Ctx>();
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
        </div>
      </div>
    );
  }

  const cd = timeline.customerDetails;
  const callDone = timeline.welcomeCall?.Outcome === "Welcomed";
  const detailsDone = !!cd?.IsComplete;
  const agreementStarted = !!timeline.agreement;

  const bookingSteps: { label: string; state: StepState; note?: string }[] = [
    { label: "Booking Confirmed", state: "done", note: fmtDate(booking.BookingDate) },
    { label: "Welcome Call", state: callDone ? "done" : "current", note: timeline.welcomeCall?.Outcome || "Pending" },
    { label: "Details on File", state: detailsDone ? "done" : callDone ? "current" : "upcoming", note: detailsDone ? "Complete" : "Pending" },
    { label: "Agreement Prep", state: agreementStarted ? "done" : detailsDone ? "current" : "upcoming" },
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
        </div>
      </div>

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

      {/* Customer details status */}
      <div
        className="rounded-2xl p-5"
        style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
      >
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: TEXT_FAINT }}>Your Details on File</p>
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: detailsDone ? "rgba(5,150,105,0.10)" : GOLD_SOFT, color: detailsDone ? "#059669" : GOLD }}
          >
            {detailsDone ? <CheckCircle2 size={16} /> : <User size={16} />}
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: TEXT }}>
              {detailsDone ? "All details collected — thank you" : "Being collected by our team"}
            </p>
            <p className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>
              Bank account, PAN and Aadhaar details are needed before agreement preparation.
              {!detailsDone && " Please have these ready when our team calls."}
            </p>
          </div>
        </div>
      </div>

      {/* Additional charges */}
      {(booking.ParkingTotal > 0 || booking.ExtraChargesTotal > 0) && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
        >
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
            <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: GOLD_SOFT, color: GOLD }}>
              <Landmark size={14} />
            </span>
            <h2 className="text-sm font-semibold" style={{ ...serif, color: TEXT }}>Additional Charges</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 p-5">
            <InfoField label={booking.IsPlotSale ? "Land Value" : "Unit Value"} value={fmtMoney(booking.TotalValue)} />
            {booking.ParkingTotal > 0 && <InfoField label="Parking" value={fmtMoney(booking.ParkingTotal)} />}
            {booking.ExtraChargesTotal > 0 && <InfoField label="Extra Charges" value={fmtMoney(booking.ExtraChargesTotal)} />}
            <InfoField label="Grand Total" value={fmtMoney(booking.GrandTotal)} />
          </div>
        </div>
      )}
    </div>
  );
};

export default PortalBooking;
