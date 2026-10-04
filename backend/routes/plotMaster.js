const express = require("express");
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");
const { getEffectiveType } = require("../services/projectType");

const router = express.Router();

const PAGE = "crm-auto-project-setup";
const MAX_GRID = 60;
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

// "P-2" must come before "P-10". SQL's ORDER BY on a string cannot do that, so the
// natural ordering is applied here and every consumer of the list gets it.
function sortPlots(rows) {
  return rows.sort((a, b) =>
    collator.compare(a.ProjectName || "", b.ProjectName || "")
    || collator.compare(a.BlockName || "", b.BlockName || "")
    || collator.compare(a.PlotName || "", b.PlotName || "")
    || collator.compare(a.PlotNo || "", b.PlotNo || ""));
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// One definition of "what a plot row looks like" for the list AND the detail call.
// The detail endpoint used to return p.* only, which has no lock columns, so a booked
// plot opened in the dialog was shown as Available with an Edit button.
const PLOT_SELECT = `
  SELECT p.Id, p.ProjectId, e.name AS ProjectName, p.BlockId, b.BlockName,
         p.PlotNo, p.PlotName, p.SurveyNo, p.AreaSqFt, p.RatePerSqFt,
         p.PlotWidthFt, p.PlotDepthFt, p.Facing, p.IsCornerPlot, p.RoadWidthFt, p.GuidelineRatePerSqFt,
         p.GridRow, p.GridCol,
         p.PlannedVillaTypeId, vt.Code AS PlannedVillaTypeCode, vt.Name AS PlannedVillaTypeName,
         p.ConvertedUnitId, p.ConvertedAt, converted.UnitName AS ConvertedUnitName,
         (SELECT COUNT(*) FROM dbo.PlotAdjacency pa
            JOIN dbo.PlotMaster o ON o.Id = CASE WHEN pa.PlotId = p.Id THEN pa.AdjacentPlotId ELSE pa.PlotId END
           WHERE (pa.PlotId = p.Id OR pa.AdjacentPlotId = p.Id) AND o.IsActive = 1) AS AdjacentPlotCount,
         bk.BookingNo AS LockBookingNo, app.ApplicationNo AS LockApplicationNo, hold.Id AS LockHoldId
  FROM dbo.PlotMaster p
  JOIN dbo.enterprise e ON e.id = p.ProjectId
  JOIN dbo.BlockMaster b ON b.Id = p.BlockId
  LEFT JOIN dbo.UnitMaster converted ON converted.Id = p.ConvertedUnitId
  LEFT JOIN dbo.VillaTypeMaster vt ON vt.Id = p.PlannedVillaTypeId
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
`;

// The Facing column must hold a Code from dbo.PlotFacingMaster, otherwise the master
// (and the premium that hangs off it) is bypassed by anything that posts free text.
// A plot may keep a legacy value it already has; it just cannot be set to a new unknown one.
async function resolveFacing(pool, facing, currentFacing = null) {
  if (!facing) return { value: null };
  if (currentFacing && facing === currentFacing) return { value: facing };
  const found = await pool.request().input("c", sql.NVarChar(20), facing)
    .query("SELECT TOP 1 Code FROM dbo.PlotFacingMaster WHERE Code = @c AND IsActive = 1");
  if (!found.recordset.length) return { error: `Facing "${facing}" is not defined in the Facing master` };
  return { value: found.recordset[0].Code };
}

router.get("/constructed-kinds", requirePageRight("crm-auto-project-setup", "view"), async (_req, res) => {
  try {
    const result = await getPool().request().query(`
      SELECT Id, Code, Name, SortOrder, IsLand, IsCommercial
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
      SELECT Id, Code, Name, SortOrder, IsActive, IsLand, IsCommercial
      FROM dbo.CrmConstructedAssetKind
      ORDER BY IsActive DESC, SortOrder, Name
    `);
    res.json(result.recordset);
  } catch (error) {
    console.error("[plot-master] GET managed constructed kinds error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Unit kinds are managed in Unit Master (services/unitKind.js); these two
// write routes stay only so older screens keep working.
const unitKind = require("../services/unitKind");
router.post("/constructed-kinds", requirePageRight("crm-auto-project-setup", "create"), async (req, res) => {
  try { const r = await unitKind.createKind(req.body, req.user?.userId); res.status(r.status).json(r.body); }
  catch (error) { console.error("[plot-master] POST constructed kind error:", error.message); res.status(500).json({ error: error.message }); }
});
router.put("/constructed-kinds/:id", requirePageRight("crm-auto-project-setup", "edit"), async (req, res) => {
  try { const r = await unitKind.updateKind(Number(req.params.id), req.body, req.user?.userId); res.status(r.status).json(r.body); }
  catch (error) { console.error("[plot-master] PUT constructed kind error:", error.message); res.status(500).json({ error: error.message }); }
});

router.get("/:id/adjacent", requirePageRight("crm-auto-project-setup", "view"), async (req, res) => {
  const plotId = Number(req.params.id);
  if (!Number.isInteger(plotId) || plotId <= 0) return res.status(400).json({ error: "Invalid plot id" });
  try {
    const result = await getPool().request().input("plotId", sql.Int, plotId).query(`
      SELECT p.Id, p.PlotNo, p.PlotName, p.AreaSqFt
      FROM dbo.PlotAdjacency pa
      JOIN dbo.PlotMaster p ON p.Id = CASE WHEN pa.PlotId = @plotId THEN pa.AdjacentPlotId ELSE pa.PlotId END
      WHERE (pa.PlotId = @plotId OR pa.AdjacentPlotId = @plotId) AND p.IsActive = 1
    `);
    res.json(result.recordset.sort((a, b) => collator.compare(a.PlotName, b.PlotName)));
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
      const candidateRequest = pool.request();
      adjacentIds.forEach((id, i) => candidateRequest.input(`a${i}`, sql.Int, id));
      const candidates = await candidateRequest.query(`
        SELECT Id, ProjectId, BlockId, ConvertedUnitId FROM dbo.PlotMaster
        WHERE Id IN (${adjacentIds.map((_, i) => `@a${i}`).join(",")}) AND IsActive = 1
      `);
      const origin = source.recordset[0];
      if (candidates.recordset.length !== adjacentIds.length || candidates.recordset.some((p) => p.ProjectId !== origin.ProjectId || p.BlockId !== origin.BlockId)) {
        return res.status(400).json({ error: "Adjacent plots must be active and in the same project and block" });
      }
      // A plot already converted to a villa keeps the links it had (they record
      // which plots the villa stands on) but cannot gain a new one.
      const converted = candidates.recordset.filter((p) => p.ConvertedUnitId != null).map((p) => p.Id);
      if (converted.length) {
        const linked = new Set((await pool.request().input("plotId", sql.Int, plotId).query(`
          SELECT CASE WHEN PlotId = @plotId THEN AdjacentPlotId ELSE PlotId END AS Other
          FROM dbo.PlotAdjacency WHERE PlotId = @plotId OR AdjacentPlotId = @plotId`)).recordset.map((r) => r.Other));
        if (converted.some((id) => !linked.has(id))) {
          return res.status(400).json({ error: "A plot already converted to a villa cannot get a new neighbour" });
        }
      }
    }
    const tx = pool.transaction();
    await tx.begin();
    try {
      // Links to converted plots are never removed here — they belong to a villa.
      await tx.request().input("plotId", sql.Int, plotId).query(`
        DELETE pa FROM dbo.PlotAdjacency pa
        JOIN dbo.PlotMaster other ON other.Id = CASE WHEN pa.PlotId = @plotId THEN pa.AdjacentPlotId ELSE pa.PlotId END
        WHERE (pa.PlotId = @plotId OR pa.AdjacentPlotId = @plotId) AND other.ConvertedUnitId IS NULL
      `);
      const kept = new Set((await tx.request().input("plotId", sql.Int, plotId).query(`
        SELECT CASE WHEN PlotId = @plotId THEN AdjacentPlotId ELSE PlotId END AS Other
        FROM dbo.PlotAdjacency WHERE PlotId = @plotId OR AdjacentPlotId = @plotId`)).recordset.map((r) => r.Other));
      for (const adjacentId of adjacentIds.filter((id) => !kept.has(id))) {
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

// Plot-type blocks (not floors/units) so the screen can offer a block that has no plots yet:
// the filter dropdowns and "Add plot" used to be built from existing plots, which made the
// very first plot of a new block impossible to create.
// Plan one villa type for several plots at once (or clear it with null).
// Converted plots are left alone: their villa already records its own type.
router.put("/planned-villa-type", requirePageRight(PAGE, "edit"), async (req, res) => {
  const plotIds = Array.isArray(req.body?.PlotIds) ? [...new Set(req.body.PlotIds.map(Number))] : [];
  if (!plotIds.length || !plotIds.every((id) => Number.isInteger(id) && id > 0)) return res.status(400).json({ error: "Select one or more plots" });
  const villaTypeId = req.body?.VillaTypeId == null || req.body.VillaTypeId === "" ? null : parseId(req.body.VillaTypeId);
  if (req.body?.VillaTypeId != null && req.body.VillaTypeId !== "" && villaTypeId == null) return res.status(400).json({ error: "Invalid villa type" });
  try {
    const pool = getPool();
    const plots = (await pool.request().query(
      `SELECT Id, ProjectId, ConvertedUnitId FROM dbo.PlotMaster WHERE IsActive = 1 AND Id IN (${plotIds.join(",")})`)).recordset;
    if (plots.length !== plotIds.length) return res.status(400).json({ error: "One or more plots are not active" });
    if (plots.some((p) => p.ConvertedUnitId != null)) return res.status(409).json({ error: "Converted plots keep the type their villa was built to" });
    const projects = new Set(plots.map((p) => p.ProjectId));
    if (projects.size > 1) return res.status(400).json({ error: "Select plots of one project" });
    const villaTypeError = await resolveVillaType(pool, villaTypeId, plots[0].ProjectId);
    if (villaTypeError) return res.status(400).json({ error: villaTypeError });
    const r = await pool.request().input("vt", sql.Int, villaTypeId).input("by", sql.Int, req.user?.userId || null)
      .query(`UPDATE dbo.PlotMaster SET PlannedVillaTypeId = @vt, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
              WHERE IsActive = 1 AND ConvertedUnitId IS NULL AND Id IN (${plotIds.join(",")})`);
    res.json({ success: true, updated: r.rowsAffected[0] });
  } catch (error) {
    console.error("[plot-master] PUT planned-villa-type error:", error.message);
    res.status(500).json({ error: "Failed to set the villa type" });
  }
});

router.get("/blocks", requirePageRight(PAGE, "view"), async (_req, res) => {
  try {
    const pool = getPool();
    const rows = (await pool.request().query(`
      SELECT b.Id AS BlockId, b.BlockName, b.ProjectId, e.name AS ProjectName
      FROM dbo.BlockMaster b JOIN dbo.enterprise e ON e.id = b.ProjectId
      WHERE b.IsActive = 1
    `)).recordset;
    const checked = await Promise.all(rows.map(async (row) => {
      try {
        const type = await getEffectiveType(pool, { projectId: row.ProjectId, blockId: row.BlockId });
        return type.HasFloors ? null : row;
      } catch (error) {
        console.error("[plot-master] block type lookup failed:", row.BlockId, error.message);
        return null;
      }
    }));
    res.json(checked.filter(Boolean).sort((a, b) =>
      collator.compare(a.ProjectName, b.ProjectName) || collator.compare(a.BlockName, b.BlockName)));
  } catch (error) {
    console.error("[plot-master] GET blocks error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Grid size + neighbour pairs for one block. Plot positions travel with the normal plot list.
router.get("/layout/:blockId", requirePageRight(PAGE, "view"), async (req, res) => {
  const blockId = parseId(req.params.blockId);
  if (blockId === null) return res.status(400).json({ error: "Invalid block id" });
  try {
    const pool = getPool();
    const layout = await pool.request().input("b", sql.Int, blockId)
      .query("SELECT GridRows, GridCols FROM dbo.PlotBlockLayout WHERE BlockId = @b");
    const adjacency = await pool.request().input("b", sql.Int, blockId).query(`
      SELECT pa.PlotId, pa.AdjacentPlotId
      FROM dbo.PlotAdjacency pa
      JOIN dbo.PlotMaster a ON a.Id = pa.PlotId AND a.IsActive = 1
      JOIN dbo.PlotMaster c ON c.Id = pa.AdjacentPlotId AND c.IsActive = 1
      WHERE a.BlockId = @b AND c.BlockId = @b
    `);
    res.json({
      BlockId: blockId,
      GridRows: layout.recordset[0]?.GridRows ?? null,
      GridCols: layout.recordset[0]?.GridCols ?? null,
      Adjacency: adjacency.recordset,
    });
  } catch (error) {
    console.error("[plot-master] GET layout error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Saves the whole matrix of one block in one transaction: grid size, every plot's cell, and
// (optionally) the full neighbour set. Plots left out of Placements become "unplaced".
// Adjacency is only replaced when the key is present, so a client that never loaded the
// links cannot wipe them by saving positions.
router.put("/layout/:blockId", requirePageRight(PAGE, "edit"), async (req, res) => {
  const blockId = parseId(req.params.blockId);
  if (blockId === null) return res.status(400).json({ error: "Invalid block id" });
  const gridRows = Number(req.body?.GridRows);
  const gridCols = Number(req.body?.GridCols);
  if (![gridRows, gridCols].every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_GRID)) {
    return res.status(400).json({ error: `Rows and columns must be whole numbers from 1 to ${MAX_GRID}` });
  }
  if (!Array.isArray(req.body?.Placements)) return res.status(400).json({ error: "Placements are required" });

  try {
    const pool = getPool();
    const block = await pool.request().input("b", sql.Int, blockId)
      .query("SELECT Id FROM dbo.BlockMaster WHERE Id = @b AND IsActive = 1");
    if (!block.recordset.length) return res.status(404).json({ error: "Block not found" });

    const plotRows = (await pool.request().input("b", sql.Int, blockId)
      .query("SELECT Id, ConvertedUnitId FROM dbo.PlotMaster WHERE BlockId = @b AND IsActive = 1")).recordset;
    const plotById = new Map(plotRows.map((row) => [row.Id, row]));

    const placements = [];
    const seenPlots = new Set();
    const seenCells = new Set();
    for (const item of req.body.Placements) {
      const id = Number(item?.Id), row = Number(item?.Row), col = Number(item?.Col);
      if (!plotById.has(id)) return res.status(400).json({ error: `Plot ${item?.Id} is not an active plot of this block` });
      if (seenPlots.has(id)) return res.status(400).json({ error: "A plot was placed twice" });
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= gridRows || col >= gridCols) {
        return res.status(400).json({ error: "A plot was placed outside the grid" });
      }
      const cell = `${row}:${col}`;
      if (seenCells.has(cell)) return res.status(400).json({ error: "Two plots were placed in the same cell" });
      seenPlots.add(id); seenCells.add(cell);
      placements.push({ id, row, col });
    }

    let pairs = null;
    if (Array.isArray(req.body?.Adjacency)) {
      // Links that already exist are kept even when a side has since been
      // converted to a villa: plots bought together are linked first and
      // converted afterwards, and the editor sends every loaded link back on
      // save. Only a NEW link to a converted plot is refused.
      const existingPairs = new Set((await pool.request().input("b", sql.Int, blockId).query(`
        SELECT pa.PlotId, pa.AdjacentPlotId FROM dbo.PlotAdjacency pa
        JOIN dbo.PlotMaster p ON p.Id = pa.PlotId WHERE p.BlockId = @b`)).recordset
        .map((r) => `${Math.min(r.PlotId, r.AdjacentPlotId)}-${Math.max(r.PlotId, r.AdjacentPlotId)}`));
      pairs = new Map();
      for (const pair of req.body.Adjacency) {
        const a = Number(pair?.[0]), b = Number(pair?.[1]);
        if (!plotById.has(a) || !plotById.has(b) || a === b) {
          return res.status(400).json({ error: "Neighbours must be two different active plots of this block" });
        }
        const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
        if ((plotById.get(a).ConvertedUnitId || plotById.get(b).ConvertedUnitId) && !existingPairs.has(key)) {
          return res.status(400).json({ error: "A plot already converted to a villa cannot get a new neighbour" });
        }
        pairs.set(`${Math.min(a, b)}-${Math.max(a, b)}`, [Math.min(a, b), Math.max(a, b)]);
      }
    }

    const by = req.user?.userId || null;
    const tx = pool.transaction();
    await tx.begin();
    let finished = false;
    try {
      const upsert = await tx.request().input("b", sql.Int, blockId).input("r", sql.Int, gridRows).input("c", sql.Int, gridCols).input("by", sql.Int, by)
        .query("UPDATE dbo.PlotBlockLayout SET GridRows = @r, GridCols = @c, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE BlockId = @b");
      if (!upsert.rowsAffected[0]) {
        await tx.request().input("b", sql.Int, blockId).input("r", sql.Int, gridRows).input("c", sql.Int, gridCols).input("by", sql.Int, by)
          .query("INSERT INTO dbo.PlotBlockLayout (BlockId, GridRows, GridCols, UpdatedBy) VALUES (@b, @r, @c, @by)");
      }
      // Clear first so a swap never trips the unique-cell index half-way through.
      await tx.request().input("b", sql.Int, blockId)
        .query("UPDATE dbo.PlotMaster SET GridRow = NULL, GridCol = NULL WHERE BlockId = @b AND IsActive = 1 AND (GridRow IS NOT NULL OR GridCol IS NOT NULL)");
      for (const item of placements) {
        await tx.request().input("id", sql.Int, item.id).input("r", sql.Int, item.row).input("c", sql.Int, item.col)
          .query("UPDATE dbo.PlotMaster SET GridRow = @r, GridCol = @c WHERE Id = @id");
      }
      if (pairs) {
        await tx.request().input("b", sql.Int, blockId).query(`
          DELETE FROM dbo.PlotAdjacency
          WHERE PlotId IN (SELECT Id FROM dbo.PlotMaster WHERE BlockId = @b)
             OR AdjacentPlotId IN (SELECT Id FROM dbo.PlotMaster WHERE BlockId = @b)
        `);
        for (const [left, right] of pairs.values()) {
          await tx.request().input("l", sql.Int, left).input("r", sql.Int, right).input("by", sql.Int, by)
            .query("INSERT INTO dbo.PlotAdjacency (PlotId, AdjacentPlotId, CreatedBy, CreatedAt) VALUES (@l, @r, @by, SYSDATETIME())");
        }
      }
      await tx.commit();
      finished = true;
      res.json({ success: true, placed: placements.length, neighbourPairs: pairs ? pairs.size : undefined });
    } catch (error) {
      if (!finished) { try { await tx.rollback(); } catch { /* already aborted */ } }
      throw error;
    }
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) return res.status(409).json({ error: "Two plots ended up in the same cell - reload and try again" });
    console.error("[plot-master] PUT layout error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Land inventory only. Constructed assets are intentionally absent here and
// continue to be served by Unit Master after a conversion.
router.get("/", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    const where = ["p.IsActive = 1"];
    if (req.query.projectId != null) {
      const projectId = parseId(req.query.projectId);
      if (projectId === null) return res.status(400).json({ error: "Invalid projectId" });
      request.input("projectId", sql.Int, projectId);
      where.push("p.ProjectId = @projectId");
    }
    if (req.query.blockId != null) {
      const blockId = parseId(req.query.blockId);
      if (blockId === null) return res.status(400).json({ error: "Invalid blockId" });
      request.input("blockId", sql.Int, blockId);
      where.push("p.BlockId = @blockId");
    }
    if (req.query.available === "1") where.push("p.ConvertedUnitId IS NULL");
    const result = await request.query(`${PLOT_SELECT} WHERE ${where.join(" AND ")}`);
    res.json(sortPlots(result.recordset));
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
  const villaTypeId = body?.PlannedVillaTypeId == null || body.PlannedVillaTypeId === "" ? null : parseId(body.PlannedVillaTypeId);
  if (body?.PlannedVillaTypeId != null && body.PlannedVillaTypeId !== "" && villaTypeId == null) return { error: "Invalid villa type" };
  return { plotNo, plotName, surveyNo, facing, villaTypeId, isCornerPlot: body?.IsCornerPlot === true, ...parsed };
}

// A planned villa type must be an active type of the plot's own project.
// The current value is accepted unchanged even if the type was since retired.
async function resolveVillaType(pool, villaTypeId, projectId, current = null) {
  if (villaTypeId == null) return null;
  if (current != null && villaTypeId === current) return null;
  const r = await pool.request().input("id", sql.Int, villaTypeId).input("p", sql.Int, projectId)
    .query("SELECT Id FROM dbo.VillaTypeMaster WHERE Id = @id AND ProjectId = @p AND IsActive = 1");
  return r.recordset.length ? null : "Select an active villa type of this project";
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
    const facingCheck = await resolveFacing(pool, value.facing);
    if (facingCheck.error) return res.status(400).json({ error: facingCheck.error });
    value.facing = facingCheck.value;
    const villaTypeError = await resolveVillaType(pool, value.villaTypeId, projectId);
    if (villaTypeError) return res.status(400).json({ error: villaTypeError });
    const result = await pool.request()
      .input("villaType", sql.Int, value.villaTypeId)
      .input("projectId", sql.Int, projectId).input("blockId", sql.Int, blockId).input("plotNo", sql.NVarChar(50), value.plotNo).input("plotName", sql.NVarChar(100), value.plotName)
      .input("surveyNo", sql.NVarChar(100), value.surveyNo).input("area", sql.Decimal(18, 2), value.AreaSqFt).input("rate", sql.Decimal(18, 2), value.RatePerSqFt)
      .input("width", sql.Decimal(18, 2), value.PlotWidthFt).input("depth", sql.Decimal(18, 2), value.PlotDepthFt)
      .input("facing", sql.NVarChar(20), value.facing).input("corner", sql.Bit, value.isCornerPlot).input("road", sql.Decimal(18, 2), value.RoadWidthFt)
      .input("guideline", sql.Decimal(18, 2), value.GuidelineRatePerSqFt).input("by", sql.Int, req.user?.userId || null)
      .query(`INSERT INTO dbo.PlotMaster (ProjectId, BlockId, PlotNo, PlotName, SurveyNo, AreaSqFt, RatePerSqFt, PlotWidthFt, PlotDepthFt, Facing, IsCornerPlot, RoadWidthFt, GuidelineRatePerSqFt, PlannedVillaTypeId, IsActive, CreatedBy, CreatedAt)
              OUTPUT INSERTED.Id
              VALUES (@projectId, @blockId, @plotNo, @plotName, @surveyNo, @area, @rate, @width, @depth, @facing, @corner, @road, @guideline, @villaType, 1, @by, SYSDATETIME())`);
    res.status(201).json(result.recordset[0]);
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) return res.status(409).json({ error: "Another active plot in this block already uses this plot number" });
    console.error("[plot-master] POST plot error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id", requirePageRight(PAGE, "view"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid plot id" });
  try {
    const result = await getPool().request().input("id", sql.Int, id)
      .query(`${PLOT_SELECT} WHERE p.Id = @id AND p.IsActive = 1`);
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
      SELECT p.Id, p.BlockId, p.ProjectId, p.Facing, p.PlannedVillaTypeId
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
    const facingCheck = await resolveFacing(pool, value.facing, editable.recordset[0].Facing);
    if (facingCheck.error) return res.status(400).json({ error: facingCheck.error });
    value.facing = facingCheck.value;
    const villaTypeError = await resolveVillaType(pool, value.villaTypeId, editable.recordset[0].ProjectId, editable.recordset[0].PlannedVillaTypeId);
    if (villaTypeError) return res.status(400).json({ error: villaTypeError });
    const updated = await pool.request()
      .input("villaType", sql.Int, value.villaTypeId)
      .input("id", sql.Int, id).input("plotNo", sql.NVarChar(50), value.plotNo).input("plotName", sql.NVarChar(100), value.plotName)
      .input("surveyNo", sql.NVarChar(100), value.surveyNo).input("area", sql.Decimal(18, 2), value.AreaSqFt).input("rate", sql.Decimal(18, 2), value.RatePerSqFt)
      .input("width", sql.Decimal(18, 2), value.PlotWidthFt).input("depth", sql.Decimal(18, 2), value.PlotDepthFt)
      .input("facing", sql.NVarChar(20), value.facing).input("corner", sql.Bit, value.isCornerPlot).input("road", sql.Decimal(18, 2), value.RoadWidthFt)
      .input("guideline", sql.Decimal(18, 2), value.GuidelineRatePerSqFt).input("by", sql.Int, req.user?.userId || null)
      .query(`UPDATE dbo.PlotMaster
              SET PlotNo = @plotNo, PlotName = @plotName, SurveyNo = @surveyNo, AreaSqFt = @area, RatePerSqFt = @rate,
                  PlotWidthFt = @width, PlotDepthFt = @depth, Facing = @facing, IsCornerPlot = @corner,
                  RoadWidthFt = @road, GuidelineRatePerSqFt = @guideline, PlannedVillaTypeId = @villaType, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
              WHERE Id = @id`);
    if (!updated.rowsAffected[0]) return res.status(404).json({ error: "Plot not found" });
    res.json({ success: true });
  } catch (error) {
    console.error("[plot-master] PUT detail error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", requirePageRight(PAGE, "delete"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid plot id" });
  try {
    const pool = getPool();
    const tx = pool.transaction();
    await tx.begin();
    let finished = false;
    try {
      // @by was referenced but never bound, so every delete failed with "Must declare the scalar variable".
      const result = await tx.request().input("id", sql.Int, id).input("by", sql.Int, req.user?.userId || null).query(`
        UPDATE p
        SET IsActive = 0, GridRow = NULL, GridCol = NULL, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
        FROM dbo.PlotMaster p
        WHERE p.Id = @id AND p.IsActive = 1 AND p.ConvertedUnitId IS NULL
          AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp WHERE bp.PlotId = p.Id AND bp.Status = N'Active')
          AND NOT EXISTS (SELECT 1 FROM dbo.CrmApplicationPlot ap WHERE ap.PlotId = p.Id AND ap.Status = N'Active')
          AND NOT EXISTS (SELECT 1 FROM dbo.CrmInventoryHold h WHERE h.EntityType = N'Plot' AND h.EntityId = p.Id AND h.Status = N'Active' AND h.HoldUntil >= SYSDATETIME())
      `);
      if (!result.rowsAffected[0]) {
        await tx.rollback(); finished = true;
        return res.status(409).json({ error: "Only available, unconverted plots can be deleted" });
      }
      await tx.request().input("id", sql.Int, id)
        .query("DELETE FROM dbo.PlotAdjacency WHERE PlotId = @id OR AdjacentPlotId = @id");
      await tx.commit(); finished = true;
      res.json({ success: true });
    } catch (error) {
      if (!finished) { try { await tx.rollback(); } catch { /* already aborted */ } }
      throw error;
    }
  } catch (error) {
    console.error("[plot-master] DELETE error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
