// Who owns the land under a villa — the one rule the plot -> villa -> resale
// lifecycle hangs on.
//
// THE LIFECYCLE
//   1. A buyer buys a plot (land booking: CrmBookingPlot line, Active).
//   2. The developer builds villas on plots: a villa is a UnitMaster row that
//      its source plots point at through PlotMaster.ConvertedUnitId.
//   3. The plot's owner then either buys the villa — a SEPARATE booking for the
//      construction only, on land they already own — or resells the plot.
//   4. After a resale the new owner can buy the villa the same way.
//
// So "who may buy this villa" is never decided by who asks: it is whoever
// currently holds ALL of its source plots under active land lines. Ownership
// moves only through a land booking or a completed resale, and this module
// reads it from there, so the two can never disagree.

const { sql } = require("../db");

class VillaLandError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/**
 * Land position of the source plots behind the given units.
 * Units not built on plots are ignored (an apartment has no plot).
 *
 * @returns {Promise<{ units: Array<{unitId:number, unitName:string, plotCount:number,
 *   ownedPlotCount:number, ownerCustomerIds:number[], ownerNames:string[]}> }>}
 */
async function landPositionOfUnits(poolOrTx, unitIds) {
  const ids = (unitIds || []).map(Number).filter(Number.isInteger);
  if (!ids.length) return { units: [] };
  const rows = (await poolOrTx.request().query(`
    SELECT u.Id AS UnitId, u.UnitName, p.Id AS PlotId,
           owner.CustomerId, owner.CustomerName
    FROM dbo.UnitMaster u
    JOIN dbo.PlotMaster p ON p.ConvertedUnitId = u.Id AND p.IsActive = 1
    OUTER APPLY (
      SELECT TOP 1 a.CustomerId, c.CustomerName
      FROM dbo.CrmBookingPlot bp
      JOIN dbo.CrmBooking b ON b.Id = bp.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
      WHERE bp.PlotId = p.Id AND bp.Status = N'Active'
        AND b.IsActive = 1 AND b.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred')
      ORDER BY bp.Id DESC
    ) owner
    WHERE u.Id IN (${ids.join(",")})
  `)).recordset;
  const byUnit = new Map();
  for (const r of rows) {
    const u = byUnit.get(r.UnitId) || { unitId: r.UnitId, unitName: r.UnitName, plotCount: 0, ownedPlotCount: 0, ownerCustomerIds: [], ownerNames: [] };
    u.plotCount += 1;
    if (r.CustomerId != null) {
      u.ownedPlotCount += 1;
      if (!u.ownerCustomerIds.includes(r.CustomerId)) { u.ownerCustomerIds.push(r.CustomerId); u.ownerNames.push(r.CustomerName || `Customer ${r.CustomerId}`); }
    }
    byUnit.set(r.UnitId, u);
  }
  return { units: [...byUnit.values()] };
}

/**
 * Who may buy a villa built on plots. Two ways to sell one:
 *   - Direct: none of its plots is sold — the villa is sold whole, land and
 *     all, to any buyer (the plots are then taken by that sale, see
 *     plotsTakenByVillaSale).
 *   - Plot first: its plots were sold — only the customer who owns every one
 *     of them can buy the villa on top.
 * Some plots sold and some not can't be sold either way. Throws
 * VillaLandError when refused; returns quietly for units not built on plots.
 */
async function assertVillaBuyerOwnsLand(poolOrTx, unitIds, customerId) {
  const { units } = await landPositionOfUnits(poolOrTx, unitIds);
  for (const u of units) {
    if (u.ownedPlotCount === 0) continue; // direct sale of the whole villa
    if (u.ownedPlotCount < u.plotCount) {
      throw new VillaLandError(`${u.unitName} stands on several plots and only some are sold. Sell the rest to the same owner first, or cancel those plot sales and sell the villa directly.`);
    }
    if (u.ownerCustomerIds.length !== 1 || customerId == null || u.ownerCustomerIds[0] !== Number(customerId)) {
      throw new VillaLandError(`${u.unitName} stands on land owned by ${u.ownerNames.join(", ")} — only the plot's owner can buy this villa. If the plot is being sold on, complete the resale first.`, 409);
    }
  }
}

/**
 * A live villa booking standing on land this booking holds. Cancelling the
 * land under it would leave the villa contract with someone who no longer
 * owns the plot, so a land cancellation must wait until the villa booking is
 * cancelled first (the same rule a resale applies, crmResales.js).
 * @returns {Promise<string|null>} the villa's BookingNo, or null
 */
async function villaBookedOnLandOf(poolOrTx, bookingId) {
  const r = await poolOrTx.request().input("b", sql.Int, bookingId).query(`
    SELECT TOP 1 vb.BookingNo
    FROM dbo.CrmBookingPlot bp
    JOIN dbo.PlotMaster p ON p.Id = bp.PlotId AND p.ConvertedUnitId IS NOT NULL
    JOIN dbo.CrmBooking vb ON vb.UnitId = p.ConvertedUnitId
    WHERE bp.BookingId = @b AND bp.Status = N'Active'
      AND vb.Id <> @b AND vb.IsActive = 1
      AND vb.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred')`);
  return r.recordset[0]?.BookingNo || null;
}

/**
 * Land part of a DIRECT villa sale: the area x rate (Plot Master) of the plots
 * under those villas that nobody owns. A villa whose plots were sold first
 * adds nothing — its buyer already owns the land, so its price is
 * construction only. Returns 0 when no unit is a villa on unsold plots.
 */
async function directSaleLandValue(poolOrTx, unitIds) {
  const ids = (unitIds || []).map(Number).filter(Number.isInteger);
  if (!ids.length) return 0;
  const r = await poolOrTx.request().query(`
    SELECT ISNULL(SUM(ISNULL(p.AreaSqFt, 0) * ISNULL(p.RatePerSqFt, 0)), 0) AS Land
    FROM dbo.PlotMaster p
    WHERE p.ConvertedUnitId IN (${ids.join(",")}) AND p.IsActive = 1
      AND NOT EXISTS (
        SELECT 1 FROM dbo.CrmBookingPlot bp JOIN dbo.CrmBooking b ON b.Id = bp.BookingId
        WHERE bp.PlotId = p.Id AND bp.Status = N'Active' AND b.IsActive = 1
          AND b.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred'))`);
  return Math.round(Number(r.recordset[0].Land || 0) * 100) / 100;
}

module.exports = { landPositionOfUnits, assertVillaBuyerOwnsLand, villaBookedOnLandOf, directSaleLandValue, VillaLandError };
