const express = require("express");
const { parseId } = require("../middleware/validateRequest");
const router = express.Router();
// Project access: a refund's own project, else its booking's.
const { projectParamGuard, projectPredicate, projectAllowed } = require("../services/projectScope");
router.param("id", projectParamGuard("SELECT COALESCE(r.ProjectId, b.ProjectId) AS ProjectId FROM dbo.CrmRefund r LEFT JOIN dbo.CrmBooking b ON b.Id = r.BookingId WHERE r.Id = @id"));
// A refund's GST document (credit note / refund voucher, migration 565): its own project.
router.param("noteId", projectParamGuard("SELECT n.ProjectId FROM dbo.CrmGstNote n WHERE n.Id = @id"));
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, requireUserEmail } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { applyPagination } = require("../services/crmListPagination");
const { transition: approvalTransition, recordGLPosting, isApproverFor } = require("../services/approvalService");
const { lockNextDocNumber, backPatchRecordId, resolveDocTypeId } = require("../utils/docNumberLock");
const { bumpCacheVersion } = require("../redis");
const {
  ensureCrmCustomerLedgerHead, postCrmRefundPaid,
  postCrmHeldCreditReallocateLedgerOnly, postCrmHeldCreditCrossCompanyMirror,
} = require("../services/crmLedger");
const { assertBookingProjectScope } = require("../services/assertBookingProjectScope");
const { refundCreateSchema } = require("../validation/crmBookingSchemas");
const { DEAD_BOOKING_STATUSES } = require("../constants/crmStatuses");

router.use(authMiddleware);
router.use(apiRateLimit);

// A refund payout is always a real bank transfer to the customer's own
// account (see excludeCash on crmProjectBanks.js's /for-project) — Cash and
// Card are never valid here. Post-Dated Cheque is excluded too since this is
// only ever a same-day mode preference, not a dated instrument. Optional
// everywhere it's used — never required to raise or approve a refund.
const ALLOWED_REFUND_MODES = new Set(["Cheque", "NEFT", "RTGS", "IMPS", "UPI"]);
// Like a money receipt, the payment mode decides what a payout needs: a
// transfer needs the customer's account; a cheque is written to their name
// and needs none. No mode yet = Finance chooses it on the voucher.
const TRANSFER_REFUND_MODES = new Set(["NEFT", "RTGS", "IMPS", "UPI"]);
const needsCustomerAccount = (mode) => TRANSFER_REFUND_MODES.has(String(mode || "").trim());
function validatePaymentMode(raw) {
  if (raw != null && raw !== "" && !ALLOWED_REFUND_MODES.has(raw)) {
    throw new Error(`PaymentMode must be one of: ${[...ALLOWED_REFUND_MODES].join(", ")}`);
  }
  return raw || "";
}

// Finance approve/reject: who may act is set in Approval Setup
// ("crm-refunds-finance") — its roles or named people, nothing else.
const isFinanceApprover = (role, userId) => isApproverFor("crm-refunds-finance", userId, role);

// ── helpers ────────────────────────────────────────────────────────────────
async function resolveFinYearId(pool, pDate) {
  if (!pDate) return null;
  const r = await pool.request().input("PDate", sql.Date, pDate).query(`
    SELECT TOP 1 FId FROM dbo.FinYear WHERE @PDate >= FStartDate AND @PDate <= FEndDate ORDER BY FStartDate DESC
  `);
  return r.recordset[0]?.FId ?? null;
}

// Deduction % only ever applies to a CancellationHeldCredit refund. Use the
// %  frozen on the linked CrmCancellation at approval time (Phase B stores it).
async function deductionPctForHeld(pool, heldOnAccountId) {
  const r = await pool.request().input("id", sql.Int, heldOnAccountId).query(`
    SELECT c.DeductionPercent
    FROM dbo.CrmOnAccountPayment oa
    JOIN dbo.CrmCancellation c ON c.Id = oa.HeldSourceRefId
    WHERE oa.Id = @id AND oa.HeldSourceType = 'Cancellation'
  `);
  return Number(r.recordset[0]?.DeductionPercent) || 0;
}

// A single CrmOnAccountPayment row can be claimed by a Refund AND a Rebooking
// Transfer independently — each only checked (Amount - AppliedAmount) at ITS
// OWN creation time, and AppliedAmount is only updated when ITS OWN flow
// finally disburses/applies. Between creation and disbursal (which can span
// the whole Draft -> Pending -> Approved -> FinancePending -> FinanceApproved
// chain, realistically days) the other flow sees the same "remaining" balance
// as still fully available, letting the same rupee be promised twice. This
// computes what's ALREADY spoken for by any live (non-terminal) claim on the
// source, on top of AppliedAmount, so callers can check against the true
// remaining-and-unclaimed balance instead of just Amount - AppliedAmount.
// `excludeRefundId`/`excludeTransferId` let a re-check exclude the very row
// being disbursed (it's about to consume the balance itself, not compete for it).
async function getUnclaimedRemaining(pool, onAccountId, { excludeRefundId = null, excludeTransferId = null } = {}) {
  const r = await pool.request()
    .input("id", sql.Int, onAccountId)
    .input("exRefund", sql.Int, excludeRefundId)
    .input("exTransfer", sql.Int, excludeTransferId)
    .query(`
      SELECT
        oa.Amount, oa.AppliedAmount,
        ISNULL((
          SELECT SUM(GrossAmount) FROM dbo.CrmRefund
          WHERE SourceOnAccountId = @id AND Status NOT IN ('Rejected', 'Paid')
            AND (@exRefund IS NULL OR Id <> @exRefund)
        ), 0) AS ReservedByRefunds,
        ISNULL((
          SELECT SUM(Amount) FROM dbo.CrmRebookingTransfer
          WHERE HeldOnAccountId = @id AND Status NOT IN ('Rejected', 'Applied')
            AND (@exTransfer IS NULL OR Id <> @exTransfer)
        ), 0) AS ReservedByTransfers
      FROM dbo.CrmOnAccountPayment oa WHERE oa.Id = @id
    `);
  const row = r.recordset[0];
  if (!row) return { found: false, remaining: 0, reserved: 0, unclaimed: 0 };
  const remaining = Number(row.Amount) - Number(row.AppliedAmount || 0);
  const reserved = Number(row.ReservedByRefunds || 0) + Number(row.ReservedByTransfers || 0);
  return { found: true, remaining, reserved, unclaimed: Math.round((remaining - reserved) * 100) / 100 };
}

