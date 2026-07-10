import React from "react";
import { useOutletContext } from "react-router-dom";
import { Building2, Phone, CheckCircle2, Circle, User, Landmark } from "lucide-react";
import { fmtMoney, fmtDate } from "./portalApi";

type Ctx = { me: any; timeline: any };

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-800 mt-0.5">{value ?? "—"}</p>
    </div>
  );
}

function SectionCard({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm space-y-4">
      <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center"><Icon size={14} /></span>
        {title}
      </h2>
      {children}
    </div>
  );
}

const PortalBooking: React.FC = () => {
  const { timeline } = useOutletContext<Ctx>();
  const booking = timeline.booking;

  if (!booking) {
    return (
      <div className="rounded-2xl border border-violet-100 bg-white p-8 text-center text-sm text-slate-500">
        You don't have an active booking yet. Once your unit is confirmed, it'll show up here.
      </div>
    );
  }

  const cd = timeline.customerDetails;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-heading text-slate-800">My Booking</h1>
        <p className="text-sm text-slate-500 mt-0.5">Everything about your unit, in one place.</p>
      </div>

      <SectionCard icon={Building2} title="Unit & Booking Details">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <InfoRow label="Booking No." value={booking.BookingNo} />
          <InfoRow label="Status" value={<span className="text-emerald-600 font-semibold">{booking.BookingStatus}</span>} />
          <InfoRow label="Project" value={booking.ProjectName} />
          <InfoRow label="Unit No." value={booking.UnitNo} />
          <InfoRow label="Token Type" value={booking.TokenType} />
          <InfoRow label="Token Value" value={booking.TokenType === "Amount" ? fmtMoney(booking.TokenValue) : `${booking.TokenValue ?? "—"}%`} />
          <InfoRow label="Total Value" value={fmtMoney(booking.TotalValue)} />
          <InfoRow label="Booking Amount" value={fmtMoney(booking.BookingAmount)} />
          <InfoRow label="Booking Date" value={fmtDate(booking.BookingDate)} />
        </div>
      </SectionCard>

      <SectionCard icon={Phone} title="Welcome Call">
        {timeline.welcomeCall ? (
          <div className="flex items-center gap-2">
            {timeline.welcomeCall.Outcome === "Welcomed" ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Circle size={16} className="text-amber-500" />}
            <span className="text-sm font-medium text-slate-700">{timeline.welcomeCall.Outcome || "Pending"}</span>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Our team will reach out to you shortly for your welcome call.</p>
        )}
      </SectionCard>

      <SectionCard icon={User} title="Your Details on File">
        <div className="flex items-center gap-2 mb-1">
          {cd?.IsComplete ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Circle size={16} className="text-amber-500" />}
          <span className="text-sm font-medium text-slate-700">
            {cd?.IsComplete ? "Complete — thank you!" : "Being completed by our team"}
          </span>
        </div>
        <p className="text-xs text-slate-500">
          Bank account, nominee, PAN and Aadhaar details are collected by our sales team before agreement preparation.
          {!cd?.IsComplete && " Please have these ready when they call."}
        </p>
      </SectionCard>

      {(booking.ParkingTotal > 0 || booking.ExtraChargesTotal > 0) && (
        <SectionCard icon={Landmark} title="Additional Charges">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <InfoRow label="Unit Value" value={fmtMoney(booking.TotalValue)} />
            {booking.ParkingTotal > 0 && <InfoRow label="Parking" value={fmtMoney(booking.ParkingTotal)} />}
            {booking.ExtraChargesTotal > 0 && <InfoRow label="Extra Charges" value={fmtMoney(booking.ExtraChargesTotal)} />}
            <InfoRow label="Grand Total" value={<span className="text-violet-600 font-bold">{fmtMoney(booking.GrandTotal)}</span>} />
          </div>
        </SectionCard>
      )}
    </div>
  );
};

export default PortalBooking;
