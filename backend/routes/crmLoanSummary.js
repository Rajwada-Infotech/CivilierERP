const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { CrmStatus } = require("../constants/crmStatuses");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");

router.use(authMiddleware);
router.use(apiRateLimit);

// GET / -- flat join of all active bookings with their CrmLoanDetail row
// (nullable). A dedicated route file avoids the /:id collision in crmBookings.js.
// Mounted at /api/crm/loan-summary in server.js.
router.get("/", requirePageRight("crm-loan-details", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const cancelled = CrmStatus.CANCELLED;
    const rejected  = CrmStatus.REJECTED;
    const sql2 = [
      "SELECT",
      "  b.Id AS BookingId, b.BookingNo, b.Status AS BookingStatus,",
      "  COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo,",
      "  a.ApplicantName, a.Mobile,",
      "  ISNULL(b.GrandTotal, b.TotalValue) AS TotalValue,",
      "  ld.Id AS LoanId,",
      "  ld.BankName, ld.BranchName, ld.LoanAmount,",
      "  ISNULL(ld.SanctionStatus, 'NotApplied') AS SanctionStatus,",
      "  ld.SanctionDate, ld.LoanAccountNo,",
      "  ld.RmName, ld.RmContact, ld.Notes,",
      "  ld.CreatedAt AS LoanCreatedAt, ld.UpdatedAt AS LoanUpdatedAt,",
      "  ISNULL((",
      "    SELECT SUM(r.Amount) FROM dbo.CrmPaymentReceipt r",
      "    JOIN dbo.CrmPaymentMilestone m ON m.Id = r.MilestoneId",
      "    WHERE m.BookingId = b.Id AND r.PaymentMode = 'Home Loan'",
      "  ), 0) + ISNULL((",
      "    SELECT SUM(o.Amount) FROM dbo.CrmOnAccountPayment o",
      "    WHERE o.BookingId = b.Id AND o.PaymentMode = 'Home Loan'",
      "  ), 0) AS DisbursedAmount",
      "FROM dbo.CrmBooking b",
      "JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId",
      "LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id",
      "LEFT JOIN dbo.CrmLoanDetail ld ON ld.BookingId = b.Id",
      "WHERE b.IsActive = 1",
      "  AND b.Status NOT IN ('" + cancelled + "', '" + rejected + "')",
      "ORDER BY b.BookingNo",
    ].join(" ");

    const result = await pool.request().query(sql2);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-loan-summary] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
