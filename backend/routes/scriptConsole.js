"use strict";

/**
 * Script Console (Admin > Script Console): run Node scripts on the server, like `docker compose exec backend node -`,
 * from the browser. Super admin only, and only with the vault key (services/scriptVault.js):
 *
 *   1. the role is checked here on every route (not only by the page),
 *   2. status / setup / unlock need no open vault; EVERYTHING else answers 403 VAULT_LOCKED until the 256-bit key has
 *      been entered by this sign-in, and again after 15 idle minutes,
 *   3. scripts, variables and output are encrypted at rest with a key derived from the vault key,
 *   4. every run is written to dbo.ScriptRunLog before it starts - no run without a record.
 */

const express = require("express");
const bcrypt = require("bcrypt");
const rateLimit = require("../middleware/rateLimiter");
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const { isSuperAdmin } = require("../middleware/maintenanceGate");
const vault = require("../services/scriptVault");
const runner = require("../services/scriptRunner");
const store = require("../services/scriptConsoleStore");

const router = express.Router();
router.use(apiRateLimit);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 3000, validate: false, message: { error: "Too many requests, please try again later." } }));
const keyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, validate: false, message: { error: "Too many attempts, please try again later." } });

// 1. Super admin only, on every route.
router.use((req, res, next) => {
  if (!isSuperAdmin(req.user?.role)) return res.status(403).json({ error: "Only a super admin can use the Script Console." });
  next();
});

const uid = (req) => Number(req.user?.userId ?? req.user?.id);
const who = (req) => req.user?.email || req.user?.name || String(uid(req));
const fail = (res, err) => res.status(err.status || 500).json({ error: err.status ? err.message : "Something went wrong." });

/** 2. The open vault of this sign-in, or answers 403 VAULT_LOCKED. */
function requireUnlocked(req, res, next) {
  const session = vault.getSession(req.token, uid(req));
  if (!session) return res.status(403).json({ code: "VAULT_LOCKED", error: "The vault is locked. Enter the vault key." });
  req.vault = session;
  next();
}

async function passwordIsRight(req, password) {
  const row = (await getPool().request().input("id", sql.Int, uid(req)).query("SELECT password FROM dbo.users WHERE id = @id")).recordset[0];
  return !!row && (await bcrypt.compare(String(password || ""), row.password));
}

function lockoutReply(res, ms) {
  res.set("Retry-After", String(Math.ceil(ms / 1000)));
  return res.status(429).json({ code: "VAULT_LOCKED_OUT", error: `Too many wrong keys. Try again in ${Math.ceil(ms / 60000)} minute(s).`, retryAfterSec: Math.ceil(ms / 1000) });
}

// ── Status, setup, unlock, lock, rotate ───────────────────────────────────────────────────────────────────────────────
router.get("/status", async (req, res) => {
  try {
    const row = await store.getKeyRow();
    const s = vault.peekSession(req.token, uid(req));
    const active = runner.running();
    res.set("Cache-Control", "no-store");
    res.json({
      configured: !!row,
      unlocked: !!s,
      idleMinutes: vault.IDLE_MS / 60000,
      lockedOutSec: Math.ceil(vault.lockedFor(uid(req)) / 1000),
      running: active ? { id: active.id, startedAt: active.startedAt, name: active.name } : null,
    });
  } catch (err) { fail(res, err); }
});

// The first key. Needs the person's own login password, so a borrowed browser session cannot create it.
router.post("/setup", keyLimiter, async (req, res) => {
  try {
    if (await store.getKeyRow()) return res.status(409).json({ error: "The vault key already exists." });
    const locked = vault.lockedFor(uid(req));
    if (locked) return lockoutReply(res, locked);
    if (!(await passwordIsRight(req, req.body?.password))) {
      const f = vault.recordFailure(uid(req));
      return res.status(403).json({ error: "That is not your password.", attemptsLeft: f.remaining });
    }
    vault.clearFailures(uid(req));
    const key = vault.generateKey();
    const v = vault.newVerifier(key);
    await store.insertKeyRow({ salt: v.salt, hash: v.hash, by: who(req) });
    vault.openSession(req.token, uid(req), key);
    // The one and only time the key leaves the server.
    res.set("Cache-Control", "no-store");
    res.status(201).json({ key: vault.formatKey(key) });
  } catch (err) { fail(res, err); }
});

router.post("/unlock", keyLimiter, async (req, res) => {
  try {
    const locked = vault.lockedFor(uid(req));
    if (locked) return lockoutReply(res, locked);
    const row = await store.getKeyRow();
    if (!row) return res.status(409).json({ code: "VAULT_NOT_SET", error: "No vault key has been created yet." });
    const key = vault.parseKey(req.body?.key);
    if (!key || !vault.verifyKey(key, row)) {
      const f = vault.recordFailure(uid(req));
      if (f.lockedUntil > Date.now()) return lockoutReply(res, f.lockedUntil - Date.now());
      return res.status(403).json({ error: "That is not the vault key.", attemptsLeft: f.remaining });
    }
    vault.clearFailures(uid(req));
    vault.openSession(req.token, uid(req), key);
    res.json({ ok: true, idleMinutes: vault.IDLE_MS / 60000 });
  } catch (err) { fail(res, err); }
});

