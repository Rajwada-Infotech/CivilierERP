const express = require("express");
const router = express.Router();
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
      entityId: b.EntityId ? parseInt(b.EntityId) : null,
      applicationId: b.ApplicationId ? parseInt(b.ApplicationId) : null,
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

// GET /application/:applicationId — every hold (active + past) for one customer
router.get("/application/:applicationId", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const applicationId = parseInt(req.params.applicationId);
    const result = await pool.request().input("aid", sql.Int, applicationId)
      .query(`${HOLD_SELECT} WHERE h.ApplicationId = @aid ORDER BY h.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-holds] GET /application error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
