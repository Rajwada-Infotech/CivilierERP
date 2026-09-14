// backend/routes/crmMoneyReceipts.js
//
// Independent Money Receipt lifecycle for the Booking Amount:
// Data Review complete -> Pending downloadable PDF -> Booking L1/L2 approval
// -> Finance approves/bounces the Money Receipt -> ReceivedPayment lands in
// Finance's queue Pending for bank/ledger confirmation.
//
// v2 (scale rebuild): the only functional changes are (1) the main list can
// no longer return an unbounded result set — every non-booking-scoped call
// is paginated now, and (2) list/count filters are built by one shared
// function so they can never drift apart. Everything else — validation,
// status transitions, approver checks — is unchanged from the previous
// version; only the file's organization changed.
const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { getMoneyReceiptPdfBuffer, deriveStatus } = require("../services/moneyReceiptPdf");
const {
  MoneyReceiptError,
  isMoneyReceiptApprover,
  createMoneyReceiptForBooking,
  updateMoneyReceipt,
  resubmitMoneyReceipt,
  bounceMoneyReceipt,
  approveMoneyReceipt,
} = require("../services/crmMoneyReceiptWorkflow");
const { applyPagination } = require("../services/crmListPagination");

router.use(authMiddleware);
router.use(apiRateLimit);

// ── Shared helpers ─────────────────────────────────────────────────────────

const RECEIPT_STATUSES = [CrmStatus.PENDING, CrmStatus.APPROVED, "Bounced"];

function actorEmail(req) {
  return req.user?.email || req.user?.name || null;
}

function handleError(res, e, context) {
  if (e instanceof MoneyReceiptError || e.status) {
    return res.status(e.status || 400).json({ error: e.message });
  }
  console.error(`[crm-money-receipts] ${context} error:`, e.message);
  return res.status(500).json({ error: e.message });
}

function requireMoneyReceiptApprover(req, res) {
  if (isMoneyReceiptApprover(req.user?.role)) return true;
  res.status(403).json({ error: "Only Finance / Account's Head approvers can perform this action" });
  return false;
}

// Builds the WHERE clause AND binds params onto whichever `request` object
// it's given. Used identically by the data query and the count query below
// so the two can never fall out of sync the way hand-duplicated filter
// blocks tend to (that was the actual bug risk in the previous version —
// nothing here changes what filters exist, only that there's one definition
// of them instead of two).
function applyReceiptFilters(request, query) {
  const { bookingId, status, companyId, projectId, blockId, search, fromDate, toDate } = query;
  const conds = [];

  if (bookingId) {
    request.input("bid", sql.Int, parseInt(bookingId, 10));
    conds.push("mr.BookingId = @bid");
  }
  if (status && RECEIPT_STATUSES.includes(status)) {
    request.input("st", sql.NVarChar(20), status);
    conds.push("mr.Status = @st");
  }
  if (fromDate) {
    request.input("fromDate", sql.Date, fromDate);
    conds.push("mr.ReceivedDate >= @fromDate");
  }
  if (toDate) {
    request.input("toDate", sql.Date, toDate);
    conds.push("mr.ReceivedDate <= @toDate");
  }
  if (companyId) {
    request.input("companyId", sql.Int, parseInt(companyId, 10));
    conds.push("b.CompanyId = @companyId");
  }
  if (projectId) {
    request.input("projectId", sql.Int, parseInt(projectId, 10));
    conds.push("b.ProjectId = @projectId");
  }
  if (blockId) {
    request.input("blockId", sql.Int, parseInt(blockId, 10));
    conds.push("um.BlockId = @blockId");
  }
  if (search) {
    // NOTE (scale): a leading-wildcard LIKE can't use a standard b-tree
    // index and will full-scan CrmMoneyReceipt/CrmApplication once the
    // table is large. Left as-is functionally, but see the indexes script
    // for a full-text index on (ApplicantName, Mobile, BookingNo, ReceiptNo)
    // if search latency becomes a problem at real customer volume.
    request.input("search", sql.NVarChar(200), `%${search}%`);
    conds.push("(a.ApplicantName LIKE @search OR a.Mobile LIKE @search OR b.BookingNo LIKE @search OR mr.ReceiptNo LIKE @search)");
  }
  return conds.length ? `WHERE ${conds.join(" AND ")}` : "";
}

