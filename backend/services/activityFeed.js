"use strict";

// Live activity for the terminal monitor (scripts/monitor.js, `npm run monitor`): every finished request, logins,
// errors and warnings from the logger, and a vitals sample once a second (CPU, memory, event-loop lag, DB pool, Redis,
// worker, socket users). Kept in small ring buffers in memory and streamed to whoever is watching through
// routes/internalMonitor.js. Costs a few array pushes per request when nobody is watching.

const { EventEmitter } = require("events");
const { monitorEventLoopDelay } = require("perf_hooks");

const feed = new EventEmitter();
feed.setMaxListeners(20);

const MAX_REQUESTS = 300;
const MAX_ERRORS = 150;
const MAX_LOGINS = 100;
const MAX_VITALS = 120;

const requests = [];
const errors = [];
const logins = [];
const vitals = [];
const startedAt = new Date().toISOString();

function push(list, item, max) {
  list.push(item);
  if (list.length > max) list.shift();
}

function emit(type, data, list, max) {
  const event = { type, t: Date.now(), ...data };
  push(list, event, max);
  if (feed.listenerCount("event")) feed.emit("event", event);
}

/** One finished (or abandoned) HTTP request. */
function recordRequest(r) {
  emit("request", r, requests, MAX_REQUESTS);
}

/** A sign-in attempt: who, from where, and whether it worked. */
function recordLogin(l) {
  emit("login", l, logins, MAX_LOGINS);
}

/** A warning or error, from the logger (level 40+) or the global error handler. */
function recordError(e) {
  emit("error", e, errors, MAX_ERRORS);
}

// ── Vitals ──────────────────────────────────────────────────────────────────────
let loopDelay = null;
let lastCpu = process.cpuUsage();
let lastAt = process.hrtime.bigint();
let timer = null;

function safe(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function sampleVitals() {
  const now = process.hrtime.bigint();
  const cpu = process.cpuUsage(lastCpu);
  const elapsedUs = Number(now - lastAt) / 1000;
  lastCpu = process.cpuUsage();
  lastAt = now;
  const mem = process.memoryUsage();
  const ms = (ns) => Math.round((ns / 1e6) * 10) / 10;

  // Required lazily: these modules require the logger, which requires this file.
  const db = safe(() => require("../db"));
  const pool = safe(() => db.getPool());
  const redis = safe(() => require("../redis"));
  const worker = safe(() => require("../worker"));
  const io = safe(() => require("../socket").getIo());

  const v = {
    cpu: elapsedUs > 0 ? Math.round(((cpu.user + cpu.system) / elapsedUs) * 1000) / 10 : 0,
    rssMB: Math.round(mem.rss / 1048576),
    heapMB: Math.round(mem.heapUsed / 1048576),
    heapTotalMB: Math.round(mem.heapTotal / 1048576),
    loopP50: loopDelay ? ms(loopDelay.percentile(50)) : null,
    loopP99: loopDelay ? ms(loopDelay.percentile(99)) : null,
    loopMax: loopDelay ? ms(loopDelay.max) : null,
    handles: safe(() => process.getActiveResourcesInfo().length),
    db: pool ? { connected: !!pool.connected, ...(db.getPoolStats(pool) || {}) } : { connected: false },
    redis: safe(() => redis.redisStatus(), "unknown"),
    worker: safe(() => worker.isRunning(), false),
    sockets: safe(() => io.engine.clientsCount, 0),
    uptime: Math.round(process.uptime()),
  };
  if (loopDelay) loopDelay.reset();
  emit("vitals", v, vitals, MAX_VITALS);
}

/** Starts the once-a-second vitals sample (idempotent; the timer never keeps the process alive). */
function startVitals() {
  if (timer) return;
  loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();
  timer = setInterval(sampleVitals, 1000);
  timer.unref();
}

/** Everything held so far, for a monitor that has just connected. */
function snapshot() {
  return {
    startedAt,
    pid: process.pid,
    node: process.version,
    env: process.env.NODE_ENV || "development",
    requests,
    errors,
    logins,
    vitals,
  };
}

module.exports = { feed, recordRequest, recordLogin, recordError, startVitals, snapshot };
