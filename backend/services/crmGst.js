const { sql } = require("../db");
const { resolveOcCcGate } = require("./crmWorkflowGuards");

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

/**
 * GST exemption on post-OC/CC sales — Schedule III, Entry 5 of the CGST Act
 * 2017: sale of a completed building is neither a supply of goods nor of
 * services (i.e. outside GST entirely) once the ENTIRE sale consideration
 * is received after OC or CC is issued (whichever is earlier) — not merely
 * once the certificate exists. A single rupee of pre-certificate payment
 * disqualifies the WHOLE booking; there is no partial exemption. This is a
 * unit/block-level rule in practice (a block's units all share one
 * certificate), which is exactly why block-level OC/CC exists (migration
 * 447, resolveOcCcGate in crmWorkflowGuards.js) — a project-wide blanket
 * flag couldn't represent this correctly for a multi-block project where
 * only some blocks are finished.
 *
 * Per business decision, exemption (once it applies) covers the whole
 * booking: Unit price, Parking, AND Extra Charges — not just the unit.
 *
 * Returns { exempt: boolean, certDate: Date|null } — certDate is surfaced
 * so callers/UI can explain *why* (e.g. "OC received 12-Jun, first payment
 * 20-Jun").
 */
async function checkGstExemption(pool, bookingId) {
  // resolveOcCcGate with no certType returns whichever of OC/CC/OC+CC was
  // Received earliest for this booking's block (falling back to the
  // project's blanket cert) — exactly "OC or CC, whichever is earlier."
  const gate = await resolveOcCcGate(pool, bookingId);
  if (!gate.received) return { exempt: false, certDate: null };

  const paidRow = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT MIN(d) AS EarliestPaid FROM (
      SELECT MIN(cr.ReceivedDate) AS d
      FROM dbo.CrmPaymentReceipt cr
      JOIN dbo.CrmPaymentMilestone m ON m.Id = cr.MilestoneId
      WHERE m.BookingId = @bid
      UNION ALL
      SELECT MIN(ReceivedDate) FROM dbo.CrmOnAccountPayment WHERE BookingId = @bid
    ) x
  `);
  const earliestPaid = paidRow.recordset[0]?.EarliestPaid || null;

  // No real money received yet -> trivially "everything received so far"
  // happened after the cert (there's nothing before it). Once a payment
  // does land, it's checked properly on the very next recalculation.
  const exempt = !earliestPaid || new Date(earliestPaid) >= new Date(gate.receivedDate);
  return { exempt, certDate: gate.receivedDate };
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
  if (bookingId == null) return null;

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

  // GST exemption check (Schedule III Entry 5 — see checkGstExemption doc
  // comment) runs before any rate resolution. When it applies, skip the
  // HSN bracket entirely: HsnCode is cleared and every GST figure — Unit,
  // Parking, AND Extra Charges, per business decision — goes to zero. This
  // re-runs every time GST is recalculated (booking edit, parking/extra-
  // charge change), so a booking correctly gains exemption the moment its
  // block's OC/CC clears with payment timing already satisfied, and would
  // correctly lose it again if that were ever no longer true — nothing is
  // cached beyond these same columns.
  const { exempt } = await checkGstExemption(pool, bookingId);

  const hsnCode = exempt ? null : (totalValue + parkingBase <= UNIT_PARKING_THRESHOLD ? AFFORDABLE_HSN_CODE : OTHER_RESIDENTIAL_HSN_CODE);
  const unitParkingRate = exempt ? 0 : await getHsnRate(pool, hsnCode);

  // Reprice every active parking allotment to this same resolved rate (0
  // when exempt) — Parking is part of the Unit+Parking bracket, not
  // independently taxed, so it shares the bracket's exemption too.
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

  // Extra Charges normally carry their own correct, per-item HSN-18%
  // GstAmount (crmExtraCharges.js) — summed directly rather than re-taxing
  // ExtraChargesTotal, which is itself already GST-inclusive. When exempt,
  // zero each active row's own Gst columns too (they're stored separately
  // from CrmBooking and getGstSplit doesn't touch them) before summing.
  if (exempt) {
    await pool.request().input("bid", sql.Int, bookingId).query(`
      UPDATE dbo.CrmExtraCharge SET GstRate = 0, GstAmount = 0, TotalAmount = Amount
      WHERE BookingId = @bid AND IsActive = 1
    `);
  }
  const extraRow = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT ISNULL(SUM(TotalAmount), 0) AS Total, ISNULL(SUM(GstAmount), 0) AS Gst
    FROM dbo.CrmExtraCharge WHERE BookingId = @bid AND IsActive = 1
  `);
  const extraChargesTotal = Number(extraRow.recordset[0].Total || 0);
  const extraWorkGstAmount = round2(extraRow.recordset[0].Gst || 0);

  // Unit's own GST portion (tax-exclusive base -> add tax on top, same
  // convention Parking/Extra Charges already use). Computed on its own
  // (not just implied inside the combined unitParkingGstAmount below) so it
  // can be added into grandTotal explicitly instead of only being displayed.
  const unitGstAmount = round2(totalValue * unitParkingRate / 100);

  // unitParkingGstAmount is the combined Unit+Parking tax figure shown to
  // the customer as one bracket-level number — Unit's portion (above) plus
  // whatever Parking's repriced rows actually summed to (parkingTotal minus
  // its own pre-tax base), computed from the real per-row rounding rather
  // than re-deriving it from the combined base, so this always matches what
  // grandTotal actually collects to the paisa.
  const parkingGstAmount = round2(parkingTotal - parkingBase);
  const unitParkingGstAmount = round2(unitGstAmount + parkingGstAmount);
  const totalGstAmount = round2(unitParkingGstAmount + extraWorkGstAmount);

  // GrandTotal = Unit (base + its GST) + Parking (base + its GST, already
  // inclusive in parkingTotal) + Extra Charges (base + its GST, already
  // inclusive in extraChargesTotal). Every rupee of tax shown anywhere on
  // this booking is now actually inside the amount the milestone schedule
  // collects.
  const grandTotal = round2(totalValue + unitGstAmount + parkingTotal + extraChargesTotal);

  await pool.request()
    .input("bid", sql.Int, bookingId)
    .input("pt", sql.Decimal(18, 2), parkingTotal)
    .input("et", sql.Decimal(18, 2), extraChargesTotal)
    .input("gt", sql.Decimal(18, 2), grandTotal)
    .input("hsn", sql.VarChar(20), hsnCode)
    .input("upr", sql.Decimal(5, 2), unitParkingRate)
    .input("ug", sql.Decimal(18, 2), unitGstAmount)
    .input("pg", sql.Decimal(18, 2), parkingGstAmount)
    .input("upg", sql.Decimal(18, 2), unitParkingGstAmount)
    .input("ewg", sql.Decimal(18, 2), extraWorkGstAmount)
    .input("tg", sql.Decimal(18, 2), totalGstAmount)
    .query(`
      UPDATE dbo.CrmBooking SET
        ParkingTotal = @pt, ExtraChargesTotal = @et, GrandTotal = @gt,
        HsnCode = @hsn,
        UnitParkingGstRate = @upr, UnitGstAmount = @ug, ParkingGstAmount = @pg,
        UnitParkingGstAmount = @upg, ExtraWorkGstAmount = @ewg, TotalGstAmount = @tg
      WHERE Id = @bid
    `);


  return {
    hsnCode, unitParkingRate, unitGstAmount, parkingGstAmount, unitParkingGstAmount,
    extraWorkGstAmount, totalGstAmount,
    parkingTotal, extraChargesTotal, grandTotal,
    isGstExempt: exempt,
  };
}

module.exports = {
  recalculateBookingGst,
  checkGstExemption,
  getHsnRate,
  UNIT_PARKING_THRESHOLD,
  AFFORDABLE_HSN_CODE,
  OTHER_RESIDENTIAL_HSN_CODE,
  EXTRA_WORK_HSN_CODE,
};