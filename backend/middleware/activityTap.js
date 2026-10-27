"use strict";

// Hands every request to the activity feed (services/activityFeed.js) once it's over: route, status, time taken, who
// made it and from where. Sign-ins are reported as logins too. Mounted ahead of the routes; it reads req.user, req.id
// and req.body when the response finishes, by which time the auth middleware and body parser have filled them in.

const { recordRequest, recordLogin } = require("../services/activityFeed");

const LOGIN_PATHS = new Set(["/api/users/login", "/api/crm-portal/login", "/api/supplier-portal/login"]);

// /api/boq/123/approve → /api/boq/:id/approve, so the same route groups together whatever record it was for.
function routeOf(path) {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, "/:uuid")
    .replace(/\/\d+(?=\/|$)/g, "/:id");
}

// req.ip honours the app's "trust proxy" setting, so a visitor can't put an address of their choosing here.
function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
}

module.exports = function activityTap(req, res, next) {
  const start = process.hrtime.bigint();
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    const path = (req.originalUrl || req.url || "").split("?")[0].slice(0, 160);
    const ms = Math.round((Number(process.hrtime.bigint() - start) / 1e6) * 10) / 10;
    // The client went away before the response was sent: nginx's 499.
    const status = res.writableFinished ? res.statusCode : 499;
    const u = req.user;
    const ip = clientIp(req);

    recordRequest({
      id: req.id,
      method: req.method,
      path,
      route: routeOf(path),
      status,
      ms,
      user: u ? u.email || u.name || `#${u.userId}` : null,
      role: u?.role || null,
      ip,
      bytes: Number(res.getHeader("content-length")) || null,
    });

    if (req.method === "POST" && LOGIN_PATHS.has(path)) {
      recordLogin({
        portal: path.split("/")[2],
        email: String(req.body?.email || req.body?.username || "").slice(0, 120) || null,
        ok: status >= 200 && status < 300,
        status,
        ip,
      });
    }
  };

  res.on("finish", finish);
  res.on("close", finish);
  next();
};

module.exports.routeOf = routeOf;
