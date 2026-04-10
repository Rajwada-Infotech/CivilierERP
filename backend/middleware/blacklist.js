const { redisGet, redisSet } = require("../redis");

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
    await redisSet(`${BLACKLIST_PREFIX}${token}`, "1", ttl);
  }
}

/**
 * Express middleware — checks if the token has been blacklisted.
 * Mount BEFORE authMiddleware, or call inside it.
 */
module.exports = { blacklistToken, BLACKLIST_PREFIX };
