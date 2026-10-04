/**
 * pushDevices.js — phone push-notification registration.
 *
 *   POST /api/push-devices/register    { token, appKey?, platform? }
 *   POST /api/push-devices/unregister  { token }          (call on logout)
 *
 * authMiddleware is applied globally on /api in server.js; the token is always
 * bound to the CALLER, never to a user id from the body.
 */
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300, validate: false, message: { error: "Too many requests, please try again later." } }));
const { registerToken, unregisterToken } = require("../services/pushNotifications");

const callerId = (req) => Number(req.user?.userId ?? req.user?.id);

router.post("/register", async (req, res) => {
  try {
    await registerToken(callerId(req), String(req.body?.token ?? ""), {
      appKey: req.body?.appKey,
      platform: req.body?.platform,
    });
    res.json({ success: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("[push-devices] register error:", err.message);
    res.status(500).json({ error: "Could not register this device for notifications." });
  }
});

router.post("/unregister", async (req, res) => {
  try {
    const removed = await unregisterToken(callerId(req), String(req.body?.token ?? ""));
    res.json({ success: true, removed });
  } catch (err) {
    console.error("[push-devices] unregister error:", err.message);
    res.status(500).json({ error: "Could not unregister this device." });
  }
});

module.exports = router;
