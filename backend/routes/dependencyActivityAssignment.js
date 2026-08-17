const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight, requireAnyPageRight } = require("../middleware/requirePageRight");

const STATUS_VALUES = new Set(["PENDING", "IN_PROGRESS", "HOLD", "CANCELLED", "APPROVED", "REWORK", "COMPLETED"]);

// GET / — every rung that has been assigned an engineer/material at least
// once. Two callers share this: the Activity Reporting page (full list,
// across every chain) and Work Reporting's own "Link Dependency" card,
// which passes ?dependencyMasterId= to show just the saved flow for the
// chain currently picked there — so the gate accepts either page's view
// right rather than only Reporting's.
router.get(
  "/",
  authMiddleware,
  requireAnyPageRight(["civilworkdpr-activity-reporting", "civilworkdpr-work-done"], "view"),
  async (req, res) => {
  const dependencyMasterId = req.query.dependencyMasterId ? parseInt(req.query.dependencyMasterId, 10) : null;
  try {
    const pool = await getPool();
    const request = pool.request();
    let where = "";
    if (Number.isFinite(dependencyMasterId)) {
      request.input("dependencyMasterId", sql.Int, dependencyMasterId);
      where = "WHERE dm.Id = @dependencyMasterId";
    }
    const r = await request.query(`
      SELECT
        daa.Id AS assignmentId,
        daa.DependencyMasterActivityId AS rungId,
        daa.EngineerId AS engineerId, u.name AS engineerName,
        daa.StartDate AS startDate,
        daa.Status AS status,
        daa.UpdatedAt AS updatedAt,
        dma.SequenceNo AS sequenceNo,
        dma.ActivityId AS activityId, am.activity_name AS activityName,
        dm.Id AS dependencyMasterId, dm.Alias AS alias, dm.WorkType AS workType,
        dm.ProjectId AS projectId, ep.name AS projectName,
        dm.TowerId AS towerId, bm.BlockName AS towerName,
        dm.Floor AS floor,
        dm.FlatId AS flatId, um.UnitName AS flatName,
        CONCAT(ISNULL(bm.BlockName, '—'), ' > Floor ', dm.Floor, ' > ', ISNULL(um.UnitName, '—')) AS scopePath,
        (
          SELECT img.M_Name AS name, dammat.Quantity AS quantity, img.M_UOM AS uom
          FROM dbo.DependencyActivityMaterial dammat
          JOIN dbo.Item_Master_Group img ON img.M_Id = dammat.ItemId
          WHERE dammat.AssignmentId = daa.Id
          ORDER BY img.M_Name ASC
          FOR JSON PATH
        ) AS materialsJson
      FROM dbo.DependencyActivityAssignment daa
      JOIN dbo.DependencyMasterActivity dma ON dma.Id = daa.DependencyMasterActivityId
      JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
      JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
      LEFT JOIN dbo.users       u  ON u.id = daa.EngineerId
      LEFT JOIN dbo.enterprise  ep ON ep.id = dm.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.BlockMaster bm ON bm.Id = dm.TowerId
      LEFT JOIN dbo.UnitMaster  um ON um.Id = dm.FlatId
      ${where}
      ORDER BY daa.UpdatedAt DESC
    `);
    const rows = r.recordset.map(({ materialsJson, ...row }) => ({
      ...row,
      materials: materialsJson ? JSON.parse(materialsJson) : [],
    }));
    res.json(rows);
  } catch (err) {
    console.error("[dependency-activity-assignment] GET / error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /:rungId/status — move a rung between report statuses. No
// order/workflow is enforced between statuses (any -> any) — that's a
// policy call left for later, not something the schema or this endpoint
// dictates.
router.patch(
  "/:rungId/status",
  authMiddleware,
  requireAnyPageRight(["civilworkdpr-activity-reporting", "civilworkdpr-work-done"], "edit"),
  async (req, res) => {
  const rungId = parseInt(req.params.rungId, 10);
  if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });

  const status = String(req.body?.status || "").toUpperCase();
  if (!STATUS_VALUES.has(status)) {
    return res.status(400).json({ error: `status must be one of: ${[...STATUS_VALUES].join(", ")}` });
  }

  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("rungId", sql.Int, rungId)
      .input("status", sql.NVarChar(20), status)
      .input("updatedBy", sql.NVarChar(200), actor)
      .query(`
        UPDATE dbo.DependencyActivityAssignment
        SET Status = @status, UpdatedBy = @updatedBy, UpdatedAt = SYSDATETIME()
        WHERE DependencyMasterActivityId = @rungId
      `);
    if (!result.rowsAffected[0]) {
      return res.status(404).json({ error: "No assignment found for this rung" });
    }
    res.json({ success: true, status });
  } catch (err) {
    console.error("[dependency-activity-assignment] PATCH /:rungId/status error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /engineers — active users, for the "Engineer Assign" picker on Work
// Reporting's per-rung assignment popup. Deliberately NOT gated behind
// PRIVILEGED_ROLES (see users.js GET /) — any authenticated Civil Work DPR
// user needs to be able to assign an engineer, same open-list precedent as
// GET /legal-executives in users.js.
router.get("/engineers", authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT id, name FROM dbo.users WHERE ISNULL(discontinue, 0) = 0 ORDER BY name ASC
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error("[dependency-activity-assignment] GET /engineers error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /:rungId — the existing assignment (if any) for one
// DependencyMasterActivity row, plus the candidate material list sourced
// from that rung's own ActivityItems links (Activity Master's "linked
// items" tab), so the popup can render quantity inputs for exactly the
// items the activity actually uses.
router.get("/:rungId", authMiddleware, async (req, res) => {
  const rungId = parseInt(req.params.rungId, 10);
  if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });

  try {
    const pool = await getPool();

    const rungRes = await pool.request().input("rungId", sql.Int, rungId).query(`
      SELECT dma.Id, dma.ActivityId FROM dbo.DependencyMasterActivity dma WHERE dma.Id = @rungId
    `);
    if (!rungRes.recordset.length) return res.status(404).json({ error: "Activity rung not found" });
    const activityId = rungRes.recordset[0].ActivityId;

    const itemsRes = await pool.request().input("activityId", sql.Int, activityId).query(`
      SELECT img.M_Id AS itemId, img.M_Name AS itemName, img.M_code AS itemCode, img.M_UOM AS uom
      FROM dbo.ActivityItems ai
      JOIN dbo.Item_Master_Group img ON img.M_Id = ai.ItemId
      WHERE ai.ActivityId = @activityId
      ORDER BY img.M_Name ASC
    `);

    const assignRes = await pool.request().input("rungId", sql.Int, rungId).query(`
      SELECT Id AS assignmentId, EngineerId AS engineerId, StartDate AS startDate
      FROM dbo.DependencyActivityAssignment WHERE DependencyMasterActivityId = @rungId
    `);
    const assignment = assignRes.recordset[0] || null;

    let materials = [];
    if (assignment) {
      const matRes = await pool.request().input("assignmentId", sql.Int, assignment.assignmentId).query(`
        SELECT ItemId AS itemId, Quantity AS quantity
        FROM dbo.DependencyActivityMaterial WHERE AssignmentId = @assignmentId
      `);
      materials = matRes.recordset;
    }

    res.json({
      rungId,
      candidateItems: itemsRes.recordset,
      assignment: assignment
        ? {
            engineerId: assignment.engineerId,
            startDate: assignment.startDate,
            materials,
          }
        : null,
    });
  } catch (err) {
    console.error("[dependency-activity-assignment] GET /:rungId error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /:rungId — upsert the assignment for one rung: engineer, start date,
// and a material+quantity list. Always replaces the material rows wholesale
// (delete + reinsert) rather than diffing — the list is short (an
// activity's own linked items) so this is simpler and avoids partial-update
// bugs.
router.post("/:rungId", authMiddleware, async (req, res) => {
  const rungId = parseInt(req.params.rungId, 10);
  if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });

  const { engineerId, startDate, materials } = req.body;
  if (!Array.isArray(materials)) return res.status(400).json({ error: "materials must be an array" });

  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = await getPool();

    const rungCheck = await pool.request().input("rungId", sql.Int, rungId)
      .query(`SELECT Id FROM dbo.DependencyMasterActivity WHERE Id = @rungId`);
    if (!rungCheck.recordset.length) return res.status(404).json({ error: "Activity rung not found" });

    const existing = await pool.request().input("rungId", sql.Int, rungId)
      .query(`SELECT Id FROM dbo.DependencyActivityAssignment WHERE DependencyMasterActivityId = @rungId`);

    let assignmentId;
    if (existing.recordset.length) {
      assignmentId = existing.recordset[0].Id;
      await pool.request()
        .input("id", sql.Int, assignmentId)
        .input("engineerId", sql.Int, engineerId || null)
        .input("startDate", sql.Date, startDate || null)
        .input("updatedBy", sql.NVarChar(200), actor)
        .query(`
          UPDATE dbo.DependencyActivityAssignment
          SET EngineerId = @engineerId, StartDate = @startDate, UpdatedBy = @updatedBy, UpdatedAt = SYSDATETIME()
          WHERE Id = @id
        `);
    } else {
      const inserted = await pool.request()
        .input("rungId", sql.Int, rungId)
        .input("engineerId", sql.Int, engineerId || null)
        .input("startDate", sql.Date, startDate || null)
        .input("createdBy", sql.NVarChar(200), actor)
        .query(`
          INSERT INTO dbo.DependencyActivityAssignment (DependencyMasterActivityId, EngineerId, StartDate, CreatedBy)
          OUTPUT INSERTED.Id AS id
          VALUES (@rungId, @engineerId, @startDate, @createdBy)
        `);
      assignmentId = inserted.recordset[0].id;
    }

    await pool.request().input("assignmentId", sql.Int, assignmentId)
      .query(`DELETE FROM dbo.DependencyActivityMaterial WHERE AssignmentId = @assignmentId`);

    for (const row of materials) {
      const itemId = row.itemId;
      const quantity = parseFloat(row.quantity);
      if (!itemId || !Number.isFinite(quantity) || quantity <= 0) continue;
      await pool.request()
        .input("assignmentId", sql.Int, assignmentId)
        .input("itemId", sql.UniqueIdentifier, itemId)
        .input("quantity", sql.Decimal(18, 2), quantity)
        .query(`
          INSERT INTO dbo.DependencyActivityMaterial (AssignmentId, ItemId, Quantity)
          VALUES (@assignmentId, @itemId, @quantity)
        `);
    }

    res.json({ success: true, assignmentId });
  } catch (err) {
    console.error("[dependency-activity-assignment] POST /:rungId error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
