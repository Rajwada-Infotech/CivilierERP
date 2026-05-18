const { redisGetStrict, redisSet } = require("../redis");
const logger = require("../logger");

const BLACKLIST_PREFIX = "blacklist:";

/**
 * Blacklist a JWT token until it expires.
 * Call this on logout.
 * @param {string} token     - The raw JWT string
 * @param {number} expiresAt - Unix timestamp (seconds) from token's `exp` claim
 */
async function blacklistToken(token, expiresAt) {
  const ttl = expiresAt - Math.floor(Date.now() / 1000);
  if (ttl > 0) {
    // redisSet uses safeExec (swallows errors) — call getRedis directly so a
    // Redis failure surfaces to the logout handler instead of silently no-oping.
    // A logout that fails to write the blacklist entry must not return success.
    const { getRedis } = require("../redis");
    const redis = await getRedis();
    await redis.set(`${BLACKLIST_PREFIX}${token}`, "1", "EX", ttl);
  }
}

/**
 * Express middleware — checks if the token has been blacklisted.
 *
 * SECURITY POSTURE: fail-closed.
 * If Redis is unavailable we cannot verify whether the token was revoked
 * (e.g. forced logout, account suspension). For a financial ERP the safe
 * default is to reject the request with 503 rather than silently allow a
 * potentially invalidated token through.
 *
 * Mount BEFORE authMiddleware, or call inside it.
 */
async function checkBlacklist(req, res, next) {
  let token = null;
  if (req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) return next();

  try {
    const isBlacklisted = await redisGetStrict(`${BLACKLIST_PREFIX}${token}`);
    if (isBlacklisted) {
      return res
        .status(401)
        .json({ error: "Token has been invalidated. Please log in again." });
    }
    next();
  } catch (err) {
    // Redis is down — we cannot confirm the token is not revoked.
    // Fail closed: reject the request rather than risk allowing a
    // suspended/logged-out session through.
    logger.error(
      { event: "BLACKLIST_CHECK_FAILED", err },
      "Redis unavailable during blacklist check — rejecting request (fail-closed)",
    );
    return res.status(503).json({
      error:
        "Authentication service temporarily unavailable. Please try again shortly.",
    });
  }
}

module.exports = { blacklistToken, checkBlacklist };
