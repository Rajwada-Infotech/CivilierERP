const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

const cleanStr = (v, len = 500) => {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().slice(0, len);
};

// ─── GET /contractors — auto-populated from Contractor Master, no manual entry ─
// Mirrors workOrder.js's /meta/contractors pattern.
router.get("/contractors", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        LHeadId           AS id,
        LHeadName         AS name,
        LHeadCode         AS code,
        LHeadContactPerson AS contactPerson,
        LHeadPhone        AS phone
      FROM dbo.AccountHeadMaster
      WHERE LHeadType = 'C' AND ISNULL(LHeadStatus, 1) = 1
      ORDER BY LHeadName ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("ContractorAllocation /contractors error:", err);
    res.status(500).json({ error: "Failed to fetch contractors" });
  }
});

const SELECT_COLUMNS = `
  ca.AllocationId           AS id,
  ca.ContractorLHeadId       AS contractorId,
  ahm.LHeadName              AS contractorName,
  ahm.LHeadCode              AS contractorCode,
  ahm.LHeadPhone             AS contractorPhone,
  ca.ProjectId               AS projectId,
  pr.name                    AS projectName,
  ca.ActivityId              AS activityId,
  act.activity_name           AS activityName,
  ca.WorkDescription         AS workDescription,
  ca.AllocationDate          AS allocationDate,
  ca.StartDate               AS startDate,
  ca.ExpectedCompletionDate  AS expectedCompletionDate,
  ca.CurrentStatus           AS currentStatus,
  ca.AllocatedBy             AS allocatedBy,
  ca.SiteLocation            AS siteLocation,
  ca.Remarks                 AS remarks,
  ca.IsAcknowledged          AS isAcknowledged,
  -- "New" badge: unacknowledged AND work hasn't actually started yet.
  CASE WHEN ca.IsAcknowledged = 0 AND ca.StartDate IS NULL THEN 1 ELSE 0 END AS isNew,
  ca.EngineerName            AS engineerName,
  ca.ApprovalDate            AS approvalDate,
  ca.ApprovalStatus          AS approvalStatus,
  ca.ApprovalRemarks         AS approvalRemarks,
  ca.CreatedBy               AS createdBy,
  ca.CreatedAt               AS createdAt,
  ca.UpdatedBy               AS updatedBy,
  ca.UpdatedAt               AS updatedAt
`;

const JOINS = `
  FROM dbo.ContractorAllocation ca
  LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = ca.ContractorLHeadId
  LEFT JOIN dbo.enterprise pr ON pr.id = ca.ProjectId
  LEFT JOIN dbo.ActivityMaster act ON act.id = ca.ActivityId
`;

// ─── GET / — allocation register ──────────────────────────────────────────────
router.get("/", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const contractorId = req.query.contractorId ? parseInt(req.query.contractorId, 10) : null;
    const result = await pool.request()
      .input("projectId", sql.Int, projectId)
      .input("contractorId", sql.Int, contractorId)
      .query(`
        SELECT ${SELECT_COLUMNS}
        ${JOINS}
        WHERE (@projectId IS NULL OR ca.ProjectId = @projectId)
          AND (@contractorId IS NULL OR ca.ContractorLHeadId = @contractorId)
        ORDER BY ca.CreatedAt DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("ContractorAllocation / error:", err);
    res.status(500).json({ error: "Failed to fetch contractor allocations" });
  }
});

// ─── POST / ────────────────────────────────────────────────────────────────────
router.post("/", authMiddleware, requirePageRight("civilworkdpr-contractor-register", "create"), async (req, res) => {
  const {
    contractorId, projectId, activityId, workDescription, allocationDate,
    startDate, expectedCompletionDate, currentStatus, siteLocation, remarks,
  } = req.body;
  const actor = req.user?.email || req.user?.name || "system";

  if (!contractorId) return res.status(400).json({ error: "Contractor is required" });
  if (!activityId) return res.status(400).json({ error: "Activity is required" });

  try {
    const pool = getPool();
    const result = await pool.request()
      .input("contractorId", sql.Int, contractorId)
      .input("projectId", sql.Int, projectId ?? null)
      .input("activityId", sql.Int, activityId)
      .input("workDescription", sql.NVarChar, cleanStr(workDescription))
      .input("allocationDate", sql.Date, allocationDate || null)
      .input("startDate", sql.Date, startDate || null)
      .input("expectedCompletionDate", sql.Date, expectedCompletionDate || null)
      .input("currentStatus", sql.NVarChar, cleanStr(currentStatus, 50) || "Allocated")
      .input("allocatedBy", sql.NVarChar, actor)
      .input("siteLocation", sql.NVarChar, cleanStr(siteLocation, 255))
      .input("remarks", sql.NVarChar, cleanStr(remarks))
      .query(`
        INSERT INTO dbo.ContractorAllocation
          (ContractorLHeadId, ProjectId, ActivityId, WorkDescription, AllocationDate,
           StartDate, ExpectedCompletionDate, CurrentStatus, AllocatedBy, SiteLocation,
           Remarks, IsAcknowledged, ApprovalStatus, CreatedBy, CreatedAt)
        OUTPUT INSERTED.AllocationId AS id
        VALUES
          (@contractorId, @projectId, @activityId, @workDescription, @allocationDate,
           @startDate, @expectedCompletionDate, @currentStatus, @allocatedBy, @siteLocation,
           @remarks, 0, 'Pending', @allocatedBy, GETDATE())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].id });
  } catch (err) {
    console.error("ContractorAllocation POST error:", err);
    res.status(500).json({ error: "Failed to create allocation" });
  }
});

