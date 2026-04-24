const logger = require('./logger');
const { getRedis, decayEngagement, cleanupInactiveUsers } = require('./redis');

logger.info({ event: "WORKER_STARTED" }, "Redis Worker started — decay & cleanup every hour");

setInterval(async () => {
  try {
    // Heartbeat every hour
    const { getRedis } = require('./redis');
    await getRedis().set('worker:heartbeat', Date.now(), 'EX', 7200);
    logger.debug({ event: "WORKER_HEARTBEAT" }, "Worker heartbeat sent");

    logger.info({ event: "WORKER_DECAY_START" }, "Running engagement decay...");
    await decayEngagement();
    logger.info({ event: "WORKER_DECAY_DONE" }, "Engagement decay complete");

    logger.info({ event: "WORKER_CLEANUP_START" }, "Running inactive user cleanup...");
    await cleanupInactiveUsers();
    logger.info({ event: "WORKER_CLEANUP_DONE" }, "Inactive user cleanup complete");
  } catch (err) {
    logger.error({ event: "WORKER_ERROR", err }, "Worker crashed");
  }
}, 3600000); // 1 hour

// Run once on start
(async () => {
  logger.info({ event: "WORKER_INIT" }, "Running initial decay & cleanup...");
  await decayEngagement();
  await cleanupInactiveUsers();
  logger.info({ event: "WORKER_INIT_DONE" }, "Initial decay & cleanup complete");
})();
