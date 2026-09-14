// backend/services/crmLedger.js
//
// Connects CRM money events (booking payments, on-account deposits) to the
// ERP's core Finance module — the double-entry GL (dbo.GeneralLedgerEntry)
// and the party advance-balance mechanism (dbo.OnAccountLedger +
// dbo.AccountHeadMaster.OnAccountBalance) that every other module (Payments
// Made, Received Payments) already uses. Before this, CrmInvoice/
// CrmPaymentReceipt/CrmOnAccountPayment were fully isolated from Finance —
// zero shared columns, zero calls.
//
// Mirrors the established pattern in generalLedger.js exactly: a poster
// function per money event, guarded by hasPosting() for idempotency, never
// allowed to block the business action it's attached to (callers wrap this
// in try/catch and log the outcome via approvalService.recordGLPosting).

const { sql } = require("../db");
const { getGLHeadId, postVoucher, hasPosting } = require("./generalLedger");

const CRM_COLLECTIONS_ACCOUNT = "CRM Collections A/c";
const CRM_STAMP_DUTY_ACCOUNT = "Stamp Duty & Registration Expense";
const CRM_GST_OUTPUT_ACCOUNT = "GST Output Liability - CRM Sales";
// Income head the company keeps when a cancelled booking is refunded (not
// re-booked). Seeded by migration 416.
const CRM_FORFEITURE_ACCOUNT = "Booking Cancellation Forfeiture";

/**
 * Live GST rate for a booking, resolved from its HsnCode against dbo.HSN —
 * never hardcoded, always re-read at posting time so a rate change in the
 * HSN master takes effect immediately. Same CGST+SGST-preferred-over-IGST
 * precedence buildGrnGstData.js already uses elsewhere in this codebase.
 * Returns 0 (no split) if the booking has no HsnCode or the code isn't
 * found — pricing is still treated as GST-inclusive, just with the GST
 * portion left un-split, same as before this feature existed.
 */
