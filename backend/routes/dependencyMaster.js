const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

// ─────────────────────────────────────────────────────────────────────────────
// Dependency Master — a task scope (Project > Tower > Floor > Flat > Room)
// tagged with a user alias, Internal/External, and a strictly linear chain
// of Activity Master activities (no branching — see DependencyMasterActivity,
// migration 320).
//
// "Tower" = dbo.BlockMaster, "Flat" = dbo.UnitMaster (this codebase's own
// naming). Floor/Flat used to be derived from dbo.RoomMaster.Floor (free
// text) — meaning a Tower/Floor/Unit that hadn't had any of its rooms
// tagged in Flat Master yet was invisible here at all, since a real
// dbo.UnitMaster row with zero RoomMaster children joined to nothing.
// Floor/Flat now come from the same canonical CRM Auto Project Setup /
// dbo.UnitMaster hierarchy Flat Master's own cascade uses (see
// roomMaster.js's /structure and /units), so a unit shows up here as soon
// as it exists, whether or not its rooms have been tagged yet. Room stays
// sourced from dbo.RoomMaster — that's still the only real per-room data.
//
// Floor is still passed around as a plain string label ("G", "1", "2", …)
// for backward compatibility with every dbo.DependencyMaster.Floor value
// already stored that way — 0 -> "G", same convention roomMaster.js and
// RoomMaster.tsx's own floorLabel() already use.
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /scope-options?level=tower|floor|flat|room&projectId=&towerId=&floor=&flatId= ──
router.get("/scope-options", authMiddleware, async (req, res) => {
  const level = String(req.query.level || "");
  const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
  const towerId = req.query.towerId ? parseInt(req.query.towerId, 10) : null;
  const floor = req.query.floor ? String(req.query.floor) : null;
  const flatId = req.query.flatId ? parseInt(req.query.flatId, 10) : null;

  try {
    const pool = getPool();

    if (level === "tower") {
      if (!Number.isFinite(projectId)) return res.status(400).json({ error: "projectId is required" });
      const r = await pool.request().input("ProjectId", sql.Int, projectId).query(`
        SELECT Id AS id, BlockName AS label
        FROM dbo.BlockMaster
        WHERE ProjectId = @ProjectId AND IsActive = 1
        ORDER BY BlockName
      `);
      return res.json(r.recordset);
    }

    if (level === "floor") {
      if (!Number.isFinite(towerId)) return res.status(400).json({ error: "towerId is required" });
      // From dbo.UnitMaster directly (not RoomMaster) — a floor shows up here
      // as soon as it has units, whether or not those units have had any
      // rooms tagged in Flat Master yet.
      const r = await pool.request().input("TowerId", sql.Int, towerId).query(`
        SELECT DISTINCT FloorNo
        FROM dbo.UnitMaster
        WHERE BlockId = @TowerId AND IsActive = 1 AND FloorNo IS NOT NULL
        ORDER BY FloorNo
      `);
      return res.json(
        r.recordset.map(({ FloorNo }) => {
          const label = FloorNo === 0 ? "G" : String(FloorNo);
          return { id: label, label };
        }),
      );
    }

    if (level === "flat") {
      if (!Number.isFinite(towerId) || !floor) return res.status(400).json({ error: "towerId and floor are required" });
      // "G" -> 0, otherwise the numeric floor — same convention floor
      // options above (and roomMaster.js/RoomMaster.tsx's own floorLabel())
      // already use.
      const floorNo = floor === "G" ? 0 : parseInt(floor, 10);
      if (!Number.isFinite(floorNo)) return res.status(400).json({ error: "Invalid floor" });
      const r = await pool.request().input("TowerId", sql.Int, towerId).input("FloorNo", sql.Int, floorNo).query(`
        SELECT Id AS id, UnitName AS label
        FROM dbo.UnitMaster
        WHERE BlockId = @TowerId AND FloorNo = @FloorNo AND IsActive = 1
        ORDER BY UnitName
      `);
      return res.json(r.recordset);
    }

    if (level === "room") {
      if (!Number.isFinite(flatId) || !floor) return res.status(400).json({ error: "flatId and floor are required" });
      // Flags rooms that already have a Dependency Chain (one room = one
      // chain, see POST/PUT's own guard) so the picker can show/disable
      // them instead of only failing on save. excludeId lets an edit skip
      // flagging its own current room as "taken".
      const excludeId = req.query.excludeId ? parseInt(req.query.excludeId, 10) : null;
      const request = pool.request().input("FlatId", sql.Int, flatId).input("Floor", sql.NVarChar(50), floor);
      if (excludeId) request.input("ExcludeId", sql.Int, excludeId);
      const r = await request.query(`
        SELECT
          rm.Id AS id, rm.RoomName AS label,
          dm.Alias AS linkedAlias
        FROM dbo.RoomMaster rm
        LEFT JOIN dbo.DependencyMaster dm
          ON dm.RoomId = rm.Id ${excludeId ? "AND dm.Id <> @ExcludeId" : ""}
        WHERE rm.UnitId = @FlatId AND rm.Floor = @Floor AND rm.IsActive = 1
        ORDER BY rm.RoomName
      `);
      return res.json(r.recordset);
    }

    return res.status(400).json({ error: "level must be one of tower, floor, flat, room" });
  } catch (err) {
    console.error("[GET /dependency-master/scope-options]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET / — list (resolved scope path + activity count) ────────────────────
router.get("/", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT
        dm.Id AS id,
        dm.Alias AS alias,
        dm.WorkType AS workType,
        dm.IsActive AS isActive,
        dm.ProjectId AS projectId, ep.name AS projectName,
        dm.TowerId AS towerId, bm.BlockName AS towerName,
        dm.Floor AS floor,
        dm.FlatId AS flatId, um.UnitName AS flatName,
        dm.RoomId AS roomId, rm.RoomName AS roomName,
        dm.CreatedAt AS createdAt,
        (SELECT COUNT(*) FROM dbo.DependencyMasterActivity dma WHERE dma.DependencyMasterId = dm.Id) AS activityCount,
        -- Built server-side so the list row is ready to render as-is —
        -- the client shouldn't have to join 4 names together itself.
        CONCAT(
          ISNULL(bm.BlockName, '—'), ' > Floor ', dm.Floor,
          ' > ', ISNULL(um.UnitName, '—'), ' > ', ISNULL(rm.RoomName, '—')
        ) AS scopePath
      FROM dbo.DependencyMaster dm
      LEFT JOIN dbo.enterprise   ep ON ep.id = dm.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.BlockMaster  bm ON bm.Id = dm.TowerId
      LEFT JOIN dbo.UnitMaster   um ON um.Id = dm.FlatId
      LEFT JOIN dbo.RoomMaster   rm ON rm.Id = dm.RoomId
      ORDER BY dm.Id DESC
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error("[GET /dependency-master]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id — single record with full activity chain ──────────────────────
router.get("/:id", authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const headRes = await pool.request().input("Id", sql.Int, id).query(`
      SELECT
        dm.Id AS id,
        dm.Alias AS alias,
        dm.WorkType AS workType,
        dm.IsActive AS isActive,
        dm.ProjectId AS projectId, ep.name AS projectName,
        dm.TowerId AS towerId, bm.BlockName AS towerName,
        dm.Floor AS floor,
        dm.FlatId AS flatId, um.UnitName AS flatName,
        dm.RoomId AS roomId, rm.RoomName AS roomName,
        dm.CreatedAt AS createdAt, dm.UpdatedAt AS updatedAt
      FROM dbo.DependencyMaster dm
      LEFT JOIN dbo.enterprise   ep ON ep.id = dm.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.BlockMaster  bm ON bm.Id = dm.TowerId
      LEFT JOIN dbo.UnitMaster   um ON um.Id = dm.FlatId
      LEFT JOIN dbo.RoomMaster   rm ON rm.Id = dm.RoomId
      WHERE dm.Id = @Id
    `);
    if (!headRes.recordset.length) return res.status(404).json({ error: "Dependency record not found" });

    const activitiesRes = await pool.request().input("Id", sql.Int, id).query(`
      SELECT dma.Id AS rungId, dma.ActivityId AS activityId, am.activity_name AS activityName, dma.SequenceNo AS sequenceNo,
             dma.WorkType AS workType
      FROM dbo.DependencyMasterActivity dma
      JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
      WHERE dma.DependencyMasterId = @Id
      ORDER BY dma.SequenceNo ASC
    `);

    res.json({ ...headRes.recordset[0], activities: activitiesRes.recordset });
  } catch (err) {
    console.error("[GET /dependency-master/:id]", err);
    res.status(500).json({ error: err.message });
  }
});

function validatePayload(body) {
  const { scope, alias, workType, activities } = body;
  // projectId/towerId/flatId/roomId are real identity PKs that can
  // legitimately be 0 (historical identity-reseed corruption — see this
  // session's migrations 441/450/463 and the Id=0 rows they document), so
  // this must check presence with `== null`, never plain truthiness, or a
  // scope pointing at a real Project/Tower/Flat/Room 0 is wrongly rejected
  // as "missing".
  if (
    !scope
    || scope.projectId == null || scope.towerId == null || scope.flatId == null || scope.roomId == null
    || !scope.floor
  ) {
    return "Full scope (Project, Tower, Floor, Flat, Room) is required";
  }
  if (!alias || !String(alias).trim()) return "Alias is required";
  if (workType !== "INTERNAL" && workType !== "EXTERNAL") return "workType must be INTERNAL or EXTERNAL";
  if (!Array.isArray(activities) || activities.length === 0) return "At least one activity is required";
  return null;
}

// ── POST / — create ──────────────────────────────────────────────────────
router.post("/", authMiddleware, requirePageRight("dependency-master", "create"), async (req, res) => {
  const err = validatePayload(req.body);
  if (err) return res.status(400).json({ error: err });
  const { scope, alias, workType, activities } = req.body;
  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = getPool();

    // One Room can only ever have one Dependency Chain — a second chain on
    // the same room would mean two independent, overlapping activity
    // sequences claiming the same physical space, with no way to tell
    // which one Work Allocation/Reporting should actually follow.
    const dupe = await pool.request().input("RoomId", sql.Int, scope.roomId).query(`
      SELECT TOP 1 Id, Alias FROM dbo.DependencyMaster WHERE RoomId = @RoomId
    `);
    if (dupe.recordset.length) {
      return res.status(409).json({
        error: `This room already has a linked Dependency Chain ("${dupe.recordset[0].Alias}") — a room can only have one.`,
      });
    }

    const insertRes = await pool
      .request()
      .input("ProjectId", sql.Int, scope.projectId)
      .input("TowerId", sql.Int, scope.towerId)
      .input("Floor", sql.NVarChar(50), String(scope.floor))
      .input("FlatId", sql.Int, scope.flatId)
      .input("RoomId", sql.Int, scope.roomId)
      .input("Alias", sql.NVarChar(200), String(alias).trim())
      .input("WorkType", sql.NVarChar(20), workType)
      .input("CreatedBy", sql.NVarChar(300), actor).query(`
        INSERT INTO dbo.DependencyMaster
          (ProjectId, TowerId, Floor, FlatId, RoomId, Alias, WorkType, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id AS id
        VALUES
          (@ProjectId, @TowerId, @Floor, @FlatId, @RoomId, @Alias, @WorkType, @CreatedBy, SYSDATETIME())
      `);
    const newId = insertRes.recordset[0].id;

    for (let i = 0; i < activities.length; i++) {
      // Each rung freezes its own WorkType at the moment it's added — falls
      // back to the record's own WorkType only for older callers that don't
      // send one per activity.
      await pool
        .request()
        .input("DependencyMasterId", sql.Int, newId)
        .input("ActivityId", sql.Int, activities[i].activityId)
        .input("SequenceNo", sql.Int, i + 1)
        .input("WorkType", sql.NVarChar(20), activities[i].workType || workType)
        .query(`
          INSERT INTO dbo.DependencyMasterActivity (DependencyMasterId, ActivityId, SequenceNo, WorkType)
          VALUES (@DependencyMasterId, @ActivityId, @SequenceNo, @WorkType)
        `);
    }

    res.status(201).json({ success: true, id: newId, message: "Dependency record created" });
  } catch (err2) {
    console.error("[POST /dependency-master]", err2);
    res.status(500).json({ error: err2.message });
  }
});

// ── PUT /:id — update ───────────────────────────────────────────────────────
// The chain is reconciled against the saved rungs instead of deleted and
// re-inserted wholesale. Every rung's row id (rungId) is what Work Allocation
// assignments, blueprint annotations, photos, worker rosters and attendance hang
// off — rebuilding all of them on each save wiped that data for the WHOLE chain
// (or, where attendance existed, failed on its foreign key), which is why removing
// one activity meant recreating the entire record. Now:
//   - a rung that stays keeps its id (and everything attached to it);
//   - a rung that's removed is deleted alone (its assignments/photos/annotations
//     cascade, its worker roster is cleared) — unless attendance was already
//     recorded against it, which is history worth protecting, so that's refused;
//   - a new activity gets a new rung.
router.put("/:id", authMiddleware, requirePageRight("dependency-master", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  const err = validatePayload(req.body);
  if (err) return res.status(400).json({ error: err });
  const { scope, alias, workType, activities } = req.body;
  const actor = req.user?.email || req.user?.name || "system";

  let tx;
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id).query(`SELECT Id FROM dbo.DependencyMaster WHERE Id = @Id`);
    if (!existing.recordset.length) return res.status(404).json({ error: "Dependency record not found" });

    // Same one-chain-per-room rule as POST / — excludes this record itself
    // so re-saving without actually changing the room doesn't self-conflict.
    const dupe = await pool.request()
      .input("RoomId", sql.Int, scope.roomId)
      .input("Id", sql.Int, id)
      .query(`SELECT TOP 1 Id, Alias FROM dbo.DependencyMaster WHERE RoomId = @RoomId AND Id <> @Id`);
    if (dupe.recordset.length) {
      return res.status(409).json({
        error: `This room already has a linked Dependency Chain ("${dupe.recordset[0].Alias}") — a room can only have one.`,
      });
    }

    tx = pool.transaction();
    await tx.begin();

    await tx
      .request()
      .input("Id", sql.Int, id)
      .input("ProjectId", sql.Int, scope.projectId)
      .input("TowerId", sql.Int, scope.towerId)
      .input("Floor", sql.NVarChar(50), String(scope.floor))
      .input("FlatId", sql.Int, scope.flatId)
      .input("RoomId", sql.Int, scope.roomId)
      .input("Alias", sql.NVarChar(200), String(alias).trim())
      .input("WorkType", sql.NVarChar(20), workType)
      .input("UpdatedBy", sql.NVarChar(300), actor).query(`
        UPDATE dbo.DependencyMaster SET
          ProjectId = @ProjectId, TowerId = @TowerId, Floor = @Floor,
          FlatId = @FlatId, RoomId = @RoomId, Alias = @Alias, WorkType = @WorkType,
          UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);

    const saved = (
      await tx.request().input("Id", sql.Int, id).query(
        `SELECT dma.Id, dma.ActivityId, am.activity_name AS ActivityName
         FROM dbo.DependencyMasterActivity dma
         LEFT JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
         WHERE dma.DependencyMasterId = @Id`,
      )
    ).recordset;
    const savedById = new Map(saved.map((r) => [Number(r.Id), r]));

    // A submitted rung is "kept" only if it points at a saved rung of this chain
    // and still names the same activity; anything else is a new rung.
    const keptIds = new Set();
    const plan = activities.map((a, i) => {
      const rungId = Number(a.rungId);
      const match = savedById.get(rungId);
      const keep = match && Number(match.ActivityId) === Number(a.activityId) && !keptIds.has(rungId);
      if (keep) keptIds.add(rungId);
      return { rungId: keep ? rungId : null, activityId: a.activityId, workType: a.workType || workType, seq: i + 1 };
    });
    const removed = saved.filter((r) => !keptIds.has(Number(r.Id)));

    for (const r of removed) {
      const att = await tx.request().input("Rung", sql.Int, r.Id)
        .query(`SELECT COUNT(*) AS n FROM dbo.WorkerAttendance WHERE DependencyMasterActivityId = @Rung`);
      if (att.recordset[0].n > 0) {
        await tx.rollback();
        return res.status(409).json({
          error: `Can't remove "${r.ActivityName || "this activity"}" — worker attendance has already been recorded against it (${att.recordset[0].n} entr${att.recordset[0].n === 1 ? "y" : "ies"}).`,
        });
      }
      await tx.request().input("Rung", sql.Int, r.Id)
        .query(`DELETE FROM dbo.WorkerActivityRoster WHERE DependencyMasterActivityId = @Rung`);
      await tx.request().input("Rung", sql.Int, r.Id)
        .query(`DELETE FROM dbo.DependencyMasterActivity WHERE Id = @Rung`);
    }

    // (DependencyMasterId, SequenceNo) is unique, so park the kept rungs on
    // temporary negative numbers before assigning their final positions.
    for (const step of plan.filter((p) => p.rungId)) {
      await tx.request().input("Rung", sql.Int, step.rungId)
        .query(`UPDATE dbo.DependencyMasterActivity SET SequenceNo = -Id WHERE Id = @Rung`);
    }
    for (const step of plan) {
      if (step.rungId) {
        await tx
          .request()
          .input("Rung", sql.Int, step.rungId)
          .input("SequenceNo", sql.Int, step.seq)
          .input("WorkType", sql.NVarChar(20), step.workType)
          .query(`UPDATE dbo.DependencyMasterActivity SET SequenceNo = @SequenceNo, WorkType = @WorkType WHERE Id = @Rung`);
      } else {
        await tx
          .request()
          .input("DependencyMasterId", sql.Int, id)
          .input("ActivityId", sql.Int, step.activityId)
          .input("SequenceNo", sql.Int, step.seq)
          .input("WorkType", sql.NVarChar(20), step.workType)
          .query(`
            INSERT INTO dbo.DependencyMasterActivity (DependencyMasterId, ActivityId, SequenceNo, WorkType)
            VALUES (@DependencyMasterId, @ActivityId, @SequenceNo, @WorkType)
          `);
      }
    }

    await tx.commit();
    res.json({ success: true, message: "Dependency record updated" });
  } catch (err2) {
    if (tx) {
      try {
        await tx.rollback();
      } catch {
        /* already rolled back / never begun */
      }
    }
    console.error("[PUT /dependency-master/:id]", err2);
    res.status(500).json({ error: err2.message });
  }
});

