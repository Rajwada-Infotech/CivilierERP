// The price of a sale before its booking exists — what the application form
// shows. Every figure comes from the same functions that price the real
// booking (priceBooking, resolveUnitParkingRate, saleTotals, planSchedule,
// landSaleSchedule), so the form and the booking can't disagree. The form used
// to work these out itself with its own copy of the rules (the Rs 45 lakh line
// and HSN codes written into it), which ignored the editable GST rules,
// commercial units, villa land and completed buildings.

const { sql } = require("../db");
const { priceBooking, round2 } = require("./bookingUnits");
const { loadLandKinds, getUnitsCommercial } = require("./projectType");
const { resolveUnitParkingRate, resolveExtraWorkHsn, getHsnRate, saleTotals, gstOn, landOwnedByCustomer } = require("./crmGst");
const { planSchedule, landSaleSchedule } = require("./crmEntityCreation");
const { directSaleLandValue } = require("./villaLand");

const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
// Zero kept: each row of the answer lines up with the row it was given.
const amounts = (list) => (Array.isArray(list) ? list : []).map(Number).map((n) => (Number.isFinite(n) && n > 0 ? n : 0));

// A completed building's sale is outside GST once the whole price is paid
// after OC / CC (crmGst.checkGstExemption). Nothing is paid before a booking,
// so the sale is outside GST exactly when every block it sits in is covered —
// the same block / project rule vw_CrmBookingOcCc applies to a booking.
async function completedBuilding(pool, { unitIds, plotIds }) {
  const where = [
    unitIds.length ? `SELECT BlockId, ProjectId FROM dbo.UnitMaster WHERE Id IN (${unitIds.join(",")})` : null,
    plotIds.length ? `SELECT BlockId, ProjectId FROM dbo.PlotMaster WHERE Id IN (${plotIds.join(",")})` : null,
  ].filter(Boolean).join(" UNION ");
  if (!where) return false;
  const r = (await pool.request().query(`
    SELECT x.BlockId, x.ProjectId, v.Covered, pv.Received
    FROM (${where}) x
    LEFT JOIN dbo.vw_CrmBlockOcCc v ON v.BlockId = x.BlockId
    LEFT JOIN dbo.vw_CrmProjectOcCc pv ON pv.ProjectId = x.ProjectId`)).recordset;
  if (!r.length) return false;
  const blocks = r.filter((x) => x.BlockId != null);
  return blocks.length ? blocks.every((x) => x.Covered === 1) : r.every((x) => x.Received === 1);
}

/**
 * @param {object} q
 *   unitIds / plotIds   what is being sold (plots make it a land sale)
 *   ratePerSqFt         the agreed rate; blank takes the first unit's / plot's own rate
 *   parkingBases        each parking slot's pre-tax charge
 *   extraAmounts        each extra charge's pre-tax amount
 *   paymentPlanId       the plan picked (ignored for land)
 *   bookingAmount       the Booking Amount when no plan sets one (land)
 *   customerId          the buyer — decides whether a villa stands on their own land
 */