async function getGstRateForBooking(pool, bookingId) {
  const r = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT h.HCGST, h.HSGST, h.HIGST
    FROM dbo.CrmBooking b
    JOIN dbo.HSN h ON h.HCode = b.HsnCode AND h.HStatus = 1
    WHERE b.Id = @bid
  `);
  const row = r.recordset[0];
  if (!row) return 0;
  const cgstSgst = (Number(row.HCGST) || 0) + (Number(row.HSGST) || 0);
  return cgstSgst || Number(row.HIGST) || 0;
}

/**
 * THE single, canonical GST split for a CRM payment amount against a
 * booking — every GL posting (postCrmReceiptToGL, postCrmOnAccountToGL
 * below) and every CrmPaymentReceipt row's own stored BaseAmount/GSTAmount
 * (crmPayments.js, previously its own separate local copy of this exact
 * function) must go through this one implementation, not re-derive GST
 * independently. Two independently-maintained calculations of "the same"
 * split is exactly the kind of drift bug this consolidation closes — a
 * receipt's stored GSTAmount disagreeing with what actually got posted to
 * the GST Output Liability account in GL would be a real reconciliation
 * problem, not just a cosmetic one.
 *
 * Deliberately NOT the live-HSN-rate back-calculation getGstRateForBooking
 * above uses — this instead takes the *ratio* of the booking's own already-
 * computed TotalGstAmount to its GrandTotal (both set once, at booking
 * time, from the live HSN rate that applied then) and applies that ratio to
 * the payment amount. Rationale: a booking's locked-in GST amount must
 * never silently drift just because the HSN master's rate changed later —
 * only a fresh booking (or an explicit re-price) should ever pick up a new
 * rate. No hardcoded percentage anywhere: both TotalGstAmount and
 * GrandTotal are themselves live, HSN-derived figures computed once at
 * booking/re-price time (see crmLedger.js's own booking-level GST columns).
 * Returns a zero split (no GST) if the booking has no GST recorded at all —
 * same conservative "don't invent a split" behavior as getGstRateForBooking.
 */
async function getGstSplit(pool, bookingId, amount) {
  const r = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT ISNULL(TotalGstAmount,0) AS TotalGstAmount, ISNULL(GrandTotal,0) AS GrandTotal FROM dbo.CrmBooking WHERE Id = @bid");
  const row = r.recordset[0] || {};
  const ratio = Number(row.GrandTotal) > 0 ? Number(row.TotalGstAmount) / Number(row.GrandTotal) : 0;
  const gstAmount = Math.round(amount * ratio * 100) / 100;
  return { gstAmount, baseAmount: Math.round((amount - gstAmount) * 100) / 100 };
}

let _sundryDebtorsGroupId;
/** ASSETS > CURRENT ASSETS > TRADE RECEIVABLES > SUNDRY DEBTORS (migration
 * 191) — without this, a new customer head has LBelongsTo = NULL and is
 * invisible in Trial Balance, which filters on it being set. */
async function getSundryDebtorsGroupId(pool) {
  if (_sundryDebtorsGroupId !== undefined) return _sundryDebtorsGroupId;
  const r = await pool.request().query("SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'SDS'");
  _sundryDebtorsGroupId = r.recordset[0]?.AGId ?? null;
  return _sundryDebtorsGroupId;
}

/**
 * Idempotent: returns the AccountHeadMaster.LHeadId for a CrmCustomer,
 * creating it on first use. LHeadType='A' — the same code used by the
 * manual Customer Master (CustomerMaster.tsx) — not 'C', which means
 * Contractor everywhere else in this schema (accountHeadMaster.js). This
 * used to be minted as 'C' too, colliding with real Contractor rows in
 * every LHeadType='C' listing/report until it was corrected. Unlike the
 * manual Customer Master, no GST gating applies here — a CRM buyer is an
 * individual, not a GST-registered company.
 */
async function ensureCrmCustomerLedgerHead(pool, crmCustomerId, createdBy) {
  const code = `CRMCUST-${crmCustomerId}`;
  const existing = await pool.request().input("code", sql.NVarChar(20), code)
    .query("SELECT LHeadId FROM dbo.AccountHeadMaster WHERE LHeadCode = @code");
  if (existing.recordset.length) return existing.recordset[0].LHeadId;

  const cust = await pool.request().input("id", sql.Int, crmCustomerId)
    .query("SELECT CustomerName, Mobile, Email, Address, PanNo, InvoiceMode FROM dbo.CrmCustomer WHERE Id = @id");
  const c = cust.recordset[0];
  if (!c) throw new Error(`CrmCustomer ${crmCustomerId} not found — cannot create ledger head`);

  const groupId = await getSundryDebtorsGroupId(pool);

  const result = await pool.request()
    .input("LHeadName", sql.NVarChar(200), c.CustomerName)
    .input("LHeadCode", sql.NVarChar(20), code)
    .input("LHeadPhone", sql.NVarChar(50), c.Mobile || null)
    .input("LHeadEmail", sql.NVarChar(100), c.Email || null)
    .input("LHeadAddress", sql.VarChar(300), c.Address || "N/A")
    .input("LHeadContactPerson", sql.VarChar(100), c.CustomerName || "N/A")
    .input("LHeadPaymentTerms", sql.NVarChar(100), "N/A")
    .input("LHeadPan", sql.NVarChar(50), c.PanNo || null)
    .input("LCountry", sql.VarChar(50), "India")
    .input("LHeadType", sql.VarChar(50), "A")
    .input("LHeadStatus", sql.Bit, 1)
    .input("Status", sql.NVarChar(20), "Approved")
    .input("LBelongsTo", sql.Int, groupId)
    .input("InvoiceMode", sql.NVarChar(20), c.InvoiceMode || "NonInvoice")
    .input("CreatedBy", sql.NVarChar(100), createdBy || "system")
    .query(`
      INSERT INTO dbo.AccountHeadMaster
        (LHeadName, LHeadCode, LHeadPhone, LHeadEmail, LHeadAddress, LHeadContactPerson,
         LHeadPaymentTerms, LHeadPan, LCountry, LHeadType, LHeadStatus, Status, LBelongsTo, InvoiceMode,
         ApprovedBy, ApprovedAt, CreatedBy, CreatedAt)
      OUTPUT INSERTED.LHeadId
      VALUES
        (@LHeadName, @LHeadCode, @LHeadPhone, @LHeadEmail, @LHeadAddress, @LHeadContactPerson,
         @LHeadPaymentTerms, @LHeadPan, @LCountry, @LHeadType, @LHeadStatus, @Status, @LBelongsTo, @InvoiceMode,
         @CreatedBy, SYSDATETIME(), @CreatedBy, SYSDATETIME())
    `);
  return result.recordset[0].LHeadId;
}

/**
 * Push an edit on CrmCustomer (the canonical identity record) out to its
 * synced AccountHeadMaster row — the same "Customer Master" ledger head
 * used by the Sales module's Customer Sale Orders and Finance's Trial
 * Balance/ledger reports. Without this, a correction made in CRM (name typo,
 * updated phone, new PAN) would silently leave that ledger head — and
 * therefore every Sales-module screen reading it — pointing at the stale
 * value, the exact same drift class already fixed for CrmApplication.
 * No-ops quietly if the customer has no ledger head yet (nothing to sync).
 */
async function syncCrmCustomerLedgerHead(pool, crmCustomerId, fields) {
  const code = `CRMCUST-${crmCustomerId}`;
  await pool.request()
    .input("code",   sql.NVarChar(20), code)
    .input("name",   sql.NVarChar(200), fields.CustomerName || null)
    .input("phone",  sql.NVarChar(50), fields.Mobile || null)
    .input("email",  sql.NVarChar(100), fields.Email ?? null)
    .input("addr",   sql.VarChar(300), fields.Address || null)
    .input("pan",    sql.NVarChar(50), fields.PanNo || null)
    // InvoiceMode has no ISNULL fallback like the fields above — CrmCustomer
    // is the canonical source for this flag (it's NOT NULL there with a real
    // default), so every sync call always carries a real value and this
    // ledger head must always end up matching it exactly, never keeping a
    // stale value from before. This is what makes "no invoice for this
    // customer" hold from BOTH the CRM booking-invoice pipeline and the
    // standalone Accounts Sale Invoice module, which reads this same row.
    .input("invmode", sql.NVarChar(20), fields.InvoiceMode || "NonInvoice")
    .query(`
      UPDATE dbo.AccountHeadMaster SET
        LHeadName          = ISNULL(@name, LHeadName),
        LHeadContactPerson = ISNULL(@name, LHeadContactPerson),
        LHeadPhone         = ISNULL(@phone, LHeadPhone),
        LHeadEmail         = @email,
        LHeadAddress       = ISNULL(@addr, LHeadAddress),
        LHeadPan           = ISNULL(@pan, LHeadPan),
        InvoiceMode        = @invmode
      WHERE LHeadCode = @code
    `);
}

/**
 * A milestone payment receipt actually being cash in hand.
 *   Dr CRM Collections A/c ... cash comes in
 *   Cr Customer ............... reduces what they owe us
 *
 * Skipped (not an error) for receipts created by applying an existing
 * on-account deposit (OnAccountPaymentId set) — that cash was already
 * posted when the deposit itself was received; posting again here would
 * double-count it.
 */
async function postCrmReceiptToGL(pool, receiptId, userEmail) {
  if (await hasPosting(pool, "CrmPaymentReceipt", receiptId))
    return { posted: true, reason: "already posted (idempotent)" };

  const r = await pool.request().input("id", sql.Int, receiptId).query(`
    SELECT r.Id, r.ReceiptNo, r.Amount, r.ReceivedDate, r.PaymentMode, r.OnAccountPaymentId,
           b.Id AS BookingId, b.CompanyId, b.ProjectId, a.CustomerId
    FROM dbo.CrmPaymentReceipt r
    JOIN dbo.CrmPaymentMilestone m ON m.Id = r.MilestoneId
    JOIN dbo.CrmBooking b ON b.Id = m.BookingId
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE r.Id = @id
  `);
  const row = r.recordset[0];
  if (!row) return { posted: false, reason: `CrmPaymentReceipt ${receiptId} not found` };
  if (row.OnAccountPaymentId)
    return { none: true, reason: "sourced from an on-account application, not new cash" };
  if (!row.CustomerId)
    return { posted: false, reason: `Receipt ${receiptId}: booking's application has no linked CrmCustomer` };

  const amount = Number(row.Amount) || 0;
  if (amount <= 0) return { posted: false, reason: `Receipt ${receiptId} amount is ${amount} (<= 0)` };

  const customerHeadId = await ensureCrmCustomerLedgerHead(pool, row.CustomerId, userEmail);
  const collectionsHeadId = await getGLHeadId(pool, CRM_COLLECTIONS_ACCOUNT);

  // Pricing is GST-inclusive — split via the same canonical getGstSplit()
  // every other CRM money event (including this receipt's own stored
  // BaseAmount/GSTAmount columns) uses, so the GL posting can never disagree
  // with what the receipt itself records. A booking with no GST recorded
  // posts exactly as before this feature existed: the full amount credited
  // to the customer, no GST leg.
  const { gstAmount, baseAmount } = await getGstSplit(pool, row.BookingId, amount);
  const legs = [
    { lHeadId: collectionsHeadId, debit: amount, narration: `${row.ReceiptNo} — CRM payment received (${row.PaymentMode || "—"})` },
  ];
  if (gstAmount > 0) {
    const gstHeadId = await getGLHeadId(pool, CRM_GST_OUTPUT_ACCOUNT);
    legs.push({ lHeadId: customerHeadId, credit: baseAmount, narration: `${row.ReceiptNo} — CRM payment received (base, excl. GST)` });
    legs.push({ lHeadId: gstHeadId, credit: gstAmount, narration: `${row.ReceiptNo} — GST output liability` });
  } else {
    legs.push({ lHeadId: customerHeadId, credit: amount, narration: `${row.ReceiptNo} — CRM payment received` });
  }

  await postVoucher(pool, {
    voucherNo: row.ReceiptNo,
    voucherDate: row.ReceivedDate,
    sourceType: "CrmPaymentReceipt",
    sourceId: receiptId,
    companyId: row.CompanyId ?? null,
    projectId: row.ProjectId ?? null,
    createdBy: userEmail,
    legs,
  });
  return { posted: true };
}

