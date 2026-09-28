const express = require("express");
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");
const { getEffectiveType } = require("../services/projectType");

const router = express.Router();

router.get("/constructed-kinds", requirePageRight("crm-auto-project-setup", "view"), async (_req, res) => {
  try {
    const result = await getPool().request().query(`
      SELECT Id, Code, Name, SortOrder
      FROM dbo.CrmConstructedAssetKind
      WHERE IsActive = 1
      ORDER BY SortOrder, Name
    `);
    res.json(result.recordset);
  } catch (error) {
    console.error("[plot-master] GET constructed kinds error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get("/constructed-kinds/manage", requirePageRight("crm-auto-project-setup", "view"), async (_req, res) => {
  try {
    const result = await getPool().request().query(`
      SELECT Id, Code, Name, SortOrder, IsActive
      FROM dbo.CrmConstructedAssetKind
      ORDER BY IsActive DESC, SortOrder, Name
    `);
    res.json(result.recordset);
  } catch (error) {
    console.error("[plot-master] GET managed constructed kinds error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

function parseConstructedKind(body) {
  const code = String(body?.Code || "").trim().toUpperCase();
  const name = String(body?.Name || "").trim();
  const sortOrder = Number(body?.SortOrder ?? 100);
  if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(code) || code === "PLOT") {
    return { error: "Code must use 2-20 uppercase letters, numbers, or underscores and cannot be PLOT" };
  }
  if (!name || name.length > 100) return { error: "Name is required and must be 100 characters or fewer" };
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) return { error: "Sort order must be a whole number from 0 to 9999" };
  return { code, name, sortOrder };
}

router.post("/constructed-kinds", requirePageRight("crm-auto-project-setup", "create"), async (req, res) => {
  const value = parseConstructedKind(req.body);
  if (value.error) return res.status(400).json({ error: value.error });
  try {
    const result = await getPool().request()
      .input("code", sql.NVarChar(20), value.code).input("name", sql.NVarChar(100), value.name)
      .input("sortOrder", sql.Int, value.sortOrder).input("by", sql.Int, req.user?.userId || null)
      .query(`INSERT INTO dbo.CrmConstructedAssetKind (Code, Name, SortOrder, IsActive, CreatedBy, CreatedAt)
              OUTPUT INSERTED.Id, INSERTED.Code, INSERTED.Name, INSERTED.SortOrder, INSERTED.IsActive
              VALUES (@code, @name, @sortOrder, 1, @by, SYSDATETIME())`);
    res.status(201).json(result.recordset[0]);
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) return res.status(409).json({ error: "An asset kind with this code already exists" });
    console.error("[plot-master] POST constructed kind error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.put("/constructed-kinds/:id", requirePageRight("crm-auto-project-setup", "edit"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid asset kind id" });
  const value = parseConstructedKind(req.body);
  if (value.error) return res.status(400).json({ error: value.error });
  const isActive = req.body?.IsActive !== false;
  try {
    const result = await getPool().request()
      .input("id", sql.Int, id).input("code", sql.NVarChar(20), value.code).input("name", sql.NVarChar(100), value.name)
      .input("sortOrder", sql.Int, value.sortOrder).input("isActive", sql.Bit, isActive).input("by", sql.Int, req.user?.userId || null)
      .query(`UPDATE dbo.CrmConstructedAssetKind
              SET Code = @code, Name = @name, SortOrder = @sortOrder, IsActive = @isActive, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
              OUTPUT INSERTED.Id, INSERTED.Code, INSERTED.Name, INSERTED.SortOrder, INSERTED.IsActive
              WHERE Id = @id`);
    if (!result.recordset.length) return res.status(404).json({ error: "Constructed asset kind not found" });
    res.json(result.recordset[0]);
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) return res.status(409).json({ error: "An asset kind with this code already exists" });
    console.error("[plot-master] PUT constructed kind error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id/adjacent", requirePageRight("crm-auto-project-setup", "view"), async (req, res) => {
  const plotId = Number(req.params.id);
  if (!Number.isInteger(plotId) || plotId <= 0) return res.status(400).json({ error: "Invalid plot id" });
  try {
    const result = await getPool().request().input("plotId", sql.Int, plotId).query(`
      SELECT p.Id, p.PlotNo, p.PlotName, p.AreaSqFt
      FROM dbo.PlotAdjacency pa
      JOIN dbo.PlotMaster p ON p.Id = CASE WHEN pa.PlotId = @plotId THEN pa.AdjacentPlotId ELSE pa.PlotId END
      WHERE pa.PlotId = @plotId OR pa.AdjacentPlotId = @plotId
      ORDER BY p.PlotName
    `);
    res.json(result.recordset);
  } catch (error) {
    console.error("[plot-master] GET adjacency error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.put("/:id/adjacent", requirePageRight("crm-auto-project-setup", "edit"), async (req, res) => {
  const plotId = Number(req.params.id);
  const adjacentIds = Array.isArray(req.body?.AdjacentPlotIds)
    ? [...new Set(req.body.AdjacentPlotIds.map(Number).filter((id) => Number.isInteger(id) && id > 0 && id !== plotId))]
    : [];
  if (!Number.isInteger(plotId) || plotId <= 0) return res.status(400).json({ error: "Invalid plot id" });
  try {
    const pool = getPool();
    const source = await pool.request().input("plotId", sql.Int, plotId).query(`
      SELECT Id, ProjectId, BlockId FROM dbo.PlotMaster WHERE Id = @plotId AND IsActive = 1 AND ConvertedUnitId IS NULL
    `);
    if (!source.recordset.length) return res.status(404).json({ error: "Active unconverted plot not found" });
    if (adjacentIds.length) {
      const candidates = await pool.request().query(`
        SELECT Id, ProjectId, BlockId FROM dbo.PlotMaster
        WHERE Id IN (${adjacentIds.join(",")}) AND IsActive = 1 AND ConvertedUnitId IS NULL
      `);
      const origin = source.recordset[0];
      if (candidates.recordset.length !== adjacentIds.length || candidates.recordset.some((p) => p.ProjectId !== origin.ProjectId || p.BlockId !== origin.BlockId)) {
        return res.status(400).json({ error: "Adjacent plots must be active, unconverted, and in the same project and block" });
      }
    }
    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request().input("plotId", sql.Int, plotId).query(`
        DELETE FROM dbo.PlotAdjacency WHERE PlotId = @plotId OR AdjacentPlotId = @plotId
      `);
      for (const adjacentId of adjacentIds) {
        await tx.request().input("left", sql.Int, Math.min(plotId, adjacentId)).input("right", sql.Int, Math.max(plotId, adjacentId))
          .input("by", sql.Int, req.user?.userId || null).query(`
            INSERT INTO dbo.PlotAdjacency (PlotId, AdjacentPlotId, CreatedBy, CreatedAt)
            VALUES (@left, @right, @by, SYSDATETIME())
          `);
      }
      await tx.commit();
      res.json({ success: true, adjacentIds });
    } catch (error) { await tx.rollback(); throw error; }
  } catch (error) {
    console.error("[plot-master] PUT adjacency error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Land inventory only. Constructed assets are intentionally absent here and
// continue to be served by Unit Master after a conversion.
router.get("/", requirePageRight("crm-auto-project-setup", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    const where = ["p.IsActive = 1"];
    if (req.query.projectId != null) {
      request.input("projectId", sql.Int, Number(req.query.projectId));
      where.push("p.ProjectId = @projectId");
    }
    if (req.query.blockId != null) {
      request.input("blockId", sql.Int, Number(req.query.blockId));
      where.push("p.BlockId = @blockId");
    }
    if (req.query.available === "1") where.push("p.ConvertedUnitId IS NULL");
    const result = await request.query(`
      SELECT p.Id, p.ProjectId, e.name AS ProjectName, p.BlockId, b.BlockName,
             p.PlotNo, p.PlotName, p.SurveyNo, p.AreaSqFt, p.RatePerSqFt,
             p.PlotWidthFt, p.PlotDepthFt, p.Facing, p.IsCornerPlot, p.RoadWidthFt, p.GuidelineRatePerSqFt,
             p.ConvertedUnitId, p.ConvertedAt, converted.UnitName AS ConvertedUnitName,
             (SELECT COUNT(*) FROM dbo.PlotAdjacency pa WHERE pa.PlotId = p.Id OR pa.AdjacentPlotId = p.Id) AS AdjacentPlotCount,
             bk.BookingNo AS LockBookingNo, app.ApplicationNo AS LockApplicationNo, hold.Id AS LockHoldId
      FROM dbo.PlotMaster p
      JOIN dbo.enterprise e ON e.id = p.ProjectId
      JOIN dbo.BlockMaster b ON b.Id = p.BlockId
      LEFT JOIN dbo.UnitMaster converted ON converted.Id = p.ConvertedUnitId
      OUTER APPLY (
        SELECT TOP 1 cb.BookingNo
        FROM dbo.CrmBookingPlot bp JOIN dbo.CrmBooking cb ON cb.Id = bp.BookingId
        WHERE bp.PlotId = p.Id AND bp.Status = N'Active' AND cb.IsActive = 1
          AND cb.Status NOT IN (N'Cancelled', N'Rejected', N'Expired')
      ) bk
      OUTER APPLY (
        SELECT TOP 1 ca.ApplicationNo
        FROM dbo.CrmApplicationPlot ap JOIN dbo.CrmApplication ca ON ca.Id = ap.ApplicationId
        WHERE ap.PlotId = p.Id AND ap.Status = N'Active' AND ca.IsActive = 1
          AND ca.Status NOT IN (N'Rejected', N'Cancelled', N'Expired', N'Converted')
      ) app
      OUTER APPLY (
        SELECT TOP 1 h.Id FROM dbo.CrmInventoryHold h
        WHERE h.EntityType = N'Plot' AND h.EntityId = p.Id AND h.Status = N'Active'
          AND h.HoldUntil >= SYSDATETIME()
      ) hold
      WHERE ${where.join(" AND ")}
      ORDER BY e.name, b.BlockName, p.PlotName
    `);
    res.json(result.recordset);
  } catch (error) {
    console.error("[plot-master] GET error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

function optionalDecimal(value, label) {
  if (value === null || value === undefined || value === "") return { value: null };
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return { error: `${label} must be a non-negative number` };
  return { value: number };
}

function parsePlotUpdate(body) {
  const plotNo = String(body?.PlotNo || "").trim();
  const plotName = String(body?.PlotName || "").trim();
  const surveyNo = String(body?.SurveyNo || "").trim() || null;
  const facing = String(body?.Facing || "").trim() || null;
  if (!plotNo || plotNo.length > 50) return { error: "Plot number is required and must be 50 characters or fewer" };
  if (!plotName || plotName.length > 100) return { error: "Plot name is required and must be 100 characters or fewer" };
  if (surveyNo?.length > 100 || facing?.length > 20) return { error: "Survey number or facing is too long" };
  const decimals = [
    ["AreaSqFt", "Area"], ["RatePerSqFt", "Rate"], ["PlotWidthFt", "Width"], ["PlotDepthFt", "Depth"],
    ["RoadWidthFt", "Road width"], ["GuidelineRatePerSqFt", "Guideline rate"],
  ];
  const parsed = {};
  for (const [key, label] of decimals) {
    const result = optionalDecimal(body?.[key], label);
    if (result.error) return result;
    parsed[key] = result.value;
  }
  return { plotNo, plotName, surveyNo, facing, isCornerPlot: body?.IsCornerPlot === true, ...parsed };
}

router.post("/", requirePageRight("crm-auto-project-setup", "create"), async (req, res) => {
  const projectId = Number(req.body?.ProjectId);
  const blockId = Number(req.body?.BlockId);
  if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(blockId) || blockId <= 0) {
    return res.status(400).json({ error: "Project and block are required" });
  }
  const value = parsePlotUpdate(req.body);
  if (value.error) return res.status(400).json({ error: value.error });
  try {
    const pool = getPool();
    const block = await pool.request().input("projectId", sql.Int, projectId).input("blockId", sql.Int, blockId)
      .query("SELECT Id FROM dbo.BlockMaster WHERE Id = @blockId AND ProjectId = @projectId AND IsActive = 1");
    if (!block.recordset.length) return res.status(400).json({ error: "Select an active block belonging to the project" });
    const type = await getEffectiveType(pool, { projectId, blockId });
    if (type.HasFloors) return res.status(400).json({ error: "This block uses floors and units, not Plot Master" });
    const result = await pool.request()
      .input("projectId", sql.Int, projectId).input("blockId", sql.Int, blockId).input("plotNo", sql.NVarChar(50), value.plotNo).input("plotName", sql.NVarChar(100), value.plotName)
      .input("surveyNo", sql.NVarChar(100), value.surveyNo).input("area", sql.Decimal(18, 2), value.AreaSqFt).input("rate", sql.Decimal(18, 2), value.RatePerSqFt)
      .input("width", sql.Decimal(18, 2), value.PlotWidthFt).input("depth", sql.Decimal(18, 2), value.PlotDepthFt)
      .input("facing", sql.NVarChar(20), value.facing).input("corner", sql.Bit, value.isCornerPlot).input("road", sql.Decimal(18, 2), value.RoadWidthFt)
      .input("guideline", sql.Decimal(18, 2), value.GuidelineRatePerSqFt).input("by", sql.Int, req.user?.userId || null)
      .query(`INSERT INTO dbo.PlotMaster (ProjectId, BlockId, PlotNo, PlotName, SurveyNo, AreaSqFt, RatePerSqFt, PlotWidthFt, PlotDepthFt, Facing, IsCornerPlot, RoadWidthFt, GuidelineRatePerSqFt, IsActive, CreatedBy, CreatedAt)
              OUTPUT INSERTED.Id
              VALUES (@projectId, @blockId, @plotNo, @plotName, @surveyNo, @area, @rate, @width, @depth, @facing, @corner, @road, @guideline, 1, @by, SYSDATETIME())`);
    res.status(201).json(result.recordset[0]);
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) return res.status(409).json({ error: "Another active plot in this block already uses this plot number" });
    console.error("[plot-master] POST plot error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id", requirePageRight("crm-auto-project-setup", "view"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid plot id" });
  try {
    const result = await getPool().request().input("id", sql.Int, id).input("by", sql.Int, req.user?.userId || null).query(`
      SELECT p.*, e.name AS ProjectName, b.BlockName, u.UnitName AS ConvertedUnitName
      FROM dbo.PlotMaster p
      JOIN dbo.enterprise e ON e.id = p.ProjectId
      JOIN dbo.BlockMaster b ON b.Id = p.BlockId
      LEFT JOIN dbo.UnitMaster u ON u.Id = p.ConvertedUnitId
      WHERE p.Id = @id AND p.IsActive = 1
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Plot not found" });
    res.json(result.recordset[0]);
  } catch (error) {
    console.error("[plot-master] GET detail error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.put("/:id", requirePageRight("crm-auto-project-setup", "edit"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid plot id" });
  const value = parsePlotUpdate(req.body);
  if (value.error) return res.status(400).json({ error: value.error });
  try {
    const pool = getPool();
    const editable = await pool.request().input("id", sql.Int, id).query(`
      SELECT p.Id, p.BlockId
      FROM dbo.PlotMaster p
      WHERE p.Id = @id AND p.IsActive = 1 AND p.ConvertedUnitId IS NULL
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp WHERE bp.PlotId = p.Id AND bp.Status = N'Active')
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmApplicationPlot ap WHERE ap.PlotId = p.Id AND ap.Status = N'Active')
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmInventoryHold h WHERE h.EntityType = N'Plot' AND h.EntityId = p.Id AND h.Status = N'Active' AND h.HoldUntil >= SYSDATETIME())
    `);
    if (!editable.recordset.length) return res.status(409).json({ error: "Only available, unconverted plots can be edited" });
    const duplicate = await pool.request().input("id", sql.Int, id).input("blockId", sql.Int, editable.recordset[0].BlockId).input("plotNo", sql.NVarChar(50), value.plotNo)
      .query("SELECT TOP 1 Id FROM dbo.PlotMaster WHERE BlockId = @blockId AND PlotNo = @plotNo AND IsActive = 1 AND Id <> @id");
    if (duplicate.recordset.length) return res.status(409).json({ error: "Another active plot in this block already uses this plot number" });
    const updated = await pool.request()
      .input("id", sql.Int, id).input("plotNo", sql.NVarChar(50), value.plotNo).input("plotName", sql.NVarChar(100), value.plotName)
      .input("surveyNo", sql.NVarChar(100), value.surveyNo).input("area", sql.Decimal(18, 2), value.AreaSqFt).input("rate", sql.Decimal(18, 2), value.RatePerSqFt)
      .input("width", sql.Decimal(18, 2), value.PlotWidthFt).input("depth", sql.Decimal(18, 2), value.PlotDepthFt)
      .input("facing", sql.NVarChar(20), value.facing).input("corner", sql.Bit, value.isCornerPlot).input("road", sql.Decimal(18, 2), value.RoadWidthFt)
      .input("guideline", sql.Decimal(18, 2), value.GuidelineRatePerSqFt).input("by", sql.Int, req.user?.userId || null)
      .query(`UPDATE dbo.PlotMaster
              SET PlotNo = @plotNo, PlotName = @plotName, SurveyNo = @surveyNo, AreaSqFt = @area, RatePerSqFt = @rate,
                  PlotWidthFt = @width, PlotDepthFt = @depth, Facing = @facing, IsCornerPlot = @corner,
                  RoadWidthFt = @road, GuidelineRatePerSqFt = @guideline, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
              WHERE Id = @id`);
    if (!updated.rowsAffected[0]) return res.status(404).json({ error: "Plot not found" });
    res.json({ success: true });
  } catch (error) {
    console.error("[plot-master] PUT detail error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", requirePageRight("crm-auto-project-setup", "delete"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid plot id" });
  try {
    const result = await getPool().request().input("id", sql.Int, id).query(`
      UPDATE p
      SET IsActive = 0, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
      FROM dbo.PlotMaster p
      WHERE p.Id = @id AND p.IsActive = 1 AND p.ConvertedUnitId IS NULL
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp WHERE bp.PlotId = p.Id AND bp.Status = N'Active')
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmApplicationPlot ap WHERE ap.PlotId = p.Id AND ap.Status = N'Active')
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmInventoryHold h WHERE h.EntityType = N'Plot' AND h.EntityId = p.Id AND h.Status = N'Active' AND h.HoldUntil >= SYSDATETIME())
    `);
    if (!result.rowsAffected[0]) return res.status(409).json({ error: "Only available, unconverted plots can be deleted" });
    res.json({ success: true });
  } catch (error) {
    console.error("[plot-master] DELETE error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
