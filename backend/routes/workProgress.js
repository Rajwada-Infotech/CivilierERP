const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

// dbo.WorkProgress — progress entries logged against a Contractor
// Allocation (Project + Activity + Contractor, see dbo.ContractorAllocation).
// Every entry starts as ReviewStatus = 'Pending' until an Engineer/Manager
// approves or rejects it via PUT /:id/review.

const cleanStr = (v, len = 500) => {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().slice(0, len);
};

const SELECT_COLUMNS = `
  wp.WorkProgressId      AS id,
  wp.AllocationId        AS allocationId,
  ca.ProjectId            AS projectId,
  pr.name                 AS projectName,
  ca.ActivityId           AS activityId,
  act.activity_name       AS activityName,
  ca.ContractorLHeadId    AS contractorId,
  ahm.LHeadName           AS contractorName,
  wp.WorkDescription      AS workDescription,
  wp.QuantityPlanned      AS quantityPlanned,
  wp.QuantityCompleted    AS quantityCompleted,
  -- Remaining qty and % progress are derived, not stored — avoids drift if
  -- either side is edited independently.
  ISNULL(wp.QuantityPlanned, 0) - ISNULL(wp.QuantityCompleted, 0) AS remainingQuantity,
  CASE WHEN ISNULL(wp.QuantityPlanned, 0) > 0
       THEN ROUND((ISNULL(wp.QuantityCompleted, 0) / wp.QuantityPlanned) * 100, 2)
       ELSE 0 END AS percentageProgress,
  wp.Unit                 AS unit,
  wp.PlannedStartDate     AS plannedStartDate,
  wp.PlannedEndDate       AS plannedEndDate,
  wp.ActualStartDate      AS actualStartDate,
  wp.ActualEndDate        AS actualEndDate,
  wp.CurrentStatus        AS currentStatus,
  wp.Remarks              AS remarks,
  wp.ReviewStatus         AS reviewStatus,
  wp.ReviewedBy           AS reviewedBy,
  wp.ReviewedAt           AS reviewedAt,
  wp.ReviewRemarks        AS reviewRemarks,
  wp.CreatedBy            AS createdBy,
  wp.CreatedAt            AS createdAt,
  wp.UpdatedBy            AS updatedBy,
  wp.UpdatedAt            AS updatedAt
`;

const JOINS = `
  FROM dbo.WorkProgress wp
  JOIN dbo.ContractorAllocation ca ON ca.AllocationId = wp.AllocationId
  LEFT JOIN dbo.enterprise pr ON pr.id = ca.ProjectId
  LEFT JOIN dbo.ActivityMaster act ON act.id = ca.ActivityId
  LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = ca.ContractorLHeadId
`;

// ─── GET / — progress entries, optionally filtered by project/allocation ────
router.get("/", authMiddleware, requirePageRight("civilworkdpr-dependency", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const allocationId = req.query.allocationId ? parseInt(req.query.allocationId, 10) : null;

    const result = await pool.request()
      .input("projectId", sql.Int, projectId)
      .input("allocationId", sql.Int, allocationId)
      .query(`
        SELECT ${SELECT_COLUMNS}
        ${JOINS}
        WHERE (@projectId IS NULL OR ca.ProjectId = @projectId)
          AND (@allocationId IS NULL OR wp.AllocationId = @allocationId)
        ORDER BY wp.CreatedAt DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("WorkProgress / error:", err);
    res.status(500).json({ error: "Failed to fetch work progress entries" });
  }
});

// ─── POST / — log a new progress update (always starts Pending review) ──────
router.post("/", authMiddleware, requirePageRight("civilworkdpr-dependency", "create"), async (req, res) => {
  const {
    allocationId, workDescription, quantityPlanned, quantityCompleted, unit,
    plannedStartDate, plannedEndDate, actualStartDate, actualEndDate,
    currentStatus, remarks,
  } = req.body;
  const actor = req.user?.email || req.user?.name || "system";

  if (!allocationId) return res.status(400).json({ error: "Allocation is required" });

  try {
    const pool = getPool();
    const result = await pool.request()
      .input("allocationId", sql.Int, allocationId)
      .input("workDescription", sql.NVarChar, cleanStr(workDescription))
      .input("quantityPlanned", sql.Decimal(18, 2), quantityPlanned ?? null)
      .input("quantityCompleted", sql.Decimal(18, 2), quantityCompleted ?? null)
      .input("unit", sql.NVarChar, cleanStr(unit, 50))
      .input("plannedStartDate", sql.Date, plannedStartDate || null)
      .input("plannedEndDate", sql.Date, plannedEndDate || null)
      .input("actualStartDate", sql.Date, actualStartDate || null)
      .input("actualEndDate", sql.Date, actualEndDate || null)
      .input("currentStatus", sql.NVarChar, cleanStr(currentStatus, 50))
      .input("remarks", sql.NVarChar, cleanStr(remarks))
      .input("createdBy", sql.NVarChar, actor)
      .query(`
        INSERT INTO dbo.WorkProgress
          (AllocationId, WorkDescription, QuantityPlanned, QuantityCompleted, Unit,
           PlannedStartDate, PlannedEndDate, ActualStartDate, ActualEndDate,
           CurrentStatus, Remarks, ReviewStatus, CreatedBy, CreatedAt)
        OUTPUT INSERTED.WorkProgressId AS id
        VALUES
          (@allocationId, @workDescription, @quantityPlanned, @quantityCompleted, @unit,
           @plannedStartDate, @plannedEndDate, @actualStartDate, @actualEndDate,
           @currentStatus, @remarks, 'Pending', @createdBy, GETDATE())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].id });
  } catch (err) {
    console.error("WorkProgress POST error:", err);
    res.status(500).json({ error: "Failed to log progress update" });
  }
});

