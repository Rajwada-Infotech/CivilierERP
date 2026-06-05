"use strict";

/**
 * followupEscalation.js
 * POST /api/followup-escalation/run  — manually trigger the escalation engine
 * GET  /api/followup-escalation/status — last-run timestamp + counts
 *
 * Requires: Followup / admin permission (inherits from routePermission)
 */

const express = require("express");
const authMiddleware = require("../middleware/auth");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const { runEscalation } = require("../escalationEngine");

const router = express.Router();
const rateLimit = require("express-rate-limit");

router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 20, validate: false }));
router.use(authMiddleware);
router.use(checkPermissionForMethod("Followup", "Escalation"));

let lastRun = null; // { timestamp, durationMs }

// POST /run — trigger immediately
router.post("/run", async (req, res) => {
  const start = Date.now();
  try {
    await runEscalation();
    lastRun = {
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - start,
    };
    res.json({ success: true, ...lastRun });
  } catch (err) {
    console.error("Manual escalation error:", err);
    res.status(500).json({ error: "Escalation failed", detail: err.message });
  }
});

// GET /status — when did it last run?
router.get("/status", (req, res) => {
  res.json({ lastRun });
});

module.exports = router;