/**
 * An on-account (advance) deposit — real cash, not yet tied to a milestone.
 *   Dr CRM Collections A/c ... cash comes in
 *   Cr Customer ............... reduces what they owe us
 * Also recorded on dbo.OnAccountLedger (CREDIT) + AccountHeadMaster.
 * OnAccountBalance bumped — the same mechanism Payments Made/Received
 * Payments already use for "money received, not yet applied to an
 * invoice", so this customer's advance balance is queryable through the
 * exact same read path as every other party in the ERP.
 */
async function postCrmOnAccountToGL(pool, onAccountId, userEmail) {
  if (await hasPosting(pool, "CrmOnAccountPayment", onAccountId))
    return { posted: true, reason: "already posted (idempotent)" };

  const r = await pool.request().input("id", sql.Int, onAccountId).query(`
    SELECT oa.Id, oa.ReceiptNo, oa.Amount, oa.ReceivedDate, oa.PaymentMode,
           b.Id AS BookingId, b.CompanyId, b.ProjectId, a.CustomerId
    FROM dbo.CrmOnAccountPayment oa
    JOIN dbo.CrmBooking b ON b.Id = oa.BookingId
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE oa.Id = @id
  `);
  const row = r.recordset[0];
  if (!row) return { posted: false, reason: `CrmOnAccountPayment ${onAccountId} not found` };
  if (!row.CustomerId)
    return { posted: false, reason: `On-account ${onAccountId}: booking's application has no linked CrmCustomer` };

  const amount = Number(row.Amount) || 0;
  if (amount <= 0) return { posted: false, reason: `On-account ${onAccountId} amount is ${amount} (<= 0)` };

  const customerHeadId = await ensureCrmCustomerLedgerHead(pool, row.CustomerId, userEmail);
  const collectionsHeadId = await getGLHeadId(pool, CRM_COLLECTIONS_ACCOUNT);

  // Same canonical getGstSplit() as postCrmReceiptToGL above — an on-account
  // deposit is real cash against the same GST-inclusive booking price, just
  // not yet allocated to a specific milestone. It must carry the identical
  // GST split so GST liability is recognised the moment cash actually
  // arrives, not deferred until the deposit happens to get applied to a
  // milestone later — postCrmOnAccountApplied below is a pure reallocation
  // of already-posted cash, not new income, so it correctly does NOT
  // re-split GST a second time.
  const { gstAmount, baseAmount } = await getGstSplit(pool, row.BookingId, amount);
  const legs = [
    { lHeadId: collectionsHeadId, debit: amount, narration: `${row.ReceiptNo} — CRM on-account deposit received` },
  ];
  if (gstAmount > 0) {
    const gstHeadId = await getGLHeadId(pool, CRM_GST_OUTPUT_ACCOUNT);
    legs.push({ lHeadId: customerHeadId, credit: baseAmount, narration: `${row.ReceiptNo} — CRM on-account deposit received (base, excl. GST)` });
    legs.push({ lHeadId: gstHeadId, credit: gstAmount, narration: `${row.ReceiptNo} — GST output liability` });
  } else {
    legs.push({ lHeadId: customerHeadId, credit: amount, narration: `${row.ReceiptNo} — CRM on-account deposit received` });
  }

  await postVoucher(pool, {
    voucherNo: row.ReceiptNo,
    voucherDate: row.ReceivedDate,
    sourceType: "CrmOnAccountPayment",
    sourceId: onAccountId,
    companyId: row.CompanyId ?? null,
    projectId: row.ProjectId ?? null,
    createdBy: userEmail,
    legs,
  });

  await pool.request()
    .input("PartyId", sql.Int, customerHeadId)
    .input("PartyType", sql.NVarChar(20), "A")
    .input("TxnDate", sql.Date, row.ReceivedDate)
    .input("TxnType", sql.NVarChar(10), "CREDIT")
    .input("Amount", sql.Decimal(18, 2), amount)
    .input("RefType", sql.NVarChar(30), "CrmOnAccountPayment")
    .input("RefDocNo", sql.NVarChar(100), row.ReceiptNo)
    .input("RefId", sql.Int, onAccountId)
    .input("CompanyId", sql.Int, row.CompanyId ?? null)
    .input("ProjectId", sql.Int, row.ProjectId ?? null)
    .input("Notes", sql.NVarChar(500), `CRM on-account deposit ${row.ReceiptNo}`)
    .input("CreatedBy", sql.NVarChar(150), userEmail)
    .query(`
      INSERT INTO dbo.OnAccountLedger
        (PartyId,PartyType,TxnDate,TxnType,Amount,RefType,RefDocNo,RefId,CompanyId,ProjectId,Notes,CreatedBy)
      VALUES
        (@PartyId,@PartyType,@TxnDate,@TxnType,@Amount,@RefType,@RefDocNo,@RefId,@CompanyId,@ProjectId,@Notes,@CreatedBy);
      UPDATE dbo.AccountHeadMaster
        SET OnAccountBalance = OnAccountBalance + @Amount
        WHERE LHeadId = @PartyId;
    `);

  return { posted: true };
}

