"use strict";

/**
 * Login history: one row per sign-in attempt in dbo.UserLoginHistory (migration 670), written by POST /api/users/login.
 * Fire-and-forget -- a failure to log must never block or fail a sign-in.
 */

const { getPool, sql } = require("../db");

const clip = (v, n) => (v == null ? null : String(v).slice(0, n));

function recordLogin(req, { userId = null, email = null, portal = null, success, reason = null }) {
  try {
    getPool()
      .request()
      .input("UserId", sql.Int, userId)
      .input("Email", sql.NVarChar(150), clip(email, 150))
      .input("Portal", sql.NVarChar(20), clip(portal || "app", 20))
      .input("Success", sql.Bit, success ? 1 : 0)
      .input("Reason", sql.NVarChar(200), clip(reason, 200))
      .input("Ip", sql.NVarChar(64), clip(req.ip, 64))
      .input("Agent", sql.NVarChar(300), clip(req.get?.("user-agent"), 300))
      .query(
        `INSERT INTO dbo.UserLoginHistory (UserId, Email, Portal, Success, FailureReason, IpAddress, UserAgent)
         VALUES (@UserId, @Email, @Portal, @Success, @Reason, @Ip, @Agent)`,
      )
      .catch((err) => console.warn("loginHistory:", err.message));
  } catch (err) {
    console.warn("loginHistory:", err.message);
  }
}

module.exports = { recordLogin };
