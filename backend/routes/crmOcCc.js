const express = require("express");
const { parseId } = require("../middleware/validateRequest");
const router = express.Router();
// Project access: a restricted user gets 403 on records outside their projects.
{ const { crmProjectGuards, crmViaBookingSql } = require("../services/projectScope"); crmProjectGuards(router, "SELECT ProjectId FROM dbo.CrmOccupancyCertificate WHERE Id = @id"); }
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { rollupBookingTotals } = require("./crmParking");

router.use(authMiddleware);
router.use(apiRateLimit);

// A project-wide certificate covers the blocks that exist when it is
// received (migration 577) - a block added later needs its own certificate,
// and until then the project shows OC/CC as not complete. Called only when a
// project-wide certificate BECOMES Received, so editing an already-received
// one never quietly extends it to newer blocks.
async function recordProjectCertCoverage(pool, certId) {
  await pool.request().input("id", sql.Int, certId).query(`
    INSERT INTO dbo.CrmOccupancyCertificateBlock (CertificateId, BlockId)
    SELECT oc.Id, bm.Id
    FROM dbo.CrmOccupancyCertificate oc
    JOIN dbo.BlockMaster bm ON bm.ProjectId = oc.ProjectId
    WHERE oc.Id = @id AND oc.BlockId IS NULL AND oc.Status = 'Received'
      AND NOT EXISTS (SELECT 1 FROM dbo.CrmOccupancyCertificateBlock cb WHERE cb.CertificateId = oc.Id AND cb.BlockId = bm.Id)`);
}

