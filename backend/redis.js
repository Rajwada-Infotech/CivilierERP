const logger = require("./logger");
const Redis = require("ioredis");
const LZString = require("lz-string");


let cachedMetrics = {
  rpm: 0,
  activeUsers: 0,
  memoryUsage: 0,
  lastUpdated: 0
};

let client = null;

function getRedis() {
  if (!client) {
    client = new Redis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || "0"),
      retryStrategy: (times) => {
        if (times > 5) return null; // stop retrying after 5 attempts
        return Math.min(times * 500, 3000);
      },
      // enableOfflineQueue: true (default) — queues commands while connecting
      // lazyConnect: false (default) — connects immediately, no manual .connect() needed
    });

    client.on("connect", () => logger.info({ event: "REDIS_CONNECTED" }, "Redis connected"));
    client.on("error", (err) => logger.error({ event: "REDIS_ERROR", err }, "Redis error"));
    client.on("close", () => logger.warn({ event: "REDIS_CLOSED" }, "Redis connection closed"));
  }
  return client;
}

async function redisGet(key) {
  try {
    return await getRedis().get(key);
  } catch {
    return null;
  }
}

async function redisSet(key, value, ttlSeconds = null) {
  try {
    if (ttlSeconds) {
      await getRedis().set(key, value, "EX", ttlSeconds);
    } else {
      await getRedis().set(key, value);
    }
  } catch {
    // Redis down — skip silently, never block the app
  }
}

async function redisDel(key) {
  try {
    await getRedis().del(key);
  } catch {}
}

function compress(value) {
  try {
    return LZString.compressToUTF16(JSON.stringify(value));
  } catch {
    return null;
  }
}

function decompress(compressed) {
  try {
    return JSON.parse(LZString.decompressFromUTF16(compressed));
  } catch {
    return null;
  }
}

async function redisDelPattern(pattern) {
  try {
    const redis = getRedis();
    const script = `
      local matches = redis.call('KEYS', ARGV[1])
      if #matches > 0 then
        redis.call('DEL', unpack(matches))
      end
      return #matches
    `;
    const numDeleted = await redis.eval(script, 0, pattern);
    if (numDeleted > 0) {
      logger.info({ event: "REDIS_DEL_PATTERN", count: numDeleted, pattern }, "Redis pattern delete");
    }
  } catch (err) {
    logger.warn({ event: "REDIS_DEL_PATTERN_ERROR", err, pattern }, "Redis pattern delete error");
  }
}

async function redisPipelineExec(commands) {
  try {
    const pipe = getRedis().pipeline();
    for (const [cmd, ...args] of commands) {
      pipe[cmd.toLowerCase()](...args);
    }
    return await pipe.exec();
  } catch {
    return null;
  }
}

async function redisZScore(key, member) {
  try {
    return await getRedis().zscore(key, member);
  } catch {
    return null;
  }
}

async function redisZIncrBy(key, increment, member, ttlSeconds = null) {
  try {
    const redis = getRedis();
    await redis.zincrby(key, increment, member);
    // Set last activity timestamp
    await redis.set(`engagement:last:${member}`, Date.now().toString(), ttlSeconds ? "EX" : null, ttlSeconds);
    if (ttlSeconds) {
      await redis.expire(key, ttlSeconds);
    }
  } catch {}
}

async function incrGlobalRequests() {
  try {
    const redis = getRedis();
    await redis.incr("global:requests");
    await redis.expire("global:requests", 60);
  } catch {}
}

