const { getRedis, decayEngagement, cleanupInactiveUsers } = require('./redis');

console.log('Redis Worker started - Decay & Cleanup every hour');

setInterval(async () => {
  try {
    // Heartbeat every hour
    const { getRedis } = require('./redis');
    await getRedis().set('worker:heartbeat', Date.now(), 'EX', 7200);
    
    console.log('Running engagement decay...');
    await decayEngagement();
    console.log('Running inactive user cleanup...');
    await cleanupInactiveUsers();
  } catch (err) {
    console.error('Worker error:', err.message);
  }
}, 3600000); // 1 hour

// Run once on start
(async () => {
  await decayEngagement();
  await cleanupInactiveUsers();
})();