// Once a buy-back payout is approved for processing, its source credit is
// committed to the buy-back. Do not let a new refund or transfer claim it.
async function assertNoActiveBuyBack(pool, bookingId) {
  const row = (await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT TOP 1 Id FROM dbo.CrmUnitResale
    WHERE IsActive = 1 AND Kind = 'BuyBack' AND Status IN ('Approved', 'Completed')
      AND (FromBookingId = @bid OR CHARINDEX(',' + CAST(@bid AS VARCHAR(20)) + ',', ',' + ISNULL(BookingIds, '') + ',') > 0)
  `)).recordset[0];
  if (row) throw Object.assign(new Error(`This booking's credit is committed to buy-back #${row.Id}`), { status: 409 });
}

// Claim creation and the availability read must share the source-row lock.
// Refunds and transfers otherwise can both observe the same unclaimed balance
// and reserve it concurrently.
async function reserveRebookingTransfer(pool, { heldId, amount, fromCompanyId, toBookingId, toCompanyId, actorUserId, isCrossCompany }) {
  // Read the source booking id without taking its deposit lock. Target
  // cancellation and transfer claims both lock the target booking first.
  const sourceSnapshot = (await pool.request().input("id", sql.Int, heldId)
    .query("SELECT BookingId FROM dbo.CrmOnAccountPayment WHERE Id = @id")).recordset[0];
  if (!sourceSnapshot) throw Object.assign(new Error("Held credit not found"), { status: 404 });

  const tx = pool.transaction();
  await tx.begin();
  try {
    const target = (await tx.request().input("bid", sql.Int, toBookingId).query(`
      SELECT Id, Status, IsActive FROM dbo.CrmBooking WITH (UPDLOCK, HOLDLOCK) WHERE Id = @bid
    `)).recordset[0];
    if (!target) throw Object.assign(new Error("Target booking not found"), { status: 404 });
    if (!target.IsActive || DEAD_BOOKING_STATUSES.includes(target.Status)) {
      throw Object.assign(new Error("Target booking is not active"), { status: 409 });
    }
    const openCancellation = (await tx.request().input("bid", sql.Int, toBookingId).query(`
      SELECT TOP 1 CancellationNo FROM dbo.CrmCancellation WITH (UPDLOCK, HOLDLOCK)
      WHERE BookingId = @bid AND Status NOT IN ('Rejected', 'Cancelled')
    `)).recordset[0];
    if (openCancellation) {
      throw Object.assign(new Error(`Target booking has open cancellation ${openCancellation.CancellationNo}`), { status: 409 });
    }

    const source = await tx.request().input("id", sql.Int, heldId)
      .query("SELECT Id, BookingId FROM dbo.CrmOnAccountPayment WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id");
    if (!source.recordset.length) throw Object.assign(new Error("Held credit not found"), { status: 404 });
    await assertNoActiveBuyBack(tx, source.recordset[0].BookingId);
    const { unclaimed } = await getUnclaimedRemaining(tx, heldId);
    if (amount > unclaimed + 0.01) {
      throw Object.assign(new Error(`Amount exceeds the held credit's available balance (₹${unclaimed.toLocaleString("en-IN")}) — another refund or re-booking transfer may have claimed it`), { status: 409 });
    }
    const result = await tx.request()
      .input("hid", sql.Int, heldId).input("fc", sql.Int, fromCompanyId)
      .input("tb", sql.Int, toBookingId).input("tc", sql.Int, toCompanyId)
      .input("amt", sql.Decimal(18, 2), amount).input("cb", sql.Int, actorUserId)
      .input("cross", sql.Bit, isCrossCompany ? 1 : 0)
      .query(`
        INSERT INTO dbo.CrmRebookingTransfer
          (HeldOnAccountId, FromCompanyId, ToBookingId, ToCompanyId, Amount, IsCrossCompany, Status, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@hid, @fc, @tb, @tc, @amt, @cross, CASE WHEN @cross = 1 THEN 'PendingTransfer' ELSE 'Draft' END, @cb, SYSDATETIME())
      `);
    await tx.commit();
    return result;
  } catch (e) {
    try { await tx.rollback(); } catch {}
    throw e;
  }
}

// Once a source credit is fully consumed (Applied) by one flow, any other
// still-open claim on it is now stale — auto-reject it the same way
// cancellation-approval already auto-rejects conflicting amendment requests,
// instead of leaving it sitting in the queue for someone to approve/pay by
// mistake weeks later. Best-effort: never allowed to fail the caller's own
// commit, since the source flow already succeeded.
async function rejectStaleClaimsOnSource(pool, onAccountId, { exceptRefundId = null, exceptTransferId = null, note }, userEmail) {
  try {
    await pool.request()
      .input("id", sql.Int, onAccountId).input("ex", sql.Int, exceptRefundId).input("n", sql.NVarChar(500), note)
      .query(`
        UPDATE dbo.CrmRefund SET Status = 'Rejected', RejectionNote = @n, UpdatedAt = SYSDATETIME()
        WHERE SourceOnAccountId = @id AND Status NOT IN ('Rejected', 'Paid') AND (@ex IS NULL OR Id <> @ex)
      `);
    await pool.request()
      .input("id", sql.Int, onAccountId).input("ex", sql.Int, exceptTransferId)
      .query(`
        UPDATE dbo.CrmRebookingTransfer SET Status = 'Rejected', UpdatedAt = SYSDATETIME()
        WHERE HeldOnAccountId = @id AND Status NOT IN ('Rejected', 'Applied') AND (@ex IS NULL OR Id <> @ex)
      `);
    await bumpCacheVersion("crm-refunds");
  } catch (e) {
    console.error("[crm-refunds] rejectStaleClaimsOnSource failed (non-fatal):", e.message);
  }
}

const REFUND_SELECT = `
  SELECT
    r.Id, r.RefundNo, r.CustomerId, r.CompanyId, r.ProjectId, r.BookingId,
    r.SourceType, r.SourceOnAccountId, r.SourceCancellationId,
    r.GrossAmount, r.DeductionPercent, r.DeductionAmount, r.NetAmount,
    r.Reason, r.RefundBankLHeadId, r.CustomerBankName, r.CustomerAccountNo, r.CustomerIfscCode,
    r.PreferredPaymentMode,
    r.Status, r.RefundDueDate, r.FinanceNewPaymentId,
    r.RequestedBy, r.RequestedAt, r.ApprovedBy, r.ApprovedAt,
    r.FinanceClearedBy, r.FinanceClearedAt, r.PaidAt, r.RejectionNote, r.Notes,
    r.CreatedAt, r.UpdatedAt,
    cu.CustomerName, cu.Mobile, cu.CustomerNo,
    b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo,
    COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
    cxl.CancellationNo,
    bank.LHeadName AS RefundBankName,
    rq.name AS RequestedByName, ap.name AS ApprovedByName, fc.name AS FinanceClearedByName,
    CASE WHEN r.RefundDueDate IS NOT NULL AND r.Status <> 'Paid'
              AND CAST(SYSDATETIME() AS DATE) > r.RefundDueDate
         THEN 1 ELSE 0 END AS IsOverdue,
    CASE WHEN r.RefundDueDate IS NOT NULL AND r.Status <> 'Paid'
         THEN DATEDIFF(day, CAST(SYSDATETIME() AS DATE), r.RefundDueDate) ELSE NULL END AS DaysRemaining
  FROM dbo.CrmRefund r
  JOIN dbo.CrmCustomer cu ON cu.Id = r.CustomerId
  LEFT JOIN dbo.CrmBooking b ON b.Id = r.BookingId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
  LEFT JOIN dbo.CrmCancellation cxl ON cxl.Id = r.SourceCancellationId
  LEFT JOIN dbo.AccountHeadMaster bank ON bank.LHeadId = r.RefundBankLHeadId
  LEFT JOIN dbo.Users rq ON rq.id = r.RequestedBy
  LEFT JOIN dbo.Users ap ON ap.id = r.ApprovedBy
  LEFT JOIN dbo.Users fc ON fc.id = r.FinanceClearedBy
`;

// ── GET / — list ──────────────────────────────────────────────────────────
// Self-repair: a refund still "with Finance" whose payout voucher Finance has
// already approved (paid). Marking it Paid runs when the voucher is approved,
// but that step is non-fatal there — if it failed (a database error at that
// moment) nothing re-ran it, leaving the refund stuck. markCrmRefundPaid is
// idempotent, so this simply finishes the job. Never blocks the list.
async function settlePaidRefunds(pool, userEmail) {
  try {
    let repairedGstNotes = 0;
    const stuck = (await pool.request().query(`
      SELECT r.Id, r.FinanceNewPaymentId FROM dbo.CrmRefund r
      JOIN dbo.NewPayment np ON np.PPaymentID = r.FinanceNewPaymentId
      WHERE r.Status IN ('FinanceApproved', 'FinancePending') AND np.Status = 'Approved'`)).recordset;
    for (const s of stuck) {
      try {
        const out = await markCrmRefundPaid(pool, s.Id, s.FinanceNewPaymentId, userEmail);
        console.warn(`[crm-refunds] settled refund ${s.Id} whose voucher was already paid:`, out?.reason || "ok");
      } catch (e) { console.error(`[crm-refunds] could not settle refund ${s.Id}:`, e.message); }
    }
    // Settlement is deliberately non-fatal after the payout has moved. If
    // statutory GST document issuance failed after the refund became Paid,
    // it will no longer appear in `stuck`; safely retry only refunds with no
    // GST-note history at all. issueForRefund is idempotent and locks the
    // refund/booking before issuing, while the history check preserves notes
    // that staff intentionally cancelled for a later manual reissue.
    const missingGstNotes = (await pool.request().query(`
      SELECT r.Id FROM dbo.CrmRefund r
      JOIN dbo.CrmBooking b ON b.Id = r.BookingId
      WHERE r.Status = 'Paid' AND r.NetAmount > 0 AND ISNULL(b.TotalGstAmount, 0) > 0
        AND b.GrandTotal > 0
        AND ROUND(r.NetAmount * b.TotalGstAmount / NULLIF(b.GrandTotal, 0), 2) > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmGstNote n WHERE n.RefundId = r.Id)
    `)).recordset;
    for (const row of missingGstNotes) {
      try {
        const out = await require("../services/crmGstNotes").issueForRefund(pool, row.Id, userEmail);
        repairedGstNotes += out?.issued?.length || 0;
      } catch (e) {
        console.error(`[crm-refunds] could not issue GST documents for paid refund ${row.Id}:`, e.message);
      }
    }
    if (stuck.length || repairedGstNotes) await bumpCacheVersion("crm-refunds");
  } catch (e) { console.error("[crm-refunds] settlePaidRefunds:", e.message); }
}

router.get("/", requirePageRight("crm-refunds", "view"), async (req, res) => {
  try {
    const pool = getPool();
    // Note: settlePaidRefunds should be called by scheduled cron job only, not on every read.
    const { status, search } = req.query;
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const blockId = req.query.blockId ? parseInt(req.query.blockId, 10) : null;
    // One filter definition for the rows, the count and the status counts — the count used to skip the
    // project scope, so a restricted user's page totals counted other projects' refunds.
    const buildWhere = (rq, withStatus) => {
      const conds = [];
      if (req.projectScope) conds.push(projectPredicate(req.projectScope, "COALESCE(r.ProjectId, b.ProjectId)", "").trim());
      if (withStatus && status) { rq.input("st", sql.NVarChar(20), status); conds.push("r.Status = @st"); }
      if (companyId) { rq.input("companyId", sql.Int, companyId); conds.push("r.CompanyId = @companyId"); }
      if (projectId) { rq.input("projectId", sql.Int, projectId); conds.push("r.ProjectId = @projectId"); }
      if (blockId) { rq.input("blockId", sql.Int, blockId); conds.push("b.BlockId = @blockId"); }
      if (search) {
        rq.input("search", sql.NVarChar(200), `%${search}%`);
        conds.push("(cu.CustomerName LIKE @search OR r.RefundNo LIKE @search OR b.BookingNo LIKE @search OR cxl.CancellationNo LIKE @search)");
      }
      return conds.length ? "WHERE " + conds.join(" AND ") : "";
    };
    const req0 = pool.request();
    const where = buildWhere(req0, true);
    const SELECT_WITH_BLOCK = `${REFUND_SELECT} LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId`;

    if (!req.query.page) {
      const result = await req0.query(`${SELECT_WITH_BLOCK} ${where} ORDER BY r.CreatedAt DESC`);
      return res.json(result.recordset);
    }
    const { page, pageSize, offset } = applyPagination(req);
    req0.input("offset", sql.Int, offset);
    req0.input("pageSize", sql.Int, pageSize);
    const FROM = `
      FROM dbo.CrmRefund r
      JOIN dbo.CrmCustomer cu ON cu.Id = r.CustomerId
      LEFT JOIN dbo.CrmBooking b ON b.Id = r.BookingId
      LEFT JOIN dbo.CrmCancellation cxl ON cxl.Id = r.SourceCancellationId`;
    const countReq = pool.request();
    const countWhere = buildWhere(countReq, true);
    const statusReq = pool.request();
    const statusWhere = buildWhere(statusReq, false);
    const [result, countResult, statusResult] = await Promise.all([
      req0.query(`${SELECT_WITH_BLOCK} ${where} ORDER BY r.CreatedAt DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`),
      countReq.query(`SELECT COUNT(*) AS total ${FROM} ${countWhere}`),
      statusReq.query(`SELECT r.Status, COUNT(*) AS n, SUM(r.NetAmount) AS net,
        SUM(CASE WHEN r.RefundDueDate IS NOT NULL AND r.Status <> 'Paid' AND CAST(SYSDATETIME() AS DATE) > r.RefundDueDate THEN 1 ELSE 0 END) AS overdue
        ${FROM} ${statusWhere} GROUP BY r.Status`),
    ]);
    const statusCounts = {};
    for (const s of statusResult.recordset) statusCounts[s.Status] = { count: s.n, net: Number(s.net) || 0, overdue: s.overdue };
    res.json({ rows: result.recordset, total: countResult.recordset[0].total, page, pageSize, statusCounts });
  } catch (e) {
    console.error("[crm-refunds] GET error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// Amount already spoken for by another live (non-terminal) claim on the same
// source — a Pending/FinancePending/etc. CrmRefund, or a Draft/PendingTransfer
// CrmRebookingTransfer — that hasn't touched AppliedAmount yet. Mirrors
// getUnclaimedRemaining's JS logic in SQL so this list-view figure agrees
// with what the create/apply endpoints will actually accept.
const RESERVED_SUBQUERY = `(
  ISNULL((SELECT SUM(GrossAmount) FROM dbo.CrmRefund WHERE SourceOnAccountId = oa.Id AND Status NOT IN ('Rejected', 'Paid')), 0) +
  ISNULL((SELECT SUM(Amount) FROM dbo.CrmRebookingTransfer WHERE HeldOnAccountId = oa.Id AND Status NOT IN ('Rejected', 'Applied')), 0)
)`;

// ── GET /eligible-sources — pickable money for a NEW refund ────────────────
// Held credit from cancelled bookings (deduction applies) + unapplied
// on-account / overpayment on live bookings (no deduction).
router.get("/eligible-sources", requirePageRight("crm-refunds", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const customerId = req.query.customerId ? parseInt(req.query.customerId, 10) : null;
    const req0 = pool.request();
    if (customerId) req0.input("cust", sql.Int, customerId);
    // Only the user's projects (a restricted user was offered every project's held credit).
    const custFilter = customerId ? "AND a.CustomerId = @cust" : "";
    const scope = req.projectScope ? projectPredicate(req.projectScope, "b.ProjectId") : "";
    const result = await req0.query(`
      SELECT
        'CancellationHeldCredit' AS SourceType,
        oa.Id AS OnAccountId, oa.Amount, oa.AppliedAmount,
        (oa.Amount - oa.AppliedAmount - ${RESERVED_SUBQUERY}) AS Remaining,
        oa.HeldAt AS AsOf, b.Id AS BookingId, b.BookingNo, b.CompanyId, b.ProjectId,
        a.CustomerId, cu.CustomerName, cxl.CancellationNo, c.DeductionPercent
      FROM dbo.CrmOnAccountPayment oa
      JOIN dbo.CrmBooking b ON b.Id = oa.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      JOIN dbo.CrmCustomer cu ON cu.Id = a.CustomerId
      LEFT JOIN dbo.CrmCancellation c ON c.Id = oa.HeldSourceRefId
      LEFT JOIN dbo.CrmCancellation cxl ON cxl.Id = oa.HeldSourceRefId
      WHERE oa.Status = 'Held' AND (oa.Amount - oa.AppliedAmount - ${RESERVED_SUBQUERY}) > 0.01 ${custFilter} ${scope}

      UNION ALL

      SELECT
        'OverpaymentOnAccount' AS SourceType,
        oa.Id AS OnAccountId, oa.Amount, oa.AppliedAmount,
        (oa.Amount - oa.AppliedAmount - ${RESERVED_SUBQUERY}) AS Remaining,
        oa.ReceivedDate AS AsOf, b.Id AS BookingId, b.BookingNo, b.CompanyId, b.ProjectId,
        a.CustomerId, cu.CustomerName, NULL AS CancellationNo, CAST(0 AS DECIMAL(5,2)) AS DeductionPercent
      FROM dbo.CrmOnAccountPayment oa
      JOIN dbo.CrmBooking b ON b.Id = oa.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      JOIN dbo.CrmCustomer cu ON cu.Id = a.CustomerId
      WHERE ISNULL(oa.Status,'') IN ('Unapplied','PartiallyApplied')
        AND (oa.Amount - ISNULL(oa.AppliedAmount,0) - ${RESERVED_SUBQUERY}) > 0.01
        AND b.Status NOT IN ('Cancelled','Rejected', 'Expired','Transferred') ${custFilter} ${scope}
      ORDER BY AsOf DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-refunds] GET /eligible-sources error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ── GET /:id ─────────────────────────────────────────────────────────────
// ── GST documents for money given back (services/crmGstNotes.js) ─────────────
// Register: every credit note and refund voucher, for the GST return.
router.get("/gst-notes", requirePageRight("crm-refunds", "view"), async (req, res) => {
  try {
    const gst = require("../services/crmGstNotes");
    const { applyPagination } = require("../services/crmListPagination");
    const pag = req.query.page ? applyPagination(req, 20, 200) : null;
    const result = await gst.list(getPool(), {
      from: req.query.from || null,
      to: req.query.to || null,
      type: req.query.type || null,
      status: req.query.status || null,
      search: req.query.search || null,
      companyId: req.query.companyId ? parseInt(req.query.companyId, 10) : null,
      projectId: req.query.projectId ? parseInt(req.query.projectId, 10) : null,
      blockId: req.query.blockId ? parseInt(req.query.blockId, 10) : null,
      projectScope: req.projectScope,
      page: pag?.page,
      pageSize: pag?.pageSize,
      offset: pag?.offset,
    });
    res.json(result);
  } catch (e) {
    console.error("[crm-refunds] GET /gst-notes:", e.message);
    res.status(500).json({ error: "Couldn't load the credit notes" });
  }
});
const gstFail = (res, e, where) => {
  if (e.status) return res.status(e.status).json({ error: e.message });
  console.error(`[crm-refunds] ${where}:`, e.message);
  res.status(500).json({ error: "Something went wrong with the credit note — please try again" });
};
const gstUser = (req) => ({ email: req.user?.email || req.user?.name || String(actorId(req)), role: req.user?.role, userId: req.user?.userId ?? actorId(req) });
const gstNote = (req) => req.body?.note ?? req.body?.remarks ?? req.body?.reason ?? null;
const withNote = (fn, where) => async (req, res) => {
  const id = parseId(req.params.noteId);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try { res.json(await fn(require("../services/crmGstNotes"), getPool(), id, req)); } catch (e) { gstFail(res, e, where); }
};
// Invoices that can still take a credit note (not void, value left, before the deadline).
router.get("/gst-notes/creditable-invoices", requirePageRight("crm-refunds", "view"), async (req, res) => {
  try { res.json(await require("../services/crmGstNotes").creditableInvoices(getPool(), { search: req.query.search || "", projectScope: req.projectScope })); }
  catch (e) { gstFail(res, e, "GET creditable invoices"); }
});
router.post("/gst-notes", requirePageRight("crm-refunds", "create"), async (req, res) => {
  try {
    const gst = require("../services/crmGstNotes");
    const inv = await gst.invoiceCreditable(getPool(), parseInt(req.body?.InvoiceId, 10));
    if (req.projectScope && !req.projectScope.map(Number).includes(Number(inv.ProjectId))) return res.status(403).json({ error: "You don't have access to this project" });
    res.status(201).json(await gst.createAdjustment(getPool(), req.body || {}, gstUser(req)));
  } catch (e) { gstFail(res, e, "POST credit note"); }
});
// Paid refunds that carried GST but have no live credit note yet.
router.get("/gst-notes/pending", requirePageRight("crm-refunds", "view"), async (req, res) => {
  try { res.json(await require("../services/crmGstNotes").pending(getPool(), { projectScope: req.projectScope })); }
  catch (e) { gstFail(res, e, "GET /gst-notes/pending"); }
});
router.get("/gst-notes/:noteId", requirePageRight("crm-refunds", "view"), async (req, res) => {
  const id = parseId(req.params.noteId);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const gst = require("../services/crmGstNotes");
    const n = await gst.load(getPool(), id);
    if (!n) return res.status(404).json({ error: "Credit note not found" });
    const { CompanyLogo, ...rest } = n;
    // The other documents of the same refund (a split into voucher + credit notes).
    // A note with no refund (an invoice adjustment) has none - without the
    // refund filter this listed every note in the system.
    const siblings = (n.RefundId == null ? [] : await gst.list(getPool(), { refundId: n.RefundId })).filter((x) => x.Id !== id)
      .map((x) => ({ Id: x.Id, DocNo: x.DocNo, DocType: x.DocType, Status: x.Status, TotalAmount: x.TotalAmount, AgainstRef: x.AgainstRef }));
    res.json({ ...rest, siblings });
  } catch (e) { gstFail(res, e, "GET /gst-notes/:noteId"); }
});
// Cancelling: a request a second person approves (workflow crm-credit-note-cancel).
router.put("/gst-notes/:noteId/cancel", requirePageRight("crm-refunds", "edit"),
  withNote((g, db, id, req) => g.requestCancel(db, id, req.body?.reason, gstUser(req)), "request cancel"));
router.put("/gst-notes/cancel-requests/:noteId/approve", requirePageRight("crm-refunds", "edit"),
  withNote((g, db, id, req) => g.decideCancel(db, id, true, gstNote(req), gstUser(req)), "approve cancel"));
router.put("/gst-notes/cancel-requests/:noteId/reject", requirePageRight("crm-refunds", "edit"),
  withNote((g, db, id, req) => g.decideCancel(db, id, false, gstNote(req), gstUser(req)), "reject cancel"));
// Credit note without a refund: an invoice reduced (workflow crm-credit-notes).
router.put("/gst-notes/:noteId", requirePageRight("crm-refunds", "edit"),
  withNote((g, db, id, req) => g.updateAdjustment(db, id, req.body || {}, gstUser(req)), "update credit note"));
router.put("/gst-notes/:noteId/submit", requirePageRight("crm-refunds", "edit"),
  withNote((g, db, id, req) => g.submitAdjustment(db, id, gstUser(req)), "submit credit note"));
router.put("/gst-notes/:noteId/approve", requirePageRight("crm-refunds", "edit"),
  withNote((g, db, id, req) => g.decideAdjustment(db, id, true, gstNote(req), gstUser(req)), "approve credit note"));
router.put("/gst-notes/:noteId/reject", requirePageRight("crm-refunds", "edit"),
  withNote((g, db, id, req) => g.decideAdjustment(db, id, false, gstNote(req), gstUser(req)), "reject credit note"));
router.get("/gst-notes/:noteId/pdf", requirePageRight("crm-refunds", "view"), async (req, res) => {
  const id = parseId(req.params.noteId);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const gst = require("../services/crmGstNotes");
    const n = await gst.load(getPool(), id);
    if (!n) return res.status(404).json({ error: "Document not found" });
    const buf = await gst.renderPdf(n);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${n.DocNo || `GST-certificate-${n.RefundNo}`}.pdf"`);
    res.send(buf);
  } catch (e) {
    console.error("[crm-refunds] GET gst-note pdf:", e.message);
    res.status(500).json({ error: "Couldn't make the PDF" });
  }
});
router.get("/:id/gst-notes", requirePageRight("crm-refunds", "view"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try { res.json(await require("../services/crmGstNotes").list(getPool(), { refundId: id })); }
  catch (e) { console.error("[crm-refunds] GET /:id/gst-notes:", e.message); res.status(500).json({ error: "Couldn't load the credit notes" }); }
});
// A refund paid before these documents existed: Finance issues its set on request.
router.post("/:id/gst-notes", requirePageRight("crm-refunds", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const gst = require("../services/crmGstNotes");
    const out = await gst.issueForRefund(getPool(), id, req.user?.email || null);
    if (out.none && out.none !== "already issued") return res.status(409).json({ error: `No credit note needed: ${out.none}` });
    res.json(await gst.list(getPool(), { refundId: id }));
  } catch (e) {
    console.error("[crm-refunds] POST /:id/gst-notes:", e.message);
    res.status(500).json({ error: "Couldn't issue the credit note" });
  }
});

// A fresh credit note for a refund whose documents were all cancelled.
router.post("/:id/gst-notes/reissue", requirePageRight("crm-refunds", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const gst = require("../services/crmGstNotes");
    await gst.reissue(getPool(), id, req.user?.email || null);
    res.json(await gst.list(getPool(), { refundId: id, includeCancelled: false }));
  } catch (e) { gstFail(res, e, "POST reissue credit note"); }
});

router.get("/:id", requirePageRight("crm-refunds", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await pool.request().input("id", sql.Int, id).query(`${REFUND_SELECT} WHERE r.Id = @id`);
    if (!r.recordset.length) return res.status(404).json({ error: "Refund not found" });
    res.json(r.recordset[0]);
  } catch (e) {
    console.error("[crm-refunds] GET /:id error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ── POST / — raise a refund against a source ─────────────────────────────
router.post("/", requirePageRight("crm-refunds", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body || {};

    // Basic field type validation — GrossAmount must be a positive number
    const { z } = require("zod");
    const refundBodySchema = z.object({
      GrossAmount: z.coerce.number().positive({ message: "GrossAmount must be a positive number" }),
      SourceType: z.string().min(1, "SourceType is required"),
      BookingId: z.coerce.number().int().positive({ message: "BookingId must be a positive integer" }).optional().nullable(),
      TdsAmount: z.coerce.number().min(0).optional().nullable(),
    });
    const parsed = refundBodySchema.safeParse(b);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid request body" });
    }

    const sourceType = b.SourceType;
    // Every refund pays back money we hold: a cancelled booking's held credit
    // or an overpayment. A 'Manual' refund (any customer, any amount, nothing
    // behind it) is not allowed — business decision 2026-10-14; no screen
    // raised one. Older Manual rows, if any, still display and run as before.
    if (sourceType === "Manual") {
      return res.status(400).json({ error: "A refund must come from a held credit (a cancelled booking) or an overpayment — choose it under Source of funds" });
    }
    if (!["CancellationHeldCredit", "OverpaymentOnAccount"].includes(sourceType)) {
      return res.status(400).json({ error: "SourceType must be CancellationHeldCredit or OverpaymentOnAccount" });
    }
    const gross = Number(b.GrossAmount);
    if (!Number.isFinite(gross) || gross <= 0) return res.status(400).json({ error: "GrossAmount must be a positive number" });

    let preferredMode;
    try { preferredMode = validatePaymentMode(b.PreferredPaymentMode); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    let customerId = null, companyId = null, projectId = null, bookingId = null;
    let sourceOnAccountId = null, sourceCancellationId = null;
    let deductionPct = 0;
    let dueDate = null;

    {
      sourceOnAccountId = b.SourceOnAccountId !== undefined && b.SourceOnAccountId !== null && b.SourceOnAccountId !== "" ? parseInt(b.SourceOnAccountId, 10) : null;
      if (sourceOnAccountId == null) return res.status(400).json({ error: "SourceOnAccountId is required for this source" });
      const oaRow = await pool.request().input("id", sql.Int, sourceOnAccountId).query(`
        SELECT oa.Id, oa.Amount, oa.AppliedAmount, oa.Status, oa.BookingId, oa.HeldSourceRefId,
               b.CompanyId, b.ProjectId, a.CustomerId
        FROM dbo.CrmOnAccountPayment oa
        JOIN dbo.CrmBooking b ON b.Id = oa.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE oa.Id = @id
      `);
      const oa = oaRow.recordset[0];
      if (!oa) return res.status(404).json({ error: "Source on-account row not found" });

      const allowed = await assertBookingProjectScope(req, res, oa.BookingId);
      if (allowed === false) return;
      const { unclaimed } = await getUnclaimedRemaining(pool, sourceOnAccountId);
      if (gross > unclaimed + 0.01) {
        return res.status(400).json({ error: `Amount exceeds the source's available balance (₹${unclaimed.toLocaleString("en-IN")}) — some of it may already be claimed by another pending refund or re-booking transfer` });
      }
      if (!projectAllowed(req.projectScope, oa.ProjectId)) return res.status(403).json({ error: "You don't have access to this project" });
      customerId = oa.CustomerId; companyId = oa.CompanyId; projectId = oa.ProjectId; bookingId = oa.BookingId;

      if (sourceType === "CancellationHeldCredit") {
        if (oa.Status !== "Held") return res.status(400).json({ error: "That on-account row is not a held cancellation credit" });
        sourceCancellationId = oa.HeldSourceRefId != null ? oa.HeldSourceRefId : null;
        deductionPct = await deductionPctForHeld(pool, sourceOnAccountId);
        dueDate = new Date(Date.now() + 45 * 86400000);
      } else {
        if (!["Unapplied", "PartiallyApplied"].includes(oa.Status || "")) {
          return res.status(400).json({ error: "That on-account row is not an unapplied/overpayment credit" });
        }
      }
    }
    if (customerId == null) return res.status(400).json({ error: "Could not resolve the customer for this refund" });

    const deductionAmt = Math.round(gross * deductionPct / 100 * 100) / 100;
    const netAmount = Math.max(0, Math.round((gross - deductionAmt) * 100) / 100);

    // Customer bank: explicit override wins, else pre-fill from CrmCustomerBankDetail.
    let cbName = b.CustomerBankName || null, cbAcc = b.CustomerAccountNo || null, cbIfsc = b.CustomerIfscCode || null;
    if (!cbName && !cbAcc) {
      const bd = await pool.request().input("cid", sql.Int, customerId).input("bid", sql.Int, bookingId || 0).query(`
        SELECT TOP 1 d.BankName, d.AccountNo, d.IfscCode
        FROM dbo.CrmCustomerBankDetail d
        JOIN dbo.CrmBooking bk ON bk.Id = d.BookingId
        JOIN dbo.CrmApplication a ON a.Id = bk.ApplicationId
        WHERE a.CustomerId = @cid
        ORDER BY CASE WHEN d.BookingId = @bid THEN 0 ELSE 1 END, d.Id DESC
      `);
      cbName = bd.recordset[0]?.BankName || null;
      cbAcc = bd.recordset[0]?.AccountNo || null;
      cbIfsc = bd.recordset[0]?.IfscCode || null;
    }

    const refundNo = await getNextDocNumber(pool, "CRFD", "CRFD");
    // Serialize the final availability check and claim insert on the source
    // deposit. The earlier check above gives a fast user-facing error, but
    // two concurrent refund/transfer requests could both pass it before
    // either one inserted its reservation.
    const reserveTx = pool.transaction();
    await reserveTx.begin();
    let ins;
    try {
      const lockedSource = await reserveTx.request().input("id", sql.Int, sourceOnAccountId)
        .query("SELECT Id, BookingId FROM dbo.CrmOnAccountPayment WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id");
      if (!lockedSource.recordset.length) throw Object.assign(new Error("Source on-account row not found"), { status: 404 });
      await assertNoActiveBuyBack(reserveTx, lockedSource.recordset[0].BookingId);
      const { unclaimed: liveUnclaimed } = await getUnclaimedRemaining(reserveTx, sourceOnAccountId);
      if (gross > liveUnclaimed + 0.01) {
        throw Object.assign(new Error(`Amount exceeds the source's available balance (₹${liveUnclaimed.toLocaleString("en-IN")}) — another refund or re-booking transfer may have claimed it`), { status: 409 });
      }
      ins = await reserveTx.request()
      .input("rno", sql.NVarChar(30), refundNo)
      .input("cust", sql.Int, customerId)
      .input("comp", sql.Int, companyId ?? null)
      .input("proj", sql.Int, projectId ?? null)
      .input("bid", sql.Int, bookingId ?? null)
      .input("stype", sql.NVarChar(30), sourceType)
      .input("soa", sql.Int, sourceOnAccountId)
      .input("scxl", sql.Int, sourceCancellationId)
      .input("gross", sql.Decimal(18, 2), gross)
      .input("pct", sql.Decimal(5, 2), deductionPct)
      .input("damt", sql.Decimal(18, 2), deductionAmt)
      .input("net", sql.Decimal(18, 2), netAmount)
      .input("reason", sql.NVarChar(sql.MAX), b.Reason || null)
      .input("bank", sql.Int, b.RefundBankLHeadId !== undefined && b.RefundBankLHeadId !== null && b.RefundBankLHeadId !== "" ? parseInt(b.RefundBankLHeadId, 10) : null)
      .input("cbn", sql.NVarChar(200), cbName)
      .input("cba", sql.NVarChar(50), cbAcc)
      .input("cbi", sql.NVarChar(20), cbIfsc)
      .input("due", sql.Date, dueDate)
      .input("pmode", sql.VarChar(50), preferredMode)
      .input("rb", sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmRefund
          (RefundNo, CustomerId, CompanyId, ProjectId, BookingId, SourceType,
           SourceOnAccountId, SourceCancellationId, GrossAmount, DeductionPercent,
           DeductionAmount, NetAmount, Reason, RefundBankLHeadId,
           CustomerBankName, CustomerAccountNo, CustomerIfscCode, PreferredPaymentMode,
           Status, RefundDueDate, RequestedBy, RequestedAt, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@rno, @cust, @comp, @proj, @bid, @stype,
           @soa, @scxl, @gross, @pct,
           @damt, @net, @reason, @bank,
           @cbn, @cba, @cbi, NULLIF(@pmode, ''),
           'Pending', @due, @rb, SYSDATETIME(), @rb, SYSDATETIME())
      `);
      await reserveTx.commit();
    } catch (reserveError) {
      try { await reserveTx.rollback(); } catch {}
      if (reserveError.status) return res.status(reserveError.status).json({ error: reserveError.message });
      throw reserveError;
    }
    await bumpCacheVersion("crm-refunds");
    res.status(201).json({ success: true, id: ins.recordset[0].Id, RefundNo: refundNo, NetAmount: netAmount, DeductionAmount: deductionAmt });
  } catch (e) {
    console.error("[crm-refunds] POST error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ── PUT /:id — edit (Draft/Pending only) ─────────────────────────────────
router.put("/:id", requirePageRight("crm-refunds", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const b = req.body || {};
    const cur = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmRefund WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Refund not found" });
    if (!["Draft", "Pending"].includes(cur.recordset[0].Status)) {
      return res.status(400).json({ error: `Cannot edit — refund is already ${cur.recordset[0].Status}` });
    }
    const updated = await pool.request()
      .input("id", sql.Int, id)
      .input("reason", sql.NVarChar(sql.MAX), b.Reason ?? null)
      .input("bank", sql.Int, b.RefundBankLHeadId !== undefined && b.RefundBankLHeadId !== null && b.RefundBankLHeadId !== "" ? parseInt(b.RefundBankLHeadId, 10) : null)
      .input("cbn", sql.NVarChar(200), b.CustomerBankName ?? null)
      .input("cba", sql.NVarChar(50), b.CustomerAccountNo ?? null)
      .input("cbi", sql.NVarChar(20), b.CustomerIfscCode ?? null)
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmRefund SET
          Reason = @reason,
          RefundBankLHeadId = ISNULL(@bank, RefundBankLHeadId),
          CustomerBankName  = ISNULL(@cbn, CustomerBankName),
          CustomerAccountNo = ISNULL(@cba, CustomerAccountNo),
          CustomerIfscCode  = ISNULL(@cbi, CustomerIfscCode),
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id AND Status IN ('Draft', 'Pending')
      `);
    if (updated.rowsAffected[0] !== 1) {
      return res.status(409).json({ error: "This refund changed status while you were editing it; reload before making further changes" });
    }
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-refunds] PUT error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ── PUT /:id/submit — Draft -> Pending ──────────────────────────────────
router.put("/:id/submit", requirePageRight("crm-refunds", "edit"), async (req, res) => {
  let tx;
  try {
    const pool = getPool();
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    tx = pool.transaction();
    await tx.begin();
    // Read the source ID first, then use the same source-row-first lock order
    // as new claims and adjustments to avoid over-reserving on resubmission.
    const snapshot = (await tx.request().input("id", sql.Int, id)
      .query("SELECT r.SourceOnAccountId, r.BookingId FROM dbo.CrmRefund r WHERE r.Id = @id")).recordset[0];
    if (!snapshot) { await tx.rollback(); return res.status(404).json({ error: "Refund not found" }); }
    if (snapshot.SourceOnAccountId) {
      const source = await tx.request().input("sid", sql.Int, snapshot.SourceOnAccountId)
        .query("SELECT Id, BookingId FROM dbo.CrmOnAccountPayment WITH (UPDLOCK, HOLDLOCK) WHERE Id = @sid");
      if (!source.recordset.length) { await tx.rollback(); return res.status(409).json({ error: "The source credit no longer exists" }); }
      await assertNoActiveBuyBack(tx, source.recordset[0].BookingId);
    }
    const cur = (await tx.request().input("id", sql.Int, id).query(`
      SELECT Status, SourceOnAccountId, GrossAmount
      FROM dbo.CrmRefund WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id
    `)).recordset[0];
    if (!cur) { await tx.rollback(); return res.status(404).json({ error: "Refund not found" }); }
    if (!["Draft", "Rejected"].includes(cur.Status)) {
      await tx.rollback();
      return res.status(400).json({ error: `Cannot submit — refund is ${cur.Status}` });
    }
    if (cur.SourceOnAccountId) {
      const { found, unclaimed } = await getUnclaimedRemaining(tx, cur.SourceOnAccountId, { excludeRefundId: id });
      if (!found || Number(cur.GrossAmount) > unclaimed + 0.01) {
        await tx.rollback();
        return res.status(409).json({ error: `Cannot resubmit — the source credit has only ₹${unclaimed.toLocaleString("en-IN")} available` });
      }
    }
    const upd = await tx.request().input("id", sql.Int, id)
      .query("UPDATE dbo.CrmRefund SET Status = 'Pending', RejectionNote = NULL, UpdatedAt = SYSDATETIME() WHERE Id = @id AND Status IN ('Draft', 'Rejected')");
    if (upd.rowsAffected[0] !== 1) throw new Error("Refund status changed while submitting");
    await tx.commit();
    await bumpCacheVersion("crm-refunds");
    res.json({ success: true, status: "Pending" });
  } catch (e) {
    try { if (tx) await tx.rollback(); } catch {}
    console.error("[crm-refunds] submit error:", e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : "An internal error occurred. Please try again later." });
  }
});

// ── PUT /:id/approve — CRM checker (admin/marketing_head) -> FinancePending ──
router.put("/:id/approve", requirePageRight("crm-refunds", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const pool = getPool();
    // One Finance step: approving here raises the payout voucher straight into
    // Finance -> Payments, where Finance approves it once. So everything the
    // voucher needs is checked BEFORE the approval is recorded.
    const pre = (await pool.request().input("id", sql.Int, id).query(`
      SELECT r.Status, r.RefundBankLHeadId, r.CustomerBankName, r.CustomerAccountNo, r.NetAmount, r.ProjectId, r.PreferredPaymentMode,
             (SELECT COUNT(*) FROM dbo.CrmProjectBank pb WHERE pb.ProjectId = r.ProjectId) AS ProjectBanks,
             (SELECT MIN(pb.BankLHeadId) FROM dbo.CrmProjectBank pb WHERE pb.ProjectId = r.ProjectId) AS OnlyProjectBank
      FROM dbo.CrmRefund r WHERE r.Id = @id`)).recordset[0];
    if (!pre) return res.status(404).json({ error: "Refund not found" });
    const bankId = pre.RefundBankLHeadId ?? (pre.ProjectBanks === 1 ? pre.OnlyProjectBank : null);
    if (pre.Status === "Pending") {
      // The company bank is Finance's call, as for every payout (brokerage
      // etc.): when neither the refund nor the project names one, Finance
      // picks it on the voucher in Payments before approving it there.
      if (needsCustomerAccount(pre.PreferredPaymentMode) && !pre.CustomerAccountNo) return res.status(400).json({ error: `A ${pre.PreferredPaymentMode} refund needs the customer's bank account — add it to the refund, or choose Cheque.` });
      if (!(Number(pre.NetAmount) > 0)) return res.status(400).json({ error: "The refund's net amount must be more than zero." });
    }
    const result = await approvalTransition("crm-refunds", id, "Approved", userEmail, req.user?.role, null, req.user?.userId ?? null);
    if (result.newStatus !== "Approved") {
      return res.json({ success: true, status: result.newStatus });
    }
    const tx = pool.transaction();
    await tx.begin();
    try {
      const rf = (await tx.request().input("id", sql.Int, id).query(`
        SELECT Id, RefundNo, Status, CustomerId, CompanyId, ProjectId, NetAmount, GrossAmount,
               SourceOnAccountId, RefundBankLHeadId, CustomerBankName, CustomerAccountNo, FinanceNewPaymentId, PreferredPaymentMode
        FROM dbo.CrmRefund WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id`)).recordset[0];
      // Already with Finance: leave it exactly as it is (never downgrade it to
      // "voucher not raised" through the catch below).
      if (rf.FinanceNewPaymentId) {
        await tx.rollback();
        return res.status(409).json({ error: "This refund's payout voucher is already with Finance in Payments" });
      }
      const raised = await raisePayoutVoucher(tx, rf, { bankId, actorEmail: req.user?.email || req.user?.name || String(actorId(req)) });
      await tx.request().input("id", sql.Int, id).input("ab", sql.Int, actorId(req)).input("np", sql.Int, raised.newPaymentId).input("bank", sql.Int, raised.bankId)
        .query(`
          UPDATE dbo.CrmRefund SET
            Status = 'FinanceApproved', ApprovedBy = @ab, ApprovedAt = SYSDATETIME(),
            FinanceNewPaymentId = @np, RefundBankLHeadId = COALESCE(@bank, RefundBankLHeadId), UpdatedAt = SYSDATETIME()
          WHERE Id = @id`);
      await tx.commit();
      await Promise.all([bumpCacheVersion("crm-refunds"), bumpCacheVersion("new-payment")]);
      return res.json({ success: true, status: "FinanceApproved", newPaymentId: raised.newPaymentId, docNo: raised.finalDocNo,
        message: `Approved — payout voucher ${raised.finalDocNo} is with Finance in Payments` });
    } catch (e) {
      try { await tx.rollback(); } catch { /* rolled back */ }
      // Approved, but the voucher couldn't be raised: kept for Finance with the reason.
      const recovered = await pool.request().input("id", sql.Int, id).input("ab", sql.Int, actorId(req)).input("n", sql.NVarChar(500), `[Payout] ${e.message}`.slice(0, 500))
        .query(`UPDATE dbo.CrmRefund
          SET Status = 'FinancePending', ApprovedBy = @ab, ApprovedAt = SYSDATETIME(), RejectionNote = @n, UpdatedAt = SYSDATETIME()
          WHERE Id = @id AND Status = 'Approved' AND FinanceNewPaymentId IS NULL`);
      await bumpCacheVersion("crm-refunds");
      if (recovered.rowsAffected[0] === 1) {
        return res.status(202).json({ success: true, status: "FinancePending", partialFailure: true, warning: `Approved, but the payout voucher couldn't be raised: ${e.message}` });
      }
      const latest = (await pool.request().input("id", sql.Int, id).query(`
        SELECT Status, FinanceNewPaymentId FROM dbo.CrmRefund WHERE Id = @id
      `)).recordset[0];
      return res.status(latest?.FinanceNewPaymentId != null ? 202 : 409).json({
        success: false,
        partialFailure: true,
        status: latest?.Status || "Unknown",
        newPaymentId: latest?.FinanceNewPaymentId ?? null,
        warning: latest?.FinanceNewPaymentId != null
          ? "This refund changed while recovery was running and now has a payout voucher. Reload before taking further action."
          : `This refund changed while recovery was running; it remains ${latest?.Status || "unavailable"}. Reload before taking further action.`,
      });
    }
  } catch (e) {
    console.error("[crm-refunds] approve error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// ── PUT /:id/reject ────────────────────────────────────────────────────
router.put("/:id/reject", requirePageRight("crm-refunds", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const pool = getPool();
    const result = await approvalTransition("crm-refunds", id, "Rejected", userEmail, req.user?.role, req.body?.note || null);
    await pool.request().input("id", sql.Int, id).input("n", sql.NVarChar(500), req.body?.note || "Rejected")
      .query("UPDATE dbo.CrmRefund SET RejectionNote = @n, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    await bumpCacheVersion("crm-refunds");
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-refunds] reject error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// Raises the refund's payout voucher (a Pending NewPayment) in Finance ->
// Payments. Finance approves it there, once — that is the refund's only
// Finance step. Runs on the caller's transaction with the refund row already
// locked (rf). Throws RefundPayoutError with a user-facing message.
class RefundPayoutError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
async function raisePayoutVoucher(tx, rf, opts) {
    // Last checkpoint before real money leaves — the source credit's CURRENT
    // balance, not the snapshot taken when the refund was raised: a re-booking
    // transfer or another refund may have used the same held credit since.
    if (rf.SourceOnAccountId) {
      // Claim writers use this row lock before reserving credit. Without it,
      // a transfer could commit after this availability read but before the
      // payout voucher transaction commits.
      const source = await tx.request().input("sid", sql.Int, rf.SourceOnAccountId).query(`
        SELECT Id FROM dbo.CrmOnAccountPayment WITH (UPDLOCK, HOLDLOCK) WHERE Id = @sid
      `);
      if (!source.recordset.length) throw new RefundPayoutError("The source credit for this refund no longer exists", 409);
      const { found, unclaimed } = await getUnclaimedRemaining(tx, rf.SourceOnAccountId, { excludeRefundId: rf.Id });
      if (!found) throw new RefundPayoutError("The source credit for this refund no longer exists", 409);
      if (Number(rf.GrossAmount) > unclaimed + 0.01) {
        throw new RefundPayoutError(`Cannot disburse — the source credit's available balance (₹${unclaimed.toLocaleString("en-IN")}) is now less than this refund's amount (₹${Number(rf.GrossAmount).toLocaleString("en-IN")}). It was likely used by a re-booking transfer or another refund in the meantime.`, 409);
      }
    }
    const bankId = opts.bankId != null ? opts.bankId : rf.RefundBankLHeadId;
    const net = Number(rf.NetAmount) || 0;
    if (net <= 0) { throw new RefundPayoutError("Net refund amount must be greater than 0", 400); }

    // Payment Mode is optional here, not mandatory — Finance can set it now
    // to skip the follow-up edit on the spawned voucher, or leave it for
    // later via Payment.tsx's own Update form. Defaults to whatever was
    // noted as a preference when the refund was raised, if anything.
    let paymentMode;
    try { paymentMode = validatePaymentMode(opts.paymentMode ?? rf.PreferredPaymentMode); }
    catch (e) { throw new RefundPayoutError(e.message, 400); }
    if (needsCustomerAccount(paymentMode) && !rf.CustomerAccountNo) {
      throw new RefundPayoutError(`A ${paymentMode} refund needs the customer's bank account — add it to the refund, or choose Cheque`, 400);
    }

    // Bank name is known the moment bankId is — resolving and storing it
    // now (instead of leaving PBankName blank for Finance to fill in later)
    // is what the whole Payment.tsx NOT-NULL crash chain traced back to.
    const bankName = bankId == null ? "" : ((await tx.request().input("bid", sql.Int, bankId)
      .query("SELECT LHeadName FROM dbo.AccountHeadMaster WHERE LHeadId = @bid")).recordset[0]?.LHeadName || "");

    const actorEmail = opts.actorEmail;
    const customerHeadId = await ensureCrmCustomerLedgerHead(tx, rf.CustomerId, actorEmail);
    const docTypeId = await resolveDocTypeId(tx, sql, "PAY");
    const finalDocNo = await lockNextDocNumber(tx, sql, {
      docTypeId, tableName: "NewPayment", docNoColumn: "DocNo", issuedBy: actorEmail,
    });
    const parts = (finalDocNo || "").split("-");
    const docYear = parseInt(parts[parts.length - 2], 10) || null;
    const docSerial = parseInt(parts[parts.length - 1], 10) || null;
    const today = new Date().toISOString().slice(0, 10);
    const finYearId = await resolveFinYearId(tx, today);

    const npIns = await tx.request()
      .input("name", sql.VarChar, "CRM Refund")
      .input("remarks", sql.NVarChar(1000), `${rf.RefundNo} — customer refund ₹${net.toLocaleString("en-IN")} to ${rf.CustomerBankName || "customer bank"} ${rf.CustomerAccountNo || ""}${paymentMode && bankId != null ? "" : " — finance to complete payment details"}`)
      .input("mode", sql.VarChar(50), paymentMode)
      .input("bankName", sql.VarChar(200), bankName)
      .input("amt", sql.Decimal(18, 2), net)
      .input("dt", sql.Date, today)
      .input("project", sql.VarChar, rf.ProjectId != null ? String(rf.ProjectId) : "")
      .input("company", sql.VarChar, rf.CompanyId != null ? String(rf.CompanyId) : "")
      .input("partyId", sql.Int, customerHeadId)
      .input("bankId", sql.Int, bankId)
      .input("docNo", sql.NVarChar(100), finalDocNo)
      .input("docTypeId", sql.Int, docTypeId)
      .input("docYear", sql.SmallInt, docYear)
      .input("docSerial", sql.Int, docSerial)
      .input("finYearId", sql.Int, finYearId)
      .input("srcRefund", sql.Int, rf.Id)
      .input("createdBy", sql.NVarChar(100), actorEmail)
      .query(`
        INSERT INTO dbo.NewPayment (
          PPaymentName, PRemarks, PMode, PBankName, PBankID, PAmount, PDocType, PDate,
          PProject, PCompany, PPartyId,
          DocNo, DocTypeId, DocYear, DocSerial, PFinYearId,
          SourceCrmRefundId,
          PCreatedAt, PCreatedBy, PApprovedBy, Status
        )
        OUTPUT INSERTED.PPaymentID
        VALUES (
          @name, @remarks, @mode, @bankName, @bankId, @amt, 'CRM Refund', @dt,
          @project, @company, @partyId,
          @docNo, @docTypeId, @docYear, @docSerial, @finYearId,
          @srcRefund,
          SYSDATETIME(), @createdBy, NULL, 'Pending'
        )
      `);
    const newPaymentId = npIns.recordset[0].PPaymentID;
    await backPatchRecordId(tx, sql, finalDocNo, "NewPayment", newPaymentId);
  return { newPaymentId, finalDocNo, bankId };
}
// ── PUT /:id/finance-approve — finance tier: spawn the payout NewPayment ──
// Also answers /:id/finance/approve — the generic actionPathSuffix shape the
// Approval Inbox's ApprovalActions component builds (see SUB_GATE_SUFFIX in
// ApprovalInbox.tsx, same convention as crm-agreement-date/crm-sales-deed-
// director). Purely additive: the original hyphenated path keeps working
// unchanged for CrmRefunds.tsx's own inline "Finance Approve" button.
router.put(["/:id/finance-approve", "/:id/finance/approve"], requirePageRight("crm-refunds", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const role = (req.user?.role || "").toLowerCase();
    const viewerUserId = req.user?.userId ?? req.user?.id ?? null;
    if (!(await isFinanceApprover(role, viewerUserId))) {
      return res.status(403).json({ error: "Only accounts/finance heads or admins can finance-approve a refund" });
    }
    // Locked for the life of this request — two concurrent finance-approve
    // calls (double-click, or two Finance users racing) must not both pass
    // this check and each mint their own NewPayment voucher for the same
    // refund. Everything through the closing UPDATE below runs inside this
    // one transaction so the row stays locked until either a voucher is
    // committed or the whole attempt rolls back.
    const tx = pool.transaction();
    await tx.begin();
    let committed = false;
    try {
    const cur = await tx.request().input("id", sql.Int, id).query(`
      SELECT Id, RefundNo, Status, CustomerId, CompanyId, ProjectId, NetAmount, GrossAmount,
             SourceOnAccountId, RefundBankLHeadId, CustomerBankName, CustomerAccountNo, FinanceNewPaymentId,
             PreferredPaymentMode
      FROM dbo.CrmRefund WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id
    `);
    if (!cur.recordset.length) { await tx.rollback(); return res.status(404).json({ error: "Refund not found" }); }
    const rf = cur.recordset[0];
    // "Approved" with no voucher = approval recorded, then the server stopped
    // before the voucher step; Finance raises it here instead of it sticking.
    if (rf.Status !== "FinancePending" && !(rf.Status === "Approved" && !rf.FinanceNewPaymentId)) {
      await tx.rollback();
      return res.status(400).json({ error: `Cannot finance-approve — status must be FinancePending (currently '${rf.Status}')` });
    }
    if (rf.FinanceNewPaymentId) {
      await tx.rollback();
      return res.status(409).json({ error: "A payout voucher already exists for this refund" });
    }
    // Last checkpoint before real money leaves — re-validate against the
    // source's CURRENT balance, not the snapshot taken when this refund was
    // first created. A Rebooking Transfer (or another refund) may have
    // consumed the same held credit in the days since. See
    // getUnclaimedRemaining for why AppliedAmount alone isn't enough.
    const raised = await raisePayoutVoucher(tx, rf, { bankId: req.body?.RefundBankLHeadId !== undefined && req.body?.RefundBankLHeadId !== null && req.body?.RefundBankLHeadId !== "" ? parseInt(req.body.RefundBankLHeadId, 10) : null, paymentMode: req.body?.PaymentMode, actorEmail: req.user?.email || req.user?.name || String(actorId(req)) });
    const { newPaymentId, finalDocNo, bankId } = raised;

    // Guard the write itself, not just the read above — under the row lock
    // this can't actually fail, but keeping the WHERE clause honest (rather
    // than an unconditional UPDATE) means a future refactor that loosens the
    // locking can't silently reintroduce the double-voucher race.
    const upd = await tx.request()
      .input("id", sql.Int, id).input("np", sql.Int, newPaymentId)
      .input("bank", sql.Int, bankId).input("fc", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmRefund SET
          Status = 'FinanceApproved', FinanceNewPaymentId = @np, RefundBankLHeadId = @bank,
          FinanceClearedBy = @fc, FinanceClearedAt = SYSDATETIME(), UpdatedAt = SYSDATETIME()
        WHERE Id = @id AND Status = 'FinancePending' AND FinanceNewPaymentId IS NULL
      `);
    if (upd.rowsAffected[0] !== 1) {
      throw new Error("Refund status changed under us — another approval was already in progress");
    }
    await tx.commit();
    committed = true;
    await Promise.all([bumpCacheVersion("crm-refunds"), bumpCacheVersion("new-payment")]);
    res.json({ success: true, status: "FinanceApproved", newPaymentId, docNo: finalDocNo });
    } catch (e) {
      try { if (!committed) await tx.rollback(); } catch {}
      throw e;
    }
  } catch (e) {
    if (e instanceof RefundPayoutError) return res.status(e.status).json({ error: e.message });
    console.error("[crm-refunds] finance-approve error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ── PUT /:id/finance-reject — FinancePending -> Pending ─────────────────
// Also answers /:id/finance/reject — see the matching comment on
// /:id/finance-approve above.
router.put(["/:id/finance-reject", "/:id/finance/reject"], requirePageRight("crm-refunds", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const role = (req.user?.role || "").toLowerCase();
    const viewerUserId = req.user?.userId ?? req.user?.id ?? null;
    if (!(await isFinanceApprover(role, viewerUserId))) {
      return res.status(403).json({ error: "Only accounts/finance heads or admins can finance-reject a refund" });
    }
    const note = req.body?.note || "Finance sent back — please revise";
    const tx = pool.transaction();
    await tx.begin();
    try {
      const cur = (await tx.request().input("id", sql.Int, id).query(`
        SELECT Status, FinanceNewPaymentId
        FROM dbo.CrmRefund WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id
      `)).recordset[0];
      if (!cur) {
        await tx.rollback();
        return res.status(404).json({ error: "Refund not found" });
      }
      if (cur.Status !== "FinancePending" || cur.FinanceNewPaymentId != null) {
        await tx.rollback();
        return res.status(409).json({ error: `Cannot finance-reject — refund status is '${cur.Status}'${cur.FinanceNewPaymentId != null ? " and its payout voucher already exists" : ""}` });
      }
      const upd = await tx.request().input("id", sql.Int, id).input("n", sql.NVarChar(500), `[Finance] ${note}`)
        .query(`
          UPDATE dbo.CrmRefund SET Status = 'Pending', RejectionNote = @n, UpdatedAt = SYSDATETIME()
          WHERE Id = @id AND Status = 'FinancePending' AND FinanceNewPaymentId IS NULL
        `);
      if (upd.rowsAffected[0] !== 1) throw Object.assign(new Error("Refund state changed while Finance was sending it back"), { status: 409 });
      await tx.commit();
    } catch (txError) {
      try { await tx.rollback(); } catch {}
      throw txError;
    }
    await bumpCacheVersion("crm-refunds");
    res.json({ success: true, status: "Pending" });
  } catch (e) {
    console.error("[crm-refunds] finance-reject error:", e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : "An internal error occurred. Please try again later." });
  }
});

// ── markCrmRefundPaid — called from newPayment.js when the payout voucher
// is approved (funds have moved). Idempotent. NON-FATAL for the caller. ────
async function markCrmRefundPaid(pool, refundId, newPaymentId, userEmail) {
  const cur = await pool.request().input("id", sql.Int, refundId)
    .query("SELECT Id, Status, SourceOnAccountId, GrossAmount FROM dbo.CrmRefund WHERE Id = @id");
  const rf = cur.recordset[0];
  if (!rf) return { ok: false, reason: "refund not found" };
  if (rf.Status === "Paid") return { ok: true, reason: "already paid (idempotent)" };
  if (!["FinanceApproved", "FinancePending"].includes(rf.Status)) {
    return { ok: false, reason: `refund not in a payable state (${rf.Status})` };
  }

  const tx = pool.transaction();
  await tx.begin();
  try {
    // Lock the refund and re-read it: the voucher-approval hook and the
    // Refunds list's self-repair can both get here for the same refund; the
    // second must stop, or it would use up the source credit twice.
    const live = (await tx.request().input("id", sql.Int, refundId)
      .query("SELECT Status FROM dbo.CrmRefund WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id")).recordset[0];
    if (!live || live.Status === "Paid" || !["FinanceApproved", "FinancePending"].includes(live.Status)) {
      await tx.rollback();
      return live?.Status === "Paid" ? { ok: true, reason: "already paid (idempotent)" } : { ok: false, reason: `refund not in a payable state (${live?.Status})` };
    }
    // Re-check under lock: by the time the payout voucher is actually
    // approved (funds already moved to the customer's bank), a Rebooking
    // Transfer may have consumed the same source credit. This can no longer
    // stop the cash that already left, but it MUST stop us from silently
    // recording a double-consumption of the source row — surface it loudly
    // instead (finance-approve is the real backstop; this is defense in depth).
    if (rf.SourceOnAccountId) {
      const oaLock = await tx.request().input("id", sql.Int, rf.SourceOnAccountId).query(`
        SELECT Amount, AppliedAmount FROM dbo.CrmOnAccountPayment WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id
      `);
      const oa = oaLock.recordset[0];
      const remaining = oa ? Number(oa.Amount) - Number(oa.AppliedAmount || 0) : 0;
      if (!oa || Number(rf.GrossAmount) > remaining + 0.01) {
        throw new Error(
          `Refund ${refundId}: source on-account ${rf.SourceOnAccountId} has only ₹${remaining.toLocaleString("en-IN")} remaining, ` +
          `less than the refund's ₹${Number(rf.GrossAmount).toLocaleString("en-IN")} — likely already consumed by a re-booking transfer. ` +
          `Payout voucher was already approved; this needs manual reconciliation, not a silent double-consumption.`
        );
      }
    }
    await tx.request().input("id", sql.Int, refundId).input("np", sql.Int, newPaymentId != null ? newPaymentId : null)
      .query(`
        UPDATE dbo.CrmRefund SET
          Status = 'Paid', PaidAt = SYSDATETIME(),
          FinanceNewPaymentId = ISNULL(FinanceNewPaymentId, @np),
          -- the bank Finance actually paid from, when it was picked on the voucher
          RefundBankLHeadId = COALESCE((SELECT TRY_CAST(np.PBankID AS INT) FROM dbo.NewPayment np WHERE np.PPaymentID = ISNULL(@np, FinanceNewPaymentId)), RefundBankLHeadId),
          UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    // Consume the source held / on-account credit by the gross amount.
    if (rf.SourceOnAccountId) {
      await tx.request().input("oid", sql.Int, rf.SourceOnAccountId).input("rid", sql.Int, refundId).input("g", sql.Decimal(18, 2), Number(rf.GrossAmount) || 0)
        .query(`
          UPDATE dbo.CrmOnAccountPayment SET
            AppliedAmount = AppliedAmount + @g,
            Status = CASE WHEN AppliedAmount + @g >= Amount - 0.01 THEN 'Applied'
                          WHEN ISNULL(Status,'') = 'Held' THEN 'Held' ELSE 'PartiallyApplied' END,
            Notes = ISNULL(Notes,'') + char(10) + 'Refunded via CrmRefund #' + CAST(@rid AS NVARCHAR(20))
          WHERE Id = @oid
        `);
      // The refunded part leaves the customer's on-account figure in Finance too.
      await require("../services/crmLedger").syncCrmOnAccountLedger(tx, rf.SourceOnAccountId, userEmail, `Refunded via CrmRefund #${refundId}`);
    }
    await tx.commit();
  } catch (txErr) {
    try { await tx.rollback(); } catch (_) { /* already rolled back */ }
    throw txErr;
  }

  // Once this refund fully consumes the source, any other still-open claim
  // on it (a Draft/PendingTransfer rebooking transfer nobody cancelled) is
  // now stale — reject it instead of leaving it for someone to act on later.
  if (rf.SourceOnAccountId) {
    const source = await pool.request().input("id", sql.Int, rf.SourceOnAccountId)
      .query("SELECT Status FROM dbo.CrmOnAccountPayment WHERE Id = @id");
    if (source.recordset[0]?.Status === "Applied") {
      await rejectStaleClaimsOnSource(pool, rf.SourceOnAccountId, {
        exceptRefundId: refundId,
        note: `Auto-rejected — the source credit was fully consumed by refund ${rf.Id} on ${new Date().toISOString().slice(0, 10)}.`,
      }, userEmail);
    }
  }

  // Forfeiture GL leg (no-op when DeductionAmount = 0). Never fatal.
  try {
    const outcome = await postCrmRefundPaid(pool, refundId, userEmail);
    await recordGLPosting("crm-refund", refundId, outcome, userEmail);
  } catch (glErr) {
    await recordGLPosting("crm-refund", refundId, { failed: true, reason: glErr.message }, userEmail);
  }
  // Its GST documents: refund voucher for money never invoiced, credit notes
  // against invoices (services/crmGstNotes.js). Never fatal to the payout.
  try { await require("../services/crmGstNotes").issueForRefund(pool, refundId, userEmail); }
  catch (e) { console.error(`[crm-refunds] GST documents for refund ${refundId}:`, e.message); }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
//  RE-BOOKING: apply held credit to a NEW booking (Phase D)
// ═══════════════════════════════════════════════════════════════════════════

// Consume a held-credit slice and drop it as a fresh Unapplied on-account row
// on the target booking. Called inline for a same-company transfer, and from
// the fund-transfer approve hook once a cross-company transfer is Approved.
// Idempotent; the caller treats a throw as non-fatal where appropriate.
async function postRebookingTransferSideEffects(pool, rt, newOaId, userEmail) {
  // Serialize recovery attempts so two user retries cannot both observe a
  // missing voucher/ledger row and post it twice.
  const tx = pool.transaction();
  await tx.begin();
  try {
    const current = (await tx.request().input("id", sql.Int, rt.Id).query(`
      SELECT Status, NewOnAccountId FROM dbo.CrmRebookingTransfer WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id
    `)).recordset[0];
    if (!current || current.Status !== "Applied" || !current.NewOnAccountId) {
      await tx.rollback();
      return { ok: false, reason: "Re-booking transfer is not Applied" };
    }
    newOaId = current.NewOnAccountId;
    const failures = [];
    if (rt.IsCrossCompany) {
      try {
        const mirror = await postCrmHeldCreditCrossCompanyMirror(pool, rt.Id, userEmail);
        await recordGLPosting("crm-rebooking-transfer-mirror", rt.Id, mirror, userEmail);
        if (!mirror?.posted) failures.push(mirror?.reason || "Cross-company CRM ledger mirror was not posted");
      } catch (err) {
        await recordGLPosting("crm-rebooking-transfer-mirror", rt.Id, { failed: true, reason: err.message }, userEmail);
        failures.push(err.message);
      }
    }
    try {
      const allocation = await postCrmHeldCreditReallocateLedgerOnly(pool, {
        customerId: rt.CustomerId, newOnAccountId: newOaId, amount: Number(rt.Amount),
        companyId: rt.ToCompanyId, projectId: rt.ToProjectId, receiptNo: `REBK-${rt.Id}`, userEmail,
      });
      await recordGLPosting("crm-rebooking-transfer", rt.Id, allocation, userEmail);
      if (!allocation?.posted) failures.push(allocation?.reason || "Customer on-account ledger entry was not posted");
    } catch (err) {
      await recordGLPosting("crm-rebooking-transfer", rt.Id, { failed: true, reason: err.message }, userEmail);
      failures.push(err.message);
    }
    await tx.commit();
    return failures.length
      ? { ok: false, applied: true, newOnAccountId: newOaId, reason: failures.join("; ") }
      : { ok: true, applied: true, newOnAccountId: newOaId };
  } catch (err) {
    try { await tx.rollback(); } catch {}
    throw err;
  }
}

async function applyRebookingTransferToBooking(pool, rebookingTransferId, userEmail) {
  const rtRes = await pool.request().input("id", sql.Int, rebookingTransferId).query(`
    SELECT rt.Id, rt.HeldOnAccountId, rt.ToBookingId, rt.ToCompanyId, rt.Amount,
           rt.IsCrossCompany, rt.Status, rt.NewOnAccountId,
           tb.ProjectId AS ToProjectId, ta.CustomerId
    FROM dbo.CrmRebookingTransfer rt
    JOIN dbo.CrmBooking tb ON tb.Id = rt.ToBookingId
    JOIN dbo.CrmApplication ta ON ta.Id = tb.ApplicationId
    WHERE rt.Id = @id
  `);
  const rt = rtRes.recordset[0];
  if (!rt) return { ok: false, reason: "rebooking transfer not found" };
  if (rt.Status === "Applied" && rt.NewOnAccountId) {
    return postRebookingTransferSideEffects(pool, rt, rt.NewOnAccountId, userEmail);
  }

  const hcRes = await pool.request().input("id", sql.Int, rt.HeldOnAccountId)
    .query("SELECT Id, Amount, AppliedAmount, Status FROM dbo.CrmOnAccountPayment WHERE Id = @id");
  const hc = hcRes.recordset[0];
  if (!hc || hc.Status !== "Held") return { ok: false, reason: "source is not a held credit" };
  const amount = Number(rt.Amount) || 0;
  // Check against the UNCLAIMED balance, not just Amount - AppliedAmount —
  // a live (non-terminal) CrmRefund on this same source has already spoken
  // for some of it, even though it hasn't been marked Paid (and therefore
  // hasn't touched AppliedAmount) yet. See getUnclaimedRemaining.
  const { unclaimed } = await getUnclaimedRemaining(pool, rt.HeldOnAccountId, { excludeTransferId: rebookingTransferId });
  if (amount > unclaimed + 0.01) return { ok: false, reason: `amount ${amount} exceeds unclaimed remaining ${unclaimed} (some of this credit is reserved by another pending refund)` };

  const receiptNo = `REBK-${rebookingTransferId}`;
  let newOaId;
  const tx = pool.transaction();
  await tx.begin();
  try {
    const targetBooking = (await tx.request().input("bid", sql.Int, rt.ToBookingId).query(`
      SELECT b.Id, b.Status, b.IsActive
      FROM dbo.CrmBooking b WITH (UPDLOCK, HOLDLOCK)
      WHERE b.Id = @bid
    `)).recordset[0];
    if (!targetBooking || !targetBooking.IsActive || DEAD_BOOKING_STATUSES.includes(targetBooking.Status)) {
      throw Object.assign(new Error("Target booking is no longer active; held credit was not applied."), { status: 409 });
    }
    const currentTransfer = (await tx.request().input("id", sql.Int, rebookingTransferId).query(`
      SELECT Status, NewOnAccountId FROM dbo.CrmRebookingTransfer WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id
    `)).recordset[0];
    if (!currentTransfer) throw Object.assign(new Error("Re-booking transfer not found"), { status: 404 });
    if (currentTransfer.Status === "Applied" && currentTransfer.NewOnAccountId) {
      newOaId = currentTransfer.NewOnAccountId;
      await tx.commit();
      return postRebookingTransferSideEffects(pool, rt, newOaId, userEmail);
    }
    if (!["Draft", "PendingTransfer"].includes(currentTransfer.Status)) {
      throw Object.assign(new Error(`Re-booking transfer is ${currentTransfer.Status} and cannot be applied.`), { status: 409 });
    }
    // Re-check once more under lock, immediately before consuming — closes
    // the window between the check above and this transaction acquiring the
    // row, the same TOCTOU class this whole function already guards against
    // for its own remaining-balance check.
    const lockRes = await tx.request().input("id", sql.Int, rt.HeldOnAccountId).query(`
      SELECT Amount, AppliedAmount FROM dbo.CrmOnAccountPayment WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id
    `);
    const lockRow = lockRes.recordset[0];
    const { found: sourceFound, unclaimed: unclaimedLocked } = await getUnclaimedRemaining(tx, rt.HeldOnAccountId, { excludeTransferId: rebookingTransferId });
    if (!lockRow || !sourceFound || amount > unclaimedLocked + 0.01) {
      throw new Error(`amount ${amount} exceeds held unclaimed remaining ${unclaimedLocked} at lock time`);
    }
    const oaIns = await tx.request()
      .input("no", sql.NVarChar(30), receiptNo)
      .input("bid", sql.Int, rt.ToBookingId)
      .input("amt", sql.Decimal(18, 2), amount)
      .query(`
        INSERT INTO dbo.CrmOnAccountPayment
          (ReceiptNo, BookingId, Amount, AppliedAmount, Status, ReceivedDate, PaymentMode, Notes, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@no, @bid, @amt, 0, 'Unapplied', CAST(SYSDATETIME() AS DATE), 'RebookingCredit',
           'Re-booking credit carried over from a cancelled booking. Apply to milestones via On Account Adjustment.',
           SYSDATETIME())
      `);
    newOaId = oaIns.recordset[0].Id;

    await tx.request().input("hid", sql.Int, rt.HeldOnAccountId).input("g", sql.Decimal(18, 2), amount)
      .query(`
        UPDATE dbo.CrmOnAccountPayment SET
          AppliedAmount = AppliedAmount + @g,
          Status = CASE WHEN AppliedAmount + @g >= Amount - 0.01 THEN 'Applied' ELSE 'Held' END,
          Notes = ISNULL(Notes,'') + char(10) + 'Transferred to a re-booking.'
        WHERE Id = @hid
      `);
    await require("../services/crmLedger").syncCrmOnAccountLedger(tx, rt.HeldOnAccountId, userEmail, "Transferred to a re-booking");

    await tx.request().input("id", sql.Int, rebookingTransferId).input("noa", sql.Int, newOaId)
      .query("UPDATE dbo.CrmRebookingTransfer SET Status = 'Applied', NewOnAccountId = @noa, UpdatedAt = SYSDATETIME() WHERE Id = @id");

    await tx.commit();
  } catch (txErr) {
    try { await tx.rollback(); } catch (_) {}
    throw txErr;
  }

  // Once this transfer fully consumes the source, any other still-open
  // refund claim on it is now stale — reject it rather than leaving it for
  // Finance to approve and pay out by mistake later (the original Finding #1
  // scenario: a Draft refund auto-created by cancellation, superseded by a
  // rebooking the staff chose instead).
  const postState = await pool.request().input("id", sql.Int, rt.HeldOnAccountId)
    .query("SELECT Status FROM dbo.CrmOnAccountPayment WHERE Id = @id");
  if (postState.recordset[0]?.Status === "Applied") {
    await rejectStaleClaimsOnSource(pool, rt.HeldOnAccountId, {
      exceptTransferId: rebookingTransferId,
      note: `Auto-rejected — the source credit was fully consumed by a re-booking transfer to booking #${rt.ToBookingId} on ${new Date().toISOString().slice(0, 10)}.`,
    }, userEmail);
  }

  // GL and customer on-account ledger follow the committed CRM transfer.
  // Failures remain visible and can be retried by an authorized user.
  return postRebookingTransferSideEffects(pool, rt, newOaId, userEmail);
}

// POST /rebooking-transfer — start moving held credit onto a new booking.
router.post("/rebooking-transfer", requirePageRight("crm-refunds", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body || {};
    const heldId = parseInt(b.heldOnAccountId ?? b.HeldOnAccountId, 10);
    const toBookingId = parseInt(b.toBookingId ?? b.ToBookingId, 10);
    const amount = Number(b.amount ?? b.Amount);
    if (!Number.isFinite(heldId) || !Number.isFinite(toBookingId)) {
      return res.status(400).json({ error: "heldOnAccountId and toBookingId are required" });
    }
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "amount must be a positive number" });
    const userEmail = req.user?.email || req.user?.name || String(actorId(req));

    const heldRes = await pool.request().input("id", sql.Int, heldId).query(`
      SELECT oa.Id, oa.Amount, oa.AppliedAmount, oa.Status, oa.BookingId AS FromBookingId,
             fb.CompanyId AS FromCompanyId, fb.ProjectId AS FromProjectId, fa.CustomerId AS FromCustomerId
      FROM dbo.CrmOnAccountPayment oa
      JOIN dbo.CrmBooking fb ON fb.Id = oa.BookingId
      JOIN dbo.CrmApplication fa ON fa.Id = fb.ApplicationId
      WHERE oa.Id = @id
    `);
    const held = heldRes.recordset[0];
    if (!held) return res.status(404).json({ error: "Held credit not found" });

    const fromAllowed = await assertBookingProjectScope(req, res, held.FromBookingId);
    if (fromAllowed === false) return;
    const toAllowed = await assertBookingProjectScope(req, res, toBookingId);
    if (toAllowed === false) return;
    if (held.Status !== "Held") return res.status(400).json({ error: "That on-account row is not a held credit" });
    const { unclaimed } = await getUnclaimedRemaining(pool, heldId);
    if (amount > unclaimed + 0.01) {
      return res.status(400).json({ error: `Amount exceeds the held credit's available balance (₹${unclaimed.toLocaleString("en-IN")}) — some of it may already be claimed by a pending refund` });
    }

    const toRes = await pool.request().input("bid", sql.Int, toBookingId).query(`
      SELECT b.Id, b.Status, b.IsActive, b.CompanyId AS ToCompanyId, b.ProjectId AS ToProjectId, a.CustomerId AS ToCustomerId
      FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId WHERE b.Id = @bid
    `);
    const to = toRes.recordset[0];
    if (!to) return res.status(404).json({ error: "Target booking not found" });
    if (!to.IsActive || require("../constants/crmStatuses").DEAD_BOOKING_STATUSES.includes(to.Status)) {
      return res.status(400).json({ error: "Target booking is not active" });
    }
    if (Number(to.ToCustomerId) !== Number(held.FromCustomerId)) {
      return res.status(400).json({ error: "Held credit and the target booking belong to different customers" });
    }

    // Both bookings must be in projects the user may work in.
    if (!projectAllowed(req.projectScope, held.FromProjectId) || !projectAllowed(req.projectScope, to.ToProjectId)) {
      return res.status(403).json({ error: "You don't have access to this project" });
    }

    const isCross = Number(held.FromCompanyId) !== Number(to.ToCompanyId);

    if (!isCross) {
      const rtIns = await reserveRebookingTransfer(pool, { heldId, amount, fromCompanyId: held.FromCompanyId, toBookingId, toCompanyId: to.ToCompanyId, actorUserId: actorId(req), isCrossCompany: false });
      const rtId = rtIns.recordset[0].Id;
      let outcome;
      try {
        outcome = await applyRebookingTransferToBooking(pool, rtId, userEmail);
        if (outcome && outcome.ok === false) {
          if (outcome.applied) {
            await bumpCacheVersion("crm-refunds");
            return res.status(202).json({
              success: true, id: rtId, crossCompany: false, partialFailure: true,
              newOnAccountId: outcome.newOnAccountId,
              message: `Held credit was applied in CRM, but its accounting ledger follow-up failed: ${outcome.reason}`,
            });
          }
          throw Object.assign(new Error(`The credit couldn't be moved: ${outcome.reason}`), { status: 409 });
        }
      } catch (applyErr) {
        // Left Draft, it reserved the held credit for good (a live claim) with
        // no way to retry or cancel - release it, as the cross-company path does.
        await pool.request().input("id", sql.Int, rtId).input("n", sql.NVarChar(500), `Could not be applied: ${String(applyErr.message).slice(0, 400)}`)
          .query("UPDATE dbo.CrmRebookingTransfer SET Status = 'Rejected', Notes = @n, UpdatedAt = SYSDATETIME() WHERE Id = @id AND Status = 'Draft'");
        if (applyErr.status === 409) return res.status(409).json({ error: applyErr.message });
        throw applyErr;
      }
      await bumpCacheVersion("crm-refunds");
      return res.status(201).json({ success: true, id: rtId, crossCompany: false, ...outcome });
    }

    // Cross-company: needs a real Inter-Company Fund Transfer between the two
    // projects' tagged bank accounts.
    const srcBank = await pool.request().input("pid", sql.Int, held.FromProjectId)
      .query("SELECT TOP 1 BankLHeadId FROM dbo.CrmProjectBank WHERE ProjectId = @pid AND IsActive = 1");
    const dstBank = await pool.request().input("pid", sql.Int, to.ToProjectId)
      .query("SELECT TOP 1 BankLHeadId FROM dbo.CrmProjectBank WHERE ProjectId = @pid AND IsActive = 1");
    if (!srcBank.recordset[0] || !dstBank.recordset[0]) {
      return res.status(400).json({ error: "Both projects must have a tagged company bank account before a cross-company transfer" });
    }
    // Reserve the held credit first (a live claim counts in getUnclaimedRemaining),
    // so nothing else can take it while the fund transfer is raised; if raising
    // it fails, the claim is released again.
    const rtIns = await reserveRebookingTransfer(pool, { heldId, amount, fromCompanyId: held.FromCompanyId, toBookingId, toCompanyId: to.ToCompanyId, actorUserId: actorId(req), isCrossCompany: true });
    const rtId = rtIns.recordset[0].Id;
    let ftId, ftDocNo;
    try {
      const dtId = await resolveDocTypeId(pool, sql, "FT");
      ftDocNo = await lockNextDocNumber(pool, sql, { docTypeId: dtId, tableName: "FundTransfer", docNoColumn: "DocNo", issuedBy: userEmail });
      const createTx = pool.transaction();
      await createTx.begin();
      try {
        const ftIns = await createTx.request()
          .input("no", sql.NVarChar(100), ftDocNo || null)
          .input("dt", sql.Date, new Date().toISOString().slice(0, 10))
          .input("sc", sql.Int, held.FromCompanyId).input("dc", sql.Int, to.ToCompanyId)
          .input("sb", sql.Int, srcBank.recordset[0].BankLHeadId).input("db", sql.Int, dstBank.recordset[0].BankLHeadId)
          .input("amt", sql.Decimal(18, 2), amount)
          .input("nar", sql.NVarChar(500), `CRM re-booking credit transfer — held credit from a cancelled booking moved to BKG #${toBookingId}`)
          .input("dtid", sql.Int, dtId != null ? dtId : null)
          .input("cb", sql.NVarChar(150), userEmail)
          .query(`
            INSERT INTO dbo.FundTransfer
              (DocNo, TransferDate, TransferType, SourceCompanyId, DestinationCompanyId,
               SourceBankId, DestinationBankId, Amount, Narration, Status, DocTypeId, CreatedBy, Mode)
            OUTPUT INSERTED.FTId
            VALUES
              (@no, @dt, 'Inter', @sc, @dc, @sb, @db, @amt, @nar, 'Draft', @dtid, @cb, 'Transfer')
          `);
        ftId = ftIns.recordset[0].FTId;
        const linked = await createTx.request().input("id", sql.Int, rtId).input("ft", sql.Int, ftId).query(`
          UPDATE dbo.CrmRebookingTransfer SET FundTransferId = @ft, UpdatedAt = SYSDATETIME()
          WHERE Id = @id AND Status = 'PendingTransfer' AND FundTransferId IS NULL
        `);
        if (linked.rowsAffected[0] !== 1) throw new Error("CRM re-booking transfer could not be linked to its Fund Transfer");
        await createTx.commit();
      } catch (createErr) {
        try { await createTx.rollback(); } catch {}
        throw createErr;
      }
      if (ftDocNo) {
        try { await backPatchRecordId(pool, sql, ftDocNo, "FundTransfer", ftId); }
        catch (patchErr) { console.error("[crm-refunds] Fund Transfer DocNo back-patch failed:", patchErr.message); }
      }
    } catch (ftErr) {
      await pool.request().input("id", sql.Int, rtId).input("n", sql.NVarChar(500), `Fund transfer could not be raised: ${String(ftErr.message).slice(0, 400)}`)
        .query("UPDATE dbo.CrmRebookingTransfer SET Status = 'Rejected', Notes = @n, UpdatedAt = SYSDATETIME() WHERE Id = @id");
      throw ftErr;
    }
    let fundTransferSubmitError = null;
    try {
      await approvalTransition("fund-transfer", ftId, "Pending", req.user?.email, req.user?.role);
    } catch (subErr) {
      fundTransferSubmitError = subErr.message;
      console.warn("[crm-refunds] fund-transfer approval submission failed:", subErr.message);
    }

    await Promise.all([bumpCacheVersion("crm-refunds"), bumpCacheVersion("fund-transfer")]);
    res.status(fundTransferSubmitError ? 202 : 201).json({
      success: true, id: rtId, crossCompany: true, fundTransferId: ftId, fundTransferDocNo: ftDocNo,
      partialFailure: Boolean(fundTransferSubmitError),
      fundTransferSubmitError: fundTransferSubmitError || undefined,
      message: fundTransferSubmitError
        ? "The Fund Transfer was created, but could not be submitted for approval. It remains Draft and the held credit is reserved; submit it manually when ready. No bank transfer was made."
        : "Inter-company Fund Transfer submitted for approval. The bank transfer must be completed manually; Finance approval records that it has happened and then applies the credit to the new booking.",
    });
  } catch (e) {
    console.error("[crm-refunds] rebooking-transfer error:", e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : "An internal error occurred. Please try again later." });
  }
});

// Manual recovery when CRM creation succeeded but ERP approval submission
// failed. This only submits the existing Fund Transfer into the approval
// workflow; it never moves or schedules bank funds.
router.put("/rebooking-transfer/:transferId/submit-fund-transfer",
  requirePageRight("crm-refunds", "edit"),
  requirePageRight("fund-transfer", "edit"),
  async (req, res) => {
    try {
      const pool = getPool();
      const transferId = parseId(req.params.transferId);
      if (!transferId) return res.status(400).json({ error: "Invalid re-booking transfer id" });
      const row = (await pool.request().input("id", sql.Int, transferId).query(`
        SELECT rt.Status, rt.FundTransferId, hc.BookingId AS SourceBookingId,
               rt.ToBookingId, ft.Status AS FundTransferStatus
        FROM dbo.CrmRebookingTransfer rt
        JOIN dbo.CrmOnAccountPayment hc ON hc.Id = rt.HeldOnAccountId
        JOIN dbo.FundTransfer ft ON ft.FTId = rt.FundTransferId
        WHERE rt.Id = @id AND rt.IsCrossCompany = 1
      `)).recordset[0];
      if (!row) return res.status(404).json({ error: "Cross-company re-booking transfer not found" });
      if (row.Status !== "PendingTransfer" || row.FundTransferStatus !== "Draft") {
        return res.status(409).json({ error: `Manual submission requires PendingTransfer/Draft status; current status is ${row.Status}/${row.FundTransferStatus}` });
      }
      for (const bookingId of [row.SourceBookingId, row.ToBookingId]) {
        const allowed = await assertBookingProjectScope(req, res, bookingId);
        if (allowed === false) return;
      }
      const result = await approvalTransition(
        "fund-transfer", row.FundTransferId, "Pending",
        req.user?.email || req.user?.name, req.user?.role, null,
        req.user?.userId ?? req.user?.id ?? null,
      );
      await Promise.all([bumpCacheVersion("crm-refunds"), bumpCacheVersion("fund-transfer")]);
      return res.json({ success: true, message: "Fund Transfer submitted for approval. Any bank transfer remains a manual staff action.", ...result });
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
  },
);

// Explicit staff retry for ledger follow-up after the CRM credit itself was
// committed. No bank action is performed by this endpoint.
router.put("/rebooking-transfer/:transferId/retry-ledger", requirePageRight("crm-refunds", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const transferId = parseId(req.params.transferId);
    if (!transferId) return res.status(400).json({ error: "Invalid re-booking transfer id" });
    const row = (await pool.request().input("id", sql.Int, transferId).query(`
      SELECT rt.Id, rt.Status, rt.IsCrossCompany, rt.FundTransferId,
             hc.BookingId AS SourceBookingId, rt.ToBookingId,
             ft.Status AS FundTransferStatus
      FROM dbo.CrmRebookingTransfer rt
      JOIN dbo.CrmOnAccountPayment hc ON hc.Id = rt.HeldOnAccountId
      LEFT JOIN dbo.FundTransfer ft ON ft.FTId = rt.FundTransferId
      WHERE rt.Id = @id
    `)).recordset[0];
    if (!row) return res.status(404).json({ error: "Re-booking transfer not found" });
    if (row.Status !== "Applied") return res.status(409).json({ error: `Re-booking transfer is ${row.Status}; retry requires Applied status` });
    if (row.IsCrossCompany) {
      if (row.FundTransferStatus !== "Approved") return res.status(409).json({ error: "The linked Fund Transfer must be approved first" });
      if (!(await require("../services/generalLedger").hasCompleteFundTransferPosting(pool, row.FundTransferId))) {
        return res.status(409).json({ error: "The linked Fund Transfer GL posting is incomplete; resolve that approval first" });
      }
    }
    for (const bookingId of [row.SourceBookingId, row.ToBookingId]) {
      const allowed = await assertBookingProjectScope(req, res, bookingId);
      if (allowed === false) return;
    }
    const result = await applyRebookingTransferToBooking(pool, transferId, req.user?.email || req.user?.name || "system");
    await Promise.all([bumpCacheVersion("crm-refunds"), bumpCacheVersion("general-ledger")]);
    if (!result.ok) return res.status(202).json({ success: true, partialFailure: true, message: result.reason, ...result });
    res.json({ success: true, message: "Re-booking ledger entries are up to date", ...result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.markCrmRefundPaid = markCrmRefundPaid;
module.exports.applyRebookingTransferToBooking = applyRebookingTransferToBooking;
module.exports.settlePaidRefunds = settlePaidRefunds;
