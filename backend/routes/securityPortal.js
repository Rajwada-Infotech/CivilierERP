"use strict";

/**
 * backend/routes/securityPortal.js: the Civilier Security app for residents, mounted at /api/security-portal.
 * Residents sign in with their customer-portal account (POST /api/crm-portal/login: mobile + password), so this router
 * uses the portal's own auth (middleware/crmPortalAuth.js), never a staff token. A resident only ever sees their own
 * flats: dbo.SecurityResident rows for their CRM customer id.
 *
 *   GET  /dashboard[?residentId=<id>]  their flats, and the visitors to the chosen one (first flat by default)
 *   GET  /visitors/pending             visitors waiting at the gate for any of their flats
 *   GET  /visitors/:id                 one request for one of their flats (with every decision on it)
 *   GET  /visitors/:id/photo           its photo
 *   POST /visitors/:id/decision        { decision: "approve" | "deny", deviceId?, platform? } (the first one settles it)
 *   GET  /passes   POST /passes   POST /passes/:id/cancel      guest passes for the resident's flats
 *   GET  /gates                        the gates of their projects (and whether a guard is on duty)
 *   GET  /calls/available   POST /calls { gateId }   GET /calls/incoming   GET /calls/:id   POST /calls/:id/answer|decline|end
 *   GET  /complaints/options   GET /complaints   POST /complaints     complaints about security guards
 *   GET  /patrol   GET /patrol/:guardId?from&to   the guards posted at their project(s), and one guard's route (replay)
 */
const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const portalAuth = require("../middleware/crmPortalAuth");
const { getPool, sql } = require("../db");
const { customerDashboard, VISITOR_SELECT } = require("../services/securityDashboard");
const visitors = require("../services/securityVisitors");

router.use(portalAuth);

router.get("/dashboard", async (req, res) => {
  const customerId = Number(req.portalUser?.customerId);
  if (!customerId) return res.status(401).json({ error: "Please sign in again." });
  let residentId = null;
  if (req.query.residentId != null && req.query.residentId !== "") {
    residentId = Number.parseInt(String(req.query.residentId), 10);
    if (!Number.isInteger(residentId) || residentId <= 0) return res.status(400).json({ error: "Invalid flat." });
  }
  try {
    const data = await customerDashboard(getPool(), customerId, residentId);
    if (data.forbidden) return res.status(403).json({ error: "That flat isn't linked to your account." });
    return res.json(data);
  } catch (err) {
    if (err.number === 208) return res.status(404).json({ error: "Security isn't set up on this server yet." });
    req.log?.error?.({ err }, "security portal dashboard failed");
    return res.status(500).json({ error: "The dashboard could not be read." });
  }
});

// A request is the resident's when they are an active resident of its flat.
const MY_FLAT = `EXISTS (SELECT 1 FROM dbo.SecurityResident res WHERE res.ProjectId = r.ProjectId AND res.Block = r.Block
  AND res.FlatNo = r.FlatNo AND res.IsActive = 1 AND res.CustomerId = @c)`;
