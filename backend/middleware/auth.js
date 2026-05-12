const jwt = require("jsonwebtoken");
const { redisGet } = require("../redis");
const { pfaddActiveUser } = require("../redis");
const logger = require("../logger");

const BLACKLIST_PREFIX = "blacklist:";

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

    const authStart = req.timing?.startStage();

    // Check Redis blacklist (logout invalidation)
    const blacklistStart = req.timing?.startStage();
    const isBlacklisted = await redisGet(`${BLACKLIST_PREFIX}${token}`);
    if (blacklistStart) {
      req.timing.mark("auth.redis_blacklist", blacklistStart, {
        redisKey: `${BLACKLIST_PREFIX}<token>`,
      });
    }
    if (isBlacklisted) {
      return res
        .status(401)
        .json({ error: "Token has been invalidated. Please log in again." });
    }

    const jwtStart = req.timing?.startStage();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (jwtStart) req.timing.mark("auth.jwt_verify", jwtStart);
    req.user = decoded;
    req.token = token;

    // Track active user — fire-and-forget so it never blocks the request.
    // FIX: was awaited, causing 10-30 ms delay on EVERY request because
    // pfaddActiveUser issued two serial Redis commands (PFADD + EXPIRE)
    // before next() could fire. Telemetry must never hold up responses.
    pfaddActiveUser(decoded.userId).catch(() => {});

    if (authStart) {
      const durationMs = req.timing.mark("auth.total", authStart);
      if (durationMs > 1000) {
        logger.warn(
          {
            event: "AUTH_SLOW",
            requestId: req.id,
            durationMs,
            userId: decoded.userId,
            url: req.originalUrl || req.url,
          },
          "Slow auth middleware",
        );
      }
    }

    next();
  } catch (err) {
    console.error("Auth error:", err.message);
    return res.status(401).json({ error: "Invalid token" });
  }
};
