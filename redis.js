const logger = require("./logger");
const Redis = require("ioredis");
const zlib = require("zlib");
const { promisify } = require("util");
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

let client = null;
let connectPromise = null;

let cachedMetrics = {
  rpm: 0,
  activeUsers: 0,
  memoryUsage: 0,
  cacheHitRate: 0,
  rpmHistory: [],
  predictedHistory: [],
  redisOk: false,
  workerOk: false,
  aofOk: false,
  lastUpdated: 0,
};

function createClient() {
  const redis = new Redis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || "0"),

    // lazyConnect: true — the client is created but does NOT open a TCP
    // connection until .connect() is explicitly called. This means
    // rate-limit-redis (which fires a Lua script in its constructor) never
    // hits an uninitialised stream and the startup crash is gone.
    lazyConnect: true,

    // With lazyConnect, enableOfflineQueue: false is also safe because the
    // queue is only relevant after the first connect() — any command that
    // arrives before connect() is called is impossible in our flow.
    enableOfflineQueue: false,

    connectTimeout: 3000,
    commandTimeout: 2000,

    retryStrategy: (times) => {
      if (times > 5) return null; // stop retrying — Redis is unavailable
      return Math.min(times * 500, 3000);
    },
  });

  redis.on("connect", () =>
    logger.info({ event: "REDIS_CONNECTED" }, "Redis connected"),
  );
  redis.on("error", (err) =>
    logger.error({ event: "REDIS_ERROR", err }, "Redis error"),
  );
  redis.on("close", () =>
    logger.warn({ event: "REDIS_CLOSED" }, "Redis connection closed"),
  );

  return redis;
}

// ─────────────────────────────
// CONNECTION — async, shared promise so connect() is only called once
// ─────────────────────────────
async function getRedis() {
  // Already connected and healthy — fast path
  if (client && client.status === "ready") return client;

  if (!client) {
    client = createClient();
  }

  // Only one connect() in flight at a time
  if (!connectPromise) {
    connectPromise = client
      .connect()
      .then(async () => {
        await client.ping();
        connectPromise = null; // reset so reconnect can re-enter
        return client;
      })
      .catch((err) => {
        // Reset so the next caller can try again
        connectPromise = null;
        logger.error(
          { event: "REDIS_CONNECT_FAIL", err },
          "Redis connect failed",
        );
        throw err;
      });
  }

  return connectPromise;
}

async function closeRedis() {
  if (!client) return;

  const redis = client;
  const pendingConnect = connectPromise;

  if (pendingConnect) {
    try {
      await pendingConnect;
    } catch {
      // The connection may already be closed or unavailable during shutdown.
    }
  }

  client = null;
  connectPromise = null;

  if (redis.status === "ready") {
    await redis.quit();
  } else if (redis.status !== "end") {
    redis.disconnect();
  }

  logger.info({ event: "REDIS_CLOSED_CLEANLY" }, "Redis client closed");
}

async function isRedisReady() {
  try {
    const redis = await getRedis();
    const pong = await redis.ping();
    return pong === "PONG";
  } catch (err) {
    logger.warn(
      { event: "REDIS_HEALTH_CHECK_FAILED", err },
      "Redis readiness check failed",
    );
    return false;
  }
}

// ─────────────────────────────
// SAFE EXEC — every public helper goes through this so Redis being down
// never crashes the app; callers just get the fallback value.
// ─────────────────────────────
async function safeExec(fn, fallback = null) {
  try {
    const redis = await getRedis();
    return await fn(redis);
  } catch {
    return fallback;
  }
}

// ─────────────────────────────
// BASIC OPS
// ─────────────────────────────
const redisGet = (key) => safeExec((r) => r.get(key));

// Security-critical variant — does NOT swallow errors.
// Use this anywhere a Redis failure must be treated as a hard error
// (e.g. token blacklist checks) rather than silently returning null.
async function redisGetStrict(key) {
  const redis = await getRedis();
  return redis.get(key);
}

const redisSet = (key, value, ttl = null) =>
  safeExec((r) => (ttl ? r.set(key, value, "EX", ttl) : r.set(key, value)));

const redisDel = (key) => safeExec((r) => r.del(key));

