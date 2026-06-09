// routes/followupPayments.js
const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermission } = require("../middleware/permissions");

const router = express.Router();
router.use(authMiddleware);

const PERMISSION_MODULE = "Followup";
const PERMISSION_SUBMODULE = "FinancePayments";

function parseId(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const VALID_MODES = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "DD"];

function buildReceiptNo(bookingNo, seq) {
  return `REC-${bookingNo}-${String(seq).padStart(3, "0")}`;
}

// ── GET / ─────────────────────────────────────────────────────────────────────
// Returns all BookingPaymentTerms rows that have been Demanded or Paid,
// with their receipt records joined. Supports pagination + filters.
router.get(
  "/",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanView"),
  async (req, res) => {
    try {
      const pool = getPool();
      const page = Math.max(1, parseInt(req.query.page || "1", 10));
      const pageSize = Math.min(
        100,
        Math.max(1, parseInt(req.query.pageSize || "50", 10)),
      );
      const skip = (page - 1) * pageSize;

      const projectId = parseId(req.query.projectId);
      const statusFilter = ["Demanded", "Paid"].includes(req.query.status)
        ? req.query.status
        : null;
      const overdueOnly = req.query.overdue === "1";
      const search = (req.query.search || "").trim();

      const conditions = [
        "fb.IsDeleted = 0",
        "bpt.DemandStatus IN ('Demanded','Paid')",
      ];
      const rData = pool
        .request()
        .input("skip", sql.Int, skip)
        .input("take", sql.Int, pageSize);

      if (projectId) {
        conditions.push("fb.ProjectId = @projectId");
        rData.input("projectId", sql.Int, projectId);
      }
      if (statusFilter) {
        conditions.push("bpt.DemandStatus = @status");
        rData.input("status", sql.NVarChar(20), statusFilter);
      }
      if (overdueOnly) {
        conditions.push("bpt.DemandStatus = 'Demanded' AND bpt.DueDate < CAST(GETDATE() AS DATE)");
      }
      if (search) {
        conditions.push(
          "(fa.ApplicantName LIKE @search OR fb.BookingNo LIKE @search OR bpt.DemandNo LIKE @search OR ptm.TermName LIKE @search)",
        );
        rData.input("search", sql.NVarChar(200), `%${search}%`);
      }

      const WHERE = conditions.join(" AND ");

      const dataResult = await rData.query(`
        SELECT
          bpt.Id              AS TermId,
          bpt.BookingID,
          fb.BookingNo,
          fa.Id               AS ApplicantId,
          fa.ApplicantName,
          fa.PrimaryMobile,
          fb.ProjectId,
          pm.name             AS ProjectName,
          fb.UnitNo,
          fb.TotalValue       AS BookingTotalValue,
          ptm.TermID,
          ptm.TermName,
          bpt.ComputedAmount,
          bpt.DocRef,
          bpt.DueDate,
          bpt.SortOrder,
          bpt.DemandStatus,
          bpt.DemandNo,
          bpt.DemandRaisedOn,
          -- Receipt summary (most recent receipt)
          (SELECT TOP 1 r.ReceiptNo    FROM dbo.FollowupPaymentReceipts r WHERE r.BookingTermId = bpt.Id ORDER BY r.CreatedAt DESC) AS LastReceiptNo,
          (SELECT TOP 1 r.AmountReceived FROM dbo.FollowupPaymentReceipts r WHERE r.BookingTermId = bpt.Id ORDER BY r.CreatedAt DESC) AS LastReceiptAmount,
          (SELECT TOP 1 r.PaymentDate  FROM dbo.FollowupPaymentReceipts r WHERE r.BookingTermId = bpt.Id ORDER BY r.CreatedAt DESC) AS LastPaymentDate,
          (SELECT TOP 1 r.PaymentMode  FROM dbo.FollowupPaymentReceipts r WHERE r.BookingTermId = bpt.Id ORDER BY r.CreatedAt DESC) AS LastPaymentMode,
          (SELECT SUM(r.AmountReceived) FROM dbo.FollowupPaymentReceipts r WHERE r.BookingTermId = bpt.Id) AS TotalReceived,
          (SELECT COUNT(*) FROM dbo.FollowupPaymentReceipts r WHERE r.BookingTermId = bpt.Id) AS ReceiptCount,
          bpt.IsPaid,
          bpt.PaidOn
        FROM dbo.BookingPaymentTerms bpt
        JOIN dbo.FollowupBookings     fb  ON fb.Id      = bpt.BookingID
        JOIN dbo.FollowupApplications fa  ON fa.Id      = fb.ApplicantId
        JOIN dbo.PaymentTermMaster    ptm ON ptm.TermID = bpt.TermID
        LEFT JOIN dbo.enterprise      pm  ON pm.id      = fb.ProjectId
        WHERE ${WHERE}
        ORDER BY bpt.DemandRaisedOn DESC, bpt.Id DESC
        OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY
      `);

      const rCount = pool.request();
      if (projectId) rCount.input("projectId", sql.Int, projectId);
      if (statusFilter) rCount.input("status", sql.NVarChar(20), statusFilter);
      if (search) rCount.input("search", sql.NVarChar(200), `%${search}%`);

      const countResult = await rCount.query(`
        SELECT COUNT(*) AS Total
        FROM dbo.BookingPaymentTerms bpt
        JOIN dbo.FollowupBookings     fb  ON fb.Id      = bpt.BookingID
        JOIN dbo.FollowupApplications fa  ON fa.Id      = fb.ApplicantId
        JOIN dbo.PaymentTermMaster    ptm ON ptm.TermID = bpt.TermID
        LEFT JOIN dbo.enterprise      pm  ON pm.id      = fb.ProjectId
        WHERE ${WHERE}
      `);

      // Summary
      const summaryResult = await pool.request().query(`
        SELECT
          SUM(CASE WHEN bpt.DemandStatus = 'Demanded' THEN bpt.ComputedAmount ELSE 0 END) AS OutstandingAmount,
          SUM(CASE WHEN bpt.DemandStatus = 'Paid'     THEN bpt.ComputedAmount ELSE 0 END) AS CollectedAmount,
          COUNT(CASE WHEN bpt.DemandStatus = 'Demanded' THEN 1 END) AS OutstandingCount,
          COUNT(CASE WHEN bpt.DemandStatus = 'Paid'     THEN 1 END) AS CollectedCount,
          SUM(CASE WHEN bpt.DemandStatus = 'Demanded' AND bpt.DueDate < CAST(GETDATE() AS DATE) THEN bpt.ComputedAmount ELSE 0 END) AS OverdueAmount,
          COUNT(CASE WHEN bpt.DemandStatus = 'Demanded' AND bpt.DueDate < CAST(GETDATE() AS DATE) THEN 1 END) AS OverdueCount
        FROM dbo.BookingPaymentTerms bpt
        JOIN dbo.FollowupBookings fb ON fb.Id = bpt.BookingID
        WHERE fb.IsDeleted = 0 AND bpt.DemandStatus IN ('Demanded','Paid')
      `);

      res.json({
        data: dataResult.recordset,
        pagination: { page, pageSize, total: countResult.recordset[0].Total },
        summary: summaryResult.recordset[0],
      });
    } catch (err) {
      console.error("GET /followup-payments:", err);
      res.status(500).json({ error: "Failed to load payments" });
    }
  },
);

