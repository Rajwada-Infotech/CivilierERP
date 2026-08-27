const {
  redisGet,
  redisSet,
  redisDel,
  compress,
  decompress,
  redisLock,
  getCacheVersion,
  getSystemMetrics,
  incrGlobalCacheHit,
  incrGlobalCacheMiss,
  getPredictedRPM,
} = require("../redis");

// ─── IN-PROCESS VERSION CACHE ─────────────────────────────────────────────────
// Avoids a Redis GET for the version number on every request.
// Re-fetches from Redis at most every VERSION_TTL_MS.
const VERSION_TTL_MS = 2000;

const localVersionCache = (() => {
  const store = new Map();

  async function get(ns) {
    const entry = store.get(ns);
    if (entry && Date.now() - entry.fetchedAt < VERSION_TTL_MS) {
      return entry.version;
    }
    const version = await getCacheVersion(ns);
    store.set(ns, { version, fetchedAt: Date.now() });
    return version;
  }

  function invalidate(ns) {
    store.delete(ns);
  }

  return { get, invalidate };
})();

// ─── REDIS HEALTH CIRCUIT BREAKER ─────────────────────────────────────────────
// When Redis is slow or down, every request was paying up to commandTimeout
// (2000 ms) waiting for Redis operations to time out before safeExec returned
// null. This made Redis problems cascade into every API endpoint appearing slow.
//
// The circuit breaker tracks consecutive Redis failures. After OPEN_THRESHOLD
// failures it stops attempting Redis calls for OPEN_DURATION_MS, returning null
// immediately so route handlers run at full DB speed while Redis recovers.

const CIRCUIT = {
  state: "closed", // "closed" | "open" | "half-open"
  failures: 0,
  lastFailure: 0,
  OPEN_THRESHOLD: 3,
  OPEN_DURATION_MS: 10_000,
};

function circuitIsOpen() {
  if (CIRCUIT.state === "closed") return false;
  if (CIRCUIT.state === "open") {
    if (Date.now() - CIRCUIT.lastFailure > CIRCUIT.OPEN_DURATION_MS) {
      CIRCUIT.state = "half-open";
      return false;
    }
    return true;
  }
  return false; // half-open: allow one probe
}

function circuitSuccess() {
  CIRCUIT.failures = 0;
  CIRCUIT.state = "closed";
}

function circuitFailure() {
  CIRCUIT.failures++;
  CIRCUIT.lastFailure = Date.now();
  if (CIRCUIT.failures >= CIRCUIT.OPEN_THRESHOLD) {
    CIRCUIT.state = "open";
  }
}

async function redisOp(fn, fallback = null) {
  if (circuitIsOpen()) return fallback;
  try {
    const result = await fn();
    circuitSuccess();
    return result;
  } catch {
    circuitFailure();
    return fallback;
  }
}

// ─── DYNAMIC TTL — refreshed in background every 10 s ────────────────────────
// Previously computed inside res.json on every cache miss, firing up to 8 Redis
// commands after the DB query but still blocking the response. Now pre-computed
// asynchronously and served from memory.
let _cachedDynamicTtl = 300;
let _dynamicTtlLastRefreshed = 0;
const DYNAMIC_TTL_REFRESH_MS = 10_000;

async function getCachedDynamicTtl(fallback = 300) {
  const now = Date.now();
  if (now - _dynamicTtlLastRefreshed < DYNAMIC_TTL_REFRESH_MS) {
    return _cachedDynamicTtl;
  }
  if (_dynamicTtlLastRefreshed === 0) {
    _cachedDynamicTtl = await computeDynamicTtl(fallback);
    _dynamicTtlLastRefreshed = Date.now();
  } else {
    computeDynamicTtl(fallback)
      .then((ttl) => {
        _cachedDynamicTtl = ttl;
        _dynamicTtlLastRefreshed = Date.now();
      })
      .catch(() => {});
  }
  return _cachedDynamicTtl;
}

async function computeDynamicTtl(fallback = 300) {
  try {
    const [metrics, predictedRPM] = await Promise.all([
      getSystemMetrics(),
      getPredictedRPM(),
    ]);
    const rpm = predictedRPM || metrics.rpm;
    let ttl = rpm > 10_000 ? 120 : rpm > 5_000 ? 180 : 300;
    if (metrics.memoryUsage > 0.8) ttl = Math.floor(ttl * 0.5);
    return Math.max(ttl, 60);
  } catch {
    return fallback;
  }
}

/**
 * Cache middleware for GET routes.
 *
 * Usage:
 *   router.get("/", cache("grns", 300), async (req, res) => { ... })
 *
 * Options:
 *   shared: true  — one cache entry for all users (master data routes).
 *
 * Adds req.timing stages when req.timing is present:
 *   cache.version_check  cache.lookup  cache.lock  cache.write
 */
