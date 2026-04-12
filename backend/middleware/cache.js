const { redisGet, redisSet, compress, decompress, redisLock, getCacheVersion, getSystemMetrics, incrGlobalCacheHit, incrGlobalCacheMiss, setStaleCache, getPredictedRPM } = require("../redis");

/**
 * Cache middleware for GET routes.
 *
 * Usage:
 *   router.get("/", cache("grns", 300), async (req, res) => { ... })
 *
 * @param {string} namespace   - Cache key prefix (e.g. "grns", "purchase-orders")
 * @param {number} ttl         - TTL in seconds (default 300 = 5 minutes)
 */
function cache(namespace, opts = {}) {
  return async (req, res, next) => {
  const queryStr = JSON.stringify(req.query);
  const userId = req.user?.userId || "anon";
  const baseKey = `cache:${namespace}:${userId}:${queryStr}`;
  const version = await getCacheVersion(namespace);
  const key = `cache:${namespace}:v${version}:${userId}:${queryStr}`;
  const lockKey = `cachelock:${key}`;
  const staleKey = `cache:stale:${baseKey}`;

    // Check cache
    let cached = await redisGet(key);
    if (cached) {
      const originalSize = Buffer.byteLength(cached, 'utf8');
      cached = decompress(cached) || JSON.parse(cached);
      const decompressedSize = Buffer.byteLength(JSON.stringify(cached), 'utf8');
      res.setHeader("X-Cache", "HIT");
      res.setHeader("X-Cache-Size", `${originalSize} -> ${decompressedSize}`);
      await incrGlobalCacheHit();
      return res.json(cached);
    }

    // Stampede protection with stale fallback
    const lockAcquired = await redisLock(lockKey, 30);
    if (!lockAcquired) {
      let staleCached = await redisGet(staleKey);
      if (staleCached) {
        const originalSize = Buffer.byteLength(staleCached, 'utf8');
        staleCached = decompress(staleCached) || JSON.parse(staleCached);
        const decompressedSize = Buffer.byteLength(JSON.stringify(staleCached), 'utf8');
        res.setHeader("X-Cache", "STALE");
        res.setHeader("X-Cache-Size", `${originalSize} -> ${decompressedSize}`);
        await incrGlobalCacheHit(); // count stale as hit
        return res.json(staleCached);
      }
      res.setHeader("Retry-After", "5");
      return res.status(503).json({ error: "Cache stampede protection. Retry in 5s." });
    }

    try {
      // Continue to handler/DB
      const originalJson = res.json.bind(res);
        res.json = async (data) => {
          const jsonStr = JSON.stringify(data);
          const ttl = (res.statusCode >= 500 ? 30 : await getDynamicTtl());
          await incrGlobalCacheMiss();
          
          // Cache all responses, short TTL for errors
          if (jsonStr.length > 1024) {
            const compressed = compress(data);
            if (compressed) {
              await redisSet(key, compressed, ttl);
              await redisSet(staleKey, compressed, ttl * 2);
              res.setHeader("X-Cache-Size", `${Buffer.byteLength(compressed, 'utf8')} -> ${jsonStr.length}`);
            } else {
              await redisSet(key, jsonStr, ttl);
              await redisSet(staleKey, jsonStr, ttl * 2);
            }
          } else {
            await redisSet(key, jsonStr, ttl);
            await redisSet(staleKey, jsonStr, ttl * 2);
          }
          
          res.setHeader("X-Cache", "MISS");
          res.setHeader("X-Cache-TTL", `${ttl}s`);
          return originalJson(data);
        };
        next();

    } catch {
      next();
    }
  };
}

async function getDynamicTtl() {
  const metrics = await getSystemMetrics();
  const predictedRPM = await getPredictedRPM();
  let ttl = (predictedRPM || metrics.rpm) > 10000 ? 120 : (predictedRPM || metrics.rpm) > 5000 ? 180 : 300;
  if (metrics.memoryUsage > 0.8) ttl *= 0.5;
  return Math.max(ttl, 60);
}

module.exports = { cache };

module.exports = { cache };
