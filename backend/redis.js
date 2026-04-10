const Redis = require("ioredis");

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

    client.on("connect", () => console.log("Redis connected"));
    client.on("error", (err) => console.error("Redis error:", err.message));
    client.on("close", () => console.warn("Redis connection closed"));
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

async function redisDelPattern(pattern) {
  try {
    const redis = getRedis();
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  } catch {}
}

module.exports = { getRedis, redisGet, redisSet, redisDel, redisDelPattern };
