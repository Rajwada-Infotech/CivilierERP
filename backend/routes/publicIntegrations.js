/**
 * Addresses Meta and Google call — no staff login, each request proves itself:
 *  - GET  /oauth/callback          — back from "Connect with Google / Facebook"; the signed state names the connection.
 *  - GET  /meta-leads/:channelId   — Meta's handshake (verify token).
 *  - POST /meta-leads/:channelId   — a lead-form submission; signed with the app secret.
 */
const express = require("express");
const rateLimit = require("../middleware/rateLimiter");
const { getPool } = require("../db");
const { parseId } = require("../middleware/validateRequest");
const { readState, finish } = require("../services/integrationOAuth");
const { parseSettings } = require("../services/integrationConnections");
const { verifyHandshake, signatureValid, processDelivery, loadConnection } = require("../services/metaLeadWebhook");

const router = express.Router();
router.use(rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));

// Back to Admin → Integrations with the outcome in the address (the page shows it).
const backTo = (returnTo, params) => {
  const u = new URL(returnTo);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
};

router.get("/oauth/callback", async (req, res) => {
  let state;
  try {
    state = readState(req.query.state);
  } catch {
    return res.status(400).send("This sign-in link has expired or is not valid. Go back to Admin → Integrations and press Connect again.");
  }
  if (req.query.error) {
    return res.redirect(backTo(state.returnTo, { connectError: String(req.query.error_description || req.query.error).slice(0, 200) }));
  }
  try {
    await finish(getPool(), state, String(req.query.code || ""));
    res.redirect(backTo(state.returnTo, { connected: String(state.cid) }));
  } catch (err) {
    console.error("[public-integrations] oauth callback:", err.message);
    res.redirect(backTo(state.returnTo, { connectError: String(err.body?.error_description || err.body?.error?.message || err.message).slice(0, 200) }));
  }
});

router.get("/meta-leads/:channelId", async (req, res) => {
  const id = parseId(req.params.channelId);
  if (id === null) return res.sendStatus(404);
  try {
    const challenge = await verifyHandshake(getPool(), id, req.query);
    return challenge === null ? res.sendStatus(403) : res.type("text/plain").send(challenge);
  } catch (err) {
    console.error("[public-integrations] meta handshake:", err.message);
    res.sendStatus(500);
  }
});

router.post("/meta-leads/:channelId", async (req, res) => {
  const id = parseId(req.params.channelId);
  if (id === null) return res.sendStatus(404);
  try {
    const pool = getPool();
    const conn = await loadConnection(pool, id);
    if (!conn) return res.sendStatus(404);
    if (!signatureValid(parseSettings(conn.ConnSettingsJson).appSecret, req.rawBody, req.get("x-hub-signature-256"))) {
      return res.sendStatus(403);
    }
    // Answer at once — Meta retries slow deliveries — then read and create the leads.
    res.sendStatus(200);
    processDelivery(pool, id, req.body).catch((err) => console.error("[public-integrations] meta leads:", err.message));
  } catch (err) {
    console.error("[public-integrations] meta leads:", err.message);
    if (!res.headersSent) res.sendStatus(500);
  }
});

module.exports = router;
