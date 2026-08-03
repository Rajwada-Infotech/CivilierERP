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
    .query("SELECT CustomerName, Mobile, Email, Address, PanNo FROM dbo.CrmCustomer WHERE Id = @id");
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
    .input("CreatedBy", sql.NVarChar(100), createdBy || "system")
    .query(`
      INSERT INTO dbo.AccountHeadMaster
        (LHeadName, LHeadCode, LHeadPhone, LHeadEmail, LHeadAddress, LHeadContactPerson,
         LHeadPaymentTerms, LHeadPan, LCountry, LHeadType, LHeadStatus, Status, LBelongsTo,
         ApprovedBy, ApprovedAt, CreatedBy, CreatedAt)
      OUTPUT INSERTED.LHeadId
      VALUES
        (@LHeadName, @LHeadCode, @LHeadPhone, @LHeadEmail, @LHeadAddress, @LHeadContactPerson,
         @LHeadPaymentTerms, @LHeadPan, @LCountry, @LHeadType, @LHeadStatus, @Status, @LBelongsTo,
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
    .query(`
      UPDATE dbo.AccountHeadMaster SET
        LHeadName          = ISNULL(@name, LHeadName),
        LHeadContactPerson = ISNULL(@name, LHeadContactPerson),
        LHeadPhone         = ISNULL(@phone, LHeadPhone),
        LHeadEmail         = @email,
        LHeadAddress       = ISNULL(@addr, LHeadAddress),
        LHeadPan           = ISNULL(@pan, LHeadPan)
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

  // Pricing is GST-inclusive — back-calculate the GST portion from the live
  // HSN rate rather than storing/hardcoding one. A booking with no HsnCode
  // (or an unresolvable one) posts exactly as before this feature existed:
  // the full amount credited to the customer, no GST leg.
  const gstRate = await getGstRateForBooking(pool, row.BookingId);
  const legs = [
    { lHeadId: collectionsHeadId, debit: amount, narration: `${row.ReceiptNo} — CRM payment received (${row.PaymentMode || "—"})` },
  ];
  if (gstRate > 0) {
    const gstAmount = Math.round((amount - amount / (1 + gstRate / 100)) * 100) / 100;
    const baseAmount = Math.round((amount - gstAmount) * 100) / 100;
    const gstHeadId = await getGLHeadId(pool, CRM_GST_OUTPUT_ACCOUNT);
    legs.push({ lHeadId: customerHeadId, credit: baseAmount, narration: `${row.ReceiptNo} — CRM payment received (base, excl. GST)` });
    legs.push({ lHeadId: gstHeadId, credit: gstAmount, narration: `${row.ReceiptNo} — GST output liability @ ${gstRate}%` });
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
           b.CompanyId, b.ProjectId, a.CustomerId
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

  await postVoucher(pool, {
    voucherNo: row.ReceiptNo,
    voucherDate: row.ReceivedDate,
    sourceType: "CrmOnAccountPayment",
    sourceId: onAccountId,
    companyId: row.CompanyId ?? null,
    projectId: row.ProjectId ?? null,
    createdBy: userEmail,
    legs: [
      { lHeadId: collectionsHeadId, debit: amount, narration: `${row.ReceiptNo} — CRM on-account deposit received` },
      { lHeadId: customerHeadId, credit: amount, narration: `${row.ReceiptNo} — CRM on-account deposit received` },
    ],
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
           a.CustomerId, p.ProjectId
    FROM dbo.CrmParkingAllotment pa
    JOIN dbo.CrmApplication a ON a.Id = pa.ApplicationId
    JOIN dbo.ParkingMaster p ON p.Id = pa.ParkingMasterId
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
  postCrmReceiptToGL,
  postCrmOnAccountToGL,
  postCrmOnAccountApplied,
  postCrmBrokerPaymentToGL,
  postCrmCancellationRefundToGL,
  postCrmSalesDeedStatutoryToGL,
  postCrmParkingPaymentToGL,
};