const BASE_SELECT = `
  SELECT mr.Id, mr.ReceiptNo, mr.BookingId, mr.Amount, mr.BaseAmount, mr.GSTAmount, mr.PaymentMode, mr.ChequeNo, mr.ChequeDate,
         mr.TransactionRef, mr.ReceivedDate, mr.CreatedAt, mr.ReceivedPaymentId, mr.Status AS MoneyReceiptStatus,
         mr.BouncedReason, mr.ApprovedAt,
         rp.RPStatus, rp.RPDocNo, rp.RPRejectionNote,
         b.BookingNo, COALESCE(proj.name, b.ProjectName) AS ProjectName,
         COALESCE(um.UnitName, b.UnitNo) AS UnitNo, b.WorkflowStage,
         a.ApplicantName, a.Mobile
  FROM dbo.CrmMoneyReceipt mr
  JOIN dbo.CrmBooking b ON b.Id = mr.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
  LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
  LEFT JOIN dbo.ReceivedPayment rp ON rp.RPPaymentID = mr.ReceivedPaymentId
`;

const COUNT_SELECT = `
  SELECT COUNT(*) AS total
  FROM dbo.CrmMoneyReceipt mr
  JOIN dbo.CrmBooking b ON b.Id = mr.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
`;

function shapeReceipts(rows) {
  return rows.map((r) => ({
    ...r,
    Status: deriveStatus(r.MoneyReceiptStatus, r.RPStatus),
    BouncedReason: r.BouncedReason || (r.RPStatus === CrmStatus.REJECTED ? r.RPRejectionNote : null),
  }));
}

// Runs N async jobs with at most `limit` in flight at once — used by
// sweep-pending so a large backlog processes in parallel batches instead of
// one DB round trip at a time, without unbounded concurrency hammering the
// pool.
async function withConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

// ── List / read ─────────────────────────────────────────────────────────────

router.get("/", requirePageRight("crm-money-receipts", "view"), async (req, res) => {
  try {
    const pool = getPool();

    // Booking-scoped calls (deep-linked from a Booking's detail view) stay
    // unpaginated on purpose — "receipts for this one booking" is bounded
    // by definition, it's not a page of the main list.
    if (req.query.bookingId && !req.query.page) {
      const dataReq = pool.request();
      const where = applyReceiptFilters(dataReq, req.query);
      const result = await dataReq.query(`${BASE_SELECT} ${where} ORDER BY mr.CreatedAt DESC`);
      return res.json(shapeReceipts(result.recordset));
    }

    // Every other list is always paginated now — at real CRM volume, an
    // unbounded SELECT * across CrmMoneyReceipt/CrmBooking/CrmApplication
    // is the single easiest way to take this endpoint (and the pool) down,
    // so the old "no ?page -> return everything" branch is gone.
    const { page, pageSize, offset } = applyPagination(req);

    const dataReq = pool.request();
    const where = applyReceiptFilters(dataReq, req.query);
    dataReq.input("offset", sql.Int, offset);
    dataReq.input("pageSize", sql.Int, pageSize);

    const countReq = pool.request();
    applyReceiptFilters(countReq, req.query); // same filter logic, fresh param bindings

    const [result, countResult] = await Promise.all([
      dataReq.query(`${BASE_SELECT} ${where} ORDER BY mr.CreatedAt DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`),
      countReq.query(`${COUNT_SELECT} ${where}`),
    ]);

    res.json({ rows: shapeReceipts(result.recordset), total: countResult.recordset[0].total, page, pageSize });
  } catch (e) {
    handleError(res, e, "GET /");
  }
});

router.get("/:id", requirePageRight("crm-money-receipts", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const result = await pool.request().input("id", sql.Int, id).query(`
      SELECT mr.*, mr.Status AS MoneyReceiptStatus,
             rp.RPStatus, rp.RPDocNo, rp.RPRejectionNote,
             b.BookingNo, b.WorkflowStage,
             COALESCE(proj.name, b.ProjectName) AS ProjectName,
             COALESCE(um.UnitName, b.UnitNo) AS UnitNo,
             a.ApplicantName
      FROM dbo.CrmMoneyReceipt mr
      JOIN dbo.CrmBooking b ON b.Id = mr.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
      LEFT JOIN dbo.ReceivedPayment rp ON rp.RPPaymentID = mr.ReceivedPaymentId
      WHERE mr.Id = @id
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Money receipt not found" });
    const row = result.recordset[0];
    row.Status = deriveStatus(row.MoneyReceiptStatus, row.RPStatus);
    row.BouncedReason = row.BouncedReason || (row.RPStatus === CrmStatus.REJECTED ? row.RPRejectionNote : null);
    res.json(row);
  } catch (e) {
    handleError(res, e, "GET /:id");
  }
});

router.get("/:id/pdf", requirePageRight("crm-money-receipts", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const row = await pool.request().input("id", sql.Int, id).query("SELECT ReceiptNo FROM dbo.CrmMoneyReceipt WHERE Id = @id");
    if (!row.recordset.length) return res.status(404).json({ error: "Money receipt not found" });
    const buffer = await getMoneyReceiptPdfBuffer(pool, id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${row.recordset[0].ReceiptNo}.pdf"`);
    res.send(buffer);
  } catch (e) {
    handleError(res, e, "GET /:id/pdf");
  }
});

