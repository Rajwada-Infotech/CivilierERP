"use strict";

const jwt = require("jsonwebtoken");
const { getMaintenanceState } = require("../services/maintenanceMode");

// Reachable while maintenance is on: the status check the Maintenance page itself polls, the public footers,
// the mobile apps' update check, and the login route (which refuses non-super-admins itself, with the same body).
const OPEN_PATHS = [
  /^\/system-maintenance\/status\/?$/,
  /^\/app-version\/?$/,
  /^\/feature-announcement\/?$/,
  /^\/public-stats(\/|$)/,
  /^\/app-releases\/latest\/?$/,
  /^\/users\/login\/?$/,
];

const isSuperAdmin = (role) => String(role || "").toLowerCase().replace(/[\s-]+/g, "_") === "super_admin";

/** The body every blocked call (and a blocked login) gets. The web app recognises `code`. */
function maintenanceBody(state) {
  return {
    code: "MAINTENANCE",
    error: state.message || "The system is under maintenance. Please try again shortly.",
    title: state.title,
    message: state.message,
    startedAt: state.startedAt,
    startsAt: state.startsAt,
    endsAt: state.endsAt,
  };
}

/** Mounted on /api before everything else. Once maintenance has started, only a valid super-admin token gets through. */
async function maintenanceGate(req, res, next) {
  if (req.method === "OPTIONS") return next();
  const state = await getMaintenanceState();
  if (!state.active || !state.enforced) return next(); // announced but not started yet: people can still finish
  if (OPEN_PATHS.some((re) => re.test(req.path))) return next();

  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      if (isSuperAdmin(payload.role)) return next();
    } catch {
      /* an invalid token is just another blocked caller */
    }
  }
  res.set("Retry-After", "60");
  return res.status(503).json(maintenanceBody(state));
}

module.exports = { maintenanceGate, maintenanceBody, isSuperAdmin };
