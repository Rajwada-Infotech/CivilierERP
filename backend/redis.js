const Redis = require("ioredis");

let client = null;

function getRedis() {
  if (!client) {
    client = new Redis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || "0"),
      maxRetriesPerRequest: null,
      retryStrategy: (times) => {
        console.log(`🔄 Retrying Redis... attempt ${times}`);
        if (times > 5) return null;
        return Math.min(times * 500, 3000);
      },
    });

    client.on("connect", () => console.log("✅ Redis connected"));
    client.on("error", (err) =>
      console.error("❌ Redis error:", err.message)
    );
    client.on("close", () =>
      console.warn("⚠️ Redis connection closed")
    );
    
    client.on("ready", () => console.log("🚀 Redis ready to use"));
  }

  return client;
}

// Safe helpers (never crash app)
async function redisGet(key) {
  try {
    return await getRedis().get(key);
  } catch (err) {
    console.error("Redis get error:", err.message);
    return null;
  }
}

async function redisSet(key, value, ttlSeconds = null) {
  if (!ttlSeconds) {
    console.warn(`redisSet called on key "${key}" without TTL - data will persist indefinitely`);
  }
  try {
    if (ttlSeconds) {
      await getRedis().set(key, value, "EX", ttlSeconds);
    } else {
      await getRedis().set(key, value);
    }
  } catch (err) {
    console.error("Redis set error:", err.message);
  }
}

async function redisDel(key) {
  try {
    await getRedis().del(key);
  } catch (err) {
    console.error("Redis del error:", err.message);
  }
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
        100
      );

      cursor = nextCursor;

      if (keys.length) {
        await redis.del(keys);
      }
    } while (cursor !== "0");
  } catch (err) {
    console.error("Redis delPattern error:", err.message);
  }
}

module.exports = {
  getRedis,
  redisGet,
  redisSet,
  redisDel,
  redisDelPattern,
};

