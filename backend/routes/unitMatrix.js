const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { cache } = require("../middleware/cache");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// GET /projects — project dropdown (mirrors unitMaster.js /projects)
router.get("/projects", requirePageRight("crm-unit-matrix", "view"), cache("unit-matrix-projects", 600), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id AS Id, name AS Name
      FROM dbo.enterprise
      WHERE business_type = 'P' AND ISNULL(discontinue, 0) = 0
      ORDER BY name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[unit-matrix] GET /projects error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /blocks?projectId= — block dropdown for the selected project
router.get("/blocks", requirePageRight("crm-unit-matrix", "view"), async (req, res) => {
  const projectId = parseInt(req.query.projectId, 10);
  try {
    const pool = getPool();
    const request = pool.request();
    let query = "SELECT Id, BlockName AS Name FROM dbo.BlockMaster WHERE IsActive = 1";
    if (Number.isFinite(projectId)) {
      request.input("pid", sql.Int, projectId);
      query += " AND ProjectId = @pid";
    }
    query += " ORDER BY BlockName";
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error("[unit-matrix] GET /blocks error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET / — the matrix itself. Status is always derived live from CrmBooking,
// never stored on UnitMaster, so it can never drift out of sync with the
// actual booking record: an administratively deactivated unit is Blocked,
// one with a live (non-cancelled) booking is Booked, everything else is
// Available.
router.get("/", requirePageRight("crm-unit-matrix", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const projectId = parseInt(req.query.projectId, 10);
    if (!Number.isFinite(projectId)) return res.status(400).json({ error: "projectId is required" });
    const blockId = parseInt(req.query.blockId, 10);

    const request = pool.request().input("pid", sql.Int, projectId);
    let where = "u.ProjectId = @pid";
    if (Number.isFinite(blockId)) {
      request.input("bid", sql.Int, blockId);
      where += " AND u.BlockId = @bid";
    }

    const result = await request.query(`
      SELECT
        u.Id, u.UnitName, u.FloorNo, u.BlockId, blk.BlockName, u.IsActive AS UnitIsActive,
        bk.Id AS BookingId, bk.BookingNo, bk.Status AS BookingStatus, bk.BookingDate,
        a.Id AS ApplicationId, a.ApplicationNo, a.ApplicantName, a.Mobile,
        assn.name AS AssignedToName, assn.email AS AssignedToEmail,
        h.Id AS HoldId, h.HoldUntil, h.ApplicationId AS HoldApplicationId,
        ha.ApplicationNo AS HoldApplicationNo, ha.ApplicantName AS HoldApplicantName, ha.Mobile AS HoldMobile,
        hassn.name AS HoldAssignedToName, hassn.email AS HoldAssignedToEmail
      FROM dbo.UnitMaster u
      LEFT JOIN dbo.BlockMaster blk ON blk.Id = u.BlockId
      LEFT JOIN dbo.CrmBooking bk ON bk.UnitId = u.Id AND bk.IsActive = 1 AND bk.Status NOT IN ('Cancelled', 'Rejected')
      LEFT JOIN dbo.CrmApplication a ON a.Id = bk.ApplicationId
      LEFT JOIN dbo.users assn ON assn.id = a.AssignedTo
      LEFT JOIN dbo.CrmInventoryHold h ON h.EntityType = 'Unit' AND h.EntityId = u.Id AND h.Status = 'Active' AND h.HoldUntil >= SYSDATETIME()
      LEFT JOIN dbo.CrmApplication ha ON ha.Id = h.ApplicationId
      LEFT JOIN dbo.users hassn ON hassn.id = ha.AssignedTo
      WHERE ${where}
      ORDER BY u.FloorNo, blk.BlockName, u.UnitName
    `);

    const units = result.recordset.map((r) => ({
      Id: r.Id,
      UnitName: r.UnitName,
      FloorNo: r.FloorNo,
      BlockId: r.BlockId,
      BlockName: r.BlockName,
      Status: !r.UnitIsActive ? "Blocked" : r.BookingId ? "Booked" : r.HoldId ? "OnHold" : "Available",
      BookingId: r.BookingId || null,
      BookingNo: r.BookingNo || null,
      BookingDate: r.BookingDate || null,
      ApplicationId: r.ApplicationId || null,
      ApplicationNo: r.ApplicationNo || null,
      ApplicantName: r.ApplicantName || null,
      Mobile: r.Mobile || null,
      AssignedToName: r.AssignedToName || null,
      AssignedToEmail: r.AssignedToEmail || null,
      HoldId: r.HoldId || null,
      HoldUntil: r.HoldUntil || null,
      HoldApplicationId: r.HoldApplicationId || null,
      HoldApplicationNo: r.HoldApplicationNo || null,
      HoldApplicantName: r.HoldApplicantName || null,
      HoldMobile: r.HoldMobile || null,
      HoldAssignedToName: r.HoldAssignedToName || null,
      HoldAssignedToEmail: r.HoldAssignedToEmail || null,
    }));

    res.json(units);
  } catch (err) {
    console.error("[unit-matrix] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
