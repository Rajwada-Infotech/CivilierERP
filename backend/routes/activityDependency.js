const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

const cleanStr = (v, len = 500) => {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().slice(0, len);
};

const SELECT_COLUMNS = `
  d.DependencyId        AS id,
  d.ActivityId           AS activityId,
  act.activity_name       AS activityName,
  d.ParentActivityId     AS parentActivityId,
  parentAct.activity_name AS parentActivityName,
  d.DependentActivityId  AS dependentActivityId,
  depAct.activity_name    AS dependentActivityName,
  d.WorkDescription      AS workDescription,
  d.QuantityPlanned      AS quantityPlanned,
  d.QuantityCompleted    AS quantityCompleted,
  -- Remaining qty and % progress are derived, not stored — avoids drift if
  -- either side is edited independently.
  ISNULL(d.QuantityPlanned, 0) - ISNULL(d.QuantityCompleted, 0) AS remainingQuantity,
  CASE WHEN ISNULL(d.QuantityPlanned, 0) > 0
       THEN ROUND((ISNULL(d.QuantityCompleted, 0) / d.QuantityPlanned) * 100, 2)
       ELSE 0 END AS percentageProgress,
  d.Unit                 AS unit,
  d.PlannedStartDate     AS plannedStartDate,
  d.PlannedEndDate       AS plannedEndDate,
  d.ActualStartDate      AS actualStartDate,
  d.ActualEndDate        AS actualEndDate,
  d.CurrentStatus        AS currentStatus,
  d.Remarks              AS remarks,
  d.ProjectId            AS projectId,
  d.CreatedBy            AS createdBy,
  d.CreatedAt             AS createdAt,
  d.UpdatedBy            AS updatedBy,
  d.UpdatedAt            AS updatedAt
`;

const JOINS = `
  FROM dbo.ActivityDependency d
  LEFT JOIN dbo.ActivityMaster act ON act.id = d.ActivityId
  LEFT JOIN dbo.ActivityMaster parentAct ON parentAct.id = d.ParentActivityId
  LEFT JOIN dbo.ActivityMaster depAct ON depAct.id = d.DependentActivityId
`;

// ─── GET / — list, optionally scoped to one activity tab ─────────────────────
router.get("/", authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const activityId = req.query.activityId ? parseInt(req.query.activityId, 10) : null;

    const result = await pool.request()
      .input("activityId", sql.Int, activityId)
      .query(`
        SELECT ${SELECT_COLUMNS}
        ${JOINS}
        WHERE (@activityId IS NULL OR d.ActivityId = @activityId)
        ORDER BY d.CreatedAt DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("ActivityDependency / error:", err);
    res.status(500).json({ error: "Failed to fetch dependencies" });
  }
});

// ─── POST / ────────────────────────────────────────────────────────────────────
router.post("/", authMiddleware, requirePageRight("civilworkdpr-dependency", "create"), async (req, res) => {
  const {
    activityId, parentActivityId, dependentActivityId, workDescription,
    quantityPlanned, quantityCompleted, unit, plannedStartDate, plannedEndDate,
    actualStartDate, actualEndDate, currentStatus, remarks, projectId,
  } = req.body;
  const actor = req.user?.email || req.user?.name || "system";

  if (!activityId) return res.status(400).json({ error: "Activity (tab) is required" });

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("activityId", sql.Int, activityId)
      .input("parentActivityId", sql.Int, parentActivityId ?? null)
      .input("dependentActivityId", sql.Int, dependentActivityId ?? null)
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
      .input("projectId", sql.Int, projectId ?? null)
      .input("createdBy", sql.NVarChar, actor)
      .query(`
        INSERT INTO dbo.ActivityDependency
          (ActivityId, ParentActivityId, DependentActivityId, WorkDescription,
           QuantityPlanned, QuantityCompleted, Unit, PlannedStartDate, PlannedEndDate,
           ActualStartDate, ActualEndDate, CurrentStatus, Remarks, ProjectId,
           CreatedBy, CreatedAt)
        OUTPUT INSERTED.DependencyId AS id
        VALUES
          (@activityId, @parentActivityId, @dependentActivityId, @workDescription,
           @quantityPlanned, @quantityCompleted, @unit, @plannedStartDate, @plannedEndDate,
           @actualStartDate, @actualEndDate, @currentStatus, @remarks, @projectId,
           @createdBy, GETDATE())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].id });
  } catch (err) {
    console.error("ActivityDependency POST error:", err);
    res.status(500).json({ error: "Failed to create dependency record" });
  }
});

// ─── PUT /:id ──────────────────────────────────────────────────────────────────
router.put("/:id", authMiddleware, requirePageRight("civilworkdpr-dependency", "edit"), async (req, res) => {
  const { id } = req.params;
  const depId = parseInt(id, 10);
  if (isNaN(depId)) return res.status(400).json({ error: "Invalid ID" });

  const {
    activityId, parentActivityId, dependentActivityId, workDescription,
    quantityPlanned, quantityCompleted, unit, plannedStartDate, plannedEndDate,
    actualStartDate, actualEndDate, currentStatus, remarks, projectId,
  } = req.body;
  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = await getPool();
    const existing = await pool.request()
      .input("id", sql.Int, depId)
      .query(`SELECT DependencyId FROM dbo.ActivityDependency WHERE DependencyId = @id`);
    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: "Dependency record not found" });
    }

    await pool.request()
      .input("id", sql.Int, depId)
      .input("activityId", sql.Int, activityId)
      .input("parentActivityId", sql.Int, parentActivityId ?? null)
      .input("dependentActivityId", sql.Int, dependentActivityId ?? null)
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
      .input("projectId", sql.Int, projectId ?? null)
      .input("updatedBy", sql.NVarChar, actor)
      .query(`
        UPDATE dbo.ActivityDependency SET
          ActivityId = @activityId, ParentActivityId = @parentActivityId,
          DependentActivityId = @dependentActivityId, WorkDescription = @workDescription,
          QuantityPlanned = @quantityPlanned, QuantityCompleted = @quantityCompleted,
          Unit = @unit, PlannedStartDate = @plannedStartDate, PlannedEndDate = @plannedEndDate,
          ActualStartDate = @actualStartDate, ActualEndDate = @actualEndDate,
          CurrentStatus = @currentStatus, Remarks = @remarks, ProjectId = @projectId,
          UpdatedBy = @updatedBy, UpdatedAt = GETDATE()
        WHERE DependencyId = @id
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("ActivityDependency PUT error:", err);
    res.status(500).json({ error: "Failed to update dependency record" });
  }
});

// ─── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", authMiddleware, requirePageRight("civilworkdpr-dependency", "delete"), async (req, res) => {
  const depId = parseInt(req.params.id, 10);
  if (isNaN(depId)) return res.status(400).json({ error: "Invalid ID" });

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("id", sql.Int, depId)
      .query(`DELETE FROM dbo.ActivityDependency WHERE DependencyId = @id`);
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Dependency record not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("ActivityDependency DELETE error:", err);
    res.status(500).json({ error: "Failed to delete dependency record" });
  }
});

module.exports = router;