const failed = (req, res, err) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.number === 208) return res.status(404).json({ error: "Security isn't set up on this server yet." });
  req.log?.error?.({ err }, "security portal visitor failed");
  return res.status(500).json({ error: "The visitor request could not be handled." });
};
const idOf = (req) => {
  const n = Number.parseInt(String(req.params.id), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

router.get("/visitors/pending", async (req, res) => {
  try {
    const rows = (await getPool().request().input("top", sql.Int, 20).input("c", sql.Int, Number(req.portalUser.customerId))
      .query(`${VISITOR_SELECT} WHERE r.Status = N'PENDING' AND ${MY_FLAT} ORDER BY r.RequestedAt DESC`)).recordset;
    res.json(rows);
  } catch (err) {
    failed(req, res, err);
  }
});

router.get("/visitors/:id", async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(400).json({ error: "Invalid visitor request." });
  try {
    const pool = getPool();
    const row = (await pool.request().input("top", sql.Int, 1).input("id", sql.Int, id).input("c", sql.Int, Number(req.portalUser.customerId))
      .query(`${VISITOR_SELECT} WHERE r.RequestId = @id AND ${MY_FLAT}`)).recordset[0];
    if (!row) return res.status(404).json({ error: "Visitor request not found." });
    const decisions = (await pool.request().input("id", sql.Int, id).query(`
      SELECT d.Decision AS decision, d.Settled AS settled, d.DecidedAt AS at, c.CustomerName AS name
      FROM dbo.SecurityVisitorDecision d LEFT JOIN dbo.CrmCustomer c ON c.Id = d.CustomerId
      WHERE d.RequestId = @id ORDER BY d.DecidedAt`)).recordset;
    res.json({ ...row, decisions, expireAfterS: visitors.EXPIRE_S });
  } catch (err) {
    failed(req, res, err);
  }
});

router.get("/visitors/:id/photo", async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(400).json({ error: "Invalid visitor request." });
  try {
    const p = (await getPool().request().input("id", sql.Int, id).input("c", sql.Int, Number(req.portalUser.customerId)).query(`
      SELECT ph.ContentType, ph.Data FROM dbo.SecurityVisitorPhoto ph JOIN dbo.SecurityVisitorRequest r ON r.RequestId = ph.RequestId
      WHERE ph.RequestId = @id AND ${MY_FLAT}`)).recordset[0];
    if (!p) return res.status(404).json({ error: "No photo." });
    res.set({ "Content-Type": p.ContentType, "Cache-Control": "private, max-age=300" }).send(p.Data);
  } catch (err) {
    failed(req, res, err);
  }
});

router.post("/visitors/:id/decision", async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(400).json({ error: "Invalid visitor request." });
  try {
    const out = await visitors.decideVisitorRequest(getPool(), Number(req.portalUser.customerId), id, req.body?.decision, {
      deviceId: req.body?.deviceId,
      platform: req.body?.platform,
    });
    res.json({ settled: out.settled, ...out.request });
  } catch (err) {
    failed(req, res, err);
  }
});

// ── Guest passes ────────────────────────────────────────────────────────────────────────────────────────────────
const customerOf = (req) => Number(req.portalUser.customerId);

router.get("/passes", async (req, res) => {
  try {
    res.json(await visitors.myPasses(getPool(), customerOf(req)));
  } catch (err) {
    failed(req, res, err);
  }
});

router.post("/passes", async (req, res) => {
  try {
    res.status(201).json(await visitors.createPass(getPool(), customerOf(req), req.body || {}));
  } catch (err) {
    failed(req, res, err);
  }
});

router.post("/passes/:id/cancel", async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(400).json({ error: "Invalid pass." });
  try {
    res.json(await visitors.cancelPass(getPool(), customerOf(req), id));
  } catch (err) {
    failed(req, res, err);
  }
});

// ── Calls (resident side) ───────────────────────────────────────────────────────────────────────────────────────
const calls = require("../services/securityCalls");
const residentParty = (req) => ({ kind: "CUSTOMER", id: customerOf(req) });

router.get("/gates", async (req, res) => {
  try {
    res.json(await calls.gatesForResident(getPool(), customerOf(req)));
  } catch (err) {
    failed(req, res, err);
  }
});

router.get("/calls/available", (_req, res) => res.json({ inApp: calls.configured() }));

router.post("/calls", async (req, res) => {
  const gateId = Number.parseInt(String(req.body?.gateId), 10);
  if (!Number.isInteger(gateId) || gateId <= 0) return res.status(400).json({ error: "Choose the gate." });
  try {
    res.status(201).json(await calls.residentCallsGate(getPool(), customerOf(req), gateId));
  } catch (err) {
    failed(req, res, err);
  }
});

router.get("/calls/incoming", async (req, res) => {
  try {
    res.json(await calls.incomingFor(getPool(), residentParty(req)));
  } catch (err) {
    failed(req, res, err);
  }
});

router.get("/calls/:id", async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(400).json({ error: "Invalid call." });
  try {
    res.json(await calls.getCall(getPool(), residentParty(req), id));
  } catch (err) {
    failed(req, res, err);
  }
});

router.post("/calls/:id/:action", async (req, res) => {
  const id = idOf(req);
  const action = req.params.action;
  if (!id || !["answer", "decline", "end"].includes(action)) return res.status(400).json({ error: "Invalid call action." });
  try {
    const pool = getPool();
    if (action === "answer") return res.json(await calls.answerCall(pool, residentParty(req), id));
    res.json(await calls.endCall(pool, residentParty(req), id, { decline: action === "decline" }));
  } catch (err) {
    failed(req, res, err);
  }
});