// ── DELETE /:id — hard delete ───────────────────────────────────────────
router.delete("/:id", authMiddleware, requirePageRight("dependency-master", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id).query(`SELECT Alias FROM dbo.DependencyMaster WHERE Id = @Id`);
    if (!existing.recordset.length) return res.status(404).json({ error: "Dependency record not found" });

    // Hard delete — DependencyMasterActivity rows cascade automatically
    // (FK_DependencyMasterActivity_Master ON DELETE CASCADE, migration 320).
    // Worker rosters (no cascade) are just per-activity setup — clear them so they don't block the delete.
    await pool.request().input("Id", sql.Int, id).query(`
      DELETE FROM dbo.WorkerActivityRoster
      WHERE DependencyMasterActivityId IN (SELECT Id FROM dbo.DependencyMasterActivity WHERE DependencyMasterId = @Id)
    `);
    await pool.request().input("Id", sql.Int, id).query(`DELETE FROM dbo.DependencyMaster WHERE Id = @Id`);

    res.json({ success: true, message: `"${existing.recordset[0].Alias}" deleted` });
  } catch (err) {
    // 547 = FK violation: worker attendance (no cascade) references its rungs.
    if (err.number === 547) {
      return res.status(409).json({
        error: "This dependency can't be deleted — worker attendance has already been recorded against its activities.",
      });
    }
    console.error("[DELETE /dependency-master/:id]", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
