const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// Builds the SELECT with enrichment subqueries so the list page can show
// booking counts and possession-gate status without extra round-trips.
function buildSelect() {
  return [
    "SELECT oc.*,",
    "  cu.name AS CreatedByName, uu.name AS UpdatedByName,",
    "  (SELECT COUNT(*) FROM dbo.CrmBooking b",
    "   WHERE b.ProjectId = oc.ProjectId AND b.IsActive = 1",
    "     AND b.Status NOT IN ('Cancelled','Rejected')",
    "  ) AS BookingCount,",
    "  (SELECT COUNT(*) FROM dbo.CrmBooking b",
    "   JOIN dbo.CrmAgreement ag ON ag.BookingId = b.Id AND ag.Status = 'Registered'",
    "   WHERE b.ProjectId = oc.ProjectId AND b.IsActive = 1",
    "     AND b.Status NOT IN ('Cancelled','Rejected')",
    "     AND NOT EXISTS (SELECT 1 FROM dbo.CrmPrePossession pp WHERE pp.BookingId = b.Id)",
    "  ) AS BookingsAwaitingPossession",
    "FROM dbo.CrmOccupancyCertificate oc",
    "LEFT JOIN dbo.Users cu ON cu.id = oc.CreatedBy",
    "LEFT JOIN dbo.Users uu ON uu.id = oc.UpdatedBy",
  ].join(" ");
}

router.get("/", requirePageRight("crm-oc-cc", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { projectId, status } = req.query;
    const req0 = pool.request();
    const where = [];
    if (projectId) { req0.input("pid", sql.Int, parseInt(projectId)); where.push("oc.ProjectId = @pid"); }
    if (status)    { req0.input("st",  sql.NVarChar(20), status);     where.push("oc.Status = @st");    }
    const q = buildSelect() + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY oc.CreatedAt DESC";
    const result = await req0.query(q);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-oc-cc] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post("/", requirePageRight("crm-oc-cc", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.ProjectId)  return res.status(400).json({ error: "ProjectId is required" });
    if (!b.CertType)   return res.status(400).json({ error: "CertType is required (OC / CC / OC+CC)" });
    if (!["OC", "CC", "OC+CC"].includes(b.CertType)) return res.status(400).json({ error: "CertType must be OC, CC, or OC+CC" });

    const proj = await pool.request().input("pid", sql.Int, parseInt(b.ProjectId))
      .query("SELECT name FROM dbo.enterprise WHERE id = @pid AND business_type = 'P'");
    if (!proj.recordset.length) return res.status(400).json({ error: "Selected project does not exist" });

    const result = await pool.request()
      .input("pid",  sql.Int,           parseInt(b.ProjectId))
      .input("proj", sql.NVarChar(200), proj.recordset[0].name)
      .input("ct",   sql.NVarChar(20),  b.CertType)
      .input("st",   sql.NVarChar(20),  b.Status || "Applied")
      .input("ad",   sql.Date,          b.ApplicationDate || null)
      .input("rd",   sql.Date,          b.ReceivedDate || null)
      .input("cno",  sql.NVarChar(100), b.CertificateNo || null)
      .input("isb",  sql.NVarChar(200), b.IssuedBy || null)
      .input("rem",  sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("cb",   sql.Int,           actorId(req))
      .query(
        "INSERT INTO dbo.CrmOccupancyCertificate" +
        "  (ProjectId, ProjectName, CertType, Status, ApplicationDate, ReceivedDate, CertificateNo, IssuedBy, Remarks, CreatedBy, CreatedAt)" +
        "  OUTPUT INSERTED.Id" +
        "  VALUES (@pid, @proj, @ct, @st, @ad, @rd, @cno, @isb, @rem, @cb, SYSDATETIME())"
      );
    res.status(201).json({ success: true, id: result.recordset[0].Id });
  } catch (e) {
    console.error("[crm-oc-cc] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", requirePageRight("crm-oc-cc", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT Id FROM dbo.CrmOccupancyCertificate WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "OC/CC record not found" });

    if (b.CertType && !["OC", "CC", "OC+CC"].includes(b.CertType))
      return res.status(400).json({ error: "CertType must be OC, CC, or OC+CC" });
    if (b.Status && !["Applied", "Received"].includes(b.Status))
      return res.status(400).json({ error: "Status must be Applied or Received" });

    await pool.request()
      .input("id",  sql.Int, id)
      .input("ct",  sql.NVarChar(20),      b.CertType || null)
      .input("st",  sql.NVarChar(20),      b.Status || null)
      .input("ad",  sql.Date,              b.ApplicationDate || null)
      .input("rd",  sql.Date,              b.ReceivedDate || null)
      .input("cno", sql.NVarChar(100),     b.CertificateNo !== undefined ? (b.CertificateNo || null) : null)
      .input("isb", sql.NVarChar(200),     b.IssuedBy !== undefined ? (b.IssuedBy || null) : null)
      .input("rem", sql.NVarChar(sql.MAX), b.Remarks !== undefined ? (b.Remarks || null) : null)
      .input("ub",  sql.Int,               actorId(req))
      .query(
        "UPDATE dbo.CrmOccupancyCertificate SET" +
        "  CertType        = ISNULL(@ct,  CertType)," +
        "  Status          = ISNULL(@st,  Status)," +
        "  ApplicationDate = ISNULL(@ad,  ApplicationDate)," +
        "  ReceivedDate    = ISNULL(@rd,  ReceivedDate)," +
        "  CertificateNo   = ISNULL(@cno, CertificateNo)," +
        "  IssuedBy        = ISNULL(@isb, IssuedBy)," +
        "  Remarks         = ISNULL(@rem, Remarks)," +
        "  UpdatedBy       = @ub," +
        "  UpdatedAt       = SYSDATETIME()" +
        "  WHERE Id = @id"
      );
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-oc-cc] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