async function quoteSale(pool, q = {}) {
  const unitIds = ids(q.unitIds);
  const plotIds = ids(q.plotIds);
  const isPlotSale = plotIds.length > 0;
  const pickedIds = isPlotSale ? plotIds : unitIds;
  if (!pickedIds.length) return null;

  const rows = (await pool.request().query(isPlotSale
    ? `SELECT Id, AreaSqFt, RatePerSqFt, NULL AS UnitKind FROM dbo.PlotMaster WHERE Id IN (${plotIds.join(",")})`
    : `SELECT Id, AreaSqFt, RatePerSqFt, UnitKind FROM dbo.UnitMaster WHERE Id IN (${unitIds.join(",")})`)).recordset;
  // In the order picked: the first is the primary, whose rate is the default.
  const lines = pickedIds.map((id) => rows.find((r) => r.Id === id)).filter(Boolean);
  if (!lines.length) return null;

  const typedRate = q.ratePerSqFt != null && q.ratePerSqFt !== "" ? Number(q.ratePerSqFt) : null;
  const rate = typedRate != null && Number.isFinite(typedRate) && typedRate > 0 ? typedRate
    : lines[0].RatePerSqFt != null ? Number(lines[0].RatePerSqFt) : null;
  const pricing = priceBooking({ lines: lines.map((l) => ({ unitId: l.Id, areaSqFt: l.AreaSqFt })), ratePerSqFt: rate });
  const totalValue = pricing.total;

  // Land vs construction — the split getBookingLandSplit makes for a booking:
  // a line is land by what it is (a plot, or a land kind), whatever its value.
  const landKinds = await loadLandKinds(pool);
  const isLandLine = (i) => isPlotSale || landKinds.has(String(lines[i].UnitKind || "").toUpperCase());
  const hasLand = lines.some((_, i) => isLandLine(i));
  let landValue = 0, constructionValue = 0;
  pricing.lines.forEach((l, i) => { if (isLandLine(i)) landValue += l.allocatedValue; else constructionValue += l.allocatedValue; });
  const isPureLand = hasLand && constructionValue === 0;
  if (isPureLand) {
    landValue = totalValue;
  } else if (!hasLand) {
    // A villa sold with its land carries the land inside its price.
    landValue = Math.min(await directSaleLandValue(pool, unitIds), totalValue);
  }
  landValue = round2(landValue);
  constructionValue = round2(totalValue - landValue);

  const exempt = await completedBuilding(pool, { unitIds: isPlotSale ? [] : unitIds, plotIds });
  const outsideGst = exempt || isPureLand;
  const parkingBases = amounts(q.parkingBases);
  const parkingBase = round2(parkingBases.reduce((a, b) => a + b, 0));
  const { hsnCode, rate: gstRate } = await resolveUnitParkingRate(pool, {
    constructionValue, parkingBase, outsideGst,
    landOwnedByCustomer: outsideGst || isPlotSale ? null : await landOwnedByCustomer(pool, unitIds, q.customerId ?? null),
    commercial: outsideGst || isPlotSale ? null : await getUnitsCommercial(pool, unitIds),
  });
  const parking = parkingBases.map((base) => ({ base, gst: gstOn(base, gstRate), total: round2(base + gstOn(base, gstRate)) }));
  const parkingTotal = round2(parking.reduce((a, p) => a + p.total, 0));

  // Extra charges: the Extra Work rate (a land sale's own rule on plots), none
  // on a completed building — as crmExtraCharges.js and recalculateBookingGst.
  const extraRate = exempt ? 0 : await getHsnRate(pool, (await resolveExtraWorkHsn(pool, { landSale: isPlotSale })).hsnCode);
  const extras = amounts(q.extraAmounts).map((base) => ({ base, gst: gstOn(base, extraRate), total: round2(base + gstOn(base, extraRate)) }));
  const extraChargesTotal = round2(extras.reduce((a, e) => a + e.total, 0));
  const extraWorkGstAmount = round2(extras.reduce((a, e) => a + e.gst, 0));

  const totals = saleTotals({ totalValue, constructionValue, rate: gstRate, parkingBase, parkingTotal, extraChargesTotal, extraWorkGstAmount });

  let schedule;
  if (isPlotSale) {
    schedule = landSaleSchedule(totals.grandTotal, q.bookingAmount).map((m) => ({ no: m.no, name: m.name, pct: null, amount: m.amount }));
  } else if (q.paymentPlanId) {
    const plan = (await pool.request().input("pid", sql.Int, Number(q.paymentPlanId)).query(`
      SELECT BookingAmount FROM dbo.CrmPaymentPlanTemplate WHERE Id = @pid;
      SELECT MilestoneNo, MilestoneName, [Percent] FROM dbo.CrmPaymentPlanTemplateItem WHERE PlanTemplateId = @pid ORDER BY MilestoneNo;
    `)).recordsets;
    const planBooking = plan[0][0]?.BookingAmount;
    schedule = planSchedule(totals.grandTotal, planBooking != null ? Number(planBooking) : q.bookingAmount,
      plan[1].map((r) => ({ no: r.MilestoneNo, name: r.MilestoneName, pct: Number(r.Percent) })));
  } else {
    schedule = [];
  }

  return {
    areaSqFt: pricing.combinedArea,
    ratePerSqFt: rate,
    unitValue: totalValue,
    landValue, constructionValue,
    isLandSale: isPureLand, isGstExempt: exempt,
    hsnCode, gstRate,
    parking, parkingBase, parkingTotal,
    extraRate, extras, extraChargesTotal, extraWorkGstAmount,
    ...totals,
    schedule,
  };
}

module.exports = { quoteSale };
