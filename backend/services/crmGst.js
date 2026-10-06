const { sql } = require("../db");
const { resolveOcCcGate } = require("./crmWorkflowGuards");
const { getBookingLandSplit, getBookingCommercial } = require("./projectType");
const { resolveHsnCode, APPLIES_TO } = require("./gstRules");

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

// A constructed Unit Master record points back to every source plot through
// PlotMaster.ConvertedUnitId. Construction is on customer-owned land only
// when the booking customer already owns every one of those plots under an
// active land booking; a villa sold together with its land deliberately
// resolves false rather than being misclassified as a works contract.
async function resolveLandOwnedByBookingCustomer(pool, bookingId) {
  const result = await pool.request().input("bid", sql.Int, bookingId).query(`
    -- Every constructed unit on this booking, not just its primary one.
    --
    -- This used to read b.UnitId alone. Migration 505 made a booking a header
    -- with CrmBookingUnit lines, so a booking carrying several villas would
    -- have had only its primary unit examined — the rest silently escaping the
    -- works-contract test, and once a CONSTRUCTION_ON_CUSTOMER_LAND rule
    -- exists, silently taking the wrong rate.
    --
    -- The UNION's second arm is the pre-485 fallback and is guarded on the
    -- absence of lines, so a booking with lines cannot also pull in its
    -- primary UnitId and double-count. UNION (not UNION ALL) de-duplicates the
    -- same unit appearing twice.
    WITH BookingUnits AS (
      SELECT l.UnitId
      FROM dbo.CrmBookingUnit l
      WHERE l.BookingId = @bid AND l.Status = N'Active' AND l.UnitId IS NOT NULL
      UNION
      SELECT b.UnitId
      FROM dbo.CrmBooking b
      WHERE b.Id = @bid AND b.UnitId IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM dbo.CrmBookingUnit l2
          WHERE l2.BookingId = @bid AND l2.Status = N'Active'
        )
    ),
    BuyingCustomer AS (
      SELECT a.CustomerId
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.Id = @bid
    )
    SELECT
      (SELECT COUNT(DISTINCT p.Id)
         FROM dbo.PlotMaster p
         JOIN BookingUnits bu ON bu.UnitId = p.ConvertedUnitId
         WHERE p.IsActive = 1) AS SourcePlotCount,
      (SELECT COUNT(DISTINCT p.Id)
         FROM dbo.PlotMaster p
         JOIN BookingUnits bu ON bu.UnitId = p.ConvertedUnitId
         JOIN dbo.CrmBookingPlot bp ON bp.PlotId = p.Id AND bp.Status = N'Active'
         JOIN dbo.CrmBooking landBooking ON landBooking.Id = bp.BookingId
         JOIN dbo.CrmApplication landApplication ON landApplication.Id = landBooking.ApplicationId
         WHERE p.IsActive = 1
           AND landBooking.IsActive = 1
           AND landBooking.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred')
           AND landApplication.CustomerId = (SELECT CustomerId FROM BuyingCustomer)
      ) AS CustomerOwnedPlotCount
  `);
  const row = result.recordset[0];
  const sourceCount = Number(row?.SourcePlotCount || 0);
  return sourceCount > 0 && Number(row?.CustomerOwnedPlotCount || 0) === sourceCount;
}


/**
 * THE single place the Unit+Parking HSN bracket is decided.
 *
 * This test used to be written out in three places — here, crmParking.js and
 * applicationFormPdf.js — each comparing against the UNIT_PARKING_THRESHOLD
 * constant directly. Once migration 507 made the bands editable master data,
 * that duplication became a real inconsistency rather than mere repetition:
 * moving the threshold in dbo.CrmGstRule changed the booking's GST while
 * parking pricing and the customer's printed application form carried on using
 * the hardcoded Rs 45 lakh. The quote and the invoice would simply disagree.
 *
 * The constants remain ONLY as a fallback for an empty or non-matching rule
 * table. That is deliberate: a GST engine that stopped taxing because someone
 * deactivated a master row would be far worse than one that carried on as it
 * always had. `fromRule` is returned so a caller can tell the two apart — the
 * fallback is safe, but it should not be invisible.
 */
async function resolveUnitParkingHsn(pool, bracketBase, opts = {}) {
  const resolved = await resolveHsnCode(pool, APPLIES_TO.UNIT_PARKING, {
    value: bracketBase,
    landOwnedByCustomer: opts.landOwnedByCustomer ?? null,
    // Commercial vs residential (migration 526) — from the unit's kind.
    commercial: opts.commercial ?? null,
  });
  if (resolved.hsnCode) return { hsnCode: resolved.hsnCode, fromRule: true, ruleName: resolved.ruleName };
  return {
    hsnCode: bracketBase <= UNIT_PARKING_THRESHOLD ? AFFORDABLE_HSN_CODE : OTHER_RESIDENTIAL_HSN_CODE,
    fromRule: false,
    ruleName: null,
  };
}