/**
 * An on-account deposit being applied to a specific milestone — not new
 * cash (already posted by postCrmOnAccountToGL when the deposit came in),
 * just a reallocation. DEBITs the OnAccountLedger to reduce the balance,
 * mirroring newPayment.js's auto-apply-OA-to-invoice DEBIT pattern exactly.
 */
async function postCrmOnAccountApplied(pool, onAccountId, appliedAmount, userEmail, txnDate) {
  const r = await pool.request().input("id", sql.Int, onAccountId).query(`
    SELECT oa.ReceiptNo, b.CompanyId, b.ProjectId, a.CustomerId
    FROM dbo.CrmOnAccountPayment oa
    JOIN dbo.CrmBooking b ON b.Id = oa.BookingId
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE oa.Id = @id
  `);
  const row = r.recordset[0];
  if (!row?.CustomerId) return { posted: false, reason: `On-account ${onAccountId}: no linked CrmCustomer` };

  const customerHeadId = await ensureCrmCustomerLedgerHead(pool, row.CustomerId, userEmail);

  await pool.request()
    .input("PartyId", sql.Int, customerHeadId)
    .input("PartyType", sql.NVarChar(20), "A")
    .input("TxnDate", sql.Date, txnDate || new Date())
    .input("TxnType", sql.NVarChar(10), "DEBIT")
    .input("Amount", sql.Decimal(18, 2), appliedAmount)
    .input("RefType", sql.NVarChar(30), "CrmPaymentReceipt")
    .input("RefDocNo", sql.NVarChar(100), row.ReceiptNo)
    .input("RefId", sql.Int, onAccountId)
    .input("CompanyId", sql.Int, row.CompanyId ?? null)
    .input("ProjectId", sql.Int, row.ProjectId ?? null)
    .input("Notes", sql.NVarChar(500), `Applied from on-account deposit ${row.ReceiptNo}`)
    .input("CreatedBy", sql.NVarChar(150), userEmail)
    .query(`
      INSERT INTO dbo.OnAccountLedger
        (PartyId,PartyType,TxnDate,TxnType,Amount,RefType,RefDocNo,RefId,CompanyId,ProjectId,Notes,CreatedBy)
      VALUES
        (@PartyId,@PartyType,@TxnDate,@TxnType,@Amount,@RefType,@RefDocNo,@RefId,@CompanyId,@ProjectId,@Notes,@CreatedBy);
      UPDATE dbo.AccountHeadMaster
        SET OnAccountBalance = OnAccountBalance - @Amount
        WHERE LHeadId = @PartyId;
    `);
  return { posted: true };
}