function cache(namespace, ttl = 300, { shared = false } = {}) {
  return async (req, res, next) => {
    try {
      // Fast-exit: Redis is down, skip all cache logic
      if (circuitIsOpen()) {
        res.setHeader("X-Cache", "BYPASS");
        return next();
      }

      const routeScope = JSON.stringify({
        path: `${req.baseUrl || ""}${req.path || ""}`,
        params: req.params || {},
        query: req.query || {},
      });

      const scopeId = shared ? "shared" : req.user?.userId || "anon";

      // Version check — served from memory, rarely touches Redis
      const vStart = req.timing?.startStage();
      const version = await redisOp(() => localVersionCache.get(namespace), 0);
      if (vStart) req.timing.mark("cache.version_check", vStart);

      const key = `cache:${namespace}:v${version}:${scopeId}:${routeScope}`;
      const baseKey = `cache:${namespace}:${scopeId}:${routeScope}`;
      const staleKey = `cache:stale:${baseKey}`;
      const lockKey = `cachelock:${key}`;

      // Cache lookup
      const lookupStart = req.timing?.startStage();
      const cached = await redisOp(() => redisGet(key));
      if (lookupStart) req.timing.mark("cache.lookup", lookupStart);

      if (cached) {
        let data;
        try {
          data = (await decompress(cached)) ?? JSON.parse(cached);
        } catch {
          data = JSON.parse(cached);
        }
        res.setHeader("X-Cache", "HIT");
        incrGlobalCacheHit().catch(() => {}); // never block a hit
        return res.json(data);
      }

      // Cache miss — intercept res.json to populate cache on the way out.
      //
      // LOCK LEAK FIX: releaseLock and the "finish" safety-net listener must be
      // set up BEFORE any branch that calls next() or returns early. Previously
      // they were only attached inside the lockAcquired===true block, so 304
      // responses (which bypass res.json entirely) left the lock held for the
      // full 30-second TTL — a perpetual cache-miss loop on every cached route.
      const dbStart = req.timing?.startStage();
      const originalJson = res.json.bind(res);
      let lockReleased = false;

      const releaseLock = () => {
        if (lockReleased) return;
        lockReleased = true;
        redisOp(() => redisDel(lockKey)).catch(() => {});
      };

      // Always fires — covers 304, errors, stream ends, anything bypassing res.json
      res.on("finish", releaseLock);

      // Stampede protection
      const lockStart = req.timing?.startStage();
      const lockAcquired = await redisOp(() => redisLock(lockKey, 30));
      if (lockStart) req.timing.mark("cache.lock", lockStart);

      if (lockAcquired === null) {
        // Redis failed — bypass to DB
        res.setHeader("X-Cache", "BYPASS");
        return next();
      }

      if (!lockAcquired) {
        // Another process is refreshing — try stale, then fall through to DB
        // instead of returning 503 (better UX: user still gets data)
        const staleCached = await redisOp(() => redisGet(staleKey));
        if (staleCached) {
          let data;
          try {
            data = (await decompress(staleCached)) ?? JSON.parse(staleCached);
          } catch {
            data = JSON.parse(staleCached);
          }
          res.setHeader("X-Cache", "STALE");
          incrGlobalCacheHit().catch(() => {});
          return res.json(data);
        }
        // No stale — fall through to DB rather than 503
        res.setHeader("X-Cache", "MISS-FALLTHROUGH");
        return next();
      }

      // Cache miss — write to cache after DB responds.
      // Only cache 2xx responses — error responses must never be stored because
      // the cache HIT path replays data without the original status code, which
      // would serve an error body as 200 and break every client that checks
      // res.ok before parsing the body.
      res.json = async (data) => {
        try {
          if (dbStart) req.timing.mark("db.query", dbStart);

          incrGlobalCacheMiss().catch(() => {});

          if (res.statusCode >= 200 && res.statusCode < 300) {
            const writeStart = req.timing?.startStage();
            const jsonStr = JSON.stringify(data);
            const finalTtl = (await getCachedDynamicTtl(ttl)) || ttl;

            let valueToStore = jsonStr;
            if (jsonStr.length > 1024) {
              const compressed = await compress(data);
              if (compressed) valueToStore = compressed;
            }

            await Promise.all([
              redisOp(() => redisSet(key, valueToStore, finalTtl)),
              redisOp(() => redisSet(staleKey, valueToStore, finalTtl * 2)),
            ]);

            if (writeStart) req.timing.mark("cache.write", writeStart);
            res.setHeader("X-Cache", "MISS");
            res.setHeader("X-Cache-TTL", `${finalTtl}s`);
          } else {
            res.setHeader("X-Cache", "SKIP");
          }

          releaseLock(); // explicit early release; "finish" listener is a safety net
        } catch (err) {
          console.error("[cache] write error:", err.message);
          releaseLock(); // always release even on write failure
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

module.exports = { cache, localVersionCache };
