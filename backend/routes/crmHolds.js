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

router.use(apiRateLimit);
router.use(authMiddleware);

// The Unit and Parking Matrix are where holds are placed and released, under their own rights (placing is
// "create" there, release "edit"); this route only accepted the Bookings edit right, so a matrix user without
// it was refused. Either now passes.
const { hasAnyPageAction } = require("../middleware/requirePageRight");
const holdRight = (matrixAction) => async (req, res, next) => {
  try {
    if (await hasAnyPageAction(req, "crm-bookings", ["edit"])
      || await hasAnyPageAction(req, "crm-unit-matrix", [matrixAction])
      || await hasAnyPageAction(req, "crm-parking-matrix", [matrixAction])) return next();
    return res.status(403).json({ error: "You don't have the right to change holds." });
  } catch (err) {
    console.error("[crm-holds] right check failed:", err.message);
    return res.status(500).json({ error: "Permission check error" });
  }
};

const HOLD_SELECT = `
  SELECT h.*, a.ApplicationNo, a.ApplicantName, a.Mobile, cb.name AS CreatedByName
  FROM dbo.CrmInventoryHold h
  JOIN dbo.CrmApplication a ON a.Id = h.ApplicationId
  LEFT JOIN dbo.Users cb ON cb.id = h.CreatedBy
`;

// POST / — place a hold on a unit or parking slot. Holds never auto-expire;
// they stay Active until manually released, the application is
// rejected/cancelled, or the hold converts into a real booking/allotment.
router.post("/", holdRight("create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body || {};
    const result = await placeHold(pool, {
      entityType: b.EntityType,
      entityId: b.EntityId !== undefined && b.EntityId !== null && b.EntityId !== "" ? parseInt(b.EntityId) : null,
      applicationId: b.ApplicationId !== undefined && b.ApplicationId !== null && b.ApplicationId !== "" ? parseInt(b.ApplicationId) : null,
      reason: b.Reason,
      userId: actorId(req),
    });
    await logCrmAudit(pool, "Application", parseInt(b.ApplicationId), actorId(req), [
      { field: "InventoryHold", oldVal: null, newVal: `${b.EntityType} #${b.EntityId} held for ${result.applicantName}` },
    ]);
    res.status(201).json({ success: true, id: result.id, holdUntil: result.holdUntil });
  } catch (e) {
    console.error("[crm-holds] POST error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// PUT /:id/release — manually release a hold (back to Available) — the only
// way (besides an application/booking cascade) a hold ever ends.
router.put("/:id/release", holdRight("edit"), async (req, res) => {
  try {
    const pool = getPool();
    await releaseHold(pool, parseInt(req.params.id), actorId(req));
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-holds] release error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
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