// GET /board - every project with blocks or a certificate, worked out from
// its blocks, plus each block's coverage and the bookings still waiting.
// One call for the whole page (project scope applied).
router.get("/board", requirePageRight("crm-oc-cc", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const scope = req.projectScope ? require("../services/projectScope").projectPredicate(req.projectScope, "pv.ProjectId", "AND") : "";
    const scopeB = req.projectScope ? require("../services/projectScope").projectPredicate(req.projectScope, "v.ProjectId", "AND") : "";
    const [projects, blocks] = await Promise.all([
      pool.request().query(`
        SELECT pv.*, e.name AS ProjectName,
          (SELECT COUNT(*) FROM dbo.CrmBooking b WHERE b.ProjectId = pv.ProjectId AND b.IsActive = 1
             AND b.Status NOT IN ('Cancelled','Rejected','Expired','Transferred')) AS LiveBookings,
          (SELECT COUNT(*) FROM dbo.CrmBooking b JOIN dbo.vw_CrmBookingOcCc bv ON bv.BookingId = b.Id
            WHERE b.ProjectId = pv.ProjectId AND b.IsActive = 1 AND bv.Received = 0
              AND b.Status NOT IN ('Cancelled','Rejected','Expired','Transferred')) AS WaitingBookings
        FROM dbo.vw_CrmProjectOcCc pv
        JOIN dbo.enterprise e ON e.id = pv.ProjectId
        WHERE (pv.ActiveBlocks > 0 OR EXISTS (SELECT 1 FROM dbo.CrmOccupancyCertificate oc WHERE oc.ProjectId = pv.ProjectId)) ${scope}
        ORDER BY e.name`),
      pool.request().query(`
        SELECT v.*, oc.CertType, oc.CertificateNo,
          (SELECT COUNT(*) FROM dbo.CrmBooking b LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
            WHERE um.BlockId = v.BlockId AND b.IsActive = 1 AND b.Status NOT IN ('Cancelled','Rejected','Expired','Transferred')) AS LiveBookings
        FROM dbo.vw_CrmBlockOcCc v
        LEFT JOIN dbo.CrmOccupancyCertificate oc ON oc.Id = v.CertificateId
        WHERE v.IsActive = 1 ${scopeB}
        ORDER BY v.ProjectId, v.BlockName`),
    ]);
    res.json({ projects: projects.recordset, blocks: blocks.recordset });
  } catch (e) {
    console.error("[crm-oc-cc] GET /board error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /overview?projectId= - the project's OC/CC worked out from its blocks:
// each block (covered by its own certificate, by the project certificate, or
// not yet) and whether the project as a whole has it.
router.get("/overview", requirePageRight("crm-oc-cc", "view"), async (req, res) => {
  try {
    const projectId = parseInt(req.query.projectId, 10);
    if (!Number.isInteger(projectId)) return res.status(400).json({ error: "projectId is required" });
    const scope = require("../services/projectScope");
    if (!scope.assertProjectAllowed(req, res, projectId)) return;
    const pool = getPool();
    const [proj, blocks] = await Promise.all([
      pool.request().input("pid", sql.Int, projectId).query("SELECT * FROM dbo.vw_CrmProjectOcCc WHERE ProjectId = @pid"),
      pool.request().input("pid", sql.Int, projectId).query(`
        SELECT v.*, oc.CertType, oc.CertificateNo,
               (SELECT COUNT(*) FROM dbo.CrmBooking b LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
                 WHERE um.BlockId = v.BlockId AND b.IsActive = 1 AND b.Status NOT IN ('Cancelled','Rejected','Expired','Transferred')) AS LiveBookings
        FROM dbo.vw_CrmBlockOcCc v
        LEFT JOIN dbo.CrmOccupancyCertificate oc ON oc.Id = v.CertificateId
        WHERE v.ProjectId = @pid
        ORDER BY v.IsActive DESC, v.BlockName`),
    ]);
    res.json({ project: proj.recordset[0] || { ProjectId: projectId, ActiveBlocks: 0, CoveredBlocks: 0, Received: 0, ReceivedDate: null, Basis: "project" }, blocks: blocks.recordset });
  } catch (e) {
    console.error("[crm-oc-cc] GET /overview error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Builds the SELECT with enrichment subqueries so the list page can show
// booking counts and possession-gate status without extra round-trips.
// A row with a BlockId scopes its counts to that block's own bookings
// (via UnitMaster.BlockId); a project-wide row (BlockId IS NULL) keeps
// counting every booking in the whole project, exactly as before migration
// 447 — a project that never adopts block-level certs sees no change.
function buildSelect() {
  return [
    "SELECT oc.*,",
    "  cu.name AS CreatedByName, uu.name AS UpdatedByName,",
    "  (SELECT COUNT(*) FROM dbo.CrmBooking b",
    "   LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId",
    "   WHERE b.ProjectId = oc.ProjectId AND b.IsActive = 1",
    "     AND b.Status NOT IN ('Cancelled','Rejected', 'Expired','Transferred')",
    "     AND (oc.BlockId IS NULL OR um.BlockId = oc.BlockId)",
    "  ) AS BookingCount,",
    "  (SELECT COUNT(*) FROM dbo.CrmBooking b",
    "   LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId",
    "   JOIN dbo.CrmAgreement ag ON ag.BookingId = b.Id AND ag.Status = 'Registered'",
    "   WHERE b.ProjectId = oc.ProjectId AND b.IsActive = 1",
    "     AND b.Status NOT IN ('Cancelled','Rejected', 'Expired','Transferred')",
    "     AND (oc.BlockId IS NULL OR um.BlockId = oc.BlockId)",
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
    const { projectId, blockId, status } = req.query;
    const req0 = pool.request();
    const where = [];
    if (projectId) { req0.input("pid", sql.Int, parseInt(projectId)); where.push("oc.ProjectId = @pid"); }
    if (req.projectScope) where.push(require("../services/projectScope").projectPredicate(req.projectScope, "oc.ProjectId", "").trim());
    if (blockId)   { req0.input("bid", sql.Int, parseInt(blockId));   where.push("oc.BlockId = @bid");   }
    if (status)    { req0.input("st",  sql.NVarChar(20), status);     where.push("oc.Status = @st");    }
    const q = buildSelect() + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY oc.ProjectName, oc.BlockName, oc.CreatedAt DESC";
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

    // Optional block scope (migration 447) — a large project can have some
    // finished, ready-to-move blocks and others still under construction,
    // each needing its own OC/CC rather than one blanket flag for the whole
    // project. Omit BlockId for the original project-wide behavior.
    let blockId = null, blockName = null;
    if (b.BlockId) {
      const blk = await pool.request()
        .input("bid", sql.Int, parseInt(b.BlockId))
        .input("pid", sql.Int, parseInt(b.ProjectId))
        .query("SELECT BlockName FROM dbo.BlockMaster WHERE Id = @bid AND ProjectId = @pid AND IsActive = 1");
      if (!blk.recordset.length) return res.status(400).json({ error: "Selected block does not exist in this project" });
      blockId = parseInt(b.BlockId);
      blockName = blk.recordset[0].BlockName;
    }

    // Duplicate guard: one (ProjectId, CertType) project-wide record, or one
    // (ProjectId, BlockId, CertType) per block. A second Applied entry for
    // the same scope+type achieves nothing — if a reapplication is needed,
    // edit the existing record. Enforced at the DB level too (migration 447's
    // filtered unique indexes), but a friendly check here gives a clear message.
    const dup = await pool.request()
      .input("pid", sql.Int, parseInt(b.ProjectId))
      .input("ct",  sql.NVarChar(20), b.CertType)
      .input("bid", sql.Int, blockId)
      .query(`
        SELECT TOP 1 Id, Status FROM dbo.CrmOccupancyCertificate
        WHERE ProjectId = @pid AND CertType = @ct
          AND ((@bid IS NULL AND BlockId IS NULL) OR BlockId = @bid)
      `);
    if (dup.recordset.length) {
      const existing = dup.recordset[0];
      const scopeLabel = blockName ? `Block ${blockName}` : "this project";
      return res.status(409).json({
        error: `An ${b.CertType} record for ${scopeLabel} already exists (status: ${existing.Status}). Edit the existing record instead of creating a duplicate.`,
      });
    }

    const result = await pool.request()
      .input("pid",  sql.Int,           parseInt(b.ProjectId))
      .input("proj", sql.NVarChar(200), proj.recordset[0].name)
      .input("bid",  sql.Int,           blockId)
      .input("bname",sql.NVarChar(100), blockName)
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
        "  (ProjectId, ProjectName, BlockId, BlockName, CertType, Status, ApplicationDate, ReceivedDate, CertificateNo, IssuedBy, Remarks, CreatedBy, CreatedAt)" +
        "  OUTPUT INSERTED.Id" +
        "  VALUES (@pid, @proj, @bid, @bname, @ct, @st, @ad, @rd, @cno, @isb, @rem, @cb, SYSDATETIME())"
      );
    // Same retroactive recalc as PUT /:id — a cert can be created already
    // Received (staff recording a certificate that's been in hand for a
    // while), and any pre-existing booking in scope needs its GST
    // reassessed immediately, not left stale until some unrelated edit.
    if ((b.Status || "Applied") === "Received") {
      await recordProjectCertCoverage(pool, result.recordset[0].Id);
      // Whole project: a block's certificate can complete the project, which
      // bookings without a block follow. Recalculating an unchanged booking
      // changes nothing.
      const affected = await pool.request()
        .input("pid", sql.Int, parseInt(b.ProjectId))
        .query(`
          SELECT bk.Id FROM dbo.CrmBooking bk
          WHERE bk.ProjectId = @pid AND bk.IsActive = 1
            AND bk.Status NOT IN ('Cancelled','Rejected', 'Expired','Transferred')
        `);
      for (const row of affected.recordset) {
        try {
          await rollupBookingTotals(pool, row.Id);
        } catch (gstErr) {
          console.error(`[crm-oc-cc] GST recalc failed for booking ${row.Id}:`, gstErr.message);
        }
      }
    }

    res.status(201).json({ success: true, id: result.recordset[0].Id });
  } catch (e) {
    // DB-level unique constraint violation (migration 412) — belt-and-suspenders.
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique") ||
        e.number === 2627 || e.number === 2601) {
      return res.status(409).json({ error: "An OC/CC record for this project and certificate type already exists." });
    }
    console.error("[crm-oc-cc] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", requirePageRight("crm-oc-cc", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const b = req.body;

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT Id, ProjectId, BlockId, Status FROM dbo.CrmOccupancyCertificate WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "OC/CC record not found" });
    const wasReceived = cur.recordset[0].Status === "Received";

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

    // Becoming Received (or an already-Received cert's ReceivedDate moving)
    // can newly satisfy the GST-exemption payment-timing check (Schedule III
    // Entry 5 — see checkGstExemption in crmGst.js) for bookings that
    // already exist. Nothing else re-runs recalculateBookingGst for them —
    // it only fires on booking creation or a Unit/Parking/Extra-Charge edit
    // — so without this, a booking priced before its cert cleared would
    // silently keep charging tax forever, contradicting the whole point of
    // this feature. Scoped exactly like buildSelect()'s BookingCount above:
    // this block's bookings if BlockId is set, the whole project otherwise.
    if (b.Status === "Received" && !wasReceived) await recordProjectCertCoverage(pool, id);
    const becameReceived = b.Status === "Received" || (wasReceived && b.ReceivedDate) || (wasReceived && b.Status && b.Status !== "Received");
    if (becameReceived) {
      // Whole project (see POST): a block's certificate can complete or
      // un-complete the project that block-less bookings follow.
      const { ProjectId } = cur.recordset[0];
      const affected = await pool.request()
        .input("pid", sql.Int, ProjectId)
        .query(`
          SELECT b.Id FROM dbo.CrmBooking b
          WHERE b.ProjectId = @pid AND b.IsActive = 1
            AND b.Status NOT IN ('Cancelled','Rejected', 'Expired','Transferred')
        `);
      for (const row of affected.recordset) {
        try {
          await rollupBookingTotals(pool, row.Id);
        } catch (gstErr) {
          // One booking's recalc failing (e.g. a data quirk on a single old
          // record) shouldn't roll back the certificate update itself or
          // block every other booking in the batch from getting recalced.
          console.error(`[crm-oc-cc] GST recalc failed for booking ${row.Id}:`, gstErr.message);
        }
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-oc-cc] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
