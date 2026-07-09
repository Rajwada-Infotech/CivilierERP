const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { applyLeadScope, actorId } = require("../services/saAccess");
const { promoteLeadToFollowup } = require("../services/saHandoff");

const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
router.use(authMiddleware);
router.use(apiRateLimit);

// GET / — all site visits (row-level scoped via the joined lead)
router.get("/", requirePageRight("sa-site-visits", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const req0 = pool.request();
    const scope0 = applyLeadScope(req0, req, "l");
    const r = await req0.query(`
      SELECT
        v.Id, v.LeadId, v.ProjectName, v.PreferredDate, v.PreferredTime,
        v.ExecutiveId, v.PickupRequired, v.CustomerNotes, v.Status,
        v.CreatedAt, v.UpdatedAt,
        l.LeadUid, l.CustomerName, l.Mobile, l.Classification,
        ex.name AS ExecutiveName
      FROM dbo.SaSiteVisit v
      JOIN  dbo.SaLead l ON v.LeadId = l.Id
      LEFT JOIN dbo.Users ex ON v.ExecutiveId = ex.id
      WHERE v.IsActive = 1 AND ${scope0}
      ORDER BY v.PreferredDate ASC, v.CreatedAt DESC
    `);
    res.json(r.recordset);
  } catch (e) {
    console.error("[sa-site-visits] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — schedule a new site visit
router.post("/", requirePageRight("sa-site-visits", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.LeadId) return res.status(400).json({ error: "LeadId required" });

    await pool.request()
      .input("lid", sql.Int, parseInt(b.LeadId))
      .input("pn", sql.NVarChar(200), b.ProjectName || null)
      .input("pd", sql.Date, b.PreferredDate || null)
      .input("pt", sql.NVarChar(20), b.PreferredTime || null)
      .input("eid", sql.Int, b.ExecutiveId || null)
      .input("pu", sql.Bit, b.PickupRequired ? 1 : 0)
      .input("cn", sql.NVarChar(sql.MAX), b.CustomerNotes || null)
      .input("st", sql.NVarChar(20), b.Status || "Scheduled")
      .input("cb", sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.SaSiteVisit
          (LeadId, ProjectName, PreferredDate, PreferredTime, ExecutiveId,
           PickupRequired, CustomerNotes, Status, IsActive, CreatedBy, CreatedAt)
        VALUES
          (@lid, @pn, @pd, @pt, @eid, @pu, @cn, @st, 1, @cb, SYSDATETIME());

        UPDATE dbo.SaLead
        SET Status = 'VisitScheduled', UpdatedAt = SYSDATETIME()
        WHERE Id = @lid AND Status NOT IN ('VisitScheduled','Visited','Booking');
      `);

    res.status(201).json({ success: true });
  } catch (e) {
    console.error("[sa-site-visits] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update a site visit; auto-promote to followup when Completed
router.put("/:id", requirePageRight("sa-site-visits", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);

    await pool.request()
      .input("id", sql.Int, id)
      .input("pn", sql.NVarChar(200), b.ProjectName || null)
      .input("pd", sql.Date, b.PreferredDate || null)
      .input("pt", sql.NVarChar(20), b.PreferredTime || null)
      .input("eid", sql.Int, b.ExecutiveId || null)
      .input("pu", sql.Bit, b.PickupRequired ? 1 : 0)
      .input("cn", sql.NVarChar(sql.MAX), b.CustomerNotes || null)
      .input("st", sql.NVarChar(20), b.Status || "Scheduled")
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.SaSiteVisit SET
          ProjectName = @pn, PreferredDate = @pd, PreferredTime = @pt,
          ExecutiveId = @eid, PickupRequired = @pu, CustomerNotes = @cn,
          Status = @st, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    if (b.Status === "Completed") {
      // Mark lead as Visited
      const leadRow = await pool.request()
        .input("id", sql.Int, id)
        .query("SELECT LeadId FROM dbo.SaSiteVisit WHERE Id = @id");

      if (leadRow.recordset.length) {
        const leadId = leadRow.recordset[0].LeadId;
        await pool.request()
          .input("lid", sql.Int, leadId)
          .query("UPDATE dbo.SaLead SET Status = 'Visited', UpdatedAt = SYSDATETIME() WHERE Id = @lid");

        // Auto-promote to follow-up module
        try {
          await promoteLeadToFollowup(pool, leadId, actorId(req));
        } catch (handoffErr) {
          // Log but don't fail the request — visit update succeeded
          console.warn("[sa-site-visits] followup promotion failed:", handoffErr.message);
        }
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[sa-site-visits] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id — soft delete
router.delete("/:id", requirePageRight("sa-site-visits", "delete"), async (req, res) => {
  try {
    const pool = getPool();
    await pool.request()
      .input("id", sql.Int, parseInt(req.params.id))
      .query("UPDATE dbo.SaSiteVisit SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[sa-site-visits] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