// ── Complaints about guards ─────────────────────────────────────────────────────────────────────────────────────
const complaints = require("../services/securityComplaints");

router.get("/complaints/options", async (req, res) => {
  try {
    res.json(await complaints.complaintOptions(getPool(), customerOf(req)));
  } catch (err) {
    failed(req, res, err);
  }
});

router.get("/complaints", async (req, res) => {
  try {
    res.json(await complaints.myComplaints(getPool(), customerOf(req)));
  } catch (err) {
    failed(req, res, err);
  }
});

router.post("/complaints", async (req, res) => {
  try {
    res.status(201).json(await complaints.raiseComplaint(getPool(), customerOf(req), req.body || {}));
  } catch (err) {
    failed(req, res, err);
  }
});

// ── Patrol: residents watch the replay of the guards' rounds, only for guards posted at a gate of the project(s) they
// live in. The last 7 days, at most 36 hours at a time.
const tracking = require("../services/securityTracking");
const { projectPredicate } = require("../services/projectScope");
const PATROL_DAYS = 7;

async function residentProjects(pool, customerId) {
  return (
    await pool.request().input("c", sql.Int, customerId).query(`
      SELECT DISTINCT ProjectId AS id FROM dbo.SecurityResident WHERE CustomerId = @c AND IsActive = 1`)
  ).recordset.map((r) => r.id);
}

router.get("/patrol", async (req, res) => {
  try {
    const pool = getPool();
    const projects = await residentProjects(pool, customerOf(req));
    if (!projects.length) return res.json({ guards: [], zones: [] });
    const [guards, zones] = await Promise.all([
      pool.request().query(`
        SELECT u.id, u.name, MIN(g.Name) AS gateName
        FROM dbo.SecurityGuardAssignment a JOIN dbo.SecurityGate g ON g.GateId = a.GateId JOIN dbo.users u ON u.id = a.GuardUserId
        WHERE a.IsActive = 1 AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= CAST(DATEADD(DAY, -${PATROL_DAYS}, SYSUTCDATETIME()) AS DATE))
          ${projectPredicate(projects, "g.ProjectId")}
        GROUP BY u.id, u.name ORDER BY u.name`),
      tracking.zonesInScope(pool, projects),
    ]);
    res.json({
      guards: guards.recordset,
      zones: zones.filter((z) => z.IsActive).map((z) => ({ id: z.ZoneId, name: z.Name, shapes: tracking.zoneShapes(z) })),
    });
  } catch (err) {
    failed(req, res, err);
  }
});

router.get("/patrol/:id", async (req, res) => {
  const id = idOf(req);
  const from = new Date(String(req.query.from || ""));
  const to = new Date(String(req.query.to || ""));
  if (!id || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return res.status(400).json({ error: "Give the guard and a from / to time." });
  if (to - from > 36 * 3600 * 1000) return res.status(400).json({ error: "Replay at most 36 hours at a time." });
  if (from < new Date(Date.now() - PATROL_DAYS * 86400000)) return res.status(400).json({ error: `Only the last ${PATROL_DAYS} days can be replayed.` });
  try {
    const pool = getPool();
    const projects = await residentProjects(pool, customerOf(req));
    // Only a guard posted at a gate of the resident's own project(s) during the asked time.
    const ok =
      projects.length &&
      (
        await pool.request().input("g", sql.Int, id).input("f", sql.DateTime2, from).input("t", sql.DateTime2, to).query(`
          SELECT TOP 1 1 AS x FROM dbo.SecurityGuardAssignment a JOIN dbo.SecurityGate g ON g.GateId = a.GateId
          WHERE a.GuardUserId = @g AND a.IsActive = 1 AND a.EffectiveFrom <= CAST(@t AS DATE)
            AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= CAST(@f AS DATE)) ${projectPredicate(projects, "g.ProjectId")}`)
      ).recordset[0];
    if (!ok) return res.status(404).json({ error: "Guard not found." });
    const trail = await tracking.trailFor(pool, id, from, to);
    // Residents see the route, not the phone's battery or accuracy.
    res.json({ ...trail, points: trail.points.map((p) => ({ at: p.at, lat: p.lat, lng: p.lng, inZone: p.inZone })) });
  } catch (err) {
    failed(req, res, err);
  }
});

module.exports = router;
