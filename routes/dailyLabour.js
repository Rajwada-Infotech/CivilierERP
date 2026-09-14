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

const SELECT_COLUMNS = `
  dl.EntryId               AS id,
  dl.AllocationId          AS allocationId,
  ca.ProjectId             AS projectId,
  pr.name                  AS projectName,
  ahm.LHeadName            AS contractorName,
  act.activity_name         AS activityName,
  dl.EntryDate              AS entryDate,
  dl.SkilledLabourCount    AS skilledLabourCount,
  dl.UnskilledLabourCount  AS unskilledLabourCount,
  dl.SkilledLabourCount + dl.UnskilledLabourCount AS totalLabourPresent,
  dl.SkilledLabourNames    AS skilledLabourNames,
  dl.UnskilledLabourNames  AS unskilledLabourNames,
  dl.BlockId                AS blockId,
  bl.BlockName              AS blockName,
  dl.UnitId                 AS unitId,
  un.UnitName                AS unitName,
  dl.RoomId                  AS roomId,
  rm.RoomName                AS roomName,
  rm.Floor                   AS floor,
  dl.Shift                 AS shift,
  dl.AttendanceStatus      AS attendanceStatus,
  dl.Remarks               AS remarks,
  dl.CreatedBy             AS createdBy,
  dl.CreatedAt             AS createdAt,
  dl.UpdatedBy             AS updatedBy,
  dl.UpdatedAt             AS updatedAt
`;

const JOINS = `
  FROM dbo.DailyLabourEntry dl
  LEFT JOIN dbo.ContractorAllocation ca ON ca.AllocationId = dl.AllocationId
  LEFT JOIN dbo.enterprise pr ON pr.id = ca.ProjectId
  LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = ca.ContractorLHeadId
  LEFT JOIN dbo.ActivityMaster act ON act.id = ca.ActivityId
  LEFT JOIN dbo.BlockMaster bl ON bl.Id = dl.BlockId
  LEFT JOIN dbo.UnitMaster un ON un.Id = dl.UnitId
  LEFT JOIN dbo.RoomMaster rm ON rm.Id = dl.RoomId
`;

// ─── GET / — optionally filtered by allocationId / projectId / date range ─────
router.get("/", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const allocationId = req.query.allocationId ? parseInt(req.query.allocationId, 10) : null;
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const from = req.query.from || null;
    const to = req.query.to || null;

    const result = await pool.request()
      .input("allocationId", sql.Int, allocationId)
      .input("projectId", sql.Int, projectId)
      .input("from", sql.Date, from)
      .input("to", sql.Date, to)
      .query(`
        SELECT ${SELECT_COLUMNS}
        ${JOINS}
        WHERE (@allocationId IS NULL OR dl.AllocationId = @allocationId)
          AND (@projectId IS NULL OR ca.ProjectId = @projectId)
          AND (@from IS NULL OR dl.EntryDate >= @from)
          AND (@to IS NULL OR dl.EntryDate <= @to)
        ORDER BY dl.EntryDate DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("DailyLabour / error:", err);
    res.status(500).json({ error: "Failed to fetch daily labour entries" });
  }
});

// ─── POST / ────────────────────────────────────────────────────────────────────
router.post("/", authMiddleware, requirePageRight("civilworkdpr-contractor-register", "create"), async (req, res) => {
  const {
    allocationId, entryDate, skilledLabourCount, unskilledLabourCount,
    skilledLabourNames, unskilledLabourNames,
    blockId, unitId, roomId,
    shift, attendanceStatus, remarks,
  } = req.body;
  const actor = req.user?.email || req.user?.name || "system";

  if (!allocationId) return res.status(400).json({ error: "Allocation is required" });
  if (!entryDate) return res.status(400).json({ error: "Date is required" });

  try {
    const pool = getPool();
    const result = await pool.request()
      .input("allocationId", sql.Int, allocationId)
      .input("entryDate", sql.Date, entryDate)
      .input("skilled", sql.Int, skilledLabourCount || 0)
      .input("unskilled", sql.Int, unskilledLabourCount || 0)
      .input("skilledNames", sql.NVarChar(sql.MAX), cleanStr(skilledLabourNames, 4000))
      .input("unskilledNames", sql.NVarChar(sql.MAX), cleanStr(unskilledLabourNames, 4000))
      .input("blockId", sql.Int, blockId || null)
      .input("unitId", sql.Int, unitId || null)
      .input("roomId", sql.Int, roomId || null)
      .input("shift", sql.NVarChar, cleanStr(shift, 20))
      .input("attendanceStatus", sql.NVarChar, cleanStr(attendanceStatus, 20))
      .input("remarks", sql.NVarChar, cleanStr(remarks))
      .input("createdBy", sql.NVarChar, actor)
      .query(`
        INSERT INTO dbo.DailyLabourEntry
          (AllocationId, EntryDate, SkilledLabourCount, UnskilledLabourCount,
           SkilledLabourNames, UnskilledLabourNames, BlockId, UnitId, RoomId, Shift,
           AttendanceStatus, Remarks, CreatedBy, CreatedAt)
        OUTPUT INSERTED.EntryId AS id
        VALUES
          (@allocationId, @entryDate, @skilled, @unskilled,
           @skilledNames, @unskilledNames, @blockId, @unitId, @roomId, @shift,
           @attendanceStatus, @remarks, @createdBy, GETDATE())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].id });
  } catch (err) {
    console.error("DailyLabour POST error:", err);
    res.status(500).json({ error: "Failed to create labour entry" });
  }
});

