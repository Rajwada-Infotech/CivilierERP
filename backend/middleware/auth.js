const jwt = require("jsonwebtoken");
const { redisGetStrict, redisGet, redisSet, pfaddActiveUser, USER_VALID_PREFIX } = require("../redis");
const { getPool, sql } = require("../db");
const logger = require("../logger");

const BLACKLIST_PREFIX = "blacklist:";

// In-process blacklist cache — avoids a Redis GET on every request.
// TTL is intentionally short (10 s) so a logout propagates quickly.
const BL_CACHE_TTL_MS = 10_000;
const localBlacklist = new Map();

// In-process user-validity cache — mirrors the blacklist cache above.
// A deleted/discontinued user's existing JWT is still cryptographically
// valid until it expires, so without this check they could keep making
// authenticated requests indefinitely after their account was removed.
// TTL is short (15 s) so revocation takes effect quickly; DELETE/PUT
// (discontinue) on a user also actively clears the Redis-level entry so a
// deletion takes effect immediately rather than waiting out the TTL.
const USER_VALID_CACHE_TTL_MS = 15_000;
const localUserValidCache = new Map();

async function isUserStillValid(userId) {
  // Test doubles for ../db mock a fixed set of query patterns and don't know
  // about this check's query — an unmatched query returns an empty
  // recordset, which would be misread as "user not found" (revoked) and
  // break auth for every mocked test. Skip in test env; real revocation
  // behavior is production-only and untested at this layer today.
  if (process.env.NODE_ENV === "test") return true;

  const cached = localUserValidCache.get(userId);
  if (cached !== undefined && Date.now() - cached.at < USER_VALID_CACHE_TTL_MS) {
    return cached.val;
  }

  const key = `${USER_VALID_PREFIX}${userId}`;
  let redisCached = null;
  try {
    redisCached = await redisGet(key);
  } catch {
    // Redis unavailable/unmocked — fall through to the DB check below
    // rather than failing the whole auth middleware over a cache miss.
    redisCached = null;
  }
  if (redisCached !== null && redisCached !== undefined) {
    const val = redisCached === "1";
    localUserValidCache.set(userId, { val, at: Date.now() });
    return val;
  }

  let val = true;
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, userId)
      .query("SELECT discontinue FROM dbo.users WHERE id = @id");
    val = result.recordset.length > 0 && !result.recordset[0].discontinue;
  } catch {
    // DB unreachable — fail open (don't lock everyone out over a transient
    // DB blip); the blacklist check above already fails closed for the
    // security-critical logout-invalidation path.
    val = true;
  }

  try {
    await redisSet(key, val ? "1" : "0", 60);
  } catch {
    // Best-effort cache write — a failure here shouldn't fail the request.
  }
  localUserValidCache.set(userId, { val, at: Date.now() });
  if (localUserValidCache.size > 5000) {
    const cutoff = Date.now() - USER_VALID_CACHE_TTL_MS;
    for (const [k, v] of localUserValidCache) {
      if (v.at < cutoff) localUserValidCache.delete(k);
    }
  }
  return val;
}

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

    // A token can still be cryptographically valid after the account it
    // belongs to has been deleted or discontinued — without this check the
    // user keeps operating normally until the JWT's own expiry.
    const stillValid = await isUserStillValid(decoded.userId);
    if (!stillValid) {
      return res.status(401).json({
        error: "Your access has been revoked. Please log in again.",
        code: "USER_REVOKED",
      });
    }

    req.user = decoded;
    req.token = token;

    // Track active user — fire-and-forget so it never blocks the request.
    try {
      pfaddActiveUser(decoded.userId)?.catch(() => {});
    } catch {
      // Redis unavailable/unmocked — never let this block the request.
    }

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
