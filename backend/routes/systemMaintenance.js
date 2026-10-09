"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const authMiddleware = require("../middleware/auth");
const { getMaintenanceState, setMaintenance } = require("../services/maintenanceMode");
const { isSuperAdmin } = require("../middleware/maintenanceGate");

const router = express.Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 3000, validate: false, message: { error: "Too many requests, please try again later." } }));

const MAX_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_WARNING_MINUTES = 60;

// Public: the Maintenance page polls this to know whether it can send people back in.
router.get("/status", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(await getMaintenanceState());
});

// Super admin only: switch maintenance on (with a message and the expected end) or off.
router.put("/", authMiddleware, async (req, res) => {
  if (!isSuperAdmin(req.user?.role)) {
    return res.status(403).json({ error: "Only a super admin can change maintenance mode." });
  }
  const { active, title, message, endsAt, startInMinutes } = req.body || {};
  if (typeof active !== "boolean") return res.status(400).json({ error: "active must be true or false." });

  // How long people get to finish what they are doing: 0 holds everyone at once.
  let startsAt = null;
  if (active && startInMinutes !== undefined && startInMinutes !== null) {
    const m = Number(startInMinutes);
    if (!Number.isInteger(m) || m < 0 || m > MAX_WARNING_MINUTES) {
      return res.status(400).json({ error: `startInMinutes must be a whole number from 0 to ${MAX_WARNING_MINUTES}.` });
    }
    if (m > 0) startsAt = new Date(Date.now() + m * 60_000);
  }

  let ends = null;
  if (active && endsAt) {
    ends = new Date(endsAt);
    if (Number.isNaN(ends.getTime())) return res.status(400).json({ error: "endsAt is not a valid date and time." });
    if (ends.getTime() <= Date.now()) return res.status(400).json({ error: "The expected end must be in the future." });
    if (startsAt && ends.getTime() <= startsAt.getTime()) return res.status(400).json({ error: "The expected end must be after maintenance starts." });
    if (ends.getTime() - Date.now() > MAX_AHEAD_MS) return res.status(400).json({ error: "The expected end is more than 30 days away." });
  }
  const cleanTitle = typeof title === "string" ? title.trim().slice(0, 120) : "";
  const cleanMessage = typeof message === "string" ? message.trim().slice(0, 500) : "";

  try {
    const state = await setMaintenance({
      active,
      title: cleanTitle,
      message: cleanMessage,
      startsAt,
      endsAt: ends,
      by: req.user?.name || req.user?.email || null,
    });
    res.json(state);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
