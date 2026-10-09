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

/**
 * The plot's owners own the villa together: when the plot's owner applies for
 * the villa on it, the co-applicants of the land (its booking, or the
 * application behind it) are copied onto the villa application. People
 * already on it (same name + mobile) are not added twice. Returns the count.
 */
async function copyLandCoOwners(poolOrTx, applicationId, unitIds, actorUserId = null) {
  const ids = (unitIds || []).map(Number).filter(Number.isInteger);
  if (!ids.length || !applicationId) return 0;
  const r = await poolOrTx.request().input("aid", sql.Int, applicationId).input("by", sql.Int, actorUserId).query(`
    INSERT INTO dbo.CrmCoApplicant
      (ApplicationId, Name, Relation, Mobile, Email, PanNo, AadhaarNo, DateOfBirth, Gender, Occupation, AnnualIncome,
       Address, City, [State], Pincode, Notes, SourceType, CreatedBy, CreatedAt)
    SELECT @aid, c.Name, c.Relation, c.Mobile, c.Email, c.PanNo, c.AadhaarNo, c.DateOfBirth, c.Gender, c.Occupation, c.AnnualIncome,
           c.Address, c.City, c.[State], c.Pincode, N'Co-owner of the plot under this villa', N'PlotOwner', @by, SYSDATETIME()
    FROM (
      SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c.Name, ISNULL(c.Mobile, N'') ORDER BY c.Id) AS rn
      FROM dbo.CrmCoApplicant c
      JOIN dbo.CrmBooking b ON (c.BookingId = b.Id OR c.ApplicationId = b.ApplicationId)
      JOIN dbo.CrmBookingPlot bp ON bp.BookingId = b.Id AND bp.Status = N'Active'
      JOIN dbo.PlotMaster p ON p.Id = bp.PlotId AND p.IsActive = 1
      WHERE p.ConvertedUnitId IN (${ids.join(",")}) AND c.IsActive = 1
        AND b.IsActive = 1 AND b.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred')
    ) c
    WHERE c.rn = 1 AND NOT EXISTS (
      SELECT 1 FROM dbo.CrmCoApplicant x WHERE x.ApplicationId = @aid AND x.IsActive = 1
        AND x.Name = c.Name AND ISNULL(x.Mobile, N'') = ISNULL(c.Mobile, N''))`);
  return r.rowsAffected?.[0] || 0;
}

/**
 * A plot converted to a villa is ONE property to its owner: the land booking
 * and the villa booking on it, held by the same customer. Given either
 * booking, returns both (land first) with one schedule — the land's unpaid
 * milestones ahead of the villa's, so money paid against the land balance
 * lands on the land booking (no GST) and the rest on the villa — and the
 * property's totals. A booking with no partner is returned on its own.
 */
async function propertyOfBooking(poolOrTx, bookingId) {
  const live = "b.IsActive = 1 AND b.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred')";
  const bookings = (await poolOrTx.request().input("b", sql.Int, bookingId).query(`
    WITH me AS (
      SELECT b.Id, b.UnitId, a.CustomerId FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId WHERE b.Id = @b
    ),
    villa AS (   -- the villa this booking is (UnitId), or the villa built on the plots this booking holds
      SELECT me.UnitId AS UnitId FROM me WHERE EXISTS (SELECT 1 FROM dbo.PlotMaster p WHERE p.ConvertedUnitId = me.UnitId AND p.IsActive = 1)
      UNION
      SELECT p.ConvertedUnitId FROM me JOIN dbo.CrmBookingPlot bp ON bp.BookingId = me.Id AND bp.Status = N'Active'
      JOIN dbo.PlotMaster p ON p.Id = bp.PlotId AND p.IsActive = 1 WHERE p.ConvertedUnitId IS NOT NULL
    )
    SELECT DISTINCT b.Id, b.BookingNo, b.UnitNo, b.TotalValue, b.Status,
           CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmBookingPlot x WHERE x.BookingId = b.Id AND x.Status = N'Active') THEN 1 ELSE 0 END AS IsLand
    FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE b.Id = @b
       OR (${live} AND a.CustomerId = (SELECT CustomerId FROM me) AND (
            b.UnitId IN (SELECT UnitId FROM villa)
         OR EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp JOIN dbo.PlotMaster p ON p.Id = bp.PlotId
                    WHERE bp.BookingId = b.Id AND bp.Status = N'Active' AND p.ConvertedUnitId IN (SELECT UnitId FROM villa))))`)).recordset
    .sort((x, y) => y.IsLand - x.IsLand || x.Id - y.Id);
  const ids = bookings.map((b) => b.Id);
  const milestones = ids.length ? (await poolOrTx.request().query(`
    SELECT m.Id, m.BookingId, m.MilestoneNo, m.MilestoneName, m.AmountDue, ISNULL(m.AmountPaid, 0) AS AmountPaid, m.DueDate, m.Status, m.DemandStatus
    FROM dbo.CrmPaymentMilestone m WHERE m.BookingId IN (${ids.join(",")})`)).recordset : [];
  const order = new Map(ids.map((id, i) => [id, i]));
  milestones.sort((a, b) => order.get(a.BookingId) - order.get(b.BookingId) || a.MilestoneNo - b.MilestoneNo);
  const byId = new Map(bookings.map((b) => [b.Id, b]));
  const schedule = milestones.map((m) => ({
    ...m,
    BookingNo: byId.get(m.BookingId).BookingNo,
    Part: byId.get(m.BookingId).IsLand ? "Land" : "Villa",
    Label: byId.get(m.BookingId).IsLand && bookings.length > 1 ? `Land balance – ${byId.get(m.BookingId).UnitNo || "plot"} · ${m.MilestoneName}` : m.MilestoneName,
  }));
  const r2 = (n) => Math.round(n * 100) / 100;
  const counted = schedule.filter((m) => m.Status !== "Waived");
  const totals = {
    price: r2(bookings.reduce((s, b) => s + Number(b.TotalValue || 0), 0)),
    paid: r2(counted.reduce((s, m) => s + Number(m.AmountPaid || 0), 0)),
  };
  totals.due = r2(counted.reduce((s, m) => s + Math.max(Number(m.AmountDue || 0) - Number(m.AmountPaid || 0), 0), 0));
  return { combined: bookings.length > 1, bookings, schedule, totals };
}

module.exports = { landPositionOfUnits, assertVillaBuyerOwnsLand, villaBookedOnLandOf, directSaleLandValue, copyLandCoOwners, propertyOfBooking, VillaLandError };
