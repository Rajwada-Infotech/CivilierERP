const express = require("express");
const router = express.Router();
const rateLimit = require("../middleware/rateLimiter");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests" } }));

const { getPool } = require("../db");
const authenticateToken = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { projectAllowed } = require("../services/projectScope");
const { todayIst } = require("../services/fixedAssetAutoDepreciation");
const {
  previewProjectMonth, generateProjectMonth, postingHistory, generateRuns,
} = require("../services/fixedAssetDepreciationGenerate");

router.use(authenticateToken);

const PAGE = "fixed-asset-depreciation-generate";

const toInt = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const toYear = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null; };
const toMonth = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null; };

function requireUser(req, res) {
  const email = req.user?.email || req.user?.name;
  if (!email) { res.status(401).json({ error: "User context missing" }); return null; }
  return email;
}

// A project-scoped user may only work on their assigned projects.
function projectOk(req, res, projectId) {
  if (req.projectScope && !projectAllowed(req.projectScope, projectId)) {
    res.status(403).json({ error: "You don't have access to this project." });
    return false;
  }
  return true;
}

// ── GET /assets?projectId&year&month — the project's depreciation-tagged assets + their state ──
router.get("/assets", requirePageRight(PAGE, "view"), async (req, res) => {
  const projectId = toInt(req.query.projectId), year = toYear(req.query.year), month = toMonth(req.query.month);
  if (!projectId || !year || !month) return res.status(400).json({ error: "projectId, year and month are required" });
  if (!projectOk(req, res, projectId)) return;
  try {
    res.json(await previewProjectMonth(getPool(), { projectId, year, month }));
  } catch (err) {
    console.error("[fixedAssetDepreciationGenerate] GET /assets:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /generate { projectId, year, month } — post the month for every asset still due ──
router.post("/generate", requirePageRight(PAGE, "create"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;
  const projectId = toInt(req.body.projectId), year = toYear(req.body.year), month = toMonth(req.body.month);
  if (!projectId || !year || !month) return res.status(400).json({ error: "projectId, year and month are required" });
  if (!projectOk(req, res, projectId)) return;
  try {
    const result = await generateProjectMonth(getPool(), { projectId, year, month, email, today: todayIst() });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[fixedAssetDepreciationGenerate] POST /generate:", err.message);
    const status = err.code === "BAD_PERIOD" ? 400 : err.code === "BUSY" ? 409 : err.code === "CONFIG_MISSING" ? 409 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ── GET /history?projectId&year&month — Depreciation Posting History ──
router.get("/history", requirePageRight(PAGE, "view"), async (req, res) => {
  const projectId = toInt(req.query.projectId);
  if (!projectId) return res.status(400).json({ error: "projectId is required" });
  if (!projectOk(req, res, projectId)) return;
  try {
    res.json(await postingHistory(getPool(), { projectId, year: toYear(req.query.year), month: toMonth(req.query.month) }));
  } catch (err) {
    console.error("[fixedAssetDepreciationGenerate] GET /history:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /runs?projectId — recent Generate clicks for the project ──
router.get("/runs", requirePageRight(PAGE, "view"), async (req, res) => {
  const projectId = toInt(req.query.projectId);
  if (!projectId) return res.status(400).json({ error: "projectId is required" });
  if (!projectOk(req, res, projectId)) return;
  try {
    res.json(await generateRuns(getPool(), projectId));
  } catch (err) {
    console.error("[fixedAssetDepreciationGenerate] GET /runs:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
