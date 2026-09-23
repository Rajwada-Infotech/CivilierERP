const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

// ─────────────────────────────────────────────────────────────────────────────
// DPR Activity Chain Template — define, once per Room Category, the Activity
// sequence every Room of that category should get, then Generate stamps it
// out onto every real RoomMaster row that matches. Mirrors CRM's Auto
// Project Setup (CrmProjectAutoSetupUnitTemplate + its "apply" action) —
// same "define the template once, generate everywhere" shape, just scoped
// to Room Category (where the real repetition lives in DPR) instead of
// Block. Nothing here is hardcoded: Room Categories and Activities are both
// admin-editable master data referenced purely by FK.
// ─────────────────────────────────────────────────────────────────────────────

router.use(authMiddleware);

// ── GET / — every category with an active template, plus its item count —
// list view for the Setup page. ─────────────────────────────────────────────
router.get("/", requirePageRight("dpr-activity-chain-template", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        t.Id AS templateId,
        cat.Id AS roomCategoryId,
        cat.Alias AS roomCategoryAlias,
        cat.SortOrder AS sortOrder,
        (SELECT COUNT(*) FROM dbo.DprActivityChainTemplateItem i WHERE i.TemplateId = t.Id) AS itemCount,
        t.UpdatedAt AS updatedAt, t.CreatedAt AS createdAt
      FROM dbo.RoomCategoryMaster cat
      LEFT JOIN dbo.DprActivityChainTemplate t ON t.RoomCategoryId = cat.Id AND t.IsActive = 1
      WHERE cat.IsActive = 1
      ORDER BY cat.SortOrder ASC, cat.Alias ASC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[dpr-activity-chain-template] GET / error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /:roomCategoryId — this category's saved chain (empty array if none
// yet) — the Setup page's edit form reads this. ────────────────────────────
router.get("/:roomCategoryId", requirePageRight("dpr-activity-chain-template", "view"), async (req, res) => {
  try {
    const roomCategoryId = parseInt(req.params.roomCategoryId, 10);
    if (!Number.isFinite(roomCategoryId)) return res.status(400).json({ error: "Invalid roomCategoryId" });
    const pool = getPool();
    const items = await pool.request().input("cid", sql.Int, roomCategoryId).query(`
      SELECT i.Id, i.SequenceNo, i.ActivityId, am.activity_name AS activityName
      FROM dbo.DprActivityChainTemplate t
      JOIN dbo.DprActivityChainTemplateItem i ON i.TemplateId = t.Id
      JOIN dbo.ActivityMaster am ON am.id = i.ActivityId
      WHERE t.RoomCategoryId = @cid AND t.IsActive = 1
      ORDER BY i.SequenceNo ASC
    `);
    res.json({ items: items.recordset });
  } catch (e) {
    console.error("[dpr-activity-chain-template] GET /:roomCategoryId error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /:roomCategoryId — replace the whole chain for this category in one
// transaction (deactivate template + cascade-delete its items, then
// re-create) — same "always fully replace the short list" convention
// crmProjectAutoSetup.js's unit-template PUT uses. ──────────────────────────
router.put("/:roomCategoryId", requirePageRight("dpr-activity-chain-template", "edit"), async (req, res) => {
  const pool = getPool();
  const actor = req.user?.email || req.user?.name || "system";
  try {
    const roomCategoryId = parseInt(req.params.roomCategoryId, 10);
    if (!Number.isFinite(roomCategoryId)) return res.status(400).json({ error: "Invalid roomCategoryId" });
    const activityIds = Array.isArray(req.body.ActivityIds) ? req.body.ActivityIds.map((x) => parseInt(x, 10)) : [];
    if (!activityIds.length || activityIds.some((x) => !Number.isFinite(x))) {
      return res.status(400).json({ error: "At least one valid Activity is required" });
    }

    const category = await pool.request().input("cid", sql.Int, roomCategoryId)
      .query("SELECT Id FROM dbo.RoomCategoryMaster WHERE Id = @cid AND IsActive = 1");
    if (!category.recordset.length) return res.status(404).json({ error: "Room Category not found" });

    const tx = pool.transaction();
    await tx.begin();
    try {
      // Deactivate any existing template for this category (cascade-deletes
      // its items via the ON DELETE CASCADE FK is NOT triggered by a soft
      // UPDATE, so items are cleaned up explicitly below instead).
      const existing = await tx.request().input("cid", sql.Int, roomCategoryId)
        .query("SELECT Id FROM dbo.DprActivityChainTemplate WHERE RoomCategoryId = @cid AND IsActive = 1");
      if (existing.recordset.length) {
        const oldId = existing.recordset[0].Id;
        await tx.request().input("id", sql.Int, oldId).query("DELETE FROM dbo.DprActivityChainTemplateItem WHERE TemplateId = @id");
        await tx.request().input("id", sql.Int, oldId)
          .query("UPDATE dbo.DprActivityChainTemplate SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE Id = @id");
      }

      const created = await tx.request()
        .input("cid", sql.Int, roomCategoryId)
        .input("cb", sql.NVarChar(200), actor)
        .query(`
          INSERT INTO dbo.DprActivityChainTemplate (RoomCategoryId, IsActive, CreatedBy, CreatedAt)
          OUTPUT INSERTED.Id
          VALUES (@cid, 1, @cb, SYSDATETIME())
        `);
      const templateId = created.recordset[0].Id;

      for (let i = 0; i < activityIds.length; i++) {
        await tx.request()
          .input("tid", sql.Int, templateId)
          .input("aid", sql.Int, activityIds[i])
          .input("so", sql.Int, i + 1)
          .query(`
            INSERT INTO dbo.DprActivityChainTemplateItem (TemplateId, ActivityId, SequenceNo)
            VALUES (@tid, @aid, @so)
          `);
      }
      await tx.commit();
      res.json({ message: "Activity chain template saved", templateId, itemCount: activityIds.length });
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  } catch (e) {
    console.error("[dpr-activity-chain-template] PUT /:roomCategoryId error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /:roomCategoryId — clears this category's template entirely. ────
router.delete("/:roomCategoryId", requirePageRight("dpr-activity-chain-template", "delete"), async (req, res) => {
  try {
    const roomCategoryId = parseInt(req.params.roomCategoryId, 10);
    if (!Number.isFinite(roomCategoryId)) return res.status(400).json({ error: "Invalid roomCategoryId" });
    const pool = getPool();
    const result = await pool.request().input("cid", sql.Int, roomCategoryId)
      .query("UPDATE dbo.DprActivityChainTemplate SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE RoomCategoryId = @cid AND IsActive = 1");
    if (result.rowsAffected[0] === 0) return res.status(404).json({ error: "No active template for this category" });
    res.json({ message: "Activity chain template removed" });
  } catch (e) {
    console.error("[dpr-activity-chain-template] DELETE /:roomCategoryId error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /generate — walks every RoomMaster row in scope, and for each one
// whose RoomCategoryId has an active template AND has no existing active
// DependencyMaster chain yet, creates the DependencyMaster + its
// DependencyMasterActivity rows from the template. Idempotent — rooms that
// already have a chain, or whose category has no template, are silently
// skipped and reported, never overwritten. ──────────────────────────────────
router.post("/generate", requirePageRight("dpr-activity-chain-template", "create"), async (req, res) => {
  const pool = getPool();
  const actor = req.user?.email || req.user?.name || "system";
  try {
    const projectId = req.body.ProjectId ? parseInt(req.body.ProjectId, 10) : null;
    const blockId = req.body.BlockId ? parseInt(req.body.BlockId, 10) : null;
    const workType = req.body.WorkType === "EXTERNAL" ? "EXTERNAL" : "INTERNAL";
    if (!projectId) return res.status(400).json({ error: "ProjectId is required" });

    const rooms = await pool.request()
      .input("pid", sql.Int, projectId)
      .input("bid", sql.Int, blockId)
      .query(`
        SELECT r.Id AS roomId, r.ProjectId, r.BlockId, r.UnitId, r.Floor, r.RoomName, r.RoomCategoryId
        FROM dbo.RoomMaster r
        WHERE r.ProjectId = @pid AND r.IsActive = 1
          AND (@bid IS NULL OR r.BlockId = @bid)
          AND r.RoomCategoryId IS NOT NULL
      `);

    let generated = 0;
    let skippedExisting = 0;
    let skippedNoTemplate = 0;
    const generatedRoomIds = [];

    for (const room of rooms.recordset) {
      const already = await pool.request().input("rid", sql.Int, room.roomId)
        .query("SELECT TOP 1 Id FROM dbo.DependencyMaster WHERE RoomId = @rid AND IsActive = 1");
      if (already.recordset.length) { skippedExisting++; continue; }

      const template = await pool.request().input("cid", sql.Int, room.RoomCategoryId).query(`
        SELECT t.Id AS templateId
        FROM dbo.DprActivityChainTemplate t
        WHERE t.RoomCategoryId = @cid AND t.IsActive = 1
      `);
      if (!template.recordset.length) { skippedNoTemplate++; continue; }
      const templateId = template.recordset[0].templateId;

      const items = await pool.request().input("tid", sql.Int, templateId)
        .query("SELECT ActivityId, SequenceNo FROM dbo.DprActivityChainTemplateItem WHERE TemplateId = @tid ORDER BY SequenceNo ASC");
      if (!items.recordset.length) { skippedNoTemplate++; continue; }

      // Floor is free text on DependencyMaster (see migration 320's own note
      // on why) — RoomMaster.Floor is the exact same free-text column, so
      // it's carried straight across with no lookup needed. Falls back to
      // "-" only for the rare legacy room with no Floor set at all, since
      // DependencyMaster.Floor is NOT NULL.
      const floor = room.Floor && String(room.Floor).trim() ? String(room.Floor).trim() : "-";

      const dm = await pool.request()
        .input("ProjectId", sql.Int, room.ProjectId)
        .input("TowerId", sql.Int, room.BlockId)
        .input("Floor", sql.NVarChar(50), floor)
        .input("FlatId", sql.Int, room.UnitId)
        .input("RoomId", sql.Int, room.roomId)
        .input("Alias", sql.NVarChar(200), room.RoomName)
        .input("WorkType", sql.NVarChar(20), workType)
        .input("CreatedBy", sql.NVarChar(300), actor)
        .query(`
          INSERT INTO dbo.DependencyMaster
            (ProjectId, TowerId, Floor, FlatId, RoomId, Alias, WorkType, CreatedBy, CreatedAt)
          OUTPUT INSERTED.Id AS id
          VALUES (@ProjectId, @TowerId, @Floor, @FlatId, @RoomId, @Alias, @WorkType, @CreatedBy, SYSDATETIME())
        `);
      const dependencyMasterId = dm.recordset[0].id;

      for (const item of items.recordset) {
        await pool.request()
          .input("did", sql.Int, dependencyMasterId)
          .input("aid", sql.Int, item.ActivityId)
          .input("so", sql.Int, item.SequenceNo)
          .input("wt", sql.NVarChar(20), workType)
          .query(`
            INSERT INTO dbo.DependencyMasterActivity (DependencyMasterId, ActivityId, SequenceNo, WorkType)
            VALUES (@did, @aid, @so, @wt)
          `);
      }

      generated++;
      generatedRoomIds.push(room.roomId);
    }

    res.json({
      message: generated > 0
        ? `Generated ${generated} activity chain(s)`
        : "No new activity chains to generate — every eligible room already has one, or its category has no saved template",
      generated, skippedExisting, skippedNoTemplate,
      totalRoomsInScope: rooms.recordset.length,
    });
  } catch (e) {
    console.error("[dpr-activity-chain-template] POST /generate error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