/**
 * A broker payout actually being cash paid out.
 *   Dr Broker ................. reduces what we owe them
 *   Cr CRM Collections A/c .... cash leaves
 *
 * The broker's ledger head already exists and needs no auto-creation —
 * CrmBrokerageMaster.BrokerId IS an AccountHeadMaster.LHeadId (LHeadType=
 * 'BR'), enforced at brokerage-creation time in crmBrokerage.js. Unlike the
 * customer side, there's no gap to fill here.
 */
async function postCrmBrokerPaymentToGL(pool, paymentId, userEmail) {
  if (await hasPosting(pool, "CrmBrokerPayment", paymentId))
    return { posted: true, reason: "already posted (idempotent)" };

  const r = await pool.request().input("id", sql.Int, paymentId).query(`
    SELECT p.Id, p.Amount, p.PaidDate, p.PaymentMode,
           br.BrokerId, br.BrokerName, b.CompanyId, b.ProjectId
    FROM dbo.CrmBrokerPayment p
    JOIN dbo.CrmBrokerageMaster br ON br.Id = p.BrokerageId
    JOIN dbo.CrmBooking b ON b.Id = br.BookingId
    WHERE p.Id = @id
  `);
  const row = r.recordset[0];
  if (!row) return { posted: false, reason: `CrmBrokerPayment ${paymentId} not found` };
  if (!row.BrokerId) return { posted: false, reason: `Payment ${paymentId}: brokerage record has no BrokerId ledger head` };

  const amount = Number(row.Amount) || 0;
  if (amount <= 0) return { posted: false, reason: `Payment ${paymentId} amount is ${amount} (<= 0)` };

  const collectionsHeadId = await getGLHeadId(pool, CRM_COLLECTIONS_ACCOUNT);
  const docNo = `BRKPMT-${paymentId}`;

  await postVoucher(pool, {
    voucherNo: docNo,
    voucherDate: row.PaidDate,
    sourceType: "CrmBrokerPayment",
    sourceId: paymentId,
    companyId: row.CompanyId ?? null,
    projectId: row.ProjectId ?? null,
    createdBy: userEmail,
    legs: [
      { lHeadId: row.BrokerId, debit: amount, narration: `${docNo} — brokerage paid to ${row.BrokerName || "broker"} (${row.PaymentMode || "—"})` },
      { lHeadId: collectionsHeadId, credit: amount, narration: `${docNo} — brokerage paid` },
    ],
  });
  return { posted: true };
}

/**
 * A cancellation refund actually being cash paid back to the customer —
 * the reverse of a receipt.
 *   Dr Customer ................ undoes the credit built up from their
 *                                 earlier payments (what we owed back)
 *   Cr CRM Collections A/c ..... cash leaves
 */