/**
 * The Extra Work (extra charges) HSN, from the master.
 *
 * Migration 507 seeded an EXTRA_WORK rule, but every caller kept using the
 * EXTRA_WORK_HSN_CODE constant directly — so the rule existed and did nothing.
 * The same contradiction as the Unit+Parking bracket: change the rule and the
 * charge keeps its old rate, while the application form keeps PRINTING the old
 * HSN to the customer.
 *
 * Unbanded, so no value is passed. Same fallback contract as
 * resolveUnitParkingHsn: the constant stands in when nothing matches, and
 * fromRule says which answer this is.
 */
async function resolveExtraWorkHsn(pool, { landSale = false } = {}) {
  // A plot sale's charges have their own rule (EXTRA_WORK_LAND — 0% by
  // business decision, migration 524); without one, the ordinary rule applies.
  if (landSale) {
    const land = await resolveHsnCode(pool, APPLIES_TO.EXTRA_WORK_LAND, { value: 0 });
    if (land.hsnCode) return { hsnCode: land.hsnCode, fromRule: true, ruleName: land.ruleName };
  }
  const resolved = await resolveHsnCode(pool, APPLIES_TO.EXTRA_WORK, { value: 0 });
  if (resolved.hsnCode) return { hsnCode: resolved.hsnCode, fromRule: true, ruleName: resolved.ruleName };
  return { hsnCode: EXTRA_WORK_HSN_CODE, fromRule: false, ruleName: null };
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

  // Land is outside GST (see getBookingLandSplit). A purely-land booking
  // therefore behaves exactly like an exempt one — no HSN, no rate, every GST
  // figure zero — while a mixed land+villa booking taxes only its construction
  // half. Tracked separately from `exempt` rather than folded into it because
  // the two are different facts: one is a completed-building exemption the
  // booking can gain or lose over time, the other is what was sold.
  const split = await getBookingLandSplit(pool, bookingId, totalValue);
  const outsideGst = exempt || split.isPureLand;

  // The bracket is an affordable-HOUSING test, so it sees construction value
  // only. For an all-flat booking constructionValue === totalValue and this is
  // byte-for-byte the previous behaviour.
  const bracketBase = split.constructionValue + parkingBase;

  // WHICH HSN applies now comes from dbo.CrmGstRule (migration 507) so the
  // threshold and the works-contract question are editable master data rather
  // than constants in this file. The RATE still comes from dbo.HSN via
  // getHsnRate below — one place for rates, one place for selection.
  //
  // The constants above remain as the fallback: if the rule table is empty or
  // nothing matches, behaviour is exactly what it was before 487. A GST engine
  // that stopped taxing because someone deactivated a master row would be far
  // worse than one that carried on as it always had.
  let hsnCode = null;
  if (!outsideGst) {
    const landOwnedByCustomer = await resolveLandOwnedByBookingCustomer(pool, bookingId);
    const commercial = await getBookingCommercial(pool, bookingId);
    hsnCode = (await resolveUnitParkingHsn(pool, bracketBase, { landOwnedByCustomer, commercial })).hsnCode;
  }
  const unitParkingRate = outsideGst ? 0 : await getHsnRate(pool, hsnCode);

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
  //
  // DELIBERATELY `exempt` AND NOT `outsideGst`: a land sale does not zero Extra
  // Charges. The completed-building exemption was a business decision to cover
  // the entire booking, but Extra Charges on a plot (legal, documentation,
  // development work) are separate supplies of SERVICES and remain taxable at
  // 18% even though the land itself is not a supply at all. Flagged for
  // confirmation with the finance team — if they want them zero-rated on land
  // sales too, this one condition becomes `outsideGst`.
  if (exempt) {
    await pool.request().input("bid", sql.Int, bookingId).query(`
      UPDATE dbo.CrmExtraCharge SET GstRate = 0, GstAmount = 0, TotalAmount = Amount
      WHERE BookingId = @bid AND IsActive = 1
    `);
  } else if (split.isPureLand) {
    // A plot sale's charges take the EXTRA_WORK_LAND rule's rate (0% by
    // business decision) — re-applied here so charges added before the rule
    // existed, or before the rate was changed in the HSN master, follow it.
    const landRate = await getHsnRate(pool, (await resolveExtraWorkHsn(pool, { landSale: true })).hsnCode);
    await pool.request().input("bid", sql.Int, bookingId).input("r", sql.Decimal(5, 2), landRate).query(`
      UPDATE dbo.CrmExtraCharge SET GstRate = @r, GstAmount = ROUND(Amount * @r / 100, 2), TotalAmount = Amount + ROUND(Amount * @r / 100, 2)
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
  // Charged on the CONSTRUCTION half only. Identical to the old
  // `totalValue * rate` for every all-flat booking, and the difference that
  // matters for a land+villa package: the land half is never taxed.
  const unitGstAmount = round2(split.constructionValue * unitParkingRate / 100);

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
    // Surfaced so a caller or the UI can say WHY there is no tax — a completed
    // building (exempt) and a sale of land (not a supply) both produce zero GST
    // but are different facts, and GST returns report them differently.
    isLandSale: split.isPureLand,
    landValue: split.landValue,
    constructionValue: split.constructionValue,
  };
}

/**
 * Is this booking / application a plot (land) sale? Plot lines are the
 * structural fact (CrmBookingPlot / CrmApplicationPlot), never a label.
 */
async function isLandSale(pool, { bookingId = null, applicationId = null } = {}) {
  if (bookingId != null) {
    return (await pool.request().input("id", sql.Int, bookingId)
      .query("SELECT TOP 1 1 AS x FROM dbo.CrmBookingPlot WHERE BookingId = @id")).recordset.length > 0;
  }
  if (applicationId != null) {
    return (await pool.request().input("id", sql.Int, applicationId)
      .query("SELECT TOP 1 1 AS x FROM dbo.CrmApplicationPlot WHERE ApplicationId = @id AND Status = N'Active'")).recordset.length > 0;
  }
  return false;
}

/**
 * GST on the developer's fee for a plot resale / transfer — the only developer
 * income in a resale (the land price passes between the buyers, outside GST).
 *
 * Which HSN: the RESALE_FEE rule in dbo.CrmGstRule. The rate: that HSN row.
 * Unlike the unit bracket there is no constant fallback: a fee is a small,
 * explicit charge, and silently taxing it at 0% because a master row is
 * missing would be worse than refusing — so a missing rule or HSN row is an
 * error the caller shows to the user.
 */
class GstSetupError extends Error {}
async function resolveResaleFeeGst(pool, feeAmount, { landSale = false } = {}) {
  const fee = Math.round((Number(feeAmount) || 0) * 100) / 100;
  if (fee <= 0) return { hsnCode: null, rate: 0, gstAmount: 0 };
  // A plot resale's fee has its own rule (RESALE_FEE_LAND); otherwise RESALE_FEE.
  let resolved = landSale ? await resolveHsnCode(pool, APPLIES_TO.RESALE_FEE_LAND, { value: fee }) : { hsnCode: null };
  if (!resolved.hsnCode) resolved = await resolveHsnCode(pool, APPLIES_TO.RESALE_FEE, { value: fee });
  if (!resolved.hsnCode) {
    throw new GstSetupError("No GST rule is set up for the resale fee — add an active RESALE_FEE rule in the GST rules master.");
  }
  const row = (await pool.request().input("code", sql.VarChar(20), resolved.hsnCode)
    .query("SELECT TOP 1 1 AS x FROM dbo.HSN WHERE HCode = @code AND HStatus = 1")).recordset[0];
  if (!row) {
    throw new GstSetupError(`HSN ${resolved.hsnCode} (used for the resale fee) is missing or inactive in the HSN master.`);
  }
  const rate = await getHsnRate(pool, resolved.hsnCode);
  return { hsnCode: resolved.hsnCode, rate, gstAmount: Math.round(fee * rate) / 100 };
}

/**
 * A shop / office can't be sold until its GST is set up. Commercial property
 * is taxed differently from homes, but with no rule marked ForCommercial = 1 a
 * commercial unit silently takes a residential rule (rules left blank apply
 * to both) or the residential constant fallback — under-charging GST the
 * company then owes itself. So the sale is refused up front, before anything
 * is written, naming what to set up. Units not of a commercial kind pass.
 */
async function assertCommercialGstReady(pool, unitIds) {
  const ids = (unitIds || []).map(Number).filter(Number.isInteger);
  if (!ids.length) return;
  const commercialKinds = await require("./projectType").loadCommercialKinds(pool);
  if (!commercialKinds.size) return;
  const units = (await pool.request().query(
    `SELECT UnitName, UnitKind FROM dbo.UnitMaster WHERE Id IN (${ids.join(",")})`)).recordset
    .filter((u) => commercialKinds.has(String(u.UnitKind || "").toUpperCase()));
  if (!units.length) return;
  const ready = (await pool.request().input("a", sql.NVarChar(50), APPLIES_TO.UNIT_PARKING).query(
    "SELECT TOP 1 1 AS x FROM dbo.CrmGstRule WHERE IsActive = 1 AND AppliesTo = @a AND ForCommercial = 1")).recordset.length;
  if (!ready) {
    throw new GstSetupError(`${units.map((u) => u.UnitName).join(", ")} ${units.length === 1 ? "is" : "are"} commercial, and no commercial GST rule is set up yet. Add an active Unit + Parking rule marked "Commercial" in the GST rules master (with its HSN), then book.`);
  }
}

module.exports = {
  isLandSale,
  resolveResaleFeeGst,
  GstSetupError,
  assertCommercialGstReady,
  resolveUnitParkingHsn,
  resolveLandOwnedByBookingCustomer,
  resolveExtraWorkHsn,
  recalculateBookingGst,
  checkGstExemption,
  getHsnRate,
  UNIT_PARKING_THRESHOLD,
  AFFORDABLE_HSN_CODE,
  OTHER_RESIDENTIAL_HSN_CODE,
  EXTRA_WORK_HSN_CODE,
};
