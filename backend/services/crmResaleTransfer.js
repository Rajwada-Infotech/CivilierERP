// Resale by ENDORSEMENT — a sold property passing from its buyer to a new
// buyer. Nothing is cancelled or re-sold: the seller's booking itself passes
// to the new buyer, so its price, milestones, receipts, invoices and the money
// already paid all stay with the property and the new buyer continues the
// remaining schedule. A plot with the villa built on it moves as one property
// (both bookings together, services/villaLand.js propertyOfBooking).
//
// What changes on completion:
//   - a new application for the buyer, Converted, carrying the same unit/plot
//     lines; each moving booking points at it (so every screen, statement and
//     ledger now reads the buyer through the booking's application)
//   - the seller's application lines become 'Transferred'
//   - the seller's co-applicants on the booking are retired
//   - money paid so far moves from the seller's ledger to the buyer's
//     (Dr seller / Cr buyer), so the advance follows its property
// What the two buyers agreed between themselves is recorded only — it is
// never developer income. The developer's transfer fee is charged to the buyer.
const { sql } = require("../db");

class ResaleError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const LIVE = "b.IsActive = 1 AND b.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred')";

/** The live bookings that move together with this one (itself first if alone). */
async function movingBookings(db, bookingId) {
  const { propertyOfBooking } = require("./villaLand");
  const p = await propertyOfBooking(db, bookingId);
  const ids = p.bookings.map((b) => b.Id);
  if (!ids.length) return [];
  return (await db.request().query(`
    SELECT b.Id, b.BookingNo, b.UnitId, b.UnitNo, b.ProjectId, b.CompanyId, b.TotalValue, b.Status, b.ApplicationId, a.CustomerId,
           (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id)
             + (SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount, 0)), 0) FROM dbo.CrmOnAccountPayment WHERE BookingId = b.Id) AS Paid
    FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE b.Id IN (${ids.join(",")}) AND ${LIVE}`)).recordset;
}

/** An open resale or buy-back already on any of these bookings. */
async function openResaleOn(db, bookingIds) {
  if (!bookingIds.length) return null;
  const likes = bookingIds.map((id) => `(',' + ISNULL(r.BookingIds, CAST(r.FromBookingId AS NVARCHAR(20))) + ',') LIKE '%,${Number(id)},%'`).join(" OR ");
  return (await db.request().query(`
    SELECT TOP 1 r.Id, r.Kind, r.Status FROM dbo.CrmUnitResale r
    WHERE r.IsActive = 1 AND r.Status IN (N'Pending', N'Approved') AND (${likes})`)).recordset[0] || null;
}

/**
 * Passes the bookings of a resale to its buyer. Runs inside the caller's
 * transaction; returns { applicationIds, paid }.
 */