async function postCrmCancellationRefundToGL(pool, cancellationId, userEmail) {
  if (await hasPosting(pool, "CrmCancellation", cancellationId))
    return { posted: true, reason: "already posted (idempotent)" };

  const r = await pool.request().input("id", sql.Int, cancellationId).query(`
    SELECT c.Id, c.CancellationNo, c.RefundAmount, c.RefundDate, c.RefundMode,
           b.CompanyId, b.ProjectId, a.CustomerId
    FROM dbo.CrmCancellation c
    JOIN dbo.CrmBooking b ON b.Id = c.BookingId
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE c.Id = @id
  `);
  const row = r.recordset[0];
  if (!row) return { posted: false, reason: `CrmCancellation ${cancellationId} not found` };
  if (!row.CustomerId) return { posted: false, reason: `Cancellation ${cancellationId}: booking's application has no linked CrmCustomer` };

  const amount = Number(row.RefundAmount) || 0;
  if (amount <= 0) return { none: true, reason: `Cancellation ${cancellationId} refund amount is ${amount} (<= 0) — nothing to refund` };

  const customerHeadId = await ensureCrmCustomerLedgerHead(pool, row.CustomerId, userEmail);
  const collectionsHeadId = await getGLHeadId(pool, CRM_COLLECTIONS_ACCOUNT);
  const docNo = row.CancellationNo || `CXLRF-${cancellationId}`;

  await postVoucher(pool, {
    voucherNo: docNo,
    voucherDate: row.RefundDate,
    sourceType: "CrmCancellation",
    sourceId: cancellationId,
    companyId: row.CompanyId ?? null,
    projectId: row.ProjectId ?? null,
    createdBy: userEmail,
    legs: [
      { lHeadId: customerHeadId, debit: amount, narration: `${docNo} — cancellation refund (${row.RefundMode || "—"})` },
      { lHeadId: collectionsHeadId, credit: amount, narration: `${docNo} — cancellation refund paid` },
    ],
  });
  return { posted: true };
}

/**
 * The FORFEITURE leg of a refund payout (dbo.CrmRefund). The spawned Finance
 * NewPayment voucher already posts  Dr Customer / Cr <real bank>  for the NET
 * amount when Finance approves it. This poster adds only the deduction the
 * company keeps:
 *   Dr Customer .......................... extinguishes the rest of their credit
 *   Cr Booking Cancellation Forfeiture ... recognised as other income
 * No-op when DeductionAmount = 0 (overpayment / manual refunds).
 */
async function postCrmRefundPaid(pool, refundId, userEmail) {
  if (await hasPosting(pool, "CrmRefund", refundId))
    return { posted: true, reason: "already posted (idempotent)" };

  const r = await pool.request().input("id", sql.Int, refundId).query(`
    SELECT Id, RefundNo, DeductionAmount, CompanyId, ProjectId, CustomerId, PaidAt
    FROM dbo.CrmRefund WHERE Id = @id
  `);
  const row = r.recordset[0];
  if (!row) return { posted: false, reason: `CrmRefund ${refundId} not found` };
  if (!row.CustomerId) return { posted: false, reason: `Refund ${refundId}: no linked CrmCustomer` };

  const deduction = Number(row.DeductionAmount) || 0;
  if (deduction <= 0) return { none: true, reason: `Refund ${refundId} has no forfeiture — bank leg posted by the NewPayment voucher` };

  const customerHeadId = await ensureCrmCustomerLedgerHead(pool, row.CustomerId, userEmail);
  const forfeitureHeadId = await getGLHeadId(pool, CRM_FORFEITURE_ACCOUNT);
  const docNo = row.RefundNo || `CRFD-${refundId}`;

  await postVoucher(pool, {
    voucherNo: `${docNo}-FORF`,
    voucherDate: row.PaidAt || new Date(),
    sourceType: "CrmRefund",
    sourceId: refundId,
    companyId: row.CompanyId ?? null,
    projectId: row.ProjectId ?? null,
    createdBy: userEmail,
    legs: [
      { lHeadId: customerHeadId, debit: deduction, narration: `${docNo} — cancellation forfeiture retained` },
      { lHeadId: forfeitureHeadId, credit: deduction, narration: `${docNo} — booking cancellation forfeiture income` },
    ],
  });
  return { posted: true };
}

/**
 * Ledger-only reallocation when held credit is applied to a NEW booking's
 * fresh on-account row (same company). NO GL voucher — the customer head
 * already carries this liability from the cancelled booking's original
 * receipts; this just makes the money show as an available advance on the new
 * booking via OnAccountLedger + AccountHeadMaster.OnAccountBalance, exactly
 * like a normal on-account deposit's ledger side. The existing
 * applyOnAccountToMilestone sweep then DEBITs it back down onto milestones.
 */
async function postCrmHeldCreditReallocateLedgerOnly(pool, { customerId, newOnAccountId, amount, companyId, projectId, receiptNo, userEmail, executor }) {
  const exec = executor || pool;
  const customerHeadId = await ensureCrmCustomerLedgerHead(pool, customerId, userEmail);
  await exec.request()
    .input("PartyId", sql.Int, customerHeadId)
    .input("PartyType", sql.NVarChar(20), "A")
    .input("TxnDate", sql.Date, new Date())
    .input("TxnType", sql.NVarChar(10), "CREDIT")
    .input("Amount", sql.Decimal(18, 2), amount)
    .input("RefType", sql.NVarChar(30), "CrmOnAccountPayment")
    .input("RefDocNo", sql.NVarChar(100), receiptNo || null)
    .input("RefId", sql.Int, newOnAccountId)
    .input("CompanyId", sql.Int, companyId ?? null)
    .input("ProjectId", sql.Int, projectId ?? null)
    .input("Notes", sql.NVarChar(500), `Re-booking credit from cancelled booking (${receiptNo || "held"})`)
    .input("CreatedBy", sql.NVarChar(150), userEmail)
    .query(`
      INSERT INTO dbo.OnAccountLedger
        (PartyId,PartyType,TxnDate,TxnType,Amount,RefType,RefDocNo,RefId,CompanyId,ProjectId,Notes,CreatedBy)
      VALUES
        (@PartyId,@PartyType,@TxnDate,@TxnType,@Amount,@RefType,@RefDocNo,@RefId,@CompanyId,@ProjectId,@Notes,@CreatedBy);
      UPDATE dbo.AccountHeadMaster SET OnAccountBalance = OnAccountBalance + @Amount WHERE LHeadId = @PartyId;
    `);
  return { posted: true };
}