// ─── PUT /:id ──────────────────────────────────────────────────────────────────
router.put("/:id", authMiddleware, requirePageRight("civilworkdpr-contractor-register", "edit"), async (req, res) => {
  const entryId = parseInt(req.params.id, 10);
  if (isNaN(entryId)) return res.status(400).json({ error: "Invalid ID" });

  const {
    entryDate, skilledLabourCount, unskilledLabourCount,
    skilledLabourNames, unskilledLabourNames,
    blockId, unitId, roomId,
    shift, attendanceStatus, remarks,
  } = req.body;
  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = getPool();
    const existing = await pool.request()
      .input("id", sql.Int, entryId)
      .query(`SELECT EntryId FROM dbo.DailyLabourEntry WHERE EntryId = @id`);
    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: "Labour entry not found" });
    }

    await pool.request()
      .input("id", sql.Int, entryId)
      .input("entryDate", sql.Date, entryDate)
      .input("skilled", sql.Int, skilledLabourCount || 0)
      .input("unskilled", sql.Int, unskilledLabourCount || 0)
      .input("skilledNames", sql.NVarChar(sql.MAX), cleanStr(skilledLabourNames, 4000))
      .input("unskilledNames", sql.NVarChar(sql.MAX), cleanStr(unskilledLabourNames, 4000))
      .input("blockId", sql.Int, blockId || null)
      .input("unitId", sql.Int, unitId || null)
      .input("roomId", sql.Int, roomId || null)
      .input("shift", sql.NVarChar, cleanStr(shift, 20))
      .input("attendanceStatus", sql.NVarChar, cleanStr(attendanceStatus, 20))
      .input("remarks", sql.NVarChar, cleanStr(remarks))
      .input("updatedBy", sql.NVarChar, actor)
      .query(`
        UPDATE dbo.DailyLabourEntry SET
          EntryDate = @entryDate, SkilledLabourCount = @skilled,
          UnskilledLabourCount = @unskilled,
          SkilledLabourNames = @skilledNames, UnskilledLabourNames = @unskilledNames,
          BlockId = @blockId, UnitId = @unitId, RoomId = @roomId,
          Shift = @shift,
          AttendanceStatus = @attendanceStatus, Remarks = @remarks,
          UpdatedBy = @updatedBy, UpdatedAt = GETDATE()
        WHERE EntryId = @id
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("DailyLabour PUT error:", err);
    res.status(500).json({ error: "Failed to update labour entry" });
  }
});

// ─── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", authMiddleware, requirePageRight("civilworkdpr-contractor-register", "delete"), async (req, res) => {
  const entryId = parseInt(req.params.id, 10);
  if (isNaN(entryId)) return res.status(400).json({ error: "Invalid ID" });

  try {
    const pool = getPool();
    const result = await pool.request()
      .input("id", sql.Int, entryId)
      .query(`DELETE FROM dbo.DailyLabourEntry WHERE EntryId = @id`);
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Labour entry not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("DailyLabour DELETE error:", err);
    res.status(500).json({ error: "Failed to delete labour entry" });
  }
});

module.exports = router;
