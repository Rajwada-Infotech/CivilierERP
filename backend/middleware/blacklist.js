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
async function checkBlacklist(req, res, next) {
  try {
    let token = null;
    if (req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.query.token) {
      token = req.query.token;
    }

    if (token) {
      const isBlacklisted = await redisGet(`${BLACKLIST_PREFIX}${token}`);
      if (isBlacklisted) {
        return res.status(401).json({ error: "Token has been invalidated. Please log in again." });
      }
    }
  } catch {
    // Redis down — allow the request through (fail open)
  }
  next();
}

module.exports = { blacklistToken, checkBlacklist };