/**
 * CRM mirror for a CROSS-company re-booking transfer (dbo.CrmRebookingTransfer).
 * Reclassifies the customer's advance liability from the source company's CRM
 * books to the target company's, through the CRM Collections proxy:
 *   Company A voucher:  Dr Customer / Cr "CRM Collections A/c"   (companyId = A)
 *   Company B voucher:  Dr "CRM Collections A/c" / Cr Customer   (companyId = B)
 * Net movement on the (single) customer head is zero. The real bank + LOAN-C
 * bridge is squared separately by the linked Finance Inter-Company FundTransfer.
 * Same-company transfers do NOT call this (no cross-company reclass needed).
 */
async function postCrmHeldCreditCrossCompanyMirror(pool, rebookingTransferId, userEmail) {
  if (await hasPosting(pool, "CrmRebookingTransfer", rebookingTransferId))
    return { posted: true, reason: "already posted (idempotent)" };

  const r = await pool.request().input("id", sql.Int, rebookingTransferId).query(`
    SELECT rt.Id, rt.Amount, rt.FromCompanyId, rt.ToCompanyId, rt.ToBookingId,
           fb.ProjectId AS FromProjectId, tb.ProjectId AS ToProjectId,
           ta.CustomerId
    FROM dbo.CrmRebookingTransfer rt
    JOIN dbo.CrmOnAccountPayment hc ON hc.Id = rt.HeldOnAccountId
    JOIN dbo.CrmBooking fb ON fb.Id = hc.BookingId
    JOIN dbo.CrmBooking tb ON tb.Id = rt.ToBookingId
    JOIN dbo.CrmApplication ta ON ta.Id = tb.ApplicationId
    WHERE rt.Id = @id
  `);
  const row = r.recordset[0];
  if (!row) return { posted: false, reason: `CrmRebookingTransfer ${rebookingTransferId} not found` };
  if (!row.CustomerId) return { posted: false, reason: `Rebooking transfer ${rebookingTransferId}: no linked CrmCustomer` };

  const amount = Number(row.Amount) || 0;
  if (amount <= 0) return { none: true, reason: `Rebooking transfer ${rebookingTransferId} amount is ${amount}` };

  const customerHeadId = await ensureCrmCustomerLedgerHead(pool, row.CustomerId, userEmail);
  const collectionsHeadId = await getGLHeadId(pool, CRM_COLLECTIONS_ACCOUNT);
  const docNo = `REBK-${rebookingTransferId}`;

  // Company A — liability leaves A's CRM books
  await postVoucher(pool, {
    voucherNo: `${docNo}-A`,
    voucherDate: new Date(),
    sourceType: "CrmRebookingTransfer",
    sourceId: rebookingTransferId,
    companyId: row.FromCompanyId ?? null,
    projectId: row.FromProjectId ?? null,
    createdBy: userEmail,
    legs: [
      { lHeadId: customerHeadId, debit: amount, narration: `${docNo} — held credit transferred out for re-booking` },
      { lHeadId: collectionsHeadId, credit: amount, narration: `${docNo} — held credit transferred out` },
    ],
  });
  // Company B — liability arrives in B's CRM books
  await postVoucher(pool, {
    voucherNo: `${docNo}-B`,
    voucherDate: new Date(),
    sourceType: "CrmRebookingTransfer",
    sourceId: rebookingTransferId,
    companyId: row.ToCompanyId ?? null,
    projectId: row.ToProjectId ?? null,
    createdBy: userEmail,
    legs: [
      { lHeadId: collectionsHeadId, debit: amount, narration: `${docNo} — held credit received for re-booking` },
      { lHeadId: customerHeadId, credit: amount, narration: `${docNo} — held credit received` },
    ],
  });
  return { posted: true };
}

/**
 * Stamp duty + registration fee actually paid to the Sub-Registrar Office on
 * deed registration — real statutory cash outlay by the company, previously
 * just plain numbers on CrmSalesDeed with zero financial trail.
 *   Dr Stamp Duty & Registration Expense ... company incurs the cost
 *   Cr CRM Collections A/c ................ cash leaves (same cash proxy
 *                                            already used for brokerage
 *                                            payouts and cancellation refunds)
 */
