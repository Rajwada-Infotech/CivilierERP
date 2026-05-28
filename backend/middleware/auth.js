const jwt = require("jsonwebtoken");
const { redisGetStrict, pfaddActiveUser } = require("../redis");
const logger = require("../logger");

const BLACKLIST_PREFIX = "blacklist:";

// In-process blacklist cache — avoids a Redis GET on every request.
// TTL is intentionally short (10 s) so a logout propagates quickly.
const BL_CACHE_TTL_MS = 10_000;
const localBlacklist = new Map();

async function checkBlacklist(token) {
  const cached = localBlacklist.get(token);
  if (cached !== undefined && Date.now() - cached.at < BL_CACHE_TTL_MS) {
    return cached.val;
  }
  const val = await redisGetStrict(`${BLACKLIST_PREFIX}${token}`);
  localBlacklist.set(token, { val, at: Date.now() });
  // Evict stale entries lazily to avoid unbounded growth
  if (localBlacklist.size > 5000) {
    const cutoff = Date.now() - BL_CACHE_TTL_MS;
    for (const [k, v] of localBlacklist) {
      if (v.at < cutoff) localBlacklist.delete(k);
    }
  }
  return val;
}

module.exports = async (req, res, next) => {
  try {
    let token = null;

    if (req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
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
      isBlacklisted = await checkBlacklist(token);
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