// ── GET /projects ─────────────────────────────────────────────────────────────
router.get(
  "/projects",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanView"),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
        SELECT id AS ProjectId, name AS ProjectName
        FROM dbo.enterprise
        WHERE business_type = 'P'
        ORDER BY name
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("GET /followup-payments/projects:", err);
      res.status(500).json({ error: "Failed to load projects" });
    }
  },
);

// ── GET /receipts/:termId ─────────────────────────────────────────────────────
// All receipts for a specific milestone (for receipt history modal)
router.get(
  "/receipts/:termId",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanView"),
  async (req, res) => {
    try {
      const pool = getPool();
      const termId = parseId(req.params.termId);
      if (!termId) return res.status(400).json({ error: "Invalid term ID" });

      const result = await pool.request().input("TermId", sql.Int, termId)
        .query(`
          SELECT r.Id, r.ReceiptNo, r.AmountReceived, r.PaymentMode,
                 r.PaymentDate, r.ReferenceNo, r.BankName, r.Notes,
                 r.RecordedBy, r.CreatedAt
          FROM dbo.FollowupPaymentReceipts r
          WHERE r.BookingTermId = @TermId
          ORDER BY r.CreatedAt DESC
        `);
      res.json(result.recordset);
    } catch (err) {
      console.error("GET /followup-payments/receipts/:termId:", err);
      res.status(500).json({ error: "Failed to load receipts" });
    }
  },
);