async function pfaddActiveUser(userId) {
  try {
    const redis = getRedis();
    const dayKey = `active:users:${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;
    await redis.pfadd(dayKey, userId);
    await redis.expire(dayKey, 86400);
  } catch {}
}

function getDateKey() {
  return new Date().toISOString().slice(0,10).replace(/-/g,'');
}

async function getSystemMetrics() {
  const now = Date.now();
  if (now - cachedMetrics.lastUpdated < 2000) {
    return cachedMetrics;
  }
  try {
    const redis = getRedis();
    const currentHour = new Date().getHours();

    // Pipeline core metrics + 12h history + health checks
    const pipelineCommands = [
      ["get", "global:requests"],
      ["pfcount", `active:users:${getDateKey()}`],
      ["info", "memory"],
      ["get", "global:cache_hits"],
      ["get", "global:cache_misses"],
      ["ping"],
      ["get", "worker:heartbeat"],
      ["info", "persistence"]
    ];

    // Add 12h RPM history keys
    for (let h = 0; h < 12; h++) {
      const hourIdx = (currentHour - 11 + h + 24) % 24;
      pipelineCommands.push(["get", `metrics:hour:${hourIdx}:total_load`]);
      pipelineCommands.push(["get", `metrics:hour:${hourIdx}:count`]);
    }

    const results = await redisPipelineExec(pipelineCommands);
    
    // Parse core metrics (indices 0-7)
    const rpmRes = results?.[0]; const rpm = Number(rpmRes?.[1] || 0);
    const usersRes = results?.[1]; const activeUsers = Number(usersRes?.[1] || 0);
    const memInfo = results?.[2]?.[1]; 
    const memoryUsage = parseFloat(memInfo?.match(/used_memory:(\d+)/)?.[1] / memInfo?.match(/maxmemory:(\d+)/)?.[1] || 0);
    const hitRes = results?.[3]; const hits = Number(hitRes?.[1] || 0);
    const missRes = results?.[4]; const misses = Number(missRes?.[1] || 0);
    const cacheHitRate = (hits + misses > 0) ? Math.round((hits / (hits + misses)) * 100) / 100 : 0;
    
    // Health checks
    const redisOk = results?.[5]?.[1] === 'PONG';
    const workerHeartbeat = results?.[6]?.[1];
    const workerOk = workerHeartbeat && (Date.now() - Number(workerHeartbeat) < 2 * 3600000); // < 2hr old
    const persistenceInfo = results?.[7]?.[1];
    const aofOk = persistenceInfo?.includes('aof_enabled=1') || persistenceInfo?.includes('rdb_last_save');
    
    // RPM History: 12 hours avg RPM
    const rpmHistory = [];
    for (let h = 0; h < 12; h++) {
      const idx = 8 + h * 2; // pipeline indices 8,10,12...25
      const totalRes = results?.[idx]; const total = Number(totalRes?.[1] || 0);
      const countRes = results?.[idx + 1]; const count = Number(countRes?.[1] || 0);
      rpmHistory[h] = count > 0 ? Math.round(total / count) : 0;
    }
    
    // Predicted History: same hours predicted (+15%)
    const predictedHistory = rpmHistory.map(rpm => Math.round(rpm * 1.15));

    cachedMetrics = { 
      rpm, activeUsers, memoryUsage, cacheHitRate, 
      rpmHistory, predictedHistory, redisOk, workerOk, aofOk,
      lastUpdated: now 
    };
  } catch (err) {
    logger.warn({ event: "REDIS_METRICS_ERROR", err }, "getSystemMetrics error");
    // Preserve cache on error
  }
  return cachedMetrics;
}

async function incrGlobalCacheHit() {
  try {
    const redis = getRedis();
    await redis.incr("global:cache_hits");
    await redis.expire("global:cache_hits", 60);
  } catch {}
}

async function incrGlobalCacheMiss() {
  try {
    const redis = getRedis();
    await redis.incr("global:cache_misses");
    await redis.expire("global:cache_misses", 60);
  } catch {}
}

async function setStaleCache(key, value, ttlSeconds) {
  try {
    await redisSet(key, value, ttlSeconds);
  } catch {}
}

async function cleanupInactiveUsers() {
  try {
    const redis = getRedis();
    const thirtyDaysAgo = (Date.now() - 30*24*60*60*1000).toString();
    await redis.eval(`
      local members = redis.call('ZRANGEBYSCORE', 'engagement:score', '-inf', ARGV[1])
      for i, member in ipairs(members) do
        local last = redis.call('GET', 'engagement:last:' .. member)
        if not last or tonumber(last) < tonumber(ARGV[1]) then
          redis.call('ZREM', 'engagement:score', member)
          redis.call('DEL', 'engagement:last:' .. member)
        end
      end
    `, 0, thirtyDaysAgo);
  } catch (err) {
    logger.warn({ event: "REDIS_CLEANUP_ERROR", err }, "cleanupInactiveUsers error");
  }
}

async function decayEngagement() {
  try {
    const redis = getRedis();
    await redis.eval(`
      local members = redis.call('ZRANGE', 'engagement:score', 0, -1, 'WITHSCORES')\n      for i = 1, #members, 2 do
        local score = tonumber(members[i+1])
        if score then
          redis.call('ZADD', 'engagement:score', score * 0.99, members[i])
        end
      end
    `, 0);
  } catch (err) {
    logger.warn({ event: "REDIS_DECAY_ERROR", err }, "decayEngagement error");
  }
}

async function redisLock(key, ttl = 30) {
  try {
    const redis = getRedis();
    return await redis.set(key, Date.now(), "PX", ttl*1000, "NX");
  } catch {
    return null;
  }
}

async function getCacheVersion(ns) {
  try {
    return Number(await redisGet(`cache:version:${ns}`) || 0);
  } catch {
    return 0;
  }
}

async function bumpCacheVersion(ns) {
  try {
    await getRedis().incr(`cache:version:${ns}`);
  } catch {}
}

async function trackHourLoad() {
  try {
    const hour = new Date().getHours();
    const redis = getRedis();
    await redis.incrby(`metrics:hour:${hour}:total_load`, 1);
    await redis.incr(`metrics:hour:${hour}:count`);
    await redis.expire(`metrics:hour:${hour}:total_load`, 7 * 86400);
    await redis.expire(`metrics:hour:${hour}:count`, 7 * 86400);
  } catch {}
}

async function getPredictedRPM() {
  try {
    const nextHour = (new Date().getHours() + 1) % 24;
    const total = Number(await redisGet(`metrics:hour:${nextHour}:total_load`) || 0);
    const count = Number(await redisGet(`metrics:hour:${nextHour}:count`) || 0);
    if (count === 0) return 0;
    return Math.round((total / count) * 1.15);
  } catch {
    return 0;
  }
}

function getDynamicLimit(score, rpm, memoryUsage) {
  const base = 20 + Math.sqrt(score) * 10;
  let loadFactor = 1;
  if (rpm > 10000) loadFactor = 0.5;
  else if (rpm > 5000) loadFactor = 0.7;
  let memoryFactor = memoryUsage > 0.8 ? 0.7 : 1;
  return Math.floor(Math.min(base * loadFactor * memoryFactor, 500));
}

module.exports = { getRedis, redisGet, redisSet, redisDel, redisDelPattern, compress, decompress, redisPipelineExec, redisZScore, redisZIncrBy, incrGlobalRequests, pfaddActiveUser, getSystemMetrics, incrGlobalCacheHit, incrGlobalCacheMiss, setStaleCache, cleanupInactiveUsers, decayEngagement, redisLock, getCacheVersion, bumpCacheVersion, trackHourLoad, getPredictedRPM, getDynamicLimit };
