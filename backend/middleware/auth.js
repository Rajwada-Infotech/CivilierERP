const jwt = require("jsonwebtoken");
const { redisGetStrict, pfaddActiveUser } = require("../redis");
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

    // Check Redis blacklist (logout invalidation).
    // Uses redisGetStrict so a Redis failure throws rather than returning null.
    // Fail-closed: if the blacklist cannot be consulted, reject the request
    // with 503 rather than allowing a potentially revoked token through.
    const blacklistStart = req.timing?.startStage();
    let isBlacklisted;
    try {
      isBlacklisted = await redisGetStrict(`${BLACKLIST_PREFIX}${token}`);
    } catch (err) {
      logger.error(
        { event: "BLACKLIST_CHECK_FAILED", err },
        "Redis unavailable during auth blacklist check — rejecting request (fail-closed)",
      );
      return res.status(503).json({
        error:
          "Authentication service temporarily unavailable. Please try again shortly.",
      });
    }
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