async function endorseToBuyer(tx, resale, actorUserId) {
  const ids = String(resale.BookingIds || resale.FromBookingId || "").split(",").map(Number).filter(Number.isInteger);
  if (!ids.length) throw new ResaleError("This resale names no booking to transfer");
  const buyer = (await tx.request().input("c", sql.Int, resale.ToCustomerId)
    .query("SELECT Id, CustomerName, Mobile, Email FROM dbo.CrmCustomer WHERE Id = @c")).recordset[0];
  if (!buyer) throw new ResaleError("Name the new buyer before completing the resale");
  const bookings = (await tx.request().query(`
    SELECT b.Id, b.BookingNo, b.UnitId, b.UnitNo, b.ProjectId, b.CompanyId, b.ApplicationId, a.CustomerId,
           a.ProjectId AS AppProjectId, a.InterestedProject, a.InterestedUnit, a.PaymentPlanId,
           (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id)
             + (SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount, 0)), 0) FROM dbo.CrmOnAccountPayment WHERE BookingId = b.Id) AS Paid
    FROM dbo.CrmBooking b WITH (UPDLOCK, HOLDLOCK) JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE b.Id IN (${ids.join(",")}) AND ${LIVE}`)).recordset;
  if (bookings.length !== ids.length) throw new ResaleError("A booking in this resale is no longer live — it can't be transferred", 409);
  if (bookings.some((b) => b.CustomerId !== resale.FromCustomerId)) throw new ResaleError("The property no longer belongs to the seller on this resale", 409);
  if (resale.ToCustomerId === resale.FromCustomerId) throw new ResaleError("The new buyer is the same customer as the seller");

  const { getNextDocNumber } = require("./docNumber");
  const applicationIds = [];
  let paid = 0;
  for (const b of bookings) {
    paid += Number(b.Paid || 0);
    const appNo = await getNextDocNumber(require("../db").getPool(), "APP", "APP");
    const app = await tx.request()
      .input("no", sql.NVarChar(50), appNo).input("cid", sql.Int, buyer.Id)
      .input("name", sql.NVarChar(200), buyer.CustomerName).input("mob", sql.NVarChar(20), buyer.Mobile || null)
      .input("em", sql.NVarChar(200), buyer.Email || null).input("pid", sql.Int, b.ProjectId).input("co", sql.Int, b.CompanyId)
      .input("uid", sql.Int, b.UnitId).input("proj", sql.NVarChar(200), b.InterestedProject || null)
      .input("unit", sql.NVarChar(200), b.UnitNo || b.InterestedUnit || null).input("pp", sql.Int, b.PaymentPlanId || null)
      .input("ref", sql.Int, b.ApplicationId).input("by", sql.Int, actorUserId)
      .input("note", sql.NVarChar(sql.MAX), `Resale: ${b.BookingNo} passed to ${buyer.CustomerName} by endorsement (resale #${resale.Id}).`)
      .query(`INSERT INTO dbo.CrmApplication (ApplicationNo, CustomerId, ApplicantName, Mobile, Email, ProjectId, CompanyId, PreferredUnitId,
                InterestedProject, InterestedUnit, PaymentPlanId, Source, Status, Notes, ReferredByApplicationId, DateOfApply, IsActive, CreatedBy, CreatedAt, AssignedTo, AssignedBy)
              OUTPUT INSERTED.Id
              VALUES (@no, @cid, @name, @mob, @em, @pid, @co, @uid, @proj, @unit, @pp, N'Other', N'Converted', @note, @ref, CAST(SYSDATETIME() AS DATE), 1, @by, SYSDATETIME(), @by, @by)`);
    const appId = app.recordset[0].Id;
    applicationIds.push(appId);
    // One Active application line per unit / plot: the seller's goes first.
    for (const t of [["CrmApplicationUnit", "UnitId"], ["CrmApplicationPlot", "PlotId"]]) {
      const lines = (await tx.request().input("a", sql.Int, b.ApplicationId)
        .query(`SELECT ${t[1]} AS Ref, IsPrimary FROM dbo.${t[0]} WHERE ApplicationId = @a AND Status = N'Active'`)).recordset;
      await tx.request().input("a", sql.Int, b.ApplicationId)
        .query(`UPDATE dbo.${t[0]} SET Status = N'Transferred' WHERE ApplicationId = @a AND Status = N'Active'`);
      for (const l of lines) {
        await tx.request().input("a", sql.Int, appId).input("r", sql.Int, l.Ref).input("pri", sql.Bit, l.IsPrimary ? 1 : 0)
          .query(`INSERT INTO dbo.${t[0]} (ApplicationId, ${t[1]}, Status, IsPrimary, CreatedAt) VALUES (@a, @r, N'Active', @pri, SYSDATETIME())`);
      }
    }
    await tx.request().input("b", sql.Int, b.Id).input("a", sql.Int, appId).input("by", sql.Int, actorUserId)
      .query("UPDATE dbo.CrmBooking SET ApplicationId = @a, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @b");
    await tx.request().input("b", sql.Int, b.Id).input("a", sql.Int, b.ApplicationId)
      .query("UPDATE dbo.CrmCoApplicant SET IsActive = 0 WHERE (BookingId = @b OR ApplicationId = @a) AND IsActive = 1");
  }
  paid = Math.round(paid * 100) / 100;
  await tx.request().input("id", sql.Int, resale.Id).input("paid", sql.Decimal(18, 2), paid).input("by", sql.Int, actorUserId)
    .query(`UPDATE dbo.CrmUnitResale SET Status = N'Completed', PaidAtTransfer = @paid, CompletedAt = SYSDATETIME(),
              ToBookingId = FromBookingId, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id`);
  return { applicationIds, paid };
}

module.exports = { movingBookings, openResaleOn, endorseToBuyer, ResaleError };
