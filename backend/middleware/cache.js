const { redisGet, redisSet } = require("../redis");

/**
 * Cache middleware for GET routes.
 *
 * ⚠️ IMPORTANT: Must be mounted AFTER authMiddleware on user-scoped routes.
 * Cache key includes `req.user?.userId`. If auth runs after cache, all users share
 * "anon" cache keys (data leak risk!).
 *
 * Usage:
 *   router.get("/", authMiddleware, cache("grns", 300), async (req, res) => { ... })
 *
 * @param {string} namespace   - Cache key prefix (e.g. "grns", "purchase-orders")
 * @param {number} ttl         - TTL in seconds (default 300 = 5 minutes)
 */
function cache(namespace, ttl = 300) {
  return async (req, res, next) => {
    // Build a key that includes query params so ?finYear=X etc. are separate
    const queryStr = JSON.stringify(req.query);
    const key = `cache:${namespace}:${req.user?.userId || "anon"}:${queryStr}`;

    try {
      const cached = await redisGet(key);
      if (cached) {
        res.setHeader("X-Cache", "HIT");
        return res.json(JSON.parse(cached));
      }
    } catch {
      // Redis miss or down — just continue to DB
    }

    // Intercept res.json so we can cache the response
    const originalJson = res.json.bind(res);
    res.json = (data) => {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        redisSet(key, JSON.stringify(data), ttl);
      }
      res.setHeader("X-Cache", "MISS");
      return originalJson(data);
    };

    next();
  };
}

module.exports = { cache };
