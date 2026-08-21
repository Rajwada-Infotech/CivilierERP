// backend/routes/crmMoneyReceipts.js
//
// Independent Money Receipt lifecycle for the Booking Amount:
// Data Review complete -> Pending downloadable PDF -> Booking L1/L2 approval
// -> Finance approves/bounces the Money Receipt -> ReceivedPayment lands in
// Finance's queue Pending for bank/ledger confirmation.
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

router.use(authMiddleware);
router.use(apiRateLimit);

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

router.get("/", requirePageRight("crm-money-receipts", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { bookingId, status, companyId } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (bookingId) {
      req0.input("bid", sql.Int, parseInt(bookingId, 10));
      conds.push("mr.BookingId = @bid");
    }
    if (status && [CrmStatus.PENDING, CrmStatus.APPROVED, "Bounced"].includes(status)) {
      req0.input("st", sql.NVarChar(20), status);
      conds.push("mr.Status = @st");
    }
    if (companyId) {
      req0.input("companyId", sql.Int, parseInt(companyId, 10));
      conds.push("b.CompanyId = @companyId");
    }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`
      SELECT mr.Id, mr.ReceiptNo, mr.BookingId, mr.Amount, mr.PaymentMode, mr.ChequeNo, mr.ChequeDate,
             mr.TransactionRef, mr.ReceivedDate, mr.CreatedAt, mr.ReceivedPaymentId, mr.Status AS MoneyReceiptStatus,
             mr.BouncedReason, mr.ApprovedAt,
             rp.RPStatus, rp.RPDocNo, rp.RPRejectionNote,
             b.BookingNo, b.ProjectName, b.UnitNo, b.WorkflowStage,
             a.ApplicantName, a.Mobile
      FROM dbo.CrmMoneyReceipt mr
      JOIN dbo.CrmBooking b ON b.Id = mr.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.ReceivedPayment rp ON rp.RPPaymentID = mr.ReceivedPaymentId
      ${where}
      ORDER BY mr.CreatedAt DESC
    `);
    res.json(result.recordset.map((r) => ({
      ...r,
      Status: deriveStatus(r.MoneyReceiptStatus, r.RPStatus),
      BouncedReason: r.BouncedReason || (r.RPStatus === CrmStatus.REJECTED ? r.RPRejectionNote : null),
    })));
  } catch (e) {
    handleError(res, e, "GET /");
  }
});

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

router.get("/:id", requirePageRight("crm-money-receipts", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const result = await pool.request().input("id", sql.Int, id).query(`
      SELECT mr.*, mr.Status AS MoneyReceiptStatus,
             rp.RPStatus, rp.RPDocNo, rp.RPRejectionNote,
             b.BookingNo, b.WorkflowStage, b.ProjectName, b.UnitNo,
             a.ApplicantName
      FROM dbo.CrmMoneyReceipt mr
      JOIN dbo.CrmBooking b ON b.Id = mr.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
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

module.exports = router;