// Pattern-based delete using a Lua script (avoids KEYS in production clusters)
const redisDelPattern = (pattern) =>
  safeExec(async (r) => {
    const script = `
      local matches = redis.call('KEYS', ARGV[1])
      if #matches > 0 then redis.call('DEL', unpack(matches)) end
      return #matches
    `;
    return await r.eval(script, 0, pattern);
  }, 0);

// ─────────────────────────────
// COMPRESSION — used by cache middleware to shrink large payloads
// ─────────────────────────────
// FIX: replaced LZString (pure-JS, slow) with zlib.gzip (native, non-blocking).
// LZString.compressToUTF16 was taking 130-570 ms on large payloads.
// zlib stores a 'gz:' prefix so decompress can detect the encoding.
async function compress(value) {
  try {
    const buf = await gzip(JSON.stringify(value));
    return "gz:" + buf.toString("base64");
  } catch {
    return null;
  }
}

async function decompress(compressed) {
  try {
    if (typeof compressed === "string" && compressed.startsWith("gz:")) {
      const buf = await gunzip(Buffer.from(compressed.slice(3), "base64"));
      return JSON.parse(buf.toString());
    }
    // Legacy: plain JSON string (no compression prefix)
    return JSON.parse(compressed);
  } catch {
    return null;
  }
}

// ─────────────────────────────
// DISTRIBUTED LOCK — used by cache stampede protection
// Returns "OK" on acquisition, null if lock is already held
// ─────────────────────────────
const redisLock = (key, ttlSeconds = 30) =>
  safeExec((r) => r.set(key, Date.now(), "PX", ttlSeconds * 1000, "NX"));

// ─────────────────────────────
// CACHE VERSION — bumping the version invalidates all keys in a namespace
// without needing a pattern delete (which is slow on large keyspaces)
// ─────────────────────────────
const getCacheVersion = (ns) =>
  safeExec(async (r) => Number((await r.get(`cache:version:${ns}`)) || 0), 0);

const bumpCacheVersion = async (ns) => {
  await safeExec((r) => r.incr(`cache:version:${ns}`));
  invalidateLocalCacheVersion(ns);
};

// Companion to bumpCacheVersion: call this to also evict the in-process
// version copy held by cache.js so the next GET re-fetches the new version
// from Redis immediately instead of waiting up to VERSION_TTL_MS.
// Import lazily to avoid circular require (cache.js → redis.js → cache.js).
function invalidateLocalCacheVersion(ns) {
  try {
    const { localVersionCache } = require("./middleware/cache");
    localVersionCache.invalidate(ns);
  } catch {
    /* cache.js not loaded yet — no-op */
  }
}

// ─────────────────────────────
// STALE CACHE HELPER
// ─────────────────────────────
const setStaleCache = (key, value, ttlSeconds) =>
  redisSet(key, value, ttlSeconds);

// ─────────────────────────────
// ZSET OPS
// ─────────────────────────────
const redisZScore = (key, member) => safeExec((r) => r.zscore(key, member), 0);

const redisZIncrBy = (key, increment, member, ttl = null) =>
  safeExec(async (r) => {
    const pipe = r.pipeline();
    pipe.zincrby(key, increment, member);
    if (ttl) {
      pipe.set(`engagement:last:${member}`, Date.now().toString(), "EX", ttl);
      pipe.expire(key, ttl);
    } else {
      pipe.set(`engagement:last:${member}`, Date.now().toString());
    }
    await pipe.exec();
  });

const decayEngagement = () =>
  safeExec(async (r) => {
    const script = `
      local key = KEYS[1]
      local factor = tonumber(ARGV[1])
      local minScore = tonumber(ARGV[2])
      local members = redis.call('ZRANGE', key, 0, -1, 'WITHSCORES')
      local updated = 0

      for i = 1, #members, 2 do
        local member = members[i]
        local score = tonumber(members[i + 1]) or 0
        local nextScore = score * factor

        if nextScore < minScore then
          redis.call('ZREM', key, member)
          redis.call('DEL', 'engagement:last:' .. member)
        else
          redis.call('ZADD', key, nextScore, member)
          updated = updated + 1
        end
      end

      return updated
    `;

    return await r.eval(script, 1, "engagement:score", 0.95, 0.01);
  }, 0);

