const { sql } = require("../db");
const { getNextDocNumber } = require("./docNumber");
const { generateMoneyReceiptPdf, getMoneyReceiptByReceivedPaymentId } = require("./moneyReceiptPdf");
const { STAGE_REVIEW, stageLabel } = require("./crmBookingStageService");

const APPROVER_ROLES = ["admin", "super_admin", "dba", "accounts_head"];

class MoneyReceiptError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function isMoneyReceiptApprover(role) {
  return APPROVER_ROLES.includes(String(role || "").trim().toLowerCase());
}

function cleanString(v) {
  return v == null ? null : String(v).trim() || null;
}

async function assertDataReviewComplete(pool, bookingId) {
  const booking = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT Id, ApplicationId, WorkflowStage, Status, IsActive
    FROM dbo.CrmBooking
    WHERE Id = @bid
  `);
  const row = booking.recordset[0];
  if (!row) throw new MoneyReceiptError("Booking not found", 404);
  if (row.IsActive === 0 || ["Cancelled", "Rejected"].includes(row.Status)) {
    throw new MoneyReceiptError(`This booking has been ${row.Status} - money receipt actions are blocked`);
  }
  // The booking must have been submitted for approval (Confirm & Book /
  // "ready-for-approval") before a Money Receipt can exist. submitForApproval
  // already hard-requires all 7 checklist items checked before it advances
  // WorkflowStage past Review — re-checking the checklist here is therefore
  // redundant and actively harmful: if any new CHECKLIST_ITEMS key is added
  // after a booking cleared Review, ensureChecklistRows inserts it as Pending
  // (it was never checkable at that stage — the check/flag routes both gate
  // on WorkflowStage='Review'), and counting it as a blocker permanently
  // prevents Money Receipt creation for an already-approved booking. The
  // real gate is the stage check: Review means not yet submitted; anything
  // past Review means the checklist has already been verified.
  if (row.WorkflowStage === STAGE_REVIEW) {
    throw new MoneyReceiptError(`This booking hasn't been submitted for approval yet (still at ${stageLabel(row.WorkflowStage)}) — Money Receipt becomes available once it's submitted`);
  }
  return row;
}

async function getBookingReceiptDefaults(pool, bookingId) {
  const result = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT TOP 1
      b.Id AS BookingId, b.ApplicationId, b.BookingNo, b.ProjectId, b.ProjectName, b.CompanyId,
      b.BookingAmount, b.TokenValue, b.PaymentMode,
      a.ApplicantName, a.DepositBankId,
      ah.LHeadName AS DepositBankName,
      cbd.ChequeNo, cbd.ChequeDate, cbd.TransactionRef
    FROM dbo.CrmBooking b
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = a.DepositBankId
    LEFT JOIN dbo.CrmCustomerBankDetail cbd
      ON cbd.BookingId = b.Id OR (cbd.ApplicationId = b.ApplicationId AND cbd.BookingId IS NULL)
    WHERE b.Id = @bid
  `);
  const row = result.recordset[0];
  if (!row) throw new MoneyReceiptError("Booking not found", 404);
  return row;
}

