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
  const req = db.request();
  ids.forEach((id, i) => req.input(`bid${i}`, sql.Int, id));
  const inList = ids.map((_, i) => `@bid${i}`).join(",");
  return (await req.query(`
    SELECT b.Id, b.BookingNo, b.UnitId, b.UnitNo, b.ProjectId, b.CompanyId, b.TotalValue, b.Status, b.ApplicationId, a.CustomerId,
           (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id)
             + (SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount, 0)), 0) FROM dbo.CrmOnAccountPayment WHERE BookingId = b.Id) AS Paid
    FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE b.Id IN (${inList}) AND ${LIVE}`)).recordset;
}

/**
 * A resale / buy-back moves a booking that is still the developer's to move.
 * Once the property is conveyed — its sale deed registered — it belongs to
 * the buyer outright; selling it on is a private sale between owners (an
 * Ownership Change), outside the developer's booking. A handover alone does
 * not convey it (business decision 2026-10-14): until the sale deed is
 * registered the booking can still change hands. Returns the reason, or null.
 */
async function conveyedReason(db, bookingIds) {
  const ids = (bookingIds || []).map(Number).filter(Number.isInteger);
  if (!ids.length) return null;
  const req = db.request();
  ids.forEach((id, i) => req.input(`cid${i}`, sql.Int, id));
  const inList = ids.map((_, i) => `@cid${i}`).join(",");
  const r = (await req.query(`
    SELECT TOP 1 b.BookingNo, N'its sale deed is registered' AS Why
    FROM dbo.CrmBooking b
    WHERE b.Id IN (${inList})
      AND EXISTS (SELECT 1 FROM dbo.CrmSalesDeed d WHERE d.BookingId = b.Id AND d.Status = N'Registered')`)).recordset[0];
  return r ? `${r.BookingNo}: ${r.Why} — the property is conveyed to its owner, so it can no longer be resold or bought back through its booking — record a new owner in Ownership Changes instead` : null;
}

/** An open resale or buy-back already on any of these bookings (being prepared, waiting, approved, or sent back to fix). */
async function openResaleOn(db, bookingIds, exceptId = null) {
  if (!bookingIds.length) return null;
  const req = db.request();
  bookingIds.forEach((id, i) => req.input(`oid${i}`, sql.Int, Number(id)));
  const likes = bookingIds.map((_, i) => `(',' + ISNULL(r.BookingIds, CAST(r.FromBookingId AS NVARCHAR(20))) + ',') LIKE '%,' + CAST(@oid${i} AS NVARCHAR(20)) + ',%'`).join(" OR ");
  const exceptClause = exceptId != null ? ` AND r.Id <> @exceptId` : "";
  if (exceptId != null) req.input("exceptId", sql.Int, Number(exceptId));
  return (await req.query(`
    SELECT TOP 1 r.Id, r.Kind, r.Status FROM dbo.CrmUnitResale r
    WHERE r.IsActive = 1 AND r.Status IN (N'Draft', N'Pending', N'Approved', N'Rejected') AND (${likes})${exceptClause}`)).recordset[0] || null;
}

/**
 * Passes one booking to another customer, inside the caller's transaction:
 * the new person's application (the one given, or a new Converted one) takes
 * the booking and its unit / plot lines; the old owner's co-applicants, home
 * loan (closed), bank details (back on their own application) and financing
 * type stay behind as their history. Used by a resale (before conveyance) and
 * by an ownership change (after it). Returns the new application's id.
 * `b` is the booking row (Id, BookingNo, UnitId, UnitNo, ProjectId, CompanyId,
 * ApplicationId, InterestedProject, InterestedUnit, PaymentPlanId).
 */