// ─── PUT /:id ──────────────────────────────────────────────────────────────────
router.put("/:id", authMiddleware, requirePageRight("civilworkdpr-contractor-register", "edit"), async (req, res) => {
  const allocId = parseInt(req.params.id, 10);
  if (isNaN(allocId)) return res.status(400).json({ error: "Invalid ID" });

  const {
    contractorId, projectId, activityId, workDescription, allocationDate,
    startDate, expectedCompletionDate, currentStatus, siteLocation, remarks,
  } = req.body;
  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = getPool();
    const existing = await pool.request()
      .input("id", sql.Int, allocId)
      .query(`SELECT AllocationId FROM dbo.ContractorAllocation WHERE AllocationId = @id`);
    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: "Allocation not found" });
    }

    await pool.request()
      .input("id", sql.Int, allocId)
      .input("contractorId", sql.Int, contractorId)
      .input("projectId", sql.Int, projectId ?? null)
      .input("activityId", sql.Int, activityId)
      .input("workDescription", sql.NVarChar, cleanStr(workDescription))
      .input("allocationDate", sql.Date, allocationDate || null)
      .input("startDate", sql.Date, startDate || null)
      .input("expectedCompletionDate", sql.Date, expectedCompletionDate || null)
      .input("currentStatus", sql.NVarChar, cleanStr(currentStatus, 50))
      .input("siteLocation", sql.NVarChar, cleanStr(siteLocation, 255))
      .input("remarks", sql.NVarChar, cleanStr(remarks))
      .input("updatedBy", sql.NVarChar, actor)
      .query(`
        UPDATE dbo.ContractorAllocation SET
          ContractorLHeadId = @contractorId, ProjectId = @projectId, ActivityId = @activityId,
          WorkDescription = @workDescription, AllocationDate = @allocationDate,
          StartDate = @startDate, ExpectedCompletionDate = @expectedCompletionDate,
          CurrentStatus = @currentStatus, SiteLocation = @siteLocation, Remarks = @remarks,
          -- Setting an actual start date acknowledges the allocation implicitly.
          IsAcknowledged = CASE WHEN @startDate IS NOT NULL THEN 1 ELSE IsAcknowledged END,
          UpdatedBy = @updatedBy, UpdatedAt = GETDATE()
        WHERE AllocationId = @id
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("ContractorAllocation PUT error:", err);
    res.status(500).json({ error: "Failed to update allocation" });
  }
});

// ─── PUT /:id/acknowledge — clears the "New" badge ───────────────────────────
router.put("/:id/acknowledge", authMiddleware, requirePageRight("civilworkdpr-contractor-register", "edit"), async (req, res) => {
  const allocId = parseInt(req.params.id, 10);
  if (isNaN(allocId)) return res.status(400).json({ error: "Invalid ID" });

  try {
    const pool = getPool();
    const result = await pool.request()
      .input("id", sql.Int, allocId)
      .query(`UPDATE dbo.ContractorAllocation SET IsAcknowledged = 1 WHERE AllocationId = @id`);
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Allocation not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("ContractorAllocation /acknowledge error:", err);
    res.status(500).json({ error: "Failed to acknowledge allocation" });
  }
});

// ─── PUT /:id/approve — Engineer Approval ────────────────────────────────────
// Plain dedicated-field update, not the generic multi-level approval engine —
// this needs a manually chosen Engineer Name, not just whoever clicks Approve.
router.put("/:id/approve", authMiddleware, requirePageRight("civilworkdpr-contractor-register", "edit"), async (req, res) => {
  const allocId = parseInt(req.params.id, 10);
  if (isNaN(allocId)) return res.status(400).json({ error: "Invalid ID" });

  const { engineerName, approvalStatus, approvalRemarks } = req.body;
  if (!engineerName) return res.status(400).json({ error: "Engineer Name is required" });
  if (!["Approved", "Rejected"].includes(approvalStatus)) {
    return res.status(400).json({ error: "approvalStatus must be Approved or Rejected" });
  }

  try {
    const pool = getPool();
    const result = await pool.request()
      .input("id", sql.Int, allocId)
      .input("engineerName", sql.NVarChar, cleanStr(engineerName, 150))
      .input("approvalStatus", sql.NVarChar, approvalStatus)
      .input("approvalRemarks", sql.NVarChar, cleanStr(approvalRemarks))
      .query(`
        UPDATE dbo.ContractorAllocation SET
          EngineerName = @engineerName,
          ApprovalDate = GETDATE(),
          ApprovalStatus = @approvalStatus,
          ApprovalRemarks = @approvalRemarks
        WHERE AllocationId = @id
      `);
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Allocation not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("ContractorAllocation /approve error:", err);
    res.status(500).json({ error: "Failed to record approval" });
  }
});

// ─── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", authMiddleware, requirePageRight("civilworkdpr-contractor-register", "delete"), async (req, res) => {
  const allocId = parseInt(req.params.id, 10);
  if (isNaN(allocId)) return res.status(400).json({ error: "Invalid ID" });

  try {
    const pool = getPool();
    const result = await pool.request()
      .input("id", sql.Int, allocId)
      .query(`DELETE FROM dbo.ContractorAllocation WHERE AllocationId = @id`);
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Allocation not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("ContractorAllocation DELETE error:", err);
    // 547 = FK constraint violation in SQL Server
    if (err.number === 547) {
      return res.status(409).json({ error: "Cannot delete — this allocation has linked daily labour entries." });
    }
    res.status(500).json({ error: "Failed to delete allocation" });
  }
});

module.exports = router;