// ── Create / edit ───────────────────────────────────────────────────────────

router.post("/", requirePageRight("crm-money-receipts", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.body?.BookingId || req.body?.bookingId, 10);
    if (!bookingId) return res.status(400).json({ error: "BookingId is required" });
    const row = await createMoneyReceiptForBooking(pool, bookingId, req.body || {}, actorId(req), { skipIfExists: true });
    res.status(row.existing ? 200 : 201).json({ success: true, ...row });
  } catch (e) {
    handleError(res, e, "POST /");
  }
});

router.put("/:id", requirePageRight("crm-money-receipts", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    await updateMoneyReceipt(pool, id, req.body || {}, actorId(req));
    res.json({ success: true });
  } catch (e) {
    handleError(res, e, "PUT /:id");
  }
});

// ── Workflow transitions (Pending <-> Bounced -> Approved) ─────────────────

router.put("/:id/resubmit", requirePageRight("crm-money-receipts", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const row = await resubmitMoneyReceipt(pool, id);
    res.json({ success: true, ...row });
  } catch (e) {
    handleError(res, e, "PUT /:id/resubmit");
  }
});

router.put("/:id/bounce", requirePageRight("crm-money-receipts", "edit"), async (req, res) => {
  try {
    if (!requireMoneyReceiptApprover(req, res)) return;
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const row = await bounceMoneyReceipt(pool, id, req.body?.reason || req.body?.Reason || req.body?.remarks, actorId(req));
    res.json({ success: true, ...row });
  } catch (e) {
    handleError(res, e, "PUT /:id/bounce");
  }
});

// Kept as a distinct route from /bounce (same underlying transition) because
// the two are wired to different UI actions/permissions upstream — merging
// them would be a routing change, not a restructure, so left alone.
router.put("/:id/reject", requirePageRight("crm-money-receipts", "edit"), async (req, res) => {
  try {
    if (!requireMoneyReceiptApprover(req, res)) return;
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const reason = req.body?.reason || req.body?.Reason || req.body?.note || req.body?.remarks;
    const row = await bounceMoneyReceipt(pool, id, reason, actorId(req));
    res.json({ success: true, ...row });
  } catch (e) {
    handleError(res, e, "PUT /:id/reject");
  }
});

router.put("/:id/approve", requirePageRight("crm-money-receipts", "edit"), async (req, res) => {
  try {
    if (!requireMoneyReceiptApprover(req, res)) return;
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const result = await approveMoneyReceipt(pool, id, actorId(req), actorEmail(req));
    res.json(result);
  } catch (e) {
    handleError(res, e, "PUT /:id/approve");
  }
});

// ── Admin backfill ───────────────────────────────────────────────────────────

const SWEEP_CONCURRENCY = 5;

// POST /sweep-pending — admin backfill for already-confirmed bookings whose
// MRs are stuck in Pending with ReceivedPaymentId = NULL (created before the
// on-confirm auto-sweep was wired up). Safe to run multiple times —
// approveMoneyReceipt guards against double-processing with its own Status
// and ReceivedPaymentId checks.
//
// Change from before: processes up to SWEEP_CONCURRENCY receipts in
// parallel instead of strictly one at a time. Each approveMoneyReceipt call
// takes its own row-level transaction lock on a *different* MoneyReceipt
// row, so concurrent execution across rows is safe; this just stops a
// large backlog from being gated by round-trip latency one row at a time.
router.post("/sweep-pending", requirePageRight("crm-money-receipts", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    if (!isMoneyReceiptApprover(req.user?.roleName)) {
      return res.status(403).json({ error: "Accounts Head or Admin access required" });
    }
    const stuckMrs = await pool.request().query(`
      SELECT mr.Id
      FROM dbo.CrmMoneyReceipt mr
      JOIN dbo.CrmBooking b ON b.Id = mr.BookingId
      WHERE mr.Status = 'Pending' AND mr.ReceivedPaymentId IS NULL
        AND b.WorkflowStage = 'Confirmed' AND b.IsActive = 1
    `);

    const outcomes = await withConcurrency(stuckMrs.recordset, SWEEP_CONCURRENCY, async (row) => {
      try {
        await approveMoneyReceipt(pool, row.Id, actorId(req), actorEmail(req));
        return { ok: true };
      } catch (e) {
        return { ok: false, id: row.Id, error: e.message };
      }
    });

    const errors = outcomes.filter((o) => !o.ok).map(({ id, error }) => ({ id, error }));
    res.json({
      success: true,
      total: stuckMrs.recordset.length,
      processed: outcomes.length - errors.length,
      failed: errors.length,
      errors,
    });
  } catch (e) {
    handleError(res, e, "POST /sweep-pending");
  }
});

module.exports = router;