async function createMoneyReceiptForBooking(pool, bookingId, data = {}, actorUserId, { skipIfExists = false } = {}) {
  await assertDataReviewComplete(pool, bookingId);

  if (skipIfExists) {
    const existing = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT TOP 1 Id, ReceiptNo, Status
      FROM dbo.CrmMoneyReceipt
      WHERE BookingId = @bid AND Status <> 'Bounced'
      ORDER BY CreatedAt DESC
    `);
    if (existing.recordset.length) return { existing: true, ...existing.recordset[0] };
  }

  const defaults = await getBookingReceiptDefaults(pool, bookingId);
  const amount = data.Amount != null && data.Amount !== ""
    ? Number(data.Amount)
    : Number(defaults.TokenValue != null ? defaults.TokenValue : defaults.BookingAmount);
  if (!amount || amount <= 0) throw new MoneyReceiptError("Amount must be greater than 0");

  // Use the booking's explicit GST rate (UnitParkingGstRate: 1 or 5 for unit/parking,
  // which is the applicable rate for the booking amount milestone). Applying it as
  // rate/(100+rate) extracts the GST portion from the tax-inclusive payment correctly:
  // e.g. ₹10,000 at 1% → GST = 10000×1/101 = ₹99.01, base = ₹9,900.99.
  // If the rate is not set, fall back to the blended TotalGstAmount/GrandTotal ratio.
  const gstRow = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT ISNULL(TotalGstAmount,0) AS TotalGstAmount, ISNULL(GrandTotal,0) AS GrandTotal, ISNULL(UnitParkingGstRate,0) AS UnitParkingGstRate FROM dbo.CrmBooking WHERE Id = @bid");
  const { TotalGstAmount: totalGstAmt, GrandTotal: grandTotal, UnitParkingGstRate: gstRate } = gstRow.recordset[0] || {};
  const rate = Number(gstRate || 0);
  const gstRatio = rate > 0
    ? rate / (100 + rate) // extract GST from tax-inclusive amount: e.g. 5% → 5/105
    : (grandTotal > 0 ? Number(totalGstAmt) / Number(grandTotal) : 0);
  const gstAmount = Math.round(amount * gstRatio * 100) / 100;
  const baseAmount = Math.round((amount - gstAmount) * 100) / 100;

  const paymentMode = cleanString(data.PaymentMode) || cleanString(defaults.PaymentMode) || "Other";
  const transactionRef = cleanString(data.TransactionRef) || cleanString(defaults.TransactionRef);
  const chequeNo = cleanString(data.ChequeNo) || cleanString(defaults.ChequeNo) || (paymentMode === "Cheque" ? transactionRef : null);
  const chequeDate = data.ChequeDate || defaults.ChequeDate || null;
  const bankName = cleanString(data.BankName) || cleanString(data.DepositBankName) || cleanString(defaults.DepositBankName);
  const receivedDate = data.ReceivedDate || new Date().toISOString().slice(0, 10);

  const receiptNo = await getNextDocNumber(pool, "MR", "MR");
  const result = await pool.request()
    .input("no", sql.NVarChar(30), receiptNo)
    .input("bid", sql.Int, bookingId)
    .input("amt", sql.Decimal(18, 2), amount)
    .input("mode", sql.NVarChar(30), paymentMode)
    .input("chq", sql.NVarChar(50), paymentMode === "Cheque" ? chequeNo : null)
    .input("chqDt", sql.Date, paymentMode === "Cheque" ? chequeDate : null)
    .input("bank", sql.NVarChar(150), bankName)
    .input("ref", sql.NVarChar(150), paymentMode === "Cheque" ? null : transactionRef)
    .input("rcvd", sql.Date, receivedDate)
    .input("rem", sql.NVarChar(500), cleanString(data.Remarks))
    .input("cb", sql.Int, actorUserId || null)
    .input("gst", sql.Decimal(18, 2), gstAmount)
    .input("base", sql.Decimal(18, 2), baseAmount)
    .query(`
      INSERT INTO dbo.CrmMoneyReceipt
        (ReceiptNo, BookingId, Amount, BaseAmount, GSTAmount, PaymentMode, ChequeNo, ChequeDate, BankName,
         TransactionRef, ReceivedDate, Remarks, Status, CreatedBy, CreatedAt, UpdatedAt)
      OUTPUT INSERTED.Id, INSERTED.ReceiptNo, INSERTED.Status
      VALUES
        (@no, @bid, @amt, @base, @gst, @mode, @chq, @chqDt, @bank,
         @ref, @rcvd, @rem, 'Pending', @cb, SYSDATETIME(), SYSDATETIME())
    `);

  const row = result.recordset[0];
  await generateMoneyReceiptPdf(pool, row.Id);
  return { existing: false, ...row };
}

async function createMoneyReceiptAfterDataReview(pool, bookingId, actorUserId) {
  return createMoneyReceiptForBooking(pool, bookingId, {}, actorUserId, { skipIfExists: true });
}

async function updateMoneyReceipt(pool, receiptId, data, actorUserId) {
  const cur = await pool.request().input("id", sql.Int, receiptId).query(`
    SELECT Id, Status, BookingId, ReceivedPaymentId
    FROM dbo.CrmMoneyReceipt
    WHERE Id = @id
  `);
  const row = cur.recordset[0];
  if (!row) throw new MoneyReceiptError("Money receipt not found", 404);
  if (!["Pending", "Bounced"].includes(row.Status)) {
    throw new MoneyReceiptError(`Cannot edit a money receipt from status "${row.Status}"`);
  }
  if (row.ReceivedPaymentId) {
    throw new MoneyReceiptError("This money receipt is already linked to Finance Received Payment and cannot be edited");
  }

  const amount = data.Amount != null && data.Amount !== "" ? Number(data.Amount) : null;
  if (amount != null && amount <= 0) throw new MoneyReceiptError("Amount must be greater than 0");
  const paymentMode = cleanString(data.PaymentMode);

  await pool.request()
    .input("id", sql.Int, receiptId)
    .input("amt", sql.Decimal(18, 2), amount)
    .input("mode", sql.NVarChar(30), paymentMode)
    .input("chq", sql.NVarChar(50), cleanString(data.ChequeNo))
    .input("chqDt", sql.Date, data.ChequeDate || null)
    .input("bank", sql.NVarChar(150), cleanString(data.BankName) || cleanString(data.DepositBankName))
    .input("ref", sql.NVarChar(150), cleanString(data.TransactionRef))
    .input("rcvd", sql.Date, data.ReceivedDate || null)
    .input("rem", sql.NVarChar(500), cleanString(data.Remarks))
    .query(`
      UPDATE dbo.CrmMoneyReceipt SET
        Amount = ISNULL(@amt, Amount),
        PaymentMode = ISNULL(@mode, PaymentMode),
        ChequeNo = CASE WHEN ISNULL(@mode, PaymentMode) = 'Cheque' THEN ISNULL(@chq, ChequeNo) ELSE NULL END,
        ChequeDate = CASE WHEN ISNULL(@mode, PaymentMode) = 'Cheque' THEN ISNULL(@chqDt, ChequeDate) ELSE NULL END,
        BankName = ISNULL(@bank, BankName),
        TransactionRef = CASE WHEN ISNULL(@mode, PaymentMode) = 'Cheque' THEN NULL ELSE ISNULL(@ref, TransactionRef) END,
        ReceivedDate = ISNULL(@rcvd, ReceivedDate),
        Remarks = ISNULL(@rem, Remarks),
        BouncedReason = CASE WHEN Status = 'Bounced' THEN BouncedReason ELSE NULL END,
        UpdatedAt = SYSDATETIME()
      WHERE Id = @id
    `);

  await generateMoneyReceiptPdf(pool, receiptId);
  return { success: true };
}

async function resubmitMoneyReceipt(pool, receiptId) {
  const result = await pool.request().input("id", sql.Int, receiptId).query(`
    UPDATE dbo.CrmMoneyReceipt SET
      Status = 'Pending',
      BouncedReason = NULL, BouncedBy = NULL, BouncedAt = NULL,
      UpdatedAt = SYSDATETIME()
    OUTPUT INSERTED.Id, INSERTED.Status
    WHERE Id = @id AND Status = 'Bounced' AND ReceivedPaymentId IS NULL
  `);
  if (!result.recordset.length) {
    throw new MoneyReceiptError("Only a bounced, unlinked money receipt can be resubmitted");
  }
  await generateMoneyReceiptPdf(pool, receiptId);
  return result.recordset[0];
}

async function bounceMoneyReceipt(pool, receiptId, reason, actorUserId) {
  if (!cleanString(reason)) throw new MoneyReceiptError("Bounce reason is required");
  const result = await pool.request()
    .input("id", sql.Int, receiptId)
    .input("reason", sql.NVarChar(500), cleanString(reason))
    .input("by", sql.Int, actorUserId || null)
    .query(`
      UPDATE dbo.CrmMoneyReceipt SET
        Status = 'Bounced',
        BouncedReason = @reason,
        BouncedBy = @by,
        BouncedAt = SYSDATETIME(),
        UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.Id, INSERTED.Status
      WHERE Id = @id AND Status = 'Pending' AND ReceivedPaymentId IS NULL
    `);
  if (!result.recordset.length) {
    throw new MoneyReceiptError("Only a pending, unlinked money receipt can be bounced");
  }
  await generateMoneyReceiptPdf(pool, receiptId);
  return result.recordset[0];
}

async function approveMoneyReceipt(pool, receiptId, actorUserId, actorEmail) {
  const tx = new sql.Transaction(pool);
  let mrRow;
  let rp;
  try {
    await tx.begin();
    const cur = await tx.request().input("id", sql.Int, receiptId).query(`
      SELECT mr.Id, mr.ReceiptNo, mr.BookingId, mr.Amount, mr.PaymentMode, mr.ChequeNo,
             mr.ChequeDate, mr.BankName, mr.TransactionRef, mr.ReceivedDate, mr.Remarks,
             mr.Status, mr.ReceivedPaymentId,
             b.BookingNo, b.ProjectName, b.ProjectId, b.CompanyId, b.ApplicationId, b.WorkflowStage,
             a.ApplicantName, a.DepositBankId
      FROM dbo.CrmMoneyReceipt mr WITH (UPDLOCK, HOLDLOCK)
      JOIN dbo.CrmBooking b ON b.Id = mr.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE mr.Id = @id
    `);
    mrRow = cur.recordset[0];
    if (!mrRow) throw new MoneyReceiptError("Money receipt not found", 404);
    if (mrRow.Status !== "Pending") throw new MoneyReceiptError(`Cannot approve from status "${mrRow.Status}"`);
    if (mrRow.ReceivedPaymentId) throw new MoneyReceiptError("Money receipt is already linked to Finance Received Payment");
    // Gate: booking must have been submitted for approval (past Review) — it
    // does NOT need to wait for Director/Level-2 sign-off. Finance records the
    // payment as soon as first-level verification is done; the booking's own
    // L1/L2 approval is a business-terms sign-off, independent of whether the
    // money was received. A still-at-Review booking has not been verified at all
    // and should not yet have a payable Money Receipt.
    if (mrRow.WorkflowStage === STAGE_REVIEW) {
      throw new MoneyReceiptError("Booking must be submitted for approval (Verify & Send for Approval) before the Money Receipt can be approved");
    }

    // Payment goes to On Account — NOT directly to a milestone.
    // Correct flow: Payment → On Account → Demand → Invoice → On Account Adjustment → Milestone Settled.
    // CrmMilestoneId is intentionally omitted so receivedPayment.js routes this through
    // applyCrmOnAccountPaymentApproval (On Account insert) instead of applyCrmMilestonePaymentApproval.
    const { createReceivedPaymentInternal } = require("../routes/receivedPayment");
    rp = await createReceivedPaymentInternal(tx, {
      RPReceivedFrom: mrRow.ApplicantName,
      RPCustomerName: mrRow.ApplicantName,
      RPProjectName: mrRow.ProjectName,
      RPProjectId: mrRow.ProjectId,
      RPCompanyId: mrRow.CompanyId,
      RPDocDate: mrRow.ReceivedDate || null,
      RPMode: mrRow.PaymentMode || null,
      RPAmount: Number(mrRow.Amount),
      RPBankName: mrRow.BankName || null,
      RPTransactionID: mrRow.PaymentMode === "Cheque" ? null : mrRow.TransactionRef,
      RPCheckNumber: mrRow.PaymentMode === "Cheque" ? mrRow.ChequeNo : null,
      RPChequeDate: mrRow.PaymentMode === "Cheque" ? mrRow.ChequeDate : null,
      RPRemarks: mrRow.Remarks || `CRM Money Receipt ${mrRow.ReceiptNo} - ${mrRow.BookingNo}`,
      RPDepositBankId: mrRow.DepositBankId || null,
      RPDepositBankName: mrRow.BankName || null,
      CrmMilestoneId: null,
      CrmBookingId: mrRow.BookingId,
      CrmApplicationId: mrRow.ApplicationId,
    }, actorEmail || String(actorUserId));

    // createReceivedPaymentInternal always inserts as 'Draft' (its other
    // callers deliberately want a manual review/submit step). CRM money has
    // already been through Booking-stage approval, so it must go straight
    // into Finance's Approval Inbox — Draft rows are invisible there (it
    // filters WHERE RPStatus = 'Pending'), so without this the payment would
    // sit unseen forever and never reach applyCrmOnAccountPaymentApproval.
    await tx.request().input("rpid", sql.Int, rp.RPPaymentID)
      .query("UPDATE dbo.ReceivedPayment SET RPStatus = 'Pending' WHERE RPPaymentID = @rpid AND RPStatus = 'Draft'");

    await tx.request()
      .input("id", sql.Int, receiptId)
      .input("rpid", sql.Int, rp.RPPaymentID)
      .input("by", sql.Int, actorUserId || null)
      .query(`
        UPDATE dbo.CrmMoneyReceipt SET
          Status = 'Approved',
          ReceivedPaymentId = @rpid,
          ApprovedBy = @by,
          ApprovedAt = SYSDATETIME(),
          UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch {}
    throw e;
  }

  try {
    const { invalidateReceivedPaymentWorkflowCaches } = require("../routes/receivedPayment");
    await invalidateReceivedPaymentWorkflowCaches();
  } catch (e) { console.error("[crm-money-receipt] cache invalidation failed:", e.message); }

  await generateMoneyReceiptPdf(pool, receiptId);

  // No demand-raise here on purpose. This milestone's own status doesn't
  // flip to Paid until Finance separately approves the linked
  // ReceivedPayment (receivedPayment.js PUT /:id/approve ->
  // applyCrmMilestonePaymentApproval), and THAT already calls
  // handleMilestoneBecamePaid, which correctly raises the true next
  // milestone's demand (MilestoneNo > this one). Raising it here too would
  // just re-target this same still-unpaid milestone.

  return { success: true, ReceivedPaymentId: rp.RPPaymentID, RPDocNo: rp.RPDocNo };
}