async function moveBookingToCustomer(tx, b, person, { applicationId = null, actorUserId, note, loanNote }) {
  let appId = applicationId;
  if (appId) {
    await tx.request().input("a", sql.Int, appId).input("uid", sql.Int, b.UnitId).input("pid", sql.Int, b.ProjectId).input("co", sql.Int, b.CompanyId)
      .input("pp", sql.Int, b.PaymentPlanId || null).input("ref", sql.Int, b.ApplicationId)
      .query(`UPDATE dbo.CrmApplication SET Status = N'Converted', PreferredUnitId = @uid, ProjectId = ISNULL(ProjectId, @pid), CompanyId = ISNULL(CompanyId, @co),
                PaymentPlanId = @pp, ReferredByApplicationId = @ref, UpdatedAt = SYSDATETIME() WHERE Id = @a`);
  } else {
    const { getNextDocNumber } = require("./docNumber");
    const appNo = await getNextDocNumber(require("../db").getPool(), "APP", "APP");
    const app = await tx.request()
      .input("no", sql.NVarChar(50), appNo).input("cid", sql.Int, person.Id)
      .input("name", sql.NVarChar(200), person.CustomerName).input("mob", sql.NVarChar(20), person.Mobile || null)
      .input("em", sql.NVarChar(200), person.Email || null).input("pid", sql.Int, b.ProjectId).input("co", sql.Int, b.CompanyId)
      .input("uid", sql.Int, b.UnitId).input("proj", sql.NVarChar(200), b.InterestedProject || null)
      .input("unit", sql.NVarChar(200), b.UnitNo || b.InterestedUnit || null).input("pp", sql.Int, b.PaymentPlanId || null)
      .input("ref", sql.Int, b.ApplicationId).input("by", sql.Int, actorUserId)
      .input("note", sql.NVarChar(sql.MAX), note)
      .query(`INSERT INTO dbo.CrmApplication (ApplicationNo, CustomerId, ApplicantName, Mobile, Email, ProjectId, CompanyId, PreferredUnitId,
                InterestedProject, InterestedUnit, PaymentPlanId, Source, Status, Notes, ReferredByApplicationId, DateOfApply, IsActive, CreatedBy, CreatedAt, AssignedTo, AssignedBy)
              OUTPUT INSERTED.Id
              VALUES (@no, @cid, @name, @mob, @em, @pid, @co, @uid, @proj, @unit, @pp, N'Other', N'Converted', @note, @ref, CAST(SYSDATETIME() AS DATE), 1, @by, SYSDATETIME(), @by, @by)`);
    appId = app.recordset[0].Id;
  }
  // One Active application line per unit / plot: the old owner's goes first.
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
  // Bills raised so far stay the old owner's (migration 563).
  for (const t of ["MaintenanceBill", "ElectricityBill"]) {
    await tx.request().input("b", sql.Int, b.Id).input("a", sql.Int, b.ApplicationId)
      .query(`IF COL_LENGTH('dbo.${t}', 'BillToApplicationId') IS NOT NULL
                EXEC sp_executesql N'UPDATE dbo.${t} SET BillToApplicationId = @a WHERE BookingId = @b AND BillToApplicationId IS NULL', N'@a INT, @b INT', @a = @a, @b = @b`);
  }
  await tx.request().input("b", sql.Int, b.Id).input("a", sql.Int, appId).input("by", sql.Int, actorUserId)
    .query("UPDATE dbo.CrmBooking SET ApplicationId = @a, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @b");
  await tx.request().input("b", sql.Int, b.Id).input("a", sql.Int, b.ApplicationId)
    .query("UPDATE dbo.CrmCoApplicant SET IsActive = 0 WHERE (BookingId = @b OR ApplicationId = @a) AND IsActive = 1");
  // What was the old owner's stays as their history, off the new booking:
  //  - their home loan is closed (its bank NOC was verified before),
  //    so it no longer asks the new person for a bank NOC or a sanction;
  //  - their bank details move to their own (old) application, so a refund
  //    or cancellation for the new person is never pre-filled with them;
  //  - how the property is financed is the new person's to declare.
  await tx.request().input("b", sql.Int, b.Id).input("n", sql.NVarChar(300), loanNote)
    .query(`UPDATE dbo.CrmLoanDetail SET SanctionStatus = N'Closed', UpdatedAt = SYSDATETIME(),
              Notes = LTRIM(ISNULL(Notes, N'') + CHAR(10) + @n)
            WHERE BookingId = @b AND ISNULL(SanctionStatus, N'') <> N'Closed'`);
  await tx.request().input("b", sql.Int, b.Id).input("a", sql.Int, b.ApplicationId)
    .query("UPDATE dbo.CrmCustomerBankDetail SET ApplicationId = ISNULL(ApplicationId, @a), BookingId = NULL, UpdatedAt = SYSDATETIME() WHERE BookingId = @b");
  await tx.request().input("b", sql.Int, b.Id)
    .query("UPDATE dbo.CrmBooking SET FinancingType = NULL WHERE Id = @b");
  return appId;
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
  const bReq = tx.request();
  ids.forEach((id, i) => bReq.input(`rid${i}`, sql.Int, id));
  const bInList = ids.map((_, i) => `@rid${i}`).join(",");
  const bookings = (await bReq.query(`
    SELECT b.Id, b.BookingNo, b.UnitId, b.UnitNo, b.ProjectId, b.CompanyId, b.ApplicationId, a.CustomerId,
           a.ProjectId AS AppProjectId, a.InterestedProject, a.InterestedUnit, a.PaymentPlanId,
           (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id)
             + (SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount, 0)), 0) FROM dbo.CrmOnAccountPayment WHERE BookingId = b.Id) AS Paid
    FROM dbo.CrmBooking b WITH (UPDLOCK, HOLDLOCK) JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE b.Id IN (${bInList}) AND ${LIVE}`)).recordset;
  if (bookings.length !== ids.length) throw new ResaleError("A booking in this resale is no longer live — it can't be transferred", 409);
  const conveyed = await conveyedReason(tx, ids);
  if (conveyed) throw new ResaleError(conveyed, 409);
  if (bookings.some((b) => b.CustomerId !== resale.FromCustomerId)) throw new ResaleError("The property no longer belongs to the seller on this resale", 409);
  if (resale.ToCustomerId === resale.FromCustomerId) throw new ResaleError("The new buyer is the same customer as the seller");

  const applicationIds = [];
  let paid = 0;
  for (const b of bookings) {
    paid += Number(b.Paid || 0);
    // The case opened the buyer's application already (their KYC and
    // co-applicants are on it): the first booking takes that one.
    const useApp = resale.BuyerApplicationId && !applicationIds.includes(resale.BuyerApplicationId) ? resale.BuyerApplicationId : null;
    applicationIds.push(await moveBookingToCustomer(tx, b, buyer, {
      applicationId: useApp, actorUserId,
      note: `Resale: ${b.BookingNo} passed to ${buyer.CustomerName} by endorsement (resale #${resale.Id}).`,
      loanNote: `Seller's loan — closed when the property was resold (case #${resale.Id})`,
    }));
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
  const bbReq = tx.request();
  ids.forEach((id, i) => bbReq.input(`bbid${i}`, sql.Int, id));
  const bbInList = ids.length ? ids.map((_, i) => `@bbid${i}`).join(",") : "0";
  const bookings = (await bbReq.query(`
    SELECT b.Id, b.BookingNo, b.UnitNo, b.ProjectId, b.CompanyId, a.CustomerId,
           (SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount, 0)), 0) FROM dbo.CrmOnAccountPayment WHERE BookingId = b.Id) AS Unapplied
    FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE b.Id IN (${bbInList}) AND ${LIVE}`)).recordset;
  if (!bookings.length || bookings.length !== ids.length) throw new ResaleError("A booking in this buy-back is no longer live", 409);
  const conveyed = await conveyedReason(tx, ids);
  if (conveyed) throw new ResaleError(conveyed, 409);
  if (bookings.some((b) => b.CustomerId !== resale.FromCustomerId)) throw new ResaleError("The property no longer belongs to the seller on this buy-back", 409);
  // Money still on account counts as paid (until the full price is in it
  // stays there — the full-booking hold), and completeBuyBack uses it up. It
  // must not be promised elsewhere meanwhile: an open refund or re-booking
  // transfer on the same credit would pay it out twice.
  const refReq = tx.request();
  ids.forEach((id, i) => refReq.input(`refid${i}`, sql.Int, id));
  const refInList = ids.length ? ids.map((_, i) => `@refid${i}`).join(",") : "0";
  const claimed = (await refReq.query(`
    SELECT TOP 1 r.RefundNo FROM dbo.CrmRefund r
    WHERE r.BookingId IN (${refInList}) AND r.Status NOT IN ('Paid', 'Rejected', 'Cancelled')`)).recordset[0];
  if (claimed) throw new ResaleError(`Refund ${claimed.RefundNo} is open on this property's money — finish or reject it first`, 409);
  const price = Math.round(Number(resale.AgreedValue || 0) * 100) / 100;
  const tds = Math.round(Number(resale.TdsAmount || 0) * 100) / 100;
  if (!(price > 0)) throw new ResaleError("The buy-back has no agreed price");
  if (tds < 0 || tds >= price) throw new ResaleError("TDS must be less than the buy-back price");
  // No bank chosen here = Finance picks it on the voucher (as for refunds and
  // brokerage); Finance can't approve the voucher without one.

  const { lockNextDocNumber, backPatchRecordId, resolveDocTypeId } = require("../utils/docNumberLock");
  const { ensureCrmCustomerLedgerHead } = require("./crmLedger");
  const bankName = bankId == null ? "" : (await tx.request().input("bid", sql.Int, bankId)
    .query("SELECT LHeadName FROM dbo.AccountHeadMaster WHERE LHeadId = @bid")).recordset[0]?.LHeadName;
  if (bankId != null && !bankName) throw new ResaleError("That bank account was not found");
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
    // Only an approved buy-back completes (a cancelled or rejected one never does).
    if (!resale || resale.Kind !== "BuyBack" || resale.Status !== "Approved" || resale.PayoutNewPaymentId !== newPaymentId) {
      await tx.rollback();
      return { done: false };
    }
    const ids = String(resale.BookingIds || resale.FromBookingId).split(",").map(Number).filter(Number.isInteger);
    const cbReq = tx.request();
    ids.forEach((id, i) => cbReq.input(`cbid${i}`, sql.Int, id));
    const cbInList = ids.length ? ids.map((_, i) => `@cbid${i}`).join(",") : "0";
    const paid = (await cbReq.query(`
      SELECT (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId IN (${cbInList}))
           + (SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount, 0)), 0) FROM dbo.CrmOnAccountPayment WHERE BookingId IN (${cbInList})) AS Paid`)).recordset[0].Paid;
    const { releaseBookingInventoryLines } = require("./crmWorkflowGuards");
    const { syncApplicationOnBookingTerminal } = require("./crmApplicationWorkflow");
    for (const id of ids) {
      await tx.request().input("b", sql.Int, id).input("by", sql.Int, actorUserId)
        .query(`UPDATE dbo.CrmBooking SET Status = 'Cancelled', UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @b AND Status NOT IN ('Cancelled', 'Rejected', 'Expired', 'Transferred')`);
      await releaseBookingInventoryLines(tx, id);
      // What sat on account was counted in the price paid back — use it up,
      // so it can't be refunded or transferred a second time.
      const usedUp = await tx.request().input("b", sql.Int, id).input("rid", sql.Int, resaleId).query(`
        UPDATE dbo.CrmOnAccountPayment SET AppliedAmount = Amount, Status = 'Applied',
          Notes = ISNULL(Notes, '') + CHAR(10) + 'Paid back in buy-back #' + CAST(@rid AS NVARCHAR(20))
        OUTPUT INSERTED.Id
        WHERE BookingId = @b AND Amount - ISNULL(AppliedAmount, 0) > 0.009`);
      for (const u of usedUp.recordset) {
        await require("./crmLedger").syncCrmOnAccountLedger(tx, u.Id, actorEmail, `Paid back in buy-back #${resaleId}`);
      }
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

module.exports = { movingBookings, openResaleOn, conveyedReason, endorseToBuyer, moveBookingToCustomer, raiseBuyBackVoucher, completeBuyBack, buyBackVoucherRejected, ResaleError };
