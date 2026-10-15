const express = require("express");
const { parseId } = require("../middleware/validateRequest");
const router = express.Router();
// Project access: a restricted user gets 403 on records outside their projects.
{ const { crmProjectGuards, crmViaBookingSql } = require("../services/projectScope"); crmProjectGuards(router, "SELECT a.ProjectId FROM dbo.CrmInventoryHold h JOIN dbo.CrmApplication a ON a.Id = h.ApplicationId WHERE h.Id = @id"); }
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { placeHold, releaseHold } = require("../services/crmHoldService");
const { logCrmAudit } = require("../services/crmAudit");

router.use(authMiddleware);
router.use(apiRateLimit);

const HOLD_SELECT = `
  SELECT h.*, a.ApplicationNo, a.ApplicantName, a.Mobile, cb.name AS CreatedByName
  FROM dbo.CrmInventoryHold h
  JOIN dbo.CrmApplication a ON a.Id = h.ApplicationId
  LEFT JOIN dbo.Users cb ON cb.id = h.CreatedBy
`;

// POST / — place a hold on a unit or parking slot for N days
router.post("/", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body || {};
    const result = await placeHold(pool, {
      entityType: b.EntityType,
      entityId: b.EntityId !== undefined && b.EntityId !== null && b.EntityId !== "" ? parseInt(b.EntityId) : null,
      applicationId: b.ApplicationId !== undefined && b.ApplicationId !== null && b.ApplicationId !== "" ? parseInt(b.ApplicationId) : null,
      holdDays: b.HoldDays,
      reason: b.Reason,
      userId: actorId(req),
    });
    await logCrmAudit(pool, "Application", parseInt(b.ApplicationId), actorId(req), [
      { field: "InventoryHold", oldVal: null, newVal: `${b.EntityType} #${b.EntityId} held ${b.HoldDays}d for ${result.applicantName}` },
    ]);
    res.status(201).json({ success: true, id: result.id, holdUntil: result.holdUntil });
  } catch (e) {
    console.error("[crm-holds] POST error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// PUT /:id/release — manually release a hold early (back to Available)
router.put("/:id/release", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    await releaseHold(pool, parseInt(req.params.id), actorId(req));
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-holds] release error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// PUT /:id/extend — add days to an active hold. The Unit Matrix and Parking
// Matrix have offered "Extend hold" (1-90 days) all along, but this route
// never existed, so the button always failed. Extends from the later of now
// and the current end date; only an Active hold can be extended.
router.put("/:id/extend", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const days = parseInt(req.body?.AdditionalDays, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    if (!Number.isInteger(days) || days < 1 || days > 90) return res.status(400).json({ error: "Enter 1 to 90 days" });
    const r = await getPool().request().input("id", sql.Int, id).input("d", sql.Int, days)
      .query(`UPDATE dbo.CrmInventoryHold
                 SET HoldUntil = DATEADD(DAY, @d, CASE WHEN HoldUntil > SYSDATETIME() THEN HoldUntil ELSE SYSDATETIME() END),
                     HoldDays = ISNULL(HoldDays, 0) + @d
              OUTPUT INSERTED.HoldUntil
               WHERE Id = @id AND Status = N'Active'`);
    if (!r.recordset.length) return res.status(409).json({ error: "This hold is no longer active — place a new hold instead" });
    res.json({ success: true, holdUntil: r.recordset[0].HoldUntil });
  } catch (e) {
    console.error("[crm-holds] extend error:", e.message);
    res.status(500).json({ error: "Could not extend the hold" });
  }
});

// GET /application/:applicationId — every hold (active + past) for one customer
router.get("/application/:applicationId", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const applicationId = parseId(req.params.applicationId);
    if (applicationId === null) return res.status(400).json({ error: "Invalid applicationId" });
    const result = await pool.request().input("aid", sql.Int, applicationId)
      .query(`${HOLD_SELECT} WHERE h.ApplicationId = @aid ORDER BY h.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-holds] GET /application error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
