const express = require("express");
const { parseId } = require("../middleware/validateRequest");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { applyLeadScope, actorId } = require("../services/saAccess");
const { statusesThatCanMoveTo } = require("../constants/saStatuses");
const { confirmSiteVisit } = require("../services/saMessaging");

// Move a lead to `to` only if STATUS_TRANSITIONS allows it from its current
// status. The check is in the UPDATE's WHERE, so it's atomic. Returns true
// when the lead actually moved.
async function advanceLead(pool, leadId, to) {
  const from = statusesThatCanMoveTo(to);
  const r = pool.request().input("lid", sql.Int, leadId).input("to", sql.NVarChar(30), to);
  from.forEach((f, i) => r.input(`f${i}`, sql.NVarChar(30), f));
  const result = await r.query(`
    UPDATE dbo.SaLead SET Status = @to, UpdatedAt = SYSDATETIME()
    WHERE Id = @lid AND Status IN (${from.map((_, i) => `@f${i}`).join(", ")})
  `);
  return result.rowsAffected[0] > 0;
}

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
      WHERE v.IsActive = 1 AND l.IsActive = 1 AND ${scope0}
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
    const lid = parseId(b.LeadId);
    if (lid === null) return res.status(400).json({ error: "Valid LeadId required" });

    const scopeReq = pool.request();
    const scope = applyLeadScope(scopeReq, req, "l");
    const owned = await scopeReq.input("lid", sql.Int, lid)
      .query(`SELECT 1 AS ok FROM dbo.SaLead l WHERE l.Id = @lid AND l.IsActive = 1 AND ${scope}`);
    if (!owned.recordset.length) return res.status(403).json({ error: "Access denied or lead not found" });

    // No conflict check existed at all — two different leads could be
    // scheduled to the same executive at the same date+time with nothing
    // to catch it.
    if (b.ExecutiveId && b.PreferredDate && b.PreferredTime) {
      const clash = await pool.request()
        .input("eid", sql.Int, parseInt(b.ExecutiveId))
        .input("pd", sql.Date, b.PreferredDate)
        .input("pt", sql.NVarChar(20), b.PreferredTime)
        .query(`
          SELECT TOP 1 Id FROM dbo.SaSiteVisit
          WHERE ExecutiveId = @eid AND PreferredDate = @pd AND PreferredTime = @pt
            AND IsActive = 1 AND Status NOT IN ('Cancelled', 'Completed')
        `);
      if (clash.recordset.length) {
        return res.status(409).json({ error: "This executive already has a site visit booked for that date and time." });
      }
    }

    const visit = await pool.request()
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
        OUTPUT INSERTED.LeadId, INSERTED.ProjectName, INSERTED.PreferredDate, INSERTED.PreferredTime, INSERTED.PickupRequired, INSERTED.Status
        VALUES
          (@lid, @pn, @pd, @pt, @eid, @pu, @cn, @st, 1, @cb, SYSDATETIME());
      `);
    await advanceLead(pool, parseInt(b.LeadId), "VisitScheduled");

    res.status(201).json({ success: true });
    const booked = visit.recordset[0];
    if (booked.Status === "Scheduled") confirmSiteVisit(pool, booked, actorId(req));
  } catch (e) {
    console.error("[sa-site-visits] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update a site visit; moves the lead to Visited when Completed
router.put("/:id", requirePageRight("sa-site-visits", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });

    // GET / scopes by applyLeadScope so a sales_person/team_lead only ever
    // sees their own leads' visits — PUT/DELETE never checked that, letting
    // anyone with the edit/delete page right mark or remove another
    // salesperson's visit (including triggering the Completed lead move
    // below) by id alone.
    const scopeReq = pool.request();
    const scope = applyLeadScope(scopeReq, req, "l");
    const owned = await scopeReq.input("id", sql.Int, id)
      .query(`SELECT 1 AS ok FROM dbo.SaSiteVisit v JOIN dbo.SaLead l ON l.Id = v.LeadId WHERE v.Id = @id AND ${scope}`);
    if (!owned.recordset.length) return res.status(403).json({ error: "Access denied" });

    // Read the visit before saving so a re-save of an already-Completed
    // visit (e.g. fixing a note) doesn't re-run the lead move / promotion.
    const before = await pool.request().input("id", sql.Int, id)
      .query("SELECT LeadId, Status FROM dbo.SaSiteVisit WHERE Id = @id");
    const prev = before.recordset[0];

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

    if (b.Status === "Completed" && prev && prev.Status !== "Completed") {
      // Forward only: a Booking or Lost lead is left as it is.
      await advanceLead(pool, prev.LeadId, "Visited");
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
    const id = parseInt(req.params.id);
    const scopeReq = pool.request();
    const scope = applyLeadScope(scopeReq, req, "l");
    const owned = await scopeReq.input("id", sql.Int, id)
      .query(`SELECT 1 AS ok FROM dbo.SaSiteVisit v JOIN dbo.SaLead l ON l.Id = v.LeadId WHERE v.Id = @id AND ${scope}`);
    if (!owned.recordset.length) return res.status(403).json({ error: "Access denied" });
    await pool.request()
      .input("id", sql.Int, id)
      .query("UPDATE dbo.SaSiteVisit SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[sa-site-visits] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