// ─── PUT /:id ──────────────────────────────────────────────────────────────────
router.put("/:id", authMiddleware, requirePageRight("civilworkdpr-dependency", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

  const {
    workDescription, quantityPlanned, quantityCompleted, unit,
    plannedStartDate, plannedEndDate, actualStartDate, actualEndDate,
    currentStatus, remarks,
  } = req.body;
  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = getPool();
    const existing = await pool.request()
      .input("id", sql.Int, id)
      .query(`SELECT WorkProgressId FROM dbo.WorkProgress WHERE WorkProgressId = @id`);
    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: "Progress entry not found" });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("workDescription", sql.NVarChar, cleanStr(workDescription))
      .input("quantityPlanned", sql.Decimal(18, 2), quantityPlanned ?? null)
      .input("quantityCompleted", sql.Decimal(18, 2), quantityCompleted ?? null)
      .input("unit", sql.NVarChar, cleanStr(unit, 50))
      .input("plannedStartDate", sql.Date, plannedStartDate || null)
      .input("plannedEndDate", sql.Date, plannedEndDate || null)
      .input("actualStartDate", sql.Date, actualStartDate || null)
      .input("actualEndDate", sql.Date, actualEndDate || null)
      .input("currentStatus", sql.NVarChar, cleanStr(currentStatus, 50))
      .input("remarks", sql.NVarChar, cleanStr(remarks))
      .input("updatedBy", sql.NVarChar, actor)
      .query(`
        UPDATE dbo.WorkProgress SET
          WorkDescription = @workDescription, QuantityPlanned = @quantityPlanned,
          QuantityCompleted = @quantityCompleted, Unit = @unit,
          PlannedStartDate = @plannedStartDate, PlannedEndDate = @plannedEndDate,
          ActualStartDate = @actualStartDate, ActualEndDate = @actualEndDate,
          CurrentStatus = @currentStatus, Remarks = @remarks,
          -- Editing a progress entry re-opens it for review.
          ReviewStatus = 'Pending', ReviewedBy = NULL, ReviewedAt = NULL, ReviewRemarks = NULL,
          UpdatedBy = @updatedBy, UpdatedAt = GETDATE()
        WHERE WorkProgressId = @id
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("WorkProgress PUT error:", err);
    res.status(500).json({ error: "Failed to update progress entry" });
  }
});

// ─── PUT /:id/review — Engineer/Manager review ───────────────────────────────
router.put("/:id/review", authMiddleware, requirePageRight("civilworkdpr-dependency", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

  const { reviewStatus, reviewRemarks } = req.body;
  const reviewedBy = req.user?.name || req.user?.email || "system";
  if (!["Approved", "Rejected"].includes(reviewStatus)) {
    return res.status(400).json({ error: "reviewStatus must be Approved or Rejected" });
  }

  try {
    const pool = getPool();
    const result = await pool.request()
      .input("id", sql.Int, id)
      .input("reviewedBy", sql.NVarChar, cleanStr(reviewedBy, 150))
      .input("reviewStatus", sql.NVarChar, reviewStatus)
      .input("reviewRemarks", sql.NVarChar, cleanStr(reviewRemarks))
      .query(`
        UPDATE dbo.WorkProgress SET
          ReviewedBy = @reviewedBy, ReviewedAt = GETDATE(),
          ReviewStatus = @reviewStatus, ReviewRemarks = @reviewRemarks
        WHERE WorkProgressId = @id
      `);
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Progress entry not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("WorkProgress /review error:", err);
    res.status(500).json({ error: "Failed to record review" });
  }
});

// ─── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", authMiddleware, requirePageRight("civilworkdpr-dependency", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

  try {
    const pool = getPool();
    const result = await pool.request()
      .input("id", sql.Int, id)
      .query(`DELETE FROM dbo.WorkProgress WHERE WorkProgressId = @id`);
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Progress entry not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("WorkProgress DELETE error:", err);
    res.status(500).json({ error: "Failed to delete progress entry" });
  }
});

module.exports = router;
