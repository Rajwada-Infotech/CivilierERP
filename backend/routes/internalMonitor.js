"use strict";

// The terminal monitor's feed (scripts/monitor.js): GET /internal/monitor/snapshot for what has happened so far, and
// GET /internal/monitor/stream for the live events as Server-Sent Events.
//
// It shows who is signed in and what they're doing, so it's locked down: only from this machine (a loopback address,
// and not relayed by a reverse proxy, which would add X-Forwarded-For), and with MONITOR_TOKEN when that's set. In
// production MONITOR_TOKEN must be set or the feed stays shut.

const express = require("express");
const { feed, snapshot, startVitals } = require("../services/activityFeed");

const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function guard(req, res, next) {
  const local = LOOPBACK.has(req.socket?.remoteAddress) && !req.headers["x-forwarded-for"];
  if (!local) return res.status(403).json({ error: "The monitor feed is only available on this machine." });
  const expected = process.env.MONITOR_TOKEN;
  if (!expected && process.env.NODE_ENV === "production") {
    return res.status(503).json({ error: "Set MONITOR_TOKEN to use the monitor in production." });
  }
  if (expected && (req.headers["x-monitor-token"] ?? req.query.token) !== expected) {
    return res.status(401).json({ error: "Wrong or missing monitor token." });
  }
  next();
}

router.use(guard);

router.get("/snapshot", (_req, res) => {
  startVitals();
  res.json(snapshot());
});

router.get("/stream", (req, res) => {
  startVitals();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const beat = setInterval(() => res.write(": ping\n\n"), 15000);
  feed.on("event", send);
  req.on("close", () => {
    clearInterval(beat);
    feed.off("event", send);
  });
});

module.exports = router;
