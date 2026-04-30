const logger = require("./logger");
const { getRedis, decayEngagement, cleanupInactiveUsers } = require("./redis");

logger.info(
  { event: "WORKER_STARTED" },
  "Redis Worker started - decay & cleanup every hour",
);

async function runMaintenance(eventPrefix) {
  try {
    const redis = await getRedis();
    await redis.set("worker:heartbeat", Date.now(), "EX", 7200);
    logger.debug({ event: "WORKER_HEARTBEAT" }, "Worker heartbeat sent");

    logger.info(
      { event: `${eventPrefix}_DECAY_START` },
      "Running engagement decay...",
    );
    const decayed = await decayEngagement();
    logger.info(
      { event: `${eventPrefix}_DECAY_DONE`, decayed },
      "Engagement decay complete",
    );

    logger.info(
      { event: `${eventPrefix}_CLEANUP_START` },
      "Running inactive user cleanup...",
    );
    const removed = await cleanupInactiveUsers();
    logger.info(
      { event: `${eventPrefix}_CLEANUP_DONE`, removed },
      "Inactive user cleanup complete",
    );
  } catch (err) {
    logger.error(
      { event: `${eventPrefix}_ERROR`, err },
      "Worker maintenance failed",
    );
  }
}

setInterval(() => {
  runMaintenance("WORKER");
}, 3600000);

runMaintenance("WORKER_INIT");