// ── POST /:termId/record ──────────────────────────────────────────────────────
// Record a payment receipt against a demanded milestone.
// Marks the milestone Paid when full amount is received.
router.post(
  "/:termId/record",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanEdit"),
  async (req, res) => {
    try {
      const pool = getPool();
      const termId = parseId(req.params.termId);
      if (!termId) return res.status(400).json({ error: "Invalid term ID" });

      const { amount, paymentMode, paymentDate, referenceNo, bankName, notes } =
        req.body || {};
      const recordedBy = req.user?.name || req.user?.email || null;

      if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
        return res.status(400).json({ error: "Valid amount is required" });
      if (!paymentDate)
        return res.status(400).json({ error: "Payment date is required" });
      if (!VALID_MODES.includes(paymentMode))
        return res.status(400).json({
          error: `Payment mode must be one of: ${VALID_MODES.join(", ")}`,
        });

      // Load the milestone
      const termResult = await pool.request().input("Id", sql.Int, termId)
        .query(`
          SELECT bpt.Id, bpt.BookingID, bpt.ComputedAmount, bpt.DemandStatus,
                 bpt.DemandNo, fb.BookingNo
          FROM dbo.BookingPaymentTerms bpt
          JOIN dbo.FollowupBookings fb ON fb.Id = bpt.BookingID
          WHERE bpt.Id = @Id AND fb.IsDeleted = 0
        `);

      const term = termResult.recordset[0];
      if (!term) return res.status(404).json({ error: "Milestone not found" });
      if (term.DemandStatus === "Pending")
        return res.status(400).json({
          error: "Demand has not been raised yet — raise demand first",
        });
      if (term.DemandStatus === "Paid")
        return res
          .status(400)
          .json({ error: "This milestone is already fully paid" });

      // Count existing receipts to generate sequential receipt number
      const countResult = await pool
        .request()
        .input("BookingTermId", sql.Int, termId)
        .query(
          "SELECT COUNT(*) AS cnt FROM dbo.FollowupPaymentReceipts WHERE BookingTermId = @BookingTermId",
        );
      const seq = (countResult.recordset[0].cnt || 0) + 1;
      const receiptNo = buildReceiptNo(term.BookingNo, seq);

      const parsedAmount = parseFloat(parseFloat(amount).toFixed(2));

      // Insert receipt
      await pool
        .request()
        .input("BookingTermId", sql.Int, termId)
        .input("BookingID", sql.Int, term.BookingID)
        .input("ReceiptNo", sql.NVarChar(60), receiptNo)
        .input("AmountReceived", sql.Decimal(18, 2), parsedAmount)
        .input("PaymentMode", sql.NVarChar(30), paymentMode)
        .input("PaymentDate", sql.Date, paymentDate)
        .input(
          "ReferenceNo",
          sql.NVarChar(100),
          (referenceNo || "").trim() || null,
        )
        .input("BankName", sql.NVarChar(100), (bankName || "").trim() || null)
        .input("Notes", sql.NVarChar(500), (notes || "").trim() || null)
        .input("RecordedBy", sql.NVarChar(200), recordedBy).query(`
          INSERT INTO dbo.FollowupPaymentReceipts
            (BookingTermId, BookingID, ReceiptNo, AmountReceived, PaymentMode,
             PaymentDate, ReferenceNo, BankName, Notes, RecordedBy)
          VALUES
            (@BookingTermId, @BookingID, @ReceiptNo, @AmountReceived, @PaymentMode,
             @PaymentDate, @ReferenceNo, @BankName, @Notes, @RecordedBy)
        `);

      // Check total received vs milestone amount → mark Paid if >= 100%
      const totalResult = await pool
        .request()
        .input("BookingTermId", sql.Int, termId)
        .query(
          "SELECT SUM(AmountReceived) AS Total FROM dbo.FollowupPaymentReceipts WHERE BookingTermId = @BookingTermId",
        );

      const totalReceived = parseFloat(totalResult.recordset[0].Total || 0);
      const isPaid = totalReceived >= parseFloat(term.ComputedAmount);

      if (isPaid) {
        await pool.request().input("Id", sql.Int, termId).query(`
            UPDATE dbo.BookingPaymentTerms
            SET DemandStatus = 'Paid',
                IsPaid       = 1,
                PaidOn       = SYSUTCDATETIME()
            WHERE Id = @Id
          `);
      }

      res.json({
        success: true,
        receiptNo,
        totalReceived,
        milestoneAmount: term.ComputedAmount,
        markedPaid: isPaid,
      });
    } catch (err) {
      console.error("POST /followup-payments/:termId/record:", err);
      res.status(500).json({ error: "Failed to record payment" });
    }
  },
);

