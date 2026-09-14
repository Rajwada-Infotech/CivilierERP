const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, requireUserEmail } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { applyPagination } = require("../services/crmListPagination");
const { transition: approvalTransition, recordGLPosting } = require("../services/approvalService");
const { lockNextDocNumber, backPatchRecordId, resolveDocTypeId } = require("../utils/docNumberLock");
const { bumpCacheVersion } = require("../redis");
const {
  ensureCrmCustomerLedgerHead, postCrmRefundPaid,
  postCrmHeldCreditReallocateLedgerOnly, postCrmHeldCreditCrossCompanyMirror,
} = require("../services/crmLedger");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const FINANCE_APPROVER_ROLES = ["accounts_head", "finance_head", "admin", "super_admin"];

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

const REFUND_SELECT = `
  SELECT
    r.Id, r.RefundNo, r.CustomerId, r.CompanyId, r.ProjectId, r.BookingId,
    r.SourceType, r.SourceOnAccountId, r.SourceCancellationId,
    r.GrossAmount, r.DeductionPercent, r.DeductionAmount, r.NetAmount,
    r.Reason, r.RefundBankLHeadId, r.CustomerBankName, r.CustomerAccountNo, r.CustomerIfscCode,
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
router.get("/", requirePageRight("crm-refunds", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status, search } = req.query;
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const blockId = req.query.blockId ? parseInt(req.query.blockId, 10) : null;
    const req0 = pool.request();
    const conds = [];
    if (status) { req0.input("st", sql.NVarChar(20), status); conds.push("r.Status = @st"); }
    if (companyId) { req0.input("companyId", sql.Int, companyId); conds.push("r.CompanyId = @companyId"); }
    if (projectId) { req0.input("projectId", sql.Int, projectId); conds.push("r.ProjectId = @projectId"); }
    if (blockId) { req0.input("blockId", sql.Int, blockId); conds.push("um.BlockId = @blockId"); }
    if (search) {
      req0.input("search", sql.NVarChar(200), `%${search}%`);
      conds.push("(cu.CustomerName LIKE @search OR r.RefundNo LIKE @search OR b.BookingNo LIKE @search OR cxl.CancellationNo LIKE @search)");
    }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const SELECT_WITH_BLOCK = `${REFUND_SELECT} LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId`;

    if (!req.query.page) {
      const result = await req0.query(`${SELECT_WITH_BLOCK} ${where} ORDER BY r.CreatedAt DESC`);
      return res.json(result.recordset);
    }
    const { page, pageSize, offset } = applyPagination(req);
    req0.input("offset", sql.Int, offset);
    req0.input("pageSize", sql.Int, pageSize);
    const [result, countResult] = await Promise.all([
      req0.query(`${SELECT_WITH_BLOCK} ${where} ORDER BY r.CreatedAt DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`),
      pool.request()
        .input("st2", sql.NVarChar(20), status || null)
        .input("companyId2", sql.Int, companyId)
        .input("projectId2", sql.Int, projectId)
        .input("blockId2", sql.Int, blockId)
        .input("search2", sql.NVarChar(200), search ? `%${search}%` : null)
        .query(`
          SELECT COUNT(*) AS total
          FROM dbo.CrmRefund r
          JOIN dbo.CrmCustomer cu ON cu.Id = r.CustomerId
          LEFT JOIN dbo.CrmBooking b ON b.Id = r.BookingId
          LEFT JOIN dbo.CrmCancellation cxl ON cxl.Id = r.SourceCancellationId
          LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
          WHERE (@st2 IS NULL OR r.Status = @st2)
            AND (@companyId2 IS NULL OR r.CompanyId = @companyId2)
            AND (@projectId2 IS NULL OR r.ProjectId = @projectId2)
            AND (@blockId2 IS NULL OR um.BlockId = @blockId2)
            AND (@search2 IS NULL OR (cu.CustomerName LIKE @search2 OR r.RefundNo LIKE @search2 OR b.BookingNo LIKE @search2 OR cxl.CancellationNo LIKE @search2))
        `),
    ]);
    res.json({ rows: result.recordset, total: countResult.recordset[0].total, page, pageSize });
  } catch (e) {
    console.error("[crm-refunds] GET error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ── GET /eligible-sources — pickable money for a NEW refund ────────────────
// Held credit from cancelled bookings (deduction applies) + unapplied
// on-account / overpayment on live bookings (no deduction).
router.get("/eligible-sources", requirePageRight("crm-refunds", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const customerId = req.query.customerId ? parseInt(req.query.customerId, 10) : null;
    const req0 = pool.request();
    if (customerId) req0.input("cust", sql.Int, customerId);
    const custFilter = customerId ? "AND a.CustomerId = @cust" : "";
    const result = await req0.query(`
      SELECT
        'CancellationHeldCredit' AS SourceType,
        oa.Id AS OnAccountId, oa.Amount, oa.AppliedAmount,
        (oa.Amount - oa.AppliedAmount) AS Remaining,
        oa.HeldAt AS AsOf, b.Id AS BookingId, b.BookingNo, b.CompanyId, b.ProjectId,
        a.CustomerId, cu.CustomerName, cxl.CancellationNo, c.DeductionPercent
      FROM dbo.CrmOnAccountPayment oa
      JOIN dbo.CrmBooking b ON b.Id = oa.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      JOIN dbo.CrmCustomer cu ON cu.Id = a.CustomerId
      LEFT JOIN dbo.CrmCancellation c ON c.Id = oa.HeldSourceRefId
      LEFT JOIN dbo.CrmCancellation cxl ON cxl.Id = oa.HeldSourceRefId
      WHERE oa.Status = 'Held' AND (oa.Amount - oa.AppliedAmount) > 0.01 ${custFilter}

      UNION ALL

      SELECT
        'OverpaymentOnAccount' AS SourceType,
        oa.Id AS OnAccountId, oa.Amount, oa.AppliedAmount,
        (oa.Amount - oa.AppliedAmount) AS Remaining,
        oa.ReceivedDate AS AsOf, b.Id AS BookingId, b.BookingNo, b.CompanyId, b.ProjectId,
        a.CustomerId, cu.CustomerName, NULL AS CancellationNo, CAST(0 AS DECIMAL(5,2)) AS DeductionPercent
      FROM dbo.CrmOnAccountPayment oa
      JOIN dbo.CrmBooking b ON b.Id = oa.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      JOIN dbo.CrmCustomer cu ON cu.Id = a.CustomerId
      WHERE ISNULL(oa.Status,'') IN ('Unapplied','PartiallyApplied')
        AND (oa.Amount - ISNULL(oa.AppliedAmount,0)) > 0.01
        AND b.Status NOT IN ('Cancelled','Rejected') ${custFilter}
      ORDER BY AsOf DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-refunds] GET /eligible-sources error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ── GET /:id ─────────────────────────────────────────────────────────────
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
    const sourceType = b.SourceType;
    if (!["CancellationHeldCredit", "OverpaymentOnAccount", "Manual"].includes(sourceType)) {
      return res.status(400).json({ error: "SourceType must be CancellationHeldCredit, OverpaymentOnAccount or Manual" });
    }
    const gross = Number(b.GrossAmount);
    if (!Number.isFinite(gross) || gross <= 0) return res.status(400).json({ error: "GrossAmount must be a positive number" });

    let customerId = null, companyId = null, projectId = null, bookingId = null;
    let sourceOnAccountId = null, sourceCancellationId = null;
    let deductionPct = 0;
    let dueDate = null;

    if (sourceType === "Manual") {
      customerId = b.CustomerId ? parseInt(b.CustomerId, 10) : null;
      if (!customerId) return res.status(400).json({ error: "CustomerId is required for a manual refund" });
      bookingId = b.BookingId ? parseInt(b.BookingId, 10) : null;
      if (bookingId) {
        const bk = await pool.request().input("bid", sql.Int, bookingId)
          .query("SELECT CompanyId, ProjectId FROM dbo.CrmBooking WHERE Id = @bid");
        companyId = bk.recordset[0]?.CompanyId ?? null;
        projectId = bk.recordset[0]?.ProjectId ?? null;
      }
    } else {
      sourceOnAccountId = b.SourceOnAccountId ? parseInt(b.SourceOnAccountId, 10) : null;
      if (!sourceOnAccountId) return res.status(400).json({ error: "SourceOnAccountId is required for this source" });
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
      const remaining = Number(oa.Amount) - Number(oa.AppliedAmount || 0);
      if (gross > remaining + 0.01) {
        return res.status(400).json({ error: `Amount exceeds the source's remaining balance (₹${remaining.toLocaleString("en-IN")})` });
      }
      customerId = oa.CustomerId; companyId = oa.CompanyId; projectId = oa.ProjectId; bookingId = oa.BookingId;

      if (sourceType === "CancellationHeldCredit") {
        if (oa.Status !== "Held") return res.status(400).json({ error: "That on-account row is not a held cancellation credit" });
        sourceCancellationId = oa.HeldSourceRefId || null;
        deductionPct = await deductionPctForHeld(pool, sourceOnAccountId);
        dueDate = new Date(Date.now() + 45 * 86400000);
      } else {
        if (!["Unapplied", "PartiallyApplied"].includes(oa.Status || "")) {
          return res.status(400).json({ error: "That on-account row is not an unapplied/overpayment credit" });
        }
      }
    }
    if (!customerId) return res.status(400).json({ error: "Could not resolve the customer for this refund" });

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
    const ins = await pool.request()
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
      .input("bank", sql.Int, b.RefundBankLHeadId ? parseInt(b.RefundBankLHeadId, 10) : null)
      .input("cbn", sql.NVarChar(200), cbName)
      .input("cba", sql.NVarChar(50), cbAcc)
      .input("cbi", sql.NVarChar(20), cbIfsc)
      .input("due", sql.Date, dueDate)
      .input("rb", sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmRefund
          (RefundNo, CustomerId, CompanyId, ProjectId, BookingId, SourceType,
           SourceOnAccountId, SourceCancellationId, GrossAmount, DeductionPercent,
           DeductionAmount, NetAmount, Reason, RefundBankLHeadId,
           CustomerBankName, CustomerAccountNo, CustomerIfscCode,
           Status, RefundDueDate, RequestedBy, RequestedAt, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@rno, @cust, @comp, @proj, @bid, @stype,
           @soa, @scxl, @gross, @pct,
           @damt, @net, @reason, @bank,
           @cbn, @cba, @cbi,
           'Pending', @due, @rb, SYSDATETIME(), @rb, SYSDATETIME())
      `);
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
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    const cur = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmRefund WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Refund not found" });
    if (!["Draft", "Pending"].includes(cur.recordset[0].Status)) {
      return res.status(400).json({ error: `Cannot edit — refund is already ${cur.recordset[0].Status}` });
    }
    await pool.request()
      .input("id", sql.Int, id)
      .input("reason", sql.NVarChar(sql.MAX), b.Reason ?? null)
      .input("bank", sql.Int, b.RefundBankLHeadId ? parseInt(b.RefundBankLHeadId, 10) : null)
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
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-refunds] PUT error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ── PUT /:id/submit — Draft -> Pending ──────────────────────────────────
router.put("/:id/submit", requirePageRight("crm-refunds", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const cur = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmRefund WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Refund not found" });
    if (!["Draft", "Rejected"].includes(cur.recordset[0].Status)) {
      return res.status(400).json({ error: `Cannot submit — refund is ${cur.recordset[0].Status}` });
    }
    await pool.request().input("id", sql.Int, id)
      .query("UPDATE dbo.CrmRefund SET Status = 'Pending', RejectionNote = NULL, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    await bumpCacheVersion("crm-refunds");
    res.json({ success: true, status: "Pending" });
  } catch (e) {
    console.error("[crm-refunds] submit error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ── PUT /:id/approve — CRM checker (admin/marketing_head) -> FinancePending ──
router.put("/:id/approve", requirePageRight("crm-refunds", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const pool = getPool();
    const result = await approvalTransition("crm-refunds", id, "Approved", userEmail, req.user?.role);
    if (result.newStatus !== "Approved") {
      return res.json({ success: true, status: result.newStatus });
    }
    await pool.request().input("id", sql.Int, id).input("ab", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmRefund SET
          Status = 'FinancePending', ApprovedBy = @ab, ApprovedAt = SYSDATETIME(), UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    await bumpCacheVersion("crm-refunds");
    res.json({ success: true, status: "FinancePending" });
  } catch (e) {
    console.error("[crm-refunds] approve error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// ── PUT /:id/reject ────────────────────────────────────────────────────
router.put("/:id/reject", requirePageRight("crm-refunds", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
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

// ── PUT /:id/finance-approve — finance tier: spawn the payout NewPayment ──
router.put("/:id/finance-approve", requirePageRight("crm-refunds", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const role = (req.user?.role || "").toLowerCase();
    if (!FINANCE_APPROVER_ROLES.includes(role)) {
      return res.status(403).json({ error: "Only accounts/finance heads or admins can finance-approve a refund" });
    }
    const cur = await pool.request().input("id", sql.Int, id).query(`
      SELECT Id, RefundNo, Status, CustomerId, CompanyId, ProjectId, NetAmount,
             RefundBankLHeadId, CustomerBankName, CustomerAccountNo, FinanceNewPaymentId
      FROM dbo.CrmRefund WHERE Id = @id
    `);
    if (!cur.recordset.length) return res.status(404).json({ error: "Refund not found" });
    const rf = cur.recordset[0];
    if (rf.Status !== "FinancePending") {
      return res.status(400).json({ error: `Cannot finance-approve — status must be FinancePending (currently '${rf.Status}')` });
    }
    if (rf.FinanceNewPaymentId) {
      return res.status(409).json({ error: "A payout voucher already exists for this refund" });
    }
    const bankId = req.body?.RefundBankLHeadId ? parseInt(req.body.RefundBankLHeadId, 10) : rf.RefundBankLHeadId;
    if (!bankId) return res.status(400).json({ error: "A company bank account (RefundBankLHeadId) is required to disburse this refund" });
    if (!rf.CustomerBankName && !rf.CustomerAccountNo) {
      return res.status(400).json({ error: "Customer bank details are missing — add them to the refund before disbursing" });
    }
    const net = Number(rf.NetAmount) || 0;
    if (net <= 0) return res.status(400).json({ error: "Net refund amount must be greater than 0" });

    const actorEmail = req.user?.email || req.user?.name || String(actorId(req));
    const customerHeadId = await ensureCrmCustomerLedgerHead(pool, rf.CustomerId, actorEmail);
    const docTypeId = await resolveDocTypeId(pool, sql, "PAY");
    const finalDocNo = await lockNextDocNumber(pool, sql, {
      docTypeId, tableName: "NewPayment", docNoColumn: "DocNo", issuedBy: actorEmail,
    });
    const parts = (finalDocNo || "").split("-");
    const docYear = parseInt(parts[parts.length - 2], 10) || null;
    const docSerial = parseInt(parts[parts.length - 1], 10) || null;
    const today = new Date().toISOString().slice(0, 10);
    const finYearId = await resolveFinYearId(pool, today);

    const npIns = await pool.request()
      .input("name", sql.VarChar, "CRM Refund")
      .input("remarks", sql.NVarChar(1000), `${rf.RefundNo} — customer refund ₹${net.toLocaleString("en-IN")} to ${rf.CustomerBankName || "customer bank"} ${rf.CustomerAccountNo || ""} — finance to complete payment details`)
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
      .input("srcRefund", sql.Int, id)
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
          @name, @remarks, '', '', @bankId, @amt, 'CRM Refund', @dt,
          @project, @company, @partyId,
          @docNo, @docTypeId, @docYear, @docSerial, @finYearId,
          @srcRefund,
          SYSDATETIME(), @createdBy, NULL, 'Pending'
        )
      `);
    const newPaymentId = npIns.recordset[0].PPaymentID;
    await backPatchRecordId(pool, sql, finalDocNo, "NewPayment", newPaymentId);

    await pool.request()
      .input("id", sql.Int, id).input("np", sql.Int, newPaymentId)
      .input("bank", sql.Int, bankId).input("fc", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmRefund SET
          Status = 'FinanceApproved', FinanceNewPaymentId = @np, RefundBankLHeadId = @bank,
          FinanceClearedBy = @fc, FinanceClearedAt = SYSDATETIME(), UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    await Promise.all([bumpCacheVersion("crm-refunds"), bumpCacheVersion("new-payment")]);
    res.json({ success: true, status: "FinanceApproved", newPaymentId, docNo: finalDocNo });
  } catch (e) {
    console.error("[crm-refunds] finance-approve error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ── PUT /:id/finance-reject — FinancePending -> Pending ─────────────────
router.put("/:id/finance-reject", requirePageRight("crm-refunds", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const role = (req.user?.role || "").toLowerCase();
    if (!FINANCE_APPROVER_ROLES.includes(role)) {
      return res.status(403).json({ error: "Only accounts/finance heads or admins can finance-reject a refund" });
    }
    const cur = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmRefund WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Refund not found" });
    if (cur.recordset[0].Status !== "FinancePending") {
      return res.status(400).json({ error: `Cannot finance-reject — status must be FinancePending (currently '${cur.recordset[0].Status}')` });
    }
    const note = req.body?.note || "Finance sent back — please revise";
    await pool.request().input("id", sql.Int, id).input("n", sql.NVarChar(500), `[Finance] ${note}`)
      .query("UPDATE dbo.CrmRefund SET Status = 'Pending', RejectionNote = @n, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    await bumpCacheVersion("crm-refunds");
    res.json({ success: true, status: "Pending" });
  } catch (e) {
    console.error("[crm-refunds] finance-reject error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
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
    await tx.request().input("id", sql.Int, refundId).input("np", sql.Int, newPaymentId || null)
      .query(`
        UPDATE dbo.CrmRefund SET
          Status = 'Paid', PaidAt = SYSDATETIME(),
          FinanceNewPaymentId = ISNULL(FinanceNewPaymentId, @np),
          UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    // Consume the source held / on-account credit by the gross amount.
    if (rf.SourceOnAccountId) {
      await tx.request().input("oid", sql.Int, rf.SourceOnAccountId).input("g", sql.Decimal(18, 2), Number(rf.GrossAmount) || 0)
        .query(`
          UPDATE dbo.CrmOnAccountPayment SET
            AppliedAmount = AppliedAmount + @g,
            Status = CASE WHEN AppliedAmount + @g >= Amount - 0.01 THEN 'Applied'
                          WHEN ISNULL(Status,'') = 'Held' THEN 'Held' ELSE 'PartiallyApplied' END,
            Notes = ISNULL(Notes,'') + char(10) + 'Refunded via CrmRefund #' + CAST(@oid AS NVARCHAR(20))
          WHERE Id = @oid
        `);
    }
    await tx.commit();
  } catch (txErr) {
    try { await tx.rollback(); } catch (_) { /* already rolled back */ }
    throw txErr;
  }

  // Forfeiture GL leg (no-op when DeductionAmount = 0). Never fatal.
  try {
    const outcome = await postCrmRefundPaid(pool, refundId, userEmail);
    await recordGLPosting("crm-refund", refundId, outcome, userEmail);
  } catch (glErr) {
    await recordGLPosting("crm-refund", refundId, { failed: true, reason: glErr.message }, userEmail);
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
//  RE-BOOKING: apply held credit to a NEW booking (Phase D)
// ═══════════════════════════════════════════════════════════════════════════

// Consume a held-credit slice and drop it as a fresh Unapplied on-account row
// on the target booking. Called inline for a same-company transfer, and from
// the fund-transfer approve hook once a cross-company transfer is Approved.
// Idempotent; the caller treats a throw as non-fatal where appropriate.
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
  if (rt.Status === "Applied" && rt.NewOnAccountId) return { ok: true, reason: "already applied (idempotent)" };

  const hcRes = await pool.request().input("id", sql.Int, rt.HeldOnAccountId)
    .query("SELECT Id, Amount, AppliedAmount, Status FROM dbo.CrmOnAccountPayment WHERE Id = @id");
  const hc = hcRes.recordset[0];
  if (!hc || hc.Status !== "Held") return { ok: false, reason: "source is not a held credit" };
  const remaining = Number(hc.Amount) - Number(hc.AppliedAmount || 0);
  const amount = Number(rt.Amount) || 0;
  if (amount > remaining + 0.01) return { ok: false, reason: `amount ${amount} exceeds held remaining ${remaining}` };

  const receiptNo = `REBK-${rebookingTransferId}`;
  let newOaId;
  const tx = pool.transaction();
  await tx.begin();
  try {
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

    await tx.request().input("id", sql.Int, rebookingTransferId).input("noa", sql.Int, newOaId)
      .query("UPDATE dbo.CrmRebookingTransfer SET Status = 'Applied', NewOnAccountId = @noa, UpdatedAt = SYSDATETIME() WHERE Id = @id");

    await tx.commit();
  } catch (txErr) {
    try { await tx.rollback(); } catch (_) {}
    throw txErr;
  }

  // GL (post-commit, non-fatal): cross-company reclass first, then the
  // ledger-only reallocation that makes the fresh row an available advance.
  try {
    if (rt.IsCrossCompany) {
      const m = await postCrmHeldCreditCrossCompanyMirror(pool, rebookingTransferId, userEmail);
      await recordGLPosting("crm-rebooking-transfer-mirror", rebookingTransferId, m, userEmail);
    }
    const a = await postCrmHeldCreditReallocateLedgerOnly(pool, {
      customerId: rt.CustomerId, newOnAccountId: newOaId, amount,
      companyId: rt.ToCompanyId, projectId: rt.ToProjectId, receiptNo, userEmail,
    });
    await recordGLPosting("crm-rebooking-transfer", rebookingTransferId, a, userEmail);
  } catch (glErr) {
    await recordGLPosting("crm-rebooking-transfer", rebookingTransferId, { failed: true, reason: glErr.message }, userEmail);
  }
  return { ok: true, newOnAccountId: newOaId };
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
    if (held.Status !== "Held") return res.status(400).json({ error: "That on-account row is not a held credit" });
    const remaining = Number(held.Amount) - Number(held.AppliedAmount || 0);
    if (amount > remaining + 0.01) {
      return res.status(400).json({ error: `Amount exceeds the held remaining balance (₹${remaining.toLocaleString("en-IN")})` });
    }

    const toRes = await pool.request().input("bid", sql.Int, toBookingId).query(`
      SELECT b.Id, b.Status, b.IsActive, b.CompanyId AS ToCompanyId, b.ProjectId AS ToProjectId, a.CustomerId AS ToCustomerId
      FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId WHERE b.Id = @bid
    `);
    const to = toRes.recordset[0];
    if (!to) return res.status(404).json({ error: "Target booking not found" });
    if (!to.IsActive || ["Cancelled", "Rejected"].includes(to.Status)) {
      return res.status(400).json({ error: "Target booking is not active" });
    }
    if (Number(to.ToCustomerId) !== Number(held.FromCustomerId)) {
      return res.status(400).json({ error: "Held credit and the target booking belong to different customers" });
    }

    const isCross = Number(held.FromCompanyId) !== Number(to.ToCompanyId);

    if (!isCross) {
      const rtIns = await pool.request()
        .input("hid", sql.Int, heldId).input("fc", sql.Int, held.FromCompanyId)
        .input("tb", sql.Int, toBookingId).input("tc", sql.Int, to.ToCompanyId)
        .input("amt", sql.Decimal(18, 2), amount).input("cb", sql.Int, actorId(req))
        .query(`
          INSERT INTO dbo.CrmRebookingTransfer
            (HeldOnAccountId, FromCompanyId, ToBookingId, ToCompanyId, Amount, IsCrossCompany, Status, CreatedBy, CreatedAt)
          OUTPUT INSERTED.Id
          VALUES (@hid, @fc, @tb, @tc, @amt, 0, 'Draft', @cb, SYSDATETIME())
        `);
      const rtId = rtIns.recordset[0].Id;
      const outcome = await applyRebookingTransferToBooking(pool, rtId, userEmail);
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
    const dtId = await resolveDocTypeId(pool, sql, "FT");
    const ftDocNo = await lockNextDocNumber(pool, sql, { docTypeId: dtId, tableName: "FundTransfer", docNoColumn: "DocNo", issuedBy: userEmail });
    const ftIns = await pool.request()
      .input("no", sql.NVarChar(100), ftDocNo || null)
      .input("dt", sql.Date, new Date().toISOString().slice(0, 10))
      .input("sc", sql.Int, held.FromCompanyId).input("dc", sql.Int, to.ToCompanyId)
      .input("sb", sql.Int, srcBank.recordset[0].BankLHeadId).input("db", sql.Int, dstBank.recordset[0].BankLHeadId)
      .input("amt", sql.Decimal(18, 2), amount)
      .input("nar", sql.NVarChar(500), `CRM re-booking credit transfer — held credit from a cancelled booking moved to BKG #${toBookingId}`)
      .input("dtid", sql.Int, dtId || null)
      .input("cb", sql.NVarChar(150), userEmail)
      .query(`
        INSERT INTO dbo.FundTransfer
          (DocNo, TransferDate, TransferType, SourceCompanyId, DestinationCompanyId,
           SourceBankId, DestinationBankId, Amount, Narration, Status, DocTypeId, CreatedBy, Mode)
        OUTPUT INSERTED.FTId
        VALUES
          (@no, @dt, 'Inter', @sc, @dc, @sb, @db, @amt, @nar, 'Draft', @dtid, @cb, 'Transfer')
      `);
    const ftId = ftIns.recordset[0].FTId;
    if (ftDocNo) await backPatchRecordId(pool, sql, ftDocNo, "FundTransfer", ftId);
    try {
      await approvalTransition("fund-transfer", ftId, "Pending", req.user?.email, req.user?.role);
    } catch (subErr) {
      console.warn("[crm-refunds] fund-transfer auto-submit failed (non-fatal):", subErr.message);
    }

    const rtIns = await pool.request()
      .input("hid", sql.Int, heldId).input("fc", sql.Int, held.FromCompanyId)
      .input("tb", sql.Int, toBookingId).input("tc", sql.Int, to.ToCompanyId)
      .input("amt", sql.Decimal(18, 2), amount).input("ft", sql.Int, ftId).input("cb", sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmRebookingTransfer
          (HeldOnAccountId, FromCompanyId, ToBookingId, ToCompanyId, Amount, IsCrossCompany, FundTransferId, Status, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@hid, @fc, @tb, @tc, @amt, 1, @ft, 'PendingTransfer', @cb, SYSDATETIME())
      `);
    await Promise.all([bumpCacheVersion("crm-refunds"), bumpCacheVersion("fund-transfer")]);
    res.status(201).json({
      success: true, id: rtIns.recordset[0].Id, crossCompany: true, fundTransferId: ftId, fundTransferDocNo: ftDocNo,
      message: "Inter-company fund transfer raised — the credit lands on the new booking once Finance approves the transfer.",
    });
  } catch (e) {
    console.error("[crm-refunds] rebooking-transfer error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

module.exports = router;
module.exports.markCrmRefundPaid = markCrmRefundPaid;
module.exports.applyRebookingTransferToBooking = applyRebookingTransferToBooking;
