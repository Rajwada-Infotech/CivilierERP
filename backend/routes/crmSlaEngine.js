/**
 * POST /api/crm/sla-engine/run    — manually trigger the CRM SLA engine
 * GET  /api/crm/sla-engine/status — last-run timestamp + summary
 */
const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const { isSaAdmin } = require("../services/saAccess");
const { runCrmSlaCheck } = require("../services/crmSlaEngine");

const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
router.use(authMiddleware);

let lastRun = null; // { timestamp, durationMs, summary }

router.post("/run", async (req, res) => {
  if (!isSaAdmin(req)) return res.status(403).json({ error: "Admin access required" });
  const start = Date.now();
  try {
    const summary = await runCrmSlaCheck();
    lastRun = { timestamp: new Date().toISOString(), durationMs: Date.now() - start, summary };
    res.json({ success: true, ...lastRun });
  } catch (e) {
    console.error("[crm-sla-engine] manual run error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/status", (req, res) => {
  if (!isSaAdmin(req)) return res.status(403).json({ error: "Admin access required" });
  res.json({ lastRun });
});

module.exports = router;