// Every CRM payment gets its own Money Receipt document, not just the
// Booking Amount's first payment — called once from receivedPayment.js's
// PUT /:id/approve, right after applyCrmMilestonePaymentApproval or
// applyCrmOnAccountPaymentApproval has actually applied the money, for
// every CRM-linked ReceivedPayment (any milestone, any installment/top-up,
// or an on-account deposit). Deliberately NOT a new Pending->Approved gate:
// the underlying ReceivedPayment has already been through Finance approval
// by the time this runs, so the receipt is generated Approved immediately —
// it documents a payment that's already been accepted, it doesn't ask for a
// second yes.
//
// Idempotent by ReceivedPaymentId: the Booking Amount's first payment still
// goes through the separate Pending-MR-first flow above (createMoneyReceipt
// AfterDataReview -> approveMoneyReceipt), which already links its MR to
// the ReceivedPayment it creates — for that one case this just refreshes
// the PDF instead of creating a duplicate document for the same money.
// Every other payment (a top-up on an already-partly-paid milestone, any
// milestone 2+, an on-account deposit) has no such pre-existing MR, so one
// gets created here for the first time.
async function ensureMoneyReceiptForApprovedPayment(pool, receivedPaymentId, actorUserId) {
  const existing = await getMoneyReceiptByReceivedPaymentId(pool, receivedPaymentId);
  if (existing) {
    await generateMoneyReceiptPdf(pool, existing.Id);
    return { existing: true, id: existing.Id };
  }

  const cur = await pool.request().input("id", sql.Int, receivedPaymentId).query(`
    SELECT RPPaymentID, RPAmount, RPMode, RPCheckNumber, RPChequeDate, RPBankName,
           RPTransactionID, RPDocDate, RPRemarks, CrmBookingId
    FROM dbo.ReceivedPayment WHERE RPPaymentID = @id
  `);
  const row = cur.recordset[0];
  if (!row || !row.CrmBookingId) return { existing: false, skipped: true };

  // Derive GST split from booking's overall ratio (same logic as crmPayments.js getGstSplit)
  const gstR = await pool.request().input("bid", sql.Int, row.CrmBookingId)
    .query("SELECT ISNULL(TotalGstAmount,0) AS TotalGstAmount, ISNULL(GrandTotal,0) AS GrandTotal FROM dbo.CrmBooking WHERE Id = @bid");
  const bkGst = gstR.recordset[0] || {};
  const gstRatio = Number(bkGst.GrandTotal) > 0 ? Number(bkGst.TotalGstAmount) / Number(bkGst.GrandTotal) : 0;
  const gstAmt  = Math.round(Number(row.RPAmount) * gstRatio * 100) / 100;
  const baseAmt = Math.round((Number(row.RPAmount) - gstAmt) * 100) / 100;

  const receiptNo = await getNextDocNumber(pool, "MR", "MR");
  const result = await pool.request()
    .input("no",   sql.NVarChar(30),  receiptNo)
    .input("bid",  sql.Int,           row.CrmBookingId)
    .input("amt",  sql.Decimal(18, 2), row.RPAmount)
    .input("base", sql.Decimal(18, 2), baseAmt)
    .input("gst",  sql.Decimal(18, 2), gstAmt)
    .input("mode", sql.NVarChar(30),  row.RPMode || "Other")
    .input("chq",  sql.NVarChar(50),  row.RPMode === "Cheque" ? row.RPCheckNumber : null)
    .input("chqDt", sql.Date,         row.RPMode === "Cheque" ? row.RPChequeDate : null)
    .input("bank", sql.NVarChar(150), row.RPBankName)
    .input("ref",  sql.NVarChar(150), row.RPMode === "Cheque" ? null : row.RPTransactionID)
    .input("rcvd", sql.Date,          row.RPDocDate || null)
    .input("rem",  sql.NVarChar(500), row.RPRemarks)
    .input("cb",   sql.Int,           actorUserId || null)
    .input("rpid", sql.Int,           receivedPaymentId)
    .query(`
      INSERT INTO dbo.CrmMoneyReceipt
        (ReceiptNo, BookingId, Amount, BaseAmount, GSTAmount, PaymentMode, ChequeNo, ChequeDate, BankName,
         TransactionRef, ReceivedDate, Remarks, Status, ReceivedPaymentId, CreatedBy,
         CreatedAt, UpdatedAt, ApprovedBy, ApprovedAt)
      OUTPUT INSERTED.Id
      VALUES
        (@no, @bid, @amt, @base, @gst, @mode, @chq, @chqDt, @bank,
         @ref, ISNULL(@rcvd, CAST(SYSDATETIME() AS DATE)), @rem, 'Approved', @rpid, @cb,
         SYSDATETIME(), SYSDATETIME(), @cb, SYSDATETIME())
    `);
  const id = result.recordset[0].Id;
  await generateMoneyReceiptPdf(pool, id);
  return { existing: false, id };
}

module.exports = {
  MoneyReceiptError,
  isMoneyReceiptApprover,
  createMoneyReceiptForBooking,
  createMoneyReceiptAfterDataReview,
  updateMoneyReceipt,
  resubmitMoneyReceipt,
  bounceMoneyReceipt,
  approveMoneyReceipt,
  ensureMoneyReceiptForApprovedPayment,
};
