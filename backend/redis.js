const logger = require("./logger");
const Redis = require("ioredis");
const LZString = require("lz-string");

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

    enableOfflineQueue: false,
    lazyConnect: true,

    connectTimeout: 3000,
    commandTimeout: 2000,

    retryStrategy: (times) => {
      if (times > 5) return null;
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

async function getRedis() {
  if (client && client.status === "ready") return client;

  if (!client) {
    client = createClient();
  }

  if (!connectPromise) {
    connectPromise = client
      .connect()
      .then(async () => {
        await client.ping();
        return client;
      })
      .catch((err) => {
        connectPromise = null;
        logger.error({ event: "REDIS_CONNECT_FAIL", err });
        throw err;
      });
  }

  return connectPromise;
}

// ─────────────────────────────
// SAFE EXEC WRAPPER
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
const redisSet = (key, value, ttl = null) =>
  safeExec((r) => (ttl ? r.set(key, value, "EX", ttl) : r.set(key, value)));
const redisDel = (key) => safeExec((r) => r.del(key));

// ─────────────────────────────
// ZSET + METRICS OPS
// ─────────────────────────────
const redisZScore = (key, member) => safeExec((r) => r.zscore(key, member), 0);

const redisZIncrBy = (key, increment, member, ttl = null) =>
  safeExec(async (r) => {
    await r.zincrby(key, increment, member);
    await r.set(
      `engagement:last:${member}`,
      Date.now().toString(),
      ttl ? "EX" : undefined,
      ttl,
    );
    if (ttl) await r.expire(key, ttl);
  });

// ─────────────────────────────
// GLOBAL METRICS
// ─────────────────────────────
const incrGlobalRequests = () =>
  safeExec(async (r) => {
    await r.incr("global:requests");
    await r.expire("global:requests", 60);
  });

const incrGlobalCacheHit = () =>
  safeExec(async (r) => {
    await r.incr("global:cache_hits");
    await r.expire("global:cache_hits", 60);
  });

const incrGlobalCacheMiss = () =>
  safeExec(async (r) => {
    await r.incr("global:cache_misses");
    await r.expire("global:cache_misses", 60);
  });

// ─────────────────────────────
// USER TRACKING
// ─────────────────────────────
const pfaddActiveUser = (userId) =>
  safeExec(async (r) => {
    const key = `active:users:${new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "")}`;
    await r.pfadd(key, userId);
    await r.expire(key, 86400);
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
    const redis = await getRedis();
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

    const rpm = Number(results?.[0]?.[1] || 0);
    const activeUsers = Number(results?.[1]?.[1] || 0);

    const memInfo = results?.[2]?.[1] || "";
    const memoryUsage = parseFloat(
      memInfo.match(/used_memory:(\d+)/)?.[1] /
        memInfo.match(/maxmemory:(\d+)/)?.[1] || 0,
    );

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
    logger.warn({ event: "REDIS_METRICS_ERROR", err });
  }

  return cachedMetrics;
}

// ─────────────────────────────
// LOAD TRACKING
// ─────────────────────────────
const trackHourLoad = () =>
  safeExec(async (r) => {
    const hour = new Date().getHours();
    await r.incrby(`metrics:hour:${hour}:total_load`, 1);
    await r.incr(`metrics:hour:${hour}:count`);
    await r.expire(`metrics:hour:${hour}:total_load`, 7 * 86400);
    await r.expire(`metrics:hour:${hour}:count`, 7 * 86400);
  });

const getPredictedRPM = async () => {
  try {
    const nextHour = (new Date().getHours() + 1) % 24;
    const total = Number(
      (await redisGet(`metrics:hour:${nextHour}:total_load`)) || 0,
    );
    const count = Number(
      (await redisGet(`metrics:hour:${nextHour}:count`)) || 0,
    );
    if (!count) return 0;
    return Math.round((total / count) * 1.15);
  } catch {
    return 0;
  }
};

// ─────────────────────────────
// LIMIT ENGINE
// ─────────────────────────────
function getDynamicLimit(score, rpm, memoryUsage) {
  const base = 20 + Math.sqrt(score) * 10;

  let loadFactor = 1;
  if (rpm > 10000) loadFactor = 0.5;
  else if (rpm > 5000) loadFactor = 0.7;

  const memoryFactor = memoryUsage > 0.8 ? 0.7 : 1;

  return Math.floor(Math.min(base * loadFactor * memoryFactor, 500));
}

module.exports = {
  getRedis,
  redisGet,
  redisSet,
  redisDel,
  redisZScore,
  redisZIncrBy,
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