router.post("/lock", (req, res) => {
  vault.closeSession(req.token);
  res.json({ ok: true });
});

// A new key, with everything re-encrypted under it. Needs the current key again.
router.post("/rotate", keyLimiter, requireUnlocked, async (req, res) => {
  try {
    const locked = vault.lockedFor(uid(req));
    if (locked) return lockoutReply(res, locked);
    const row = await store.getKeyRow();
    const current = vault.parseKey(req.body?.currentKey);
    if (!current || !vault.verifyKey(current, row)) {
      const f = vault.recordFailure(uid(req));
      return res.status(403).json({ error: "That is not the current vault key.", attemptsLeft: f.remaining });
    }
    vault.clearFailures(uid(req));
    const next = vault.generateKey();
    const v = vault.newVerifier(next);
    await store.rotateKey(vault.deriveEncKey(current), vault.deriveEncKey(next), v);
    vault.closeAllSessions(); // every open vault must use the new key
    vault.openSession(req.token, uid(req), next);
    res.set("Cache-Control", "no-store");
    res.json({ key: vault.formatKey(next) });
  } catch (err) { fail(res, err); }
});

// ── Everything below needs the open vault ─────────────────────────────────────────────────────────────────────────────
router.use(requireUnlocked);
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

// Saved scripts
const cleanLibrary = (b) => {
  const name = String(b?.name ?? "").trim();
  const script = String(b?.script ?? "");
  if (!name || name.length > 200) throw Object.assign(new Error("Give the script a name (up to 200 characters)."), { status: 400 });
  if (!script.trim()) throw Object.assign(new Error("The script is empty."), { status: 400 });
  if (script.length > runner.MAX_SCRIPT) throw Object.assign(new Error("The script is too long."), { status: 400 });
  const env = Object.entries(runner.parseEnv(b?.env)).map(([key, value]) => ({ key, value }));
  return { name, description: String(b?.description ?? "").trim().slice(0, 500), script, env };
};
const dupName = (err) => (err?.number === 2627 || err?.number === 2601 ? Object.assign(new Error("A saved script with that name already exists."), { status: 409 }) : err);

router.get("/library", async (req, res) => {
  try { res.json(await store.listLibrary(req.vault.encKey)); } catch (err) { fail(res, err); }
});
router.post("/library", async (req, res) => {
  try { res.status(201).json({ id: await store.saveLibrary(req.vault.encKey, { ...cleanLibrary(req.body), by: who(req) }) }); } catch (err) { fail(res, dupName(err)); }
});
router.put("/library/:id", async (req, res) => {
  try {
    const id = await store.saveLibrary(req.vault.encKey, { ...cleanLibrary(req.body), id: parseInt(req.params.id, 10), by: who(req) });
    if (!id) return res.status(404).json({ error: "Saved script not found." });
    res.json({ id });
  } catch (err) { fail(res, dupName(err)); }
});
router.delete("/library/:id", async (req, res) => {
  try {
    if (!(await store.deleteLibrary(parseInt(req.params.id, 10)))) return res.status(404).json({ error: "Saved script not found." });
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

// Runs
router.post("/run", async (req, res) => {
  try {
    const script = req.body?.script;
    const env = req.body?.env;
    const name = String(req.body?.name ?? "").trim().slice(0, 200) || null;
    const minutes = Number(req.body?.timeoutMinutes);
    const id = runner.newRunId();
    runner.parseEnv(env); // validate before anything is written
    if (typeof script !== "string" || !script.trim()) return res.status(400).json({ error: "There is no script to run." });
    if (runner.running()) return res.status(409).json({ error: "A script is already running. Stop it or wait for it to finish." });

    const encKey = req.vault.encKey;
    const user = { id: uid(req), email: who(req) };
    // 4. The record comes first: if it cannot be written the script does not run.
    await store.insertRun(encKey, { id, user, name, script, env: runner.parseEnv(env) });
    const run = runner.start({
      id, script, env, user, name, timeoutMs: Number.isFinite(minutes) ? minutes * 60_000 : undefined,
      onFinish: (r) => { store.finishRun(encKey, r, runner.outputText(r)).catch((e) => console.error("[script-console] could not record the end of run", r.id, e.message)); },
    });
    res.status(202).json({ id: run.id, startedAt: run.startedAt });
  } catch (err) { fail(res, err); }
});

router.get("/runs/:id", (req, res) => {
  const run = runner.get(req.params.id);
  if (!run) return res.status(404).json({ error: "That run is no longer in memory - open it from History." });
  res.json(runner.view(run, Math.max(0, parseInt(req.query.from, 10) || 0)));
});

router.post("/runs/:id/kill", (req, res) => {
  if (!runner.kill(req.params.id, who(req))) return res.status(404).json({ error: "That run is not running." });
  res.json({ ok: true });
});

// History
router.get("/history", async (req, res) => {
  try {
    await store.markInterrupted(runner.running()?.id);
    res.json(await store.listRuns(parseInt(req.query.limit, 10) || 50));
  } catch (err) { fail(res, err); }
});
router.get("/history/:id", async (req, res) => {
  try {
    const run = await store.getRun(req.vault.encKey, String(req.params.id).slice(0, 40));
    if (!run) return res.status(404).json({ error: "Run not found." });
    res.json(run);
  } catch (err) { fail(res, err); }
});

module.exports = router;
