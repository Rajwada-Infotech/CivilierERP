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
 * A villa built on plots may only be bought by the customer who owns every
 * one of those plots. Throws VillaLandError otherwise; returns quietly for
 * units that are not built on plots.
 */
async function assertVillaBuyerOwnsLand(poolOrTx, unitIds, customerId) {
  const { units } = await landPositionOfUnits(poolOrTx, unitIds);
  for (const u of units) {
    if (u.ownedPlotCount < u.plotCount) {
      throw new VillaLandError(`${u.unitName} stands on plots that have not been sold. Sell the plot first — the villa is then bought by the plot's owner as a separate booking.`);
    }
    if (u.ownerCustomerIds.length !== 1 || customerId == null || u.ownerCustomerIds[0] !== Number(customerId)) {
      throw new VillaLandError(`${u.unitName} stands on land owned by ${u.ownerNames.join(", ")} — only the plot's owner can buy this villa. If the plot is being sold on, complete the resale first.`, 409);
    }
  }
}

module.exports = { landPositionOfUnits, assertVillaBuyerOwnsLand, VillaLandError };
