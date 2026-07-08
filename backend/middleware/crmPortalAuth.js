/**
 * Auth middleware for the CRM customer portal — deliberately separate from
 * the staff auth middleware (middleware/auth.js). Portal tokens carry
 * { type: "crm_portal", portalUserId, applicationId } and are rejected if a
 * staff token (or any token missing that type marker) is presented, so the
 * two token spaces can never be swapped into each other's endpoints.
 */
const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  try {
    let token = null;
    if (req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }
    if (!token) return res.status(401).json({ error: "No token provided" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== "crm_portal") {
      return res.status(401).json({ error: "Invalid portal token" });
    }
    req.portalUser = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
