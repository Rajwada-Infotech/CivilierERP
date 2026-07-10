import React from "react";
import { useOutletContext } from "react-router-dom";
import { Building2, Phone, CheckCircle2, Circle, User, Landmark } from "lucide-react";
import { fmtMoney, fmtDate } from "./portalApi";
import { PageHeader, Card, CardHeader, InfoField, StatusPill, Stepper, StepState } from "./portalTheme";

type Ctx = { me: any; timeline: any };

const PortalBooking: React.FC = () => {
  const { timeline } = useOutletContext<Ctx>();
  const booking = timeline.booking;

  if (!booking) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="My Property" title="My Booking" />
        <Card className="p-8 text-center text-sm text-slate-500">
          You don't have an active booking yet. Once your unit is confirmed, it'll show up here.
        </Card>
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

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="My Property" title="My Booking" subtitle="Everything about your unit, in one place." />

      <Card className="p-5">
        <Stepper steps={bookingSteps} />
      </Card>

      <Card>
        <CardHeader icon={Building2} title="Unit & Booking Details" action={<StatusPill status={booking.BookingStatus} />} />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-5">
          <InfoField label="Booking No." value={booking.BookingNo} mono />
          <InfoField label="Project" value={booking.ProjectName} />
          <InfoField label="Unit No." value={booking.UnitNo} />
          <InfoField label="Token Type" value={booking.TokenType} />
          <InfoField label="Token Value" value={booking.TokenType === "Amount" ? fmtMoney(booking.TokenValue) : `${booking.TokenValue ?? "—"}%`} />
          <InfoField label="Total Value" value={fmtMoney(booking.TotalValue)} />
          <InfoField label="Booking Amount" value={fmtMoney(booking.BookingAmount)} />
          <InfoField label="Booking Date" value={fmtDate(booking.BookingDate)} />
        </div>
      </Card>

      <Card>
        <CardHeader icon={Phone} title="Welcome Call" />
        <div className="p-5">
          {timeline.welcomeCall ? (
            <div className="flex items-center gap-2">
              {callDone ? <CheckCircle2 size={16} style={{ color: "#0F7A44" }} /> : <Circle size={16} className="text-amber-500" />}
              <span className="text-sm font-medium text-slate-700">{timeline.welcomeCall.Outcome || "Pending"}</span>
              {timeline.welcomeCall.CallDate && <span className="text-xs text-slate-400">· {fmtDate(timeline.welcomeCall.CallDate)}</span>}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Our team will reach out to you shortly for your welcome call.</p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader icon={User} title="Your Details on File" />
        <div className="p-5">
          <div className="flex items-center gap-2 mb-1">
            {detailsDone ? <CheckCircle2 size={16} style={{ color: "#0F7A44" }} /> : <Circle size={16} className="text-amber-500" />}
            <span className="text-sm font-medium text-slate-700">
              {detailsDone ? "Complete — thank you!" : "Being completed by our team"}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Bank account, nominee, PAN and Aadhaar details are collected by our sales team before agreement preparation.
            {!detailsDone && " Please have these ready when they call."}
          </p>
        </div>
      </Card>

      {(booking.ParkingTotal > 0 || booking.ExtraChargesTotal > 0) && (
        <Card>
          <CardHeader icon={Landmark} title="Additional Charges" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-5">
            <InfoField label="Unit Value" value={fmtMoney(booking.TotalValue)} />
            {booking.ParkingTotal > 0 && <InfoField label="Parking" value={fmtMoney(booking.ParkingTotal)} />}
            {booking.ExtraChargesTotal > 0 && <InfoField label="Extra Charges" value={fmtMoney(booking.ExtraChargesTotal)} />}
            <InfoField label="Grand Total" value={fmtMoney(booking.GrandTotal)} />
          </div>
        </Card>
      )}
    </div>
  );
};

export default PortalBooking;
