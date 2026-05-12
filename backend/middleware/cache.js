const {
  redisGet,
  redisSet,
  compress,
  decompress,
  redisLock,
  getCacheVersion,
  getSystemMetrics,
  incrGlobalCacheHit,
  incrGlobalCacheMiss,
  getPredictedRPM,
} = require("../redis");

/**
 * Cache middleware for GET routes.
 *
 * Usage:
 *   router.get("/", cache("grns", 300), async (req, res) => { ... })
 *
 * Options:
 *   shared: true  — omits userId from the cache key. Use for master-data
 *                   routes whose response is identical for all users
 *                   (enterprises, company-master, project-master, item lists, etc.).
 *                   One warm entry serves every user instead of one per user.
 *
 * Behaviour when Redis is unavailable:
 *   - All cache operations fail silently and return null/undefined.
 *   - getDynamicTtl() catches its own errors and returns the fallback TTL.
 *   - The route handler always runs — Redis being down never produces a 500.
 */
function cache(namespace, ttl = 300, { shared = false } = {}) {
  return async (req, res, next) => {
    try {
      const routeScope = JSON.stringify({
        path: `${req.baseUrl || ""}${req.path || ""}`,
        params: req.params || {},
        query: req.query || {},
      });

      // shared = true  → one entry for all users (master data)
      // shared = false → scoped per user (user-specific lists, dashboards)
      const scopeId = shared ? "shared" : req.user?.userId || "anon";

      // getCacheVersion returns 0 (safe fallback) when Redis is down
      const version = await getCacheVersion(namespace);

      const key = `cache:${namespace}:v${version}:${scopeId}:${routeScope}`;
      const baseKey = `cache:${namespace}:${scopeId}:${routeScope}`;
      const staleKey = `cache:stale:${baseKey}`;
      const lockKey = `cachelock:${key}`;

      // ─── CACHE HIT ───────────────────────────────────────────────────────────
      const cached = await redisGet(key); // returns null when Redis is down

      if (cached) {
        let data;
        try {
          data = decompress(cached) || JSON.parse(cached);
        } catch {
          data = JSON.parse(cached);
        }

        res.setHeader("X-Cache", "HIT");
        await incrGlobalCacheHit();
        return res.json(data);
      }

      // ─── STAMPEDE PROTECTION ─────────────────────────────────────────────────
      const lockAcquired = await redisLock(lockKey, 30);

      if (lockAcquired === null) {
        // Redis is down — skip straight to the route handler
        return next();
      }

      if (!lockAcquired) {
        // Another process is already refreshing — serve stale if available
        const staleCached = await redisGet(staleKey);

        if (staleCached) {
          let data;
          try {
            data = decompress(staleCached) || JSON.parse(staleCached);
          } catch {
            data = JSON.parse(staleCached);
          }

          res.setHeader("X-Cache", "STALE");
          await incrGlobalCacheHit();
          return res.json(data);
        }

        res.setHeader("Retry-After", "5");
        return res
          .status(503)
          .json({ error: "Cache busy, retry in 5 seconds" });
      }

      // ─── CACHE MISS — intercept res.json to populate cache on the way out ───
      const originalJson = res.json.bind(res);

      res.json = async (data) => {
        try {
          const jsonStr = JSON.stringify(data);

          const dynamicTtl =
            res.statusCode >= 500 ? 30 : await getDynamicTtl(ttl);
          const finalTtl = dynamicTtl || ttl;

          await incrGlobalCacheMiss();

          let valueToStore = jsonStr;
          if (jsonStr.length > 1024) {
            const compressed = compress(data);
            if (compressed) valueToStore = compressed;
          }

          await redisSet(key, valueToStore, finalTtl);
          await redisSet(staleKey, valueToStore, finalTtl * 2);

          res.setHeader("X-Cache", "MISS");
          res.setHeader("X-Cache-TTL", `${finalTtl}s`);
        } catch (err) {
          console.error("[cache] write error:", err.message);
        }

        return originalJson(data);
      };

      next();
    } catch (err) {
      console.error("[cache] middleware error:", err.message);
      next();
    }
  };
}

// ─── DYNAMIC TTL ─────────────────────────────────────────────────────────────
async function getDynamicTtl(fallback = 300) {
  try {
    const metrics = await getSystemMetrics();
    const predictedRPM = await getPredictedRPM();
    const rpm = predictedRPM || metrics.rpm;
    let ttl = rpm > 10000 ? 120 : rpm > 5000 ? 180 : 300;
    if (metrics.memoryUsage > 0.8) ttl = Math.floor(ttl * 0.5);
    return Math.max(ttl, 60);
  } catch {
    return fallback;
  }
}

module.exports = { cache };
