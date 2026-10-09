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

/**
 * A resale / buy-back moves a booking that is still the developer's to move.
 * Once the property is conveyed — its sale deed registered, or its handover
 * started — it belongs to the buyer outright; selling it on is a private sale
 * between owners, outside the developer's booking. Returns the reason, or null.
 */
async function conveyedReason(db, bookingIds) {
  const ids = (bookingIds || []).map(Number).filter(Number.isInteger);
  if (!ids.length) return null;
  const r = (await db.request().query(`
    SELECT TOP 1 b.BookingNo,
      CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmSalesDeed d WHERE d.BookingId = b.Id AND d.Status = N'Registered') THEN N'its sale deed is registered'
           WHEN EXISTS (SELECT 1 FROM dbo.CrmHandover h WHERE h.BookingId = b.Id) THEN N'its handover has started'
      END AS Why
    FROM dbo.CrmBooking b
    WHERE b.Id IN (${ids.join(",")})
      AND (EXISTS (SELECT 1 FROM dbo.CrmSalesDeed d WHERE d.BookingId = b.Id AND d.Status = N'Registered')
        OR EXISTS (SELECT 1 FROM dbo.CrmHandover h WHERE h.BookingId = b.Id))`)).recordset[0];
  return r ? `${r.BookingNo}: ${r.Why} — the property is conveyed to its owner, so it can no longer be resold or bought back through its booking` : null;
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
  const conveyed = await conveyedReason(tx, ids);
  if (conveyed) throw new ResaleError(conveyed, 409);
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

// ── Buy-back (Kind = 'BuyBack') ────────────────────────────────────────────
// We buy a sold property back at an agreed price. Finance pays it through ONE
// payout voucher in Payments (NewPayment.SourceCrmResaleId, migration 551),
// like a refund. When Finance approves that voucher the property comes back:
// the seller's booking(s) close (Cancelled, as a cancellation closes them —
// every inventory and dues rule already reads that), the unit / plot lines are
// released to stock, and the difference between the agreed price and what the
// seller had paid goes to Property Buy-back Cost. Unpaid milestones simply die
// with the booking; earlier invoices are left as they are.

/** Raises the buy-back payout voucher. Inside the caller's transaction. */
async function raiseBuyBackVoucher(tx, resale, { bankId, paymentMode = "", actorEmail }) {
  const ids = String(resale.BookingIds || resale.FromBookingId || "").split(",").map(Number).filter(Number.isInteger);
  const bookings = (await tx.request().query(`
    SELECT b.Id, b.BookingNo, b.UnitNo, b.ProjectId, b.CompanyId, a.CustomerId,
           (SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount, 0)), 0) FROM dbo.CrmOnAccountPayment WHERE BookingId = b.Id) AS Unapplied
    FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE b.Id IN (${ids.join(",") || "0"}) AND ${LIVE}`)).recordset;
  if (!bookings.length || bookings.length !== ids.length) throw new ResaleError("A booking in this buy-back is no longer live", 409);
  const conveyed = await conveyedReason(tx, ids);
  if (conveyed) throw new ResaleError(conveyed, 409);
  if (bookings.some((b) => b.CustomerId !== resale.FromCustomerId)) throw new ResaleError("The property no longer belongs to the seller on this buy-back", 409);
  const unapplied = bookings.reduce((s, b) => s + Number(b.Unapplied || 0), 0);
  if (unapplied > 0.009) throw new ResaleError(`₹${unapplied.toLocaleString("en-IN")} is still on account (not yet adjusted to a milestone). Adjust it first, so the buy-back counts every rupee paid.`, 409);
  const price = Math.round(Number(resale.AgreedValue || 0) * 100) / 100;
  const tds = Math.round(Number(resale.TdsAmount || 0) * 100) / 100;
  if (!(price > 0)) throw new ResaleError("The buy-back has no agreed price");
  if (tds < 0 || tds >= price) throw new ResaleError("TDS must be less than the buy-back price");
  if (bankId == null) throw new ResaleError("Choose the company bank that pays this buy-back");

  const { lockNextDocNumber, backPatchRecordId, resolveDocTypeId } = require("../utils/docNumberLock");
  const { ensureCrmCustomerLedgerHead } = require("./crmLedger");
  const bankName = (await tx.request().input("bid", sql.Int, bankId)
    .query("SELECT LHeadName FROM dbo.AccountHeadMaster WHERE LHeadId = @bid")).recordset[0]?.LHeadName;
  if (!bankName) throw new ResaleError("That bank account was not found");
  const sellerHeadId = await ensureCrmCustomerLedgerHead(tx, resale.FromCustomerId, actorEmail);
  const docTypeId = await resolveDocTypeId(tx, sql, "PAY");
  const docNo = await lockNextDocNumber(tx, sql, { docTypeId, tableName: "NewPayment", docNoColumn: "DocNo", issuedBy: actorEmail });
  const parts = (docNo || "").split("-");
  const today = new Date().toISOString().slice(0, 10);
  const fy = (await tx.request().input("d", sql.Date, today)
    .query("SELECT TOP 1 FId FROM dbo.FinYear WHERE @d >= FStartDate AND @d <= FEndDate ORDER BY FStartDate DESC")).recordset[0]?.FId ?? null;
  const lead = bookings[0];
  const ins = await tx.request()
    .input("name", sql.VarChar, "CRM Buy-back")
    .input("remarks", sql.NVarChar(1000), `Buy-back #${resale.Id} — ${bookings.map((b) => b.UnitNo || b.BookingNo).join(" + ")} bought back at ₹${price.toLocaleString("en-IN")}${tds ? ` (TDS ₹${tds.toLocaleString("en-IN")})` : ""}`)
    .input("mode", sql.VarChar(50), paymentMode || "").input("bankName", sql.VarChar(200), bankName).input("bankId", sql.Int, bankId)
    .input("amt", sql.Decimal(18, 2), price).input("tds", sql.Decimal(18, 2), tds || null).input("dt", sql.Date, today)
    .input("project", sql.VarChar, lead.ProjectId != null ? String(lead.ProjectId) : "")
    .input("company", sql.VarChar, lead.CompanyId != null ? String(lead.CompanyId) : "")
    .input("partyId", sql.Int, sellerHeadId)
    .input("docNo", sql.NVarChar(100), docNo).input("docTypeId", sql.Int, docTypeId)
    .input("docYear", sql.SmallInt, parseInt(parts[parts.length - 2], 10) || null).input("docSerial", sql.Int, parseInt(parts[parts.length - 1], 10) || null)
    .input("fy", sql.Int, fy).input("src", sql.Int, resale.Id).input("by", sql.NVarChar(100), actorEmail)
    .query(`INSERT INTO dbo.NewPayment (PPaymentName, PRemarks, PMode, PBankName, PBankID, PAmount, TDSAmount, PDocType, PDate,
              PProject, PCompany, PPartyId, DocNo, DocTypeId, DocYear, DocSerial, PFinYearId, SourceCrmResaleId,
              PCreatedAt, PCreatedBy, PApprovedBy, Status)
            OUTPUT INSERTED.PPaymentID
            VALUES (@name, @remarks, @mode, @bankName, @bankId, @amt, @tds, 'CRM Buy-back', @dt,
              @project, @company, @partyId, @docNo, @docTypeId, @docYear, @docSerial, @fy, @src,
              SYSDATETIME(), @by, NULL, 'Pending')`);
  const newPaymentId = ins.recordset[0].PPaymentID;
  await backPatchRecordId(tx, sql, docNo, "NewPayment", newPaymentId);
  await tx.request().input("id", sql.Int, resale.Id).input("np", sql.Int, newPaymentId)
    .query("UPDATE dbo.CrmUnitResale SET PayoutNewPaymentId = @np, UpdatedAt = SYSDATETIME() WHERE Id = @id");
  return { newPaymentId, docNo };
}

/**
 * Finance approved the buy-back voucher: the property comes back to stock.
 * Idempotent (a completed buy-back is left alone).
 */
async function completeBuyBack(pool, resaleId, newPaymentId, actorUserId, actorEmail) {
  const tx = pool.transaction();
  await tx.begin();
  let resale;
  try {
    resale = (await tx.request().input("id", sql.Int, resaleId)
      .query("SELECT * FROM dbo.CrmUnitResale WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id AND IsActive = 1")).recordset[0];
    if (!resale || resale.Kind !== "BuyBack" || resale.Status === "Completed" || resale.PayoutNewPaymentId !== newPaymentId) {
      await tx.rollback();
      return { done: false };
    }
    const ids = String(resale.BookingIds || resale.FromBookingId).split(",").map(Number).filter(Number.isInteger);
    const paid = (await tx.request().query(`
      SELECT (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId IN (${ids.join(",")}))
           + (SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount, 0)), 0) FROM dbo.CrmOnAccountPayment WHERE BookingId IN (${ids.join(",")})) AS Paid`)).recordset[0].Paid;
    const { releaseBookingInventoryLines } = require("./crmWorkflowGuards");
    const { syncApplicationOnBookingTerminal } = require("./crmApplicationWorkflow");
    for (const id of ids) {
      await tx.request().input("b", sql.Int, id).input("by", sql.Int, actorUserId)
        .query(`UPDATE dbo.CrmBooking SET Status = 'Cancelled', UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @b AND Status NOT IN ('Cancelled', 'Rejected', 'Expired', 'Transferred')`);
      await releaseBookingInventoryLines(tx, id);
      await syncApplicationOnBookingTerminal(tx, id, "Cancelled", "BookingBoughtBack", `Bought back by the developer (buy-back #${resaleId})`, actorUserId);
      await tx.request().input("b", sql.Int, id).query("UPDATE dbo.CrmMoneyReceipt SET Status = 'Rejected', UpdatedAt = SYSDATETIME() WHERE BookingId = @b AND Status = 'Pending'");
      await tx.request().input("b", sql.Int, id).input("by", sql.Int, actorUserId).query(`
        UPDATE dbo.ReceivedPayment SET RPStatus = 'Rejected', RPRejectedBy = @by, RPRejectedAt = SYSDATETIME(),
          RPRejectionNote = 'Auto-rejected — property bought back', RPUpdatedBy = @by, RPUpdatedAt = SYSDATETIME()
        WHERE CrmBookingId = @b AND RPStatus = 'Pending'`);
    }
    await tx.request().input("id", sql.Int, resaleId).input("paid", sql.Decimal(18, 2), paid).input("by", sql.Int, actorUserId)
      .query(`UPDATE dbo.CrmUnitResale SET Status = N'Completed', PaidAtTransfer = @paid, CompletedAt = SYSDATETIME(), UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id`);
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    throw e;
  }
  // Posted after the property is back in stock, like every CRM posting: a
  // ledger failure is recorded and reported, never allowed to undo the buy-back.
  let outcome;
  try { outcome = await require("./crmLedger").postCrmBuyBackDifferenceToGL(pool, resaleId, actorEmail); }
  catch (e) { outcome = { posted: false, reason: `Buy-back difference not posted: ${e.message}` }; }
  await require("./approvalService").recordGLPosting("crm-buyback", resaleId, outcome, actorEmail);
  return { done: true, ledger: outcome };
}

/** Finance turned the voucher down: back to Approved, ready for a fresh voucher. */
async function buyBackVoucherRejected(pool, resaleId, newPaymentId, note) {
  await pool.request().input("id", sql.Int, resaleId).input("np", sql.Int, newPaymentId)
    .input("n", sql.NVarChar(500), `[Finance] ${note || "Payout voucher rejected"}`.slice(0, 500))
    .query(`UPDATE dbo.CrmUnitResale SET PayoutNewPaymentId = NULL, RejectionNote = @n, UpdatedAt = SYSDATETIME()
            WHERE Id = @id AND PayoutNewPaymentId = @np AND Status = N'Approved'`);
}

module.exports = { movingBookings, openResaleOn, conveyedReason, endorseToBuyer, raiseBuyBackVoucher, completeBuyBack, buyBackVoucherRejected, ResaleError };
