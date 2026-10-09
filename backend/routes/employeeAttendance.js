const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1500, validate: false, message: { error: "Too many requests, please try again later." } }));

const { getPool } = require("../db");
const authenticateToken = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const svc = require("../services/employeeAttendance");

router.use(authenticateToken);

const SELF = "employee-attendance";
const HR = "hr-attendance-management";

const toInt = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const toDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
const actorOf = (req) => req.user?.email || req.user?.name || "unknown";

function fail(res, err, where) {
  if (err instanceof svc.AttendanceError) return res.status(err.status).json({ error: err.message });
  console.error(`[employeeAttendance] ${where}:`, err.message);
  return res.status(500).json({ error: err.message });
}

const filtersOf = (q) => ({
  from: toDate(q.from), to: toDate(q.to), employeeId: toInt(q.employeeId), companyId: toInt(q.companyId),
  department: q.department ? String(q.department) : null, projectId: toInt(q.projectId), status: q.status ? String(q.status) : null,
});

// ═══ Employee self-service — the logged-in user's own attendance ═══

router.get("/me", requirePageRight(SELF, "view"), async (req, res) => {
  try { res.json(await svc.getMyState(getPool(), req.user)); } catch (e) { fail(res, e, "GET /me"); }
});
router.post("/me/in", requirePageRight(SELF, "create"), async (req, res) => {
  try { res.json(await svc.clockIn(getPool(), req.user, { projectId: toInt(req.body?.projectId) })); } catch (e) { fail(res, e, "POST /me/in"); }
});
router.post("/me/out", requirePageRight(SELF, "create"), async (req, res) => {
  try { res.json(await svc.clockOut(getPool(), req.user)); } catch (e) { fail(res, e, "POST /me/out"); }
});
router.post("/me/break-start", requirePageRight(SELF, "create"), async (req, res) => {
  try { res.json(await svc.breakStart(getPool(), req.user)); } catch (e) { fail(res, e, "POST /me/break-start"); }
});
router.post("/me/break-stop", requirePageRight(SELF, "create"), async (req, res) => {
  try { res.json(await svc.breakStop(getPool(), req.user)); } catch (e) { fail(res, e, "POST /me/break-stop"); }
});

// ═══ HR attendance management ═══

router.get("/hr/filters", requirePageRight(HR, "view"), async (req, res) => {
  try { res.json(await svc.hrFilterOptions(getPool())); } catch (e) { fail(res, e, "GET /hr/filters"); }
});

router.get("/hr/records", requirePageRight(HR, "view"), async (req, res) => {
  try { res.json(await svc.listRecords(getPool(), filtersOf(req.query))); } catch (e) { fail(res, e, "GET /hr/records"); }
});

router.get("/hr/summary", requirePageRight(HR, "view"), async (req, res) => {
  try {
    const f = filtersOf(req.query);
    if (!f.from || !f.to) return res.status(400).json({ error: "from and to dates are required" });
    res.json(await svc.summary(getPool(), f));
  } catch (e) { fail(res, e, "GET /hr/summary"); }
});

router.get("/hr/not-marked", requirePageRight(HR, "view"), async (req, res) => {
  try {
    const f = filtersOf(req.query);
    const date = toDate(req.query.date);
    if (!date) return res.status(400).json({ error: "date is required" });
    res.json(await svc.notMarked(getPool(), { date, companyId: f.companyId, department: f.department, employeeId: f.employeeId }));
  } catch (e) { fail(res, e, "GET /hr/not-marked"); }
});

router.get("/hr/records/:id", requirePageRight(HR, "view"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const record = await svc.getRecord(pool, id);
    if (!record) return res.status(404).json({ error: "Not found" });
    res.json({ record, audit: await svc.getAudit(pool, id) });
  } catch (e) { fail(res, e, "GET /hr/records/:id"); }
});

// Corrections — each needs a reason and is written to the audit trail.
router.put("/hr/records/:id", requirePageRight(HR, "edit"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const { inTime, outTime, reason } = req.body || {};
    const record = await svc.hrUpdateRecord(getPool(), id, { inTime, outTime, reason }, actorOf(req));
    res.json({ record, audit: await svc.getAudit(getPool(), id) });
  } catch (e) { fail(res, e, "PUT /hr/records/:id"); }
});

router.post("/hr/records/:id/breaks", requirePageRight(HR, "edit"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const { start, end, reason } = req.body || {};
    const record = await svc.hrAddBreak(getPool(), id, { start, end, reason }, actorOf(req));
    res.json({ record, audit: await svc.getAudit(getPool(), id) });
  } catch (e) { fail(res, e, "POST /hr/records/:id/breaks"); }
});

router.put("/hr/breaks/:breakId", requirePageRight(HR, "edit"), async (req, res) => {
  const breakId = toInt(req.params.breakId);
  if (!breakId) return res.status(400).json({ error: "Invalid id" });
  try {
    const { start, end, reason } = req.body || {};
    const record = await svc.hrUpdateBreak(getPool(), breakId, { start, end, reason }, actorOf(req));
    res.json({ record, audit: await svc.getAudit(getPool(), record.attendanceId) });
  } catch (e) { fail(res, e, "PUT /hr/breaks/:breakId"); }
});

router.delete("/hr/breaks/:breakId", requirePageRight(HR, "edit"), async (req, res) => {
  const breakId = toInt(req.params.breakId);
  if (!breakId) return res.status(400).json({ error: "Invalid id" });
  try {
    const record = await svc.hrDeleteBreak(getPool(), breakId, { reason: req.body?.reason ?? req.query.reason }, actorOf(req));
    res.json({ record, audit: await svc.getAudit(getPool(), record.attendanceId) });
  } catch (e) { fail(res, e, "DELETE /hr/breaks/:breakId"); }
});

module.exports = router;