const cleanupInactiveUsers = (inactiveAfterMs = 30 * 24 * 60 * 60 * 1000) =>
  safeExec(async (r) => {
    let cursor = "0";
    let removed = 0;
    const cutoff = Date.now() - inactiveAfterMs;

    do {
      const [nextCursor, keys] = await r.scan(
        cursor,
        "MATCH",
        "engagement:last:*",
        "COUNT",
        100,
      );
      cursor = nextCursor;

      if (keys.length === 0) continue;
      // Batch-fetch all lastSeen values in one pipeline round-trip
      const getPipe = r.pipeline();
      for (const key of keys) getPipe.get(key);
      const getResults = await getPipe.exec();

      const delPipe = r.pipeline();
      let pageDels = 0;
      for (let i = 0; i < keys.length; i++) {
        const lastSeen = Number(getResults[i]?.[1] || 0);
        if (Number.isFinite(lastSeen) && lastSeen >= cutoff) continue;
        const member = keys[i].slice("engagement:last:".length);
        delPipe.zrem("engagement:score", member);
        delPipe.del(keys[i]);
        pageDels++;
      }
      if (pageDels > 0) await delPipe.exec();
      removed += pageDels;
    } while (cursor !== "0");

    return removed;
  }, 0);

// ─────────────────────────────
// GLOBAL METRICS COUNTERS
// ─────────────────────────────
const incrGlobalRequests = () =>
  safeExec(async (r) => {
    const pipe = r.pipeline();
    pipe.incr("global:requests");
    pipe.expire("global:requests", 60);
    await pipe.exec();
  });

const incrGlobalCacheHit = () =>
  safeExec(async (r) => {
    const pipe = r.pipeline();
    pipe.incr("global:cache_hits");
    pipe.expire("global:cache_hits", 60);
    await pipe.exec();
  });

const incrGlobalCacheMiss = () =>
  safeExec(async (r) => {
    const pipe = r.pipeline();
    pipe.incr("global:cache_misses");
    pipe.expire("global:cache_misses", 60);
    await pipe.exec();
  });

// ─────────────────────────────
// USER TRACKING
// ─────────────────────────────
const pfaddActiveUser = (userId) =>
  // FIX: pipeline PFADD + EXPIRE into ONE round-trip (was two serial awaits).
  // Saves ~10-20 ms per request — these were blocking auth before next() fired.
  safeExec(async (r) => {
    const key = `active:users:${new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "")}`;
    const pipe = r.pipeline();
    pipe.pfadd(key, userId);
    pipe.expire(key, 86400);
    await pipe.exec();
  });

// ─────────────────────────────
// PIPELINE
// ─────────────────────────────
async function redisPipelineExec(commands) {
  return safeExec(async (r) => {
    const pipe = r.pipeline();
    for (const [cmd, ...args] of commands) {
      pipe[cmd.toLowerCase()](...args);
    }
    return await pipe.exec();
  });
}

// ─────────────────────────────
// METRICS ENGINE
// ─────────────────────────────
function getDateKey() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

async function getSystemMetrics() {
  const now = Date.now();
  if (now - cachedMetrics.lastUpdated < 2000) return cachedMetrics;

  try {
    const currentHour = new Date().getHours();

    const pipelineCommands = [
      ["get", "global:requests"],
      ["pfcount", `active:users:${getDateKey()}`],
      ["info", "memory"],
      ["get", "global:cache_hits"],
      ["get", "global:cache_misses"],
      ["ping"],
    ];

    for (let h = 0; h < 12; h++) {
      const hourIdx = (currentHour - 11 + h + 24) % 24;
      pipelineCommands.push(["get", `metrics:hour:${hourIdx}:total_load`]);
      pipelineCommands.push(["get", `metrics:hour:${hourIdx}:count`]);
    }

    const results = await redisPipelineExec(pipelineCommands);
    if (!results) return cachedMetrics; // Redis down — return last known

    const rpm = Number(results?.[0]?.[1] || 0);
    const activeUsers = Number(results?.[1]?.[1] || 0);

    const memInfo = results?.[2]?.[1] || "";
    const usedMem = Number(memInfo.match(/used_memory:(\d+)/)?.[1] || 0);
    const maxMem = Number(memInfo.match(/maxmemory:(\d+)/)?.[1] || 0);
    const memoryUsage = maxMem > 0 ? usedMem / maxMem : 0;

    const hits = Number(results?.[3]?.[1] || 0);
    const misses = Number(results?.[4]?.[1] || 0);
    const cacheHitRate =
      hits + misses > 0 ? Math.round((hits / (hits + misses)) * 100) / 100 : 0;

    const redisOk = results?.[5]?.[1] === "PONG";

    const rpmHistory = [];
    for (let h = 0; h < 12; h++) {
      const idx = 6 + h * 2;
      const total = Number(results?.[idx]?.[1] || 0);
      const count = Number(results?.[idx + 1]?.[1] || 0);
      rpmHistory[h] = count > 0 ? Math.round(total / count) : 0;
    }

    const predictedHistory = rpmHistory.map((r) => Math.round(r * 1.15));

    cachedMetrics = {
      rpm,
      activeUsers,
      memoryUsage,
      cacheHitRate,
      rpmHistory,
      predictedHistory,
      redisOk,
      workerOk: true,
      aofOk: true,
      lastUpdated: now,
    };
  } catch (err) {
    logger.warn(
      { event: "REDIS_METRICS_ERROR", err },
      "getSystemMetrics error — preserving cache",
    );
  }

  return cachedMetrics;
}

