// The live "cost + GST" preview shown wherever unit, parking or extra-charge values are picked.
import React from "react";
import { useGstRates, computeUnitParkingGst, fmtInr } from "@/lib/crmGst";

// Live "cost + GST" preview shown at every point Unit/Parking/Extra Charges
// values are picked — Application's Project/Unit and Parking steps, and
// (via the same component reused in CrmBookingDetail.tsx) the Booking's own
// Parking & Extra Charges tab. Rate is always fetched live from HSN Master
// (useGstRates), never hardcoded — this is a preview of the exact same fixed
// rule the backend enforces (crmGst.js), not a separate/independent guess.
export const GstBreakdownBox: React.FC<{ unitValue: number; parkingBase: number }> = ({ unitValue, parkingBase }) => {
  const { data: rates, isLoading } = useGstRates();
  if (isLoading || !rates) {
    return <p className="text-[0.6875rem] text-muted-foreground">Loading GST rates from HSN Master…</p>;
  }
  const gst = computeUnitParkingGst(unitValue, parkingBase, rates);
  return (
    <div className=" border border-foreground/30 bg-card px-3 py-2 text-xs space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-foreground font-medium">GST ({gst.hsnCode}) — fixed, from HSN Master</span>
        <span className="text-foreground font-semibold">{gst.rate}%</span>
      </div>

      {/* Follows the exact stated formula, in this exact order:
          Unit (+ its own GST), Parking (+ its own GST) -> Amount (Unit +
          Parking, pre-tax) -> GST (combined) -> Total Amount. No row repeats
          a figure another row already shows. */}
      <div className="flex items-center justify-between text-foreground">
        <span>Unit</span>
        <span>{fmtInr(gst.unitBase)}</span>
      </div>
      <div className="flex items-center justify-between text-foreground pl-2">
        <span>Unit GST ({gst.rate}%)</span>
        <span>{fmtInr(gst.unitGstAmount)}</span>
      </div>
      {gst.parkingBase > 0 && (
        <>
          <div className="flex items-center justify-between text-foreground">
            <span>Parking</span>
            <span>{fmtInr(gst.parkingBase)}</span>
          </div>
          <div className="flex items-center justify-between text-foreground pl-2">
            <span>Parking GST ({gst.rate}%)</span>
            <span>{fmtInr(gst.parkingGstAmount)}</span>
          </div>
        </>
      )}

      <div className="flex items-center justify-between border-t border-foreground/30 pt-1 text-foreground">
        <span>Amount (Unit{gst.parkingBase > 0 ? " + Parking" : ""})</span>
        <span className="font-medium">{fmtInr(gst.base)}</span>
      </div>
      <div className="flex items-center justify-between text-foreground">
        <span>GST</span>
        <span className="font-medium">{fmtInr(gst.gstAmount)}</span>
      </div>
      <div className="flex items-center justify-between border-t border-foreground/30 pt-1 font-semibold text-foreground">
        <span>Total Amount</span>
        <span>{fmtInr(gst.total)}</span>
      </div>
      <p className="text-[0.625rem] text-foreground">
        {gst.base <= 4500000
          ? "At or under ₹45L — 1% bracket applies."
          : "Over ₹45L — 5% bracket applies."} Crosses automatically as Parking is added or changed — never editable here.
      </p>
    </div>
  );
};

export const GstGrandTotalText: React.FC<{ unitValue: number; parkingBase: number }> = ({ unitValue, parkingBase }) => {
  const { data: rates } = useGstRates();
  if (!rates) return <>—</>;
  const gst = computeUnitParkingGst(unitValue, parkingBase, rates);
  return <>{fmtInr(gst.total)}</>;
};
