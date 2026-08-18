const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");

router.use(authMiddleware);
router.use(apiRateLimit);

const PP_SELECT = `
  SELECT p.*, b.BookingNo, b.UnitNo, a.ApplicantName, a.Mobile
  FROM dbo.CrmPrePossession p
  JOIN dbo.CrmBooking b ON b.Id = p.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
`;

router.get("/", requirePageRight("crm-pre-possession", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`${PP_SELECT} ORDER BY p.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-pre-possession] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Workflow guard: pre-possession inspection only makes sense once the sales
// deed is customer-approved (not merely Executed/Registered) — tightened to
// match crmHandover.js's own gate exactly, since a physical pre-possession
// inspection is downstream of both parties agreeing the deed is final, the
// same threshold Handover already enforces.
router.post("/", requirePageRight("crm-pre-possession", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId);

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const deed = await pool.request().input("bid", sql.Int, bookingId)
      .query(`SELECT TOP 1 CustomerApprovalStatus FROM dbo.CrmSalesDeed WHERE BookingId = @bid ORDER BY CreatedAt DESC`);
    if (!deed.recordset.length) {
      return res.status(400).json({ error: "Pre-possession check requires the sales deed to be created first" });
    }
    if (deed.recordset[0].CustomerApprovalStatus !== "Approved") {
      return res.status(400).json({ error: "Pre-possession check requires the customer to approve the sales deed first" });
    }

    const result = await pool.request()
      .input("bid", sql.Int, parseInt(b.BookingId))
      .input("sdt", sql.Date, b.ScheduledInspectionDate || null)
      .input("cb",  sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmPrePossession (BookingId, ScheduledInspectionDate, Status, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@bid, @sdt, 'Pending', @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "Pre-possession check already exists for this booking" });
    console.error("[crm-pre-possession] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", requirePageRight("crm-pre-possession", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);

    // If DuesClearedCheck is being set to true, validate that no outstanding
    // payment demands exist for this booking. Checking here (not at creation)
    // because the pre-possession record is created once and then updated as
    // checks are completed — the toggle must be validated at the moment it's set.
    if (b.DuesClearedCheck === true || b.DuesClearedCheck === 1) {
      const ppRow = await pool.request().input("id", sql.Int, id)
        .query("SELECT BookingId FROM dbo.CrmPrePossession WHERE Id = @id");
      if (ppRow.recordset.length) {
        const bookingId = ppRow.recordset[0].BookingId;
        const demands = await pool.request().input("bid", sql.Int, bookingId)
          .query(`
            SELECT COUNT(*) AS OutstandingCount
            FROM dbo.CrmPaymentDemand
            WHERE BookingId = @bid AND Status NOT IN ('Paid', 'Waived', 'Cancelled')
          `);
        if (demands.recordset[0].OutstandingCount > 0) {
          return res.status(400).json({
            error: `Cannot mark dues cleared — ${demands.recordset[0].OutstandingCount} outstanding payment demand(s) exist for this booking. Ensure all demands are paid or waived first.`,
          });
        }
      }
    }

    const result = await pool.request()
      .input("id",   sql.Int, id)
      .input("dues", sql.Bit, b.DuesClearedCheck ? 1 : (b.DuesClearedCheck === false ? 0 : null))
      .input("doc",  sql.Bit, b.DocumentationCheck ? 1 : (b.DocumentationCheck === false ? 0 : null))
      .input("qc",   sql.Bit, b.QualityInspectionCheck ? 1 : (b.QualityInspectionCheck === false ? 0 : null))
      .input("util", sql.Bit, b.UtilityReadinessCheck ? 1 : (b.UtilityReadinessCheck === false ? 0 : null))
      .input("icd",  sql.Date, b.InspectionCompletedDate || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub",   sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmPrePossession SET
          DuesClearedCheck = ISNULL(@dues, DuesClearedCheck),
          DocumentationCheck = ISNULL(@doc, DocumentationCheck),
          QualityInspectionCheck = ISNULL(@qc, QualityInspectionCheck),
          UtilityReadinessCheck = ISNULL(@util, UtilityReadinessCheck),
          InspectionCompletedDate = ISNULL(@icd, InspectionCompletedDate),
          Status = CASE
            WHEN ISNULL(@dues, DuesClearedCheck) = 1 AND ISNULL(@doc, DocumentationCheck) = 1
             AND ISNULL(@qc, QualityInspectionCheck) = 1 AND ISNULL(@util, UtilityReadinessCheck) = 1
            THEN 'Ready' ELSE Status END,
          Notes = @note, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        OUTPUT INSERTED.Status
        WHERE Id = @id
      `);
    res.json({ success: true, status: result.recordset[0]?.Status });
  } catch (e) {
    console.error("[crm-pre-possession] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
