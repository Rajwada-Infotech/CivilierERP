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
 * @param {string} namespace
 * @param {number} ttl (optional, fallback TTL)
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

      const version = await getCacheVersion(namespace);

      const key = `cache:${namespace}:v${version}:${userId}:${routeScope}`;
      const baseKey = `cache:${namespace}:${userId}:${routeScope}`;
      const staleKey = `cache:stale:${baseKey}`;
      const lockKey = `cachelock:${key}`;

      // ===================== CACHE HIT =====================
      let cached = await redisGet(key);

      if (cached) {
        const originalSize = Buffer.byteLength(cached, "utf8");

        let data;
        try {
          data = decompress(cached) || JSON.parse(cached);
        } catch {
          data = JSON.parse(cached);
        }

        const decompressedSize = Buffer.byteLength(
          JSON.stringify(data),
          "utf8"
        );

        res.setHeader("X-Cache", "HIT");
        res.setHeader(
          "X-Cache-Size",
          `${originalSize} -> ${decompressedSize}`
        );

        await incrGlobalCacheHit();
        return res.json(data);
      }

      // ===================== STAMPEDE PROTECTION =====================
      const lockAcquired = await redisLock(lockKey, 30);

      if (!lockAcquired) {
        let staleCached = await redisGet(staleKey);

        if (staleCached) {
          const originalSize = Buffer.byteLength(staleCached, "utf8");

          let data;
          try {
            data = decompress(staleCached) || JSON.parse(staleCached);
          } catch {
            data = JSON.parse(staleCached);
          }

          const decompressedSize = Buffer.byteLength(
            JSON.stringify(data),
            "utf8"
          );

          res.setHeader("X-Cache", "STALE");
          res.setHeader(
            "X-Cache-Size",
            `${originalSize} -> ${decompressedSize}`
          );

          await incrGlobalCacheHit();
          return res.json(data);
        }

        res.setHeader("Retry-After", "5");
        return res.status(503).json({
          error: "Cache busy, retry in 5 seconds",
        });
      }

      // ===================== CACHE MISS =====================
      const originalJson = res.json.bind(res);

      res.json = async (data) => {
        try {
          const jsonStr = JSON.stringify(data);

          const dynamicTtl =
            res.statusCode >= 500 ? 30 : await getDynamicTtl();
          const finalTtl = dynamicTtl || ttl;

          await incrGlobalCacheMiss();

          let valueToStore = jsonStr;

          // Compress if large
          if (jsonStr.length > 1024) {
            const compressed = compress(data);
            if (compressed) valueToStore = compressed;
          }

          await redisSet(key, valueToStore, finalTtl);
          await redisSet(staleKey, valueToStore, finalTtl * 2);

          res.setHeader("X-Cache", "MISS");
          res.setHeader("X-Cache-TTL", `${finalTtl}s`);

        } catch (err) {
          console.error("Cache write error:", err.message);
        }

        return originalJson(data);
      };

      next();
    } catch (err) {
      console.error("Cache middleware error:", err.message);
      next();
    }
  };
}

// ===================== DYNAMIC TTL =====================
async function getDynamicTtl() {
  const metrics = await getSystemMetrics();
  const predictedRPM = await getPredictedRPM();

  const rpm = predictedRPM || metrics.rpm;

  let ttl = rpm > 10000 ? 120 : rpm > 5000 ? 180 : 300;

  if (metrics.memoryUsage > 0.8) {
    ttl = ttl * 0.5;
  }

  return Math.max(ttl, 60);
}

module.exports = { cache };
