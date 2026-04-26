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
 * Behaviour when Redis is unavailable:
 *   - All cache operations fail silently and return null/undefined.
 *   - getDynamicTtl() catches its own errors and returns the fallback TTL.
 *   - The route handler always runs — Redis being down never produces a 500.
 */
function cache(namespace, ttl = 300) {
  return async (req, res, next) => {
    try {
      const routeScope = JSON.stringify({
        path: `${req.baseUrl || ""}${req.path || ""}`,
        params: req.params || {},
        query: req.query || {},
      });
      const userId = req.user?.userId || "anon";

      // getCacheVersion returns 0 (safe fallback) when Redis is down
      const version = await getCacheVersion(namespace);

      const key = `cache:${namespace}:v${version}:${userId}:${routeScope}`;
      const baseKey = `cache:${namespace}:${userId}:${routeScope}`;
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
      // redisLock returns null when Redis is down, which is treated the same as
      // "lock acquired" — we just skip the stale path and serve fresh.
      const lockAcquired = await redisLock(lockKey, 30);

      if (lockAcquired === null) {
        // Redis is down — skip straight to the route handler
        return next();
      }

      if (!lockAcquired) {
        // Another process is already refreshing — try stale first
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

        // No stale either — ask client to retry briefly
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

          // getDynamicTtl is fully guarded — it never throws
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
          // Cache write failed (Redis down, serialisation error, etc.)
          // Log and continue — the response still goes out to the client.
          console.error("[cache] write error:", err.message);
        }

        return originalJson(data);
      };

      next();
    } catch (err) {
      // The cache layer must never break the route
      console.error("[cache] middleware error:", err.message);
      next();
    }
  };
}

// ─── DYNAMIC TTL ─────────────────────────────────────────────────────────────
// Previously this could throw when Redis was unavailable, crashing any route
// that used the cache() middleware (e.g. financeDashboard).
// Now it always returns a safe number.
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
