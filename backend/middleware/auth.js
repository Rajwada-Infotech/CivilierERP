const jwt = require("jsonwebtoken");
const { redisGet } = require("../redis");
const { BLACKLIST_PREFIX } = require("./blacklist");

module.exports = async (req, res, next) => {
  try {
    let token = null;

    if (req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }
    if (!token && req.query.token) {
      token = req.query.token;
    }
    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Reject tokens issued before last server boot
    const bootTime = await redisGet("server:boot");
    if (bootTime && decoded.iat * 1000 < parseInt(bootTime)) {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    // Check Redis blacklist (logout invalidation) — only after JWT is valid
    const isBlacklisted = await redisGet(`${BLACKLIST_PREFIX}${token}`);
    if (isBlacklisted) {
      return res.status(401).json({ error: "Token has been invalidated. Please log in again." });
    }

    req.user = decoded;
    req.token = token; // store for use in logout route

    next();
  } catch (err) {
    console.error("Auth error:", err.message);
    return res.status(401).json({ error: "Invalid token" });
  }
};
