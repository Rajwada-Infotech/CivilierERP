const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight, requireAnyPageRight } = require("../middleware/requirePageRight");

const STATUS_VALUES = new Set(["PENDING", "IN_PROGRESS", "HOLD", "CANCELLED", "APPROVED", "REWORK", "COMPLETED"]);
const SOURCE_VALUES = new Set(["CONTRACTOR", "DEVELOPER"]);

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
        daa.StartDate AS startDate,
        daa.Days AS days,
        daa.EndDate AS endDate,
        daa.LabourSource AS labourSource,
        daa.MaterialSource AS materialSource,
        daa.Description AS description,
        daa.Remarks AS remarks,
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
          SELECT STRING_AGG(u.name, ', ') WITHIN GROUP (ORDER BY u.name)
          FROM dbo.DependencyActivityEngineer dae
          JOIN dbo.users u ON u.id = dae.EngineerId
          WHERE dae.AssignmentId = daa.Id
        ) AS engineerNames,
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

// GET /contractors?projectId= — contractors for the "Labour/Material Given
// By" pickers, sourced from Contractor Master (dbo.AccountHeadMaster WHERE
// LHeadType='C'). Prefers contractors already allocated to this project
// (dbo.ContractorAllocation) so the list stays project-relevant where that
// data exists, but falls back to the full Contractor Master roster when the
// project has no allocations yet — an empty dropdown because nobody's
// gotten around to recording an allocation is worse than an unscoped list.
router.get("/contractors", authMiddleware, async (req, res) => {
  const projectId = parseInt(req.query.projectId, 10);
  if (!Number.isFinite(projectId)) return res.status(400).json({ error: "projectId is required" });
  try {
    const pool = await getPool();
    const scoped = await pool.request().input("projectId", sql.Int, projectId).query(`
      SELECT DISTINCT ahm.LHeadId AS id, ahm.LHeadName AS name
      FROM dbo.ContractorAllocation ca
      JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = ca.ContractorLHeadId
      WHERE ca.ProjectId = @projectId AND ISNULL(ahm.LHeadStatus, 1) = 1
      ORDER BY ahm.LHeadName ASC
    `);
    if (scoped.recordset.length) return res.json(scoped.recordset);

    const all = await pool.request().query(`
      SELECT LHeadId AS id, LHeadName AS name
      FROM dbo.AccountHeadMaster
      WHERE LHeadType = 'C' AND ISNULL(LHeadStatus, 1) = 1
      ORDER BY LHeadName ASC
    `);
    res.json(all.recordset);
  } catch (err) {
    console.error("[dependency-activity-assignment] GET /contractors error:", err.message);
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
      SELECT
        Id AS assignmentId, StartDate AS startDate, Days AS days, EndDate AS endDate,
        LabourSource AS labourSource, MaterialSource AS materialSource,
        LabourContractorId AS labourContractorId, MaterialContractorId AS materialContractorId,
        Description AS description, Remarks AS remarks
      FROM dbo.DependencyActivityAssignment WHERE DependencyMasterActivityId = @rungId
    `);
    const assignment = assignRes.recordset[0] || null;

    let materials = [];
    let engineerIds = [];
    let checkpoints = [];
    if (assignment) {
      const matRes = await pool.request().input("assignmentId", sql.Int, assignment.assignmentId).query(`
        SELECT ItemId AS itemId, Quantity AS quantity
        FROM dbo.DependencyActivityMaterial WHERE AssignmentId = @assignmentId
      `);
      materials = matRes.recordset;

      const engRes = await pool.request().input("assignmentId", sql.Int, assignment.assignmentId).query(`
        SELECT EngineerId AS engineerId FROM dbo.DependencyActivityEngineer WHERE AssignmentId = @assignmentId
      `);
      engineerIds = engRes.recordset.map((r) => r.engineerId);

      const cpRes = await pool.request().input("assignmentId", sql.Int, assignment.assignmentId).query(`
        SELECT Id AS id, CheckpointId AS checkpointId, FieldName AS fieldName, SortOrder AS sortOrder, IsChecked AS isChecked
        FROM dbo.DependencyActivityCheckpoint WHERE AssignmentId = @assignmentId
        ORDER BY SortOrder ASC, Id ASC
      `);
      checkpoints = cpRes.recordset.map((c) => ({ ...c, isChecked: !!c.isChecked }));
    }

    res.json({
      rungId,
      activityId,
      candidateItems: itemsRes.recordset,
      assignment: assignment
        ? {
            engineerIds,
            startDate: assignment.startDate,
            days: assignment.days,
            endDate: assignment.endDate,
            labourSource: assignment.labourSource,
            materialSource: assignment.materialSource,
            labourContractorId: assignment.labourContractorId,
            materialContractorId: assignment.materialContractorId,
            description: assignment.description,
            remarks: assignment.remarks,
            materials,
            checkpoints,
          }
        : null,
    });
  } catch (err) {
    console.error("[dependency-activity-assignment] GET /:rungId error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /:rungId — upsert the assignment for one rung: engineers, start
// date/duration/end date, labour & material source, description, remarks,
// and a material+quantity list. Engineers and materials are always replaced
// wholesale (delete + reinsert) rather than diffed — both lists are short,
// so this is simpler and avoids partial-update bugs.
router.post("/:rungId", authMiddleware, async (req, res) => {
  const rungId = parseInt(req.params.rungId, 10);
  if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });

  const {
    engineerIds, startDate, days, endDate, labourSource, materialSource,
    labourContractorId, materialContractorId, description, remarks, materials, checkpoints,
  } = req.body;

  if (engineerIds != null && !Array.isArray(engineerIds)) {
    return res.status(400).json({ error: "engineerIds must be an array" });
  }
  if (!Array.isArray(materials)) return res.status(400).json({ error: "materials must be an array" });
  if (checkpoints != null && !Array.isArray(checkpoints)) {
    return res.status(400).json({ error: "checkpoints must be an array" });
  }
  if (labourSource && !SOURCE_VALUES.has(labourSource)) {
    return res.status(400).json({ error: `labourSource must be one of: ${[...SOURCE_VALUES].join(", ")}` });
  }
  if (materialSource && !SOURCE_VALUES.has(materialSource)) {
    return res.status(400).json({ error: `materialSource must be one of: ${[...SOURCE_VALUES].join(", ")}` });
  }

  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = await getPool();

    const rungCheck = await pool.request().input("rungId", sql.Int, rungId)
      .query(`SELECT Id FROM dbo.DependencyMasterActivity WHERE Id = @rungId`);
    if (!rungCheck.recordset.length) return res.status(404).json({ error: "Activity rung not found" });

    const existing = await pool.request().input("rungId", sql.Int, rungId)
      .query(`SELECT Id FROM dbo.DependencyActivityAssignment WHERE DependencyMasterActivityId = @rungId`);

    const fieldInputs = (request) =>
      request
        .input("startDate", sql.Date, startDate || null)
        .input("days", sql.Int, Number.isFinite(days) ? days : null)
        .input("endDate", sql.Date, endDate || null)
        .input("labourSource", sql.NVarChar(20), labourSource || null)
        .input("materialSource", sql.NVarChar(20), materialSource || null)
        .input("labourContractorId", sql.Int, Number.isFinite(labourContractorId) ? labourContractorId : null)
        .input("materialContractorId", sql.Int, Number.isFinite(materialContractorId) ? materialContractorId : null)
        .input("description", sql.NVarChar(500), description || null)
        .input("remarks", sql.NVarChar(1000), remarks || null);

    let assignmentId;
    if (existing.recordset.length) {
      assignmentId = existing.recordset[0].Id;
      await fieldInputs(pool.request())
        .input("id", sql.Int, assignmentId)
        .input("updatedBy", sql.NVarChar(200), actor)
        .query(`
          UPDATE dbo.DependencyActivityAssignment
          SET StartDate = @startDate, Days = @days, EndDate = @endDate,
              LabourSource = @labourSource, MaterialSource = @materialSource,
              LabourContractorId = @labourContractorId, MaterialContractorId = @materialContractorId,
              Description = @description, Remarks = @remarks,
              UpdatedBy = @updatedBy, UpdatedAt = SYSDATETIME()
          WHERE Id = @id
        `);
    } else {
      const inserted = await fieldInputs(pool.request())
        .input("rungId", sql.Int, rungId)
        .input("createdBy", sql.NVarChar(200), actor)
        .query(`
          INSERT INTO dbo.DependencyActivityAssignment
            (DependencyMasterActivityId, StartDate, Days, EndDate, LabourSource, MaterialSource,
             LabourContractorId, MaterialContractorId, Description, Remarks, CreatedBy)
          OUTPUT INSERTED.Id AS id
          VALUES (@rungId, @startDate, @days, @endDate, @labourSource, @materialSource,
                  @labourContractorId, @materialContractorId, @description, @remarks, @createdBy)
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

    await pool.request().input("assignmentId", sql.Int, assignmentId)
      .query(`DELETE FROM dbo.DependencyActivityEngineer WHERE AssignmentId = @assignmentId`);
    for (const engineerId of engineerIds || []) {
      const id = parseInt(engineerId, 10);
      if (!Number.isFinite(id)) continue;
      await pool.request()
        .input("assignmentId", sql.Int, assignmentId)
        .input("engineerId", sql.Int, id)
        .query(`
          INSERT INTO dbo.DependencyActivityEngineer (AssignmentId, EngineerId)
          VALUES (@assignmentId, @engineerId)
        `);
    }

    await pool.request().input("assignmentId", sql.Int, assignmentId)
      .query(`DELETE FROM dbo.DependencyActivityCheckpoint WHERE AssignmentId = @assignmentId`);
    let cpSort = 0;
    for (const row of checkpoints || []) {
      const fieldName = String(row.fieldName || "").trim();
      if (!fieldName) continue;
      cpSort += 10;
      await pool.request()
        .input("assignmentId", sql.Int, assignmentId)
        .input("checkpointId", sql.Int, Number.isFinite(row.checkpointId) ? row.checkpointId : null)
        .input("fieldName", sql.NVarChar(200), fieldName)
        .input("sortOrder", sql.Int, cpSort)
        .input("isChecked", sql.Bit, !!row.isChecked)
        .input("checkedAt", sql.DateTime2, row.isChecked ? new Date() : null)
        .input("checkedBy", sql.NVarChar(200), row.isChecked ? actor : null)
        .query(`
          INSERT INTO dbo.DependencyActivityCheckpoint
            (AssignmentId, CheckpointId, FieldName, SortOrder, IsChecked, CheckedAt, CheckedBy)
          VALUES (@assignmentId, @checkpointId, @fieldName, @sortOrder, @isChecked, @checkedAt, @checkedBy)
        `);
    }

    res.json({ success: true, assignmentId });
  } catch (err) {
    console.error("[dependency-activity-assignment] POST /:rungId error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