async function postCrmSalesDeedStatutoryToGL(pool, deedId, userEmail) {
  if (await hasPosting(pool, "CrmSalesDeed", deedId))
    return { posted: true, reason: "already posted (idempotent)" };

  const r = await pool.request().input("id", sql.Int, deedId).query(`
    SELECT d.Id, d.DeedNo, d.StampDuty, d.RegistrationFee, d.RegistrationDate, d.DeedDate,
           b.CompanyId, b.ProjectId
    FROM dbo.CrmSalesDeed d
    JOIN dbo.CrmBooking b ON b.Id = d.BookingId
    WHERE d.Id = @id
  `);
  const row = r.recordset[0];
  if (!row) return { posted: false, reason: `CrmSalesDeed ${deedId} not found` };

  const amount = (Number(row.StampDuty) || 0) + (Number(row.RegistrationFee) || 0);
  if (amount <= 0) return { none: true, reason: `Deed ${deedId} has no stamp duty / registration fee recorded` };

  const expenseHeadId = await getGLHeadId(pool, CRM_STAMP_DUTY_ACCOUNT);
  const collectionsHeadId = await getGLHeadId(pool, CRM_COLLECTIONS_ACCOUNT);
  const voucherDate = row.RegistrationDate || row.DeedDate || new Date();

  await postVoucher(pool, {
    voucherNo: row.DeedNo,
    voucherDate,
    sourceType: "CrmSalesDeed",
    sourceId: deedId,
    companyId: row.CompanyId ?? null,
    projectId: row.ProjectId ?? null,
    createdBy: userEmail,
    legs: [
      { lHeadId: expenseHeadId, debit: amount, narration: `${row.DeedNo} — stamp duty & registration fee on deed registration` },
      { lHeadId: collectionsHeadId, credit: amount, narration: `${row.DeedNo} — stamp duty & registration fee paid` },
    ],
  });
  return { posted: true };
}

/**
 * A standalone (non-unit-linked) parking sale being paid — the same money
 * event as postCrmReceiptToGL, but for CrmParkingAllotment rows that have no
 * CrmBooking/CrmPaymentMilestone to hang a receipt off of (BookingId IS
 * NULL). Previously PUT /mark-paid just flipped PaymentStatus with zero
 * financial trail.
 *   Dr CRM Collections A/c ... cash comes in
 *   Cr Customer ............... reduces what they owe us
 */
async function postCrmParkingPaymentToGL(pool, allotmentId, userEmail) {
  if (await hasPosting(pool, "CrmParkingAllotment", allotmentId))
    return { posted: true, reason: "already posted (idempotent)" };

  const r = await pool.request().input("id", sql.Int, allotmentId).query(`
    SELECT pa.Id, pa.TotalAmount, pa.ReceiptNo, pa.PaymentMode, pa.PaymentReceivedDate,
           a.CustomerId, COALESCE(p.ProjectId, s.ProjectId) AS ProjectId
    FROM dbo.CrmParkingAllotment pa
    JOIN dbo.CrmApplication a ON a.Id = pa.ApplicationId
    LEFT JOIN dbo.ParkingMaster p ON p.Id = pa.ParkingMasterId
    LEFT JOIN dbo.ParkingSlot s ON s.Id = pa.ParkingSlotId
    WHERE pa.Id = @id
  `);
  const row = r.recordset[0];
  if (!row) return { posted: false, reason: `CrmParkingAllotment ${allotmentId} not found` };
  if (!row.CustomerId)
    return { posted: false, reason: `Allotment ${allotmentId}: application has no linked CrmCustomer` };

  const amount = Number(row.TotalAmount) || 0;
  if (amount <= 0) return { none: true, reason: `Allotment ${allotmentId} amount is ${amount} (<= 0)` };

  const customerHeadId = await ensureCrmCustomerLedgerHead(pool, row.CustomerId, userEmail);
  const collectionsHeadId = await getGLHeadId(pool, CRM_COLLECTIONS_ACCOUNT);
  const docNo = row.ReceiptNo || `PARK-${allotmentId}`;

  await postVoucher(pool, {
    voucherNo: docNo,
    voucherDate: row.PaymentReceivedDate || new Date(),
    sourceType: "CrmParkingAllotment",
    sourceId: allotmentId,
    companyId: null,
    projectId: row.ProjectId ?? null,
    createdBy: userEmail,
    legs: [
      { lHeadId: collectionsHeadId, debit: amount, narration: `${docNo} — standalone parking payment received (${row.PaymentMode || "—"})` },
      { lHeadId: customerHeadId, credit: amount, narration: `${docNo} — standalone parking payment received` },
    ],
  });
  return { posted: true };
}

module.exports = {
  CRM_COLLECTIONS_ACCOUNT,
  CRM_GST_OUTPUT_ACCOUNT,
  ensureCrmCustomerLedgerHead,
  syncCrmCustomerLedgerHead,
  getGstRateForBooking,
  getGstSplit,
  postCrmReceiptToGL,
  postCrmOnAccountToGL,
  postCrmOnAccountApplied,
  postCrmBrokerPaymentToGL,
  postCrmCancellationRefundToGL,
  postCrmRefundPaid,
  postCrmHeldCreditReallocateLedgerOnly,
  postCrmHeldCreditCrossCompanyMirror,
  postCrmSalesDeedStatutoryToGL,
  postCrmParkingPaymentToGL,
};