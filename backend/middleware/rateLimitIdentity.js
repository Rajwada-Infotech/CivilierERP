"use strict";

const jwt = require("jsonwebtoken");

/**
 * Who an API request counts against for rate limiting.
 *
 * The limiter used to key on req.ip because it runs BEFORE the auth middleware (req.user is not set yet). But every
 * person in one office shares one public IP, and behind a load balancer every request can arrive from the balancer's
 * own address - so the whole company shared a single 1000-requests-a-minute bucket, and busy mornings answered
 * "429 Too many requests" to everyone at once.
 *
 * So the signed-in person is identified here, from a VERIFIED token (a forged token verifies as nobody and falls
 * back to the IP bucket - it can never borrow someone else's), and each person gets their own bucket. Requests with
 * no valid token (login page, public status checks) still count against the IP.
 */
function attachRateLimitUser(req, _res, next) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      if (payload && payload.userId != null) req.rateLimitUserId = payload.userId;
    } catch {
      /* not a valid token: counted by IP */
    }
  }
  next();
}

const rateLimitKey = (req) => (req.rateLimitUserId != null ? `user:${req.rateLimitUserId}` : req.ip);

/**
 * Login attempts are counted per email address, not per IP: behind Docker / the load balancer every request shares one
 * address, so "20 attempts per IP" meant 20 logins for the whole company - and when maintenance ends and everyone signs
 * back in at once, the 21st person was refused. Guessing one account's password is still capped at 20 tries per 15
 * minutes; a separate, much higher per-IP cap (see server.js) still stops one machine spraying many accounts.
 */
const loginRateLimitKey = (req) => {
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  return email ? `email:${email.slice(0, 254)}` : req.ip;
};

module.exports = { attachRateLimitUser, rateLimitKey, loginRateLimitKey };