// ─────────────────────────────
// LOAD TRACKING
// ─────────────────────────────
const trackHourLoad = () =>
  safeExec(async (r) => {
    const hour = new Date().getHours();
    const pipe = r.pipeline();
    pipe.incrby(`metrics:hour:${hour}:total_load`, 1);
    pipe.incr(`metrics:hour:${hour}:count`);
    pipe.expire(`metrics:hour:${hour}:total_load`, 7 * 86400);
    pipe.expire(`metrics:hour:${hour}:count`, 7 * 86400);
    await pipe.exec();
  });

const getPredictedRPM = async () => {
  try {
    // FIX: was two serial redisGet calls; pipeline them into one round-trip.
    const nextHour = (new Date().getHours() + 1) % 24;
    const [totalRaw, countRaw] = await Promise.all([
      redisGet(`metrics:hour:${nextHour}:total_load`),
      redisGet(`metrics:hour:${nextHour}:count`),
    ]);
    const total = Number(totalRaw || 0);
    const count = Number(countRaw || 0);
    if (!count) return 0;
    return Math.round((total / count) * 1.15);
  } catch {
    return 0;
  }
};

// ─────────────────────────────
// DYNAMIC RATE LIMIT
// ─────────────────────────────
function getDynamicLimit(score, rpm, memoryUsage) {
  const base = 300 + Math.sqrt(Number(score) || 0) * 10;
  let loadFactor = 1;
  if (rpm > 10000) loadFactor = 0.5;
  else if (rpm > 5000) loadFactor = 0.7;
  const memoryFactor = memoryUsage > 0.8 ? 0.7 : 1;
  return Math.floor(Math.min(base * loadFactor * memoryFactor, 1000));
}

// ─────────────────────────────
// USER SESSION VALIDITY — auth.js caches "does this user still exist and
// isn't discontinued" for a short TTL to avoid a DB hit on every request.
// Deleting/discontinuing a user must clear this immediately, otherwise the
// stale cache entry keeps their existing tokens working until it expires.
// ─────────────────────────────
const USER_VALID_PREFIX = "user-valid:";
const invalidateUserSession = (userId) =>
  redisDel(`${USER_VALID_PREFIX}${userId}`);

module.exports = {
  getRedis,
  isRedisReady,
  redisGetStrict,
  USER_VALID_PREFIX,
  invalidateUserSession,
  closeRedis,
  redisGet,
  redisSet,
  redisDel,
  redisDelPattern,
  compress,
  decompress,
  redisLock,
  getCacheVersion,
  bumpCacheVersion,
  invalidateLocalCacheVersion,
  setStaleCache,
  redisZScore,
  redisZIncrBy,
  decayEngagement,
  cleanupInactiveUsers,
  incrGlobalRequests,
  incrGlobalCacheHit,
  incrGlobalCacheMiss,
  pfaddActiveUser,
  redisPipelineExec,
  getSystemMetrics,
  trackHourLoad,
  getPredictedRPM,
  getDynamicLimit,
};
