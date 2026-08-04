const { sql } = require("../db");

// Fixed business rule (migration 283) — never a per-booking input, never
// editable anywhere except by editing the HSN Master rows themselves:
//   Unit Value + Parking (pre-tax) <= Rs. 45 Lakh  -> HSN 9954AFH (1%)
//   Unit Value + Parking (pre-tax) >  Rs. 45 Lakh  -> HSN 9954OTH (5%)
//   Extra Work (Extra Charges)                     -> HSN 9954EXW (18%), always
// Parking used to carry its own independent GST (ParkingMaster.GstRate) —
// that's now fully replaced by whichever of the two rates above the
// Unit+Parking bracket resolves to, since Parking is priced as part of that
// same bracket, not a separate line item with its own tax rule. Extra
// Charges keep their own per-item HSN-18% pricing (crmExtraCharges.js) —
// this file only sums those already-correct amounts, never re-taxes them.
const UNIT_PARKING_THRESHOLD = 4500000; // Rs. 45,00,000
const AFFORDABLE_HSN_CODE = "9954AFH";
const OTHER_RESIDENTIAL_HSN_CODE = "9954OTH";
const EXTRA_WORK_HSN_CODE = "9954EXW";

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Combined CGST+SGST is the real intra-state rate every other rate in this
// app is quoted as (1%, 5%, 18%) — IGST is the same total rate split
// differently for inter-state, so it's only a fallback when CGST/SGST
// aren't populated on a given HSN row.
async function getHsnRate(pool, hcode) {
  const r = await pool.request().input("code", sql.VarChar(20), hcode)
    .query("SELECT HCGST, HSGST, HIGST FROM dbo.HSN WHERE HCode = @code AND HStatus = 1");
  const row = r.recordset[0];
  if (!row) return 0;
  const cgst = Number(row.HCGST || 0);
  const sgst = Number(row.HSGST || 0);
  return cgst + sgst > 0 ? cgst + sgst : Number(row.HIGST || 0);
}

// The single source of truth for ParkingTotal/ExtraChargesTotal/GrandTotal
// AND the fixed HSN-driven GST — merged into one function (rather than two
// separate rollups) so milestones are always redistributed
// (recalculateRemainingMilestones, called by the two rollupBookingTotals
// callers right after this) against the truly final GrandTotal, not a
// transient pre-repricing value.
//
// Order matters: Parking's own per-allotment rate must be resolved and
// written FIRST (it depends on the bracket, which depends on Parking's own
// pre-tax base — not circular, since the bracket only needs pre-tax
// amounts), then ParkingTotal is re-derived from the now-repriced rows.
async function recalculateBookingGst(pool, bookingId) {
  if (!bookingId) return null;

  const bookingRow = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT TotalValue FROM dbo.CrmBooking WHERE Id = @bid");
  const booking = bookingRow.recordset[0];
  if (!booking) return null;
  const totalValue = Number(booking.TotalValue || 0);

  // Pre-tax parking base (RateSnapshot x Quantity) — NOT CrmParkingAllotment
  // .TotalAmount, which already has a (possibly stale) tax baked in from the
  // last time this ran.
  const parkingBaseRow = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT ISNULL(SUM(RateSnapshot * Quantity), 0) AS Base FROM dbo.CrmParkingAllotment WHERE BookingId = @bid AND IsActive = 1");
  const parkingBase = Number(parkingBaseRow.recordset[0].Base || 0);

  const unitParking = totalValue + parkingBase;
  const hsnCode = unitParking <= UNIT_PARKING_THRESHOLD ? AFFORDABLE_HSN_CODE : OTHER_RESIDENTIAL_HSN_CODE;
  const unitParkingRate = await getHsnRate(pool, hsnCode);

  // Reprice every active parking allotment to this same resolved rate —
  // Parking is part of the Unit+Parking bracket, not independently taxed.
  await pool.request()
    .input("bid", sql.Int, bookingId)
    .input("r", sql.Decimal(5, 2), unitParkingRate)
    .query(`
      UPDATE dbo.CrmParkingAllotment SET
        GstRateSnapshot = @r,
        GstAmount = ROUND((RateSnapshot * Quantity) * @r / 100, 2),
        TotalAmount = (RateSnapshot * Quantity) + ROUND((RateSnapshot * Quantity) * @r / 100, 2)
      WHERE BookingId = @bid AND IsActive = 1
    `);

  const parkingTotalRow = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT ISNULL(SUM(TotalAmount), 0) AS Total FROM dbo.CrmParkingAllotment WHERE BookingId = @bid AND IsActive = 1");
  const parkingTotal = Number(parkingTotalRow.recordset[0].Total || 0);

  // Extra Charges already carry their own correct, per-item HSN-18% GstAmount
  // (crmExtraCharges.js) — sum those directly rather than re-taxing
  // ExtraChargesTotal, which is itself already GST-inclusive.
  const extraRow = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT ISNULL(SUM(TotalAmount), 0) AS Total, ISNULL(SUM(GstAmount), 0) AS Gst
    FROM dbo.CrmExtraCharge WHERE BookingId = @bid AND IsActive = 1
  `);
  const extraChargesTotal = Number(extraRow.recordset[0].Total || 0);
  const extraWorkGstAmount = round2(extraRow.recordset[0].Gst || 0);

  const unitParkingGstAmount = round2(unitParking * unitParkingRate / 100);
  const totalGstAmount = round2(unitParkingGstAmount + extraWorkGstAmount);
  const grandTotal = round2(totalValue + parkingTotal + extraChargesTotal);

  await pool.request()
    .input("bid", sql.Int, bookingId)
    .input("pt", sql.Decimal(18, 2), parkingTotal)
    .input("et", sql.Decimal(18, 2), extraChargesTotal)
    .input("gt", sql.Decimal(18, 2), grandTotal)
    .input("hsn", sql.VarChar(20), hsnCode)
    .input("upr", sql.Decimal(5, 2), unitParkingRate)
    .input("upg", sql.Decimal(18, 2), unitParkingGstAmount)
    .input("ewg", sql.Decimal(18, 2), extraWorkGstAmount)
    .input("tg", sql.Decimal(18, 2), totalGstAmount)
    .query(`
      UPDATE dbo.CrmBooking SET
        ParkingTotal = @pt, ExtraChargesTotal = @et, GrandTotal = @gt,
        HsnCode = @hsn,
        UnitParkingGstRate = @upr, UnitParkingGstAmount = @upg,
        ExtraWorkGstAmount = @ewg, TotalGstAmount = @tg
      WHERE Id = @bid
    `);

  return {
    hsnCode, unitParkingRate, unitParkingGstAmount,
    extraWorkGstAmount, totalGstAmount,
    parkingTotal, extraChargesTotal, grandTotal,
  };
}

module.exports = {
  recalculateBookingGst,
  getHsnRate,
  UNIT_PARKING_THRESHOLD,
  AFFORDABLE_HSN_CODE,
  OTHER_RESIDENTIAL_HSN_CODE,
  EXTRA_WORK_HSN_CODE,
};