// ── DELETE /receipts/:receiptId ───────────────────────────────────────────────
// Remove a receipt (admin correction). Re-evaluates Paid status.
router.delete(
  "/receipts/:receiptId",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanEdit"),
  async (req, res) => {
    try {
      const pool = getPool();
      const receiptId = parseId(req.params.receiptId);
      if (!receiptId)
        return res.status(400).json({ error: "Invalid receipt ID" });

      // Get the receipt so we know which term to re-evaluate
      const receiptResult = await pool
        .request()
        .input("Id", sql.Int, receiptId)
        .query(
          "SELECT BookingTermId FROM dbo.FollowupPaymentReceipts WHERE Id = @Id",
        );

      const receipt = receiptResult.recordset[0];
      if (!receipt) return res.status(404).json({ error: "Receipt not found" });

      const termId = receipt.BookingTermId;

      // Delete the receipt
      await pool
        .request()
        .input("Id", sql.Int, receiptId)
        .query("DELETE FROM dbo.FollowupPaymentReceipts WHERE Id = @Id");

      // Re-evaluate: sum remaining receipts
      const totalResult = await pool
        .request()
        .input("BookingTermId", sql.Int, termId)
        .query(
          "SELECT SUM(AmountReceived) AS Total FROM dbo.FollowupPaymentReceipts WHERE BookingTermId = @BookingTermId",
        );

      const termResult = await pool
        .request()
        .input("Id", sql.Int, termId)
        .query(
          "SELECT ComputedAmount, DemandStatus FROM dbo.BookingPaymentTerms WHERE Id = @Id",
        );

      const term = termResult.recordset[0];
      const totalReceived = parseFloat(totalResult.recordset[0].Total || 0);
      const stillPaid = totalReceived >= parseFloat(term?.ComputedAmount || 0);

      // Revert to Demanded if no longer fully paid
      if (!stillPaid && term?.DemandStatus === "Paid") {
        await pool.request().input("Id", sql.Int, termId).query(`
            UPDATE dbo.BookingPaymentTerms
            SET DemandStatus = 'Demanded',
                IsPaid       = 0,
                PaidOn       = NULL
            WHERE Id = @Id
          `);
      }

      res.json({ success: true, totalReceived, markedPaid: stillPaid });
    } catch (err) {
      console.error("DELETE /followup-payments/receipts/:id:", err);
      res.status(500).json({ error: "Failed to delete receipt" });
    }
  },
);

module.exports = router;