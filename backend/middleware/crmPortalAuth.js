/**
 * Auth middleware for the CRM customer portal — deliberately separate from
 * the staff auth middleware (middleware/auth.js). Portal tokens carry
 * { type: "crm_portal", portalUserId, customerId } and are rejected if a
 * staff token (or any token missing that type marker) is presented, so the
 * two token spaces can never be swapped into each other's endpoints.
 *
 * Updated (migration 254): tokens carry customerId instead of applicationId.
 * applicationId is now a request-scoped parameter validated server-side per
 * request against the authenticated customerId — never baked into the JWT.
 */
const jwt = require("jsonwebtoken");
const { redisGetStrict } = require("../redis");

module.exports = async (req, res, next) => {
  let tokenVerified = false;
  try {
    let token = null;
    if (req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }
    if (!token) return res.status(401).json({ error: "No token provided" });

    const decoded = jwt.verify(token, process.env.PORTAL_JWT_SECRET || process.env.JWT_SECRET);
    tokenVerified = true;
    if (decoded.type !== "crm_portal") {
      return res.status(401).json({ error: "Invalid portal token" });
    }
    // Accept both new tokens (customerId) and old tokens still in the wild
    // (applicationId). Old tokens are treated as invalid since the identity
    // model changed — customers simply need to log in again.
    if (!decoded.customerId) {
      return res.status(401).json({ error: "Session expired — please log in again" });
    }
    const revoked = await redisGetStrict(`blacklist:${token}`);
    if (revoked) return res.status(401).json({ error: "Token has been invalidated. Please log in again." });
    const currentVersion = Number(await redisGetStrict(`crm-portal:session-version:${decoded.portalUserId}`)) || 0;
    if ((Number(decoded.sessionVersion) || 0) !== currentVersion) {
      return res.status(401).json({ error: "Session has expired. Please log in again." });
    }
    req.portalUser = decoded;
    req.portalToken = token;
    next();
  } catch (err) {
    if (tokenVerified) {
      return res.status(503).json({ error: "Authentication service temporarily unavailable. Please try again shortly." });
    }
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
