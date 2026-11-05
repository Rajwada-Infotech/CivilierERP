#!/usr/bin/env node
"use strict";

// CivilierERP backend monitor — a live dashboard in the terminal, and a log of everything it sees.
//
//   npm run monitor                      watch the backend on this machine (PORT from backend/.env, else 5000)
//   npm run monitor -- --url http://127.0.0.1:5000 --token <MONITOR_TOKEN>
//   npm run monitor -- --plain           one line per event instead of the dashboard (also when output isn't a terminal)
//   npm run monitor -- --no-log          don't write the log file
//
// It reads the backend's local-only activity feed (routes/internalMonitor.js): every request, sign-in, warning and
// error, and a vitals sample each second. It shows health (API, database pool, Redis, worker, live socket users),
// resources (CPU, memory, event-loop lag), traffic (requests a minute, latency, error rate, status mix), the busiest
// and slowest routes, who is active, and a live feed with views for errors, slow requests and sign-ins. It raises
// alerts when something goes wrong, and writes every event and alert to logs/monitor/activity-YYYY-MM-DD.log.
// Keys: 1-4 switch the lower panel · p pause · c clear the counts · q quit. Reconnects by itself when the backend
// restarts. No dependencies beyond Node and dotenv.

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
} catch {
  // dotenv is optional here: flags and the environment still work.
}

// ── Options ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = opt("url", process.env.MONITOR_URL || `http://127.0.0.1:${process.env.PORT || 5000}`).replace(/\/$/, "");
const TOKEN = opt("token", process.env.MONITOR_TOKEN || "");
const TTY = process.stdout.isTTY && !flag("plain");
const LOG_DIR = opt("log-dir", path.join(__dirname, "..", "logs", "monitor"));
const LOGGING = !flag("no-log");

// Thresholds for alerts and colours.
const SLOW_MS = 800;
const VERY_SLOW_MS = 2000;
const WINDOW_MS = 5 * 60 * 1000; // tables cover the last five minutes
const KEEP_MS = 15 * 60 * 1000; // requests kept for the slow view

// ── State ───────────────────────────────────────────────────────────────────────
const S = {
  connected: false,
  everConnected: false,
  connectedAt: 0,
  lastError: "",
  server: null,
  reqs: [],
  errs: [],
  logins: [],
  vitals: [],
  seen: 0, // newest event time taken in, so a reconnect's snapshot doesn't add the same events twice
  loggedTo: Date.now(), // events up to here are already in the log (or happened before the monitor started)
  totals: { requests: 0, s5xx: 0, s4xx: 0, loginOk: 0, loginFail: 0, errors: 0, warns: 0 },
  alerts: new Map(),
  view: 1,
  paused: false,
  pausedAt: 0,
  startedAt: Date.now(),
};

// ── Formatting ──────────────────────────────────────────────────────────────────
const esc = (code) => (s) => (TTY || process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const C = {
  bold: esc("1"),
  dim: esc("2"),
  red: esc("31"),
  green: esc("32"),
  yellow: esc("33"),
  blue: esc("34"),
  magenta: esc("35"),
  cyan: esc("36"),
  gray: esc("90"),
  inv: esc("7"),
  redBg: esc("41;97;1"),
  greenBg: esc("42;30;1"),
  head: esc("48;5;24;97;1"),
};
const pad2 = (n) => String(n).padStart(2, "0");
const clock = (t) => {
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};
const stamp = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${clock(t)}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};
const dur = (ms) => (ms == null ? "—" : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`);
const span = (s) => {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${pad2(s % 60)}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${pad2(Math.floor((s % 3600) / 60))}m`;
  return `${Math.floor(s / 86400)}d${pad2(Math.floor((s % 86400) / 3600))}h`;
};
const ago = (t) => span((Date.now() - t) / 1000);
const num = (n) => Number(n || 0).toLocaleString("en-IN");
const pct = (part, whole) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "0%");
const percentile = (values, q) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((q / 100) * s.length))];
};
// eslint-disable-next-line no-control-regex
const visible = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");
/** Fits plain text to exactly w columns (cut with an ellipsis, or padded). */
const fit = (text, w, right = false) => {
  text = String(text ?? "");
  if (w <= 0) return "";
  if (text.length > w) return w === 1 ? "…" : `${text.slice(0, w - 1)}…`;
  return right ? text.padStart(w) : text.padEnd(w);
};
/** Fits an already-coloured string to exactly w columns: padded, or cut with an ellipsis keeping its colour codes. */
const fitColored = (s, w) => {
  const len = visible(s).length;
  if (len <= w) return s + " ".repeat(w - len);
  let out = "";
  let shown = 0;
  for (let i = 0; i < s.length && shown < w - 1; ) {
    // eslint-disable-next-line no-control-regex
    const code = /^\x1b\[[0-9;]*m/.exec(s.slice(i));
    if (code) {
      out += code[0];
      i += code[0].length;
    } else {
      out += s[i++];
      shown++;
    }
  }
  return `${out}…\x1b[0m`;
};
const SPARK = "▁▂▃▄▅▆▇█";
const spark = (values, width, max) => {
  const v = values.slice(-width);
  const top = max ?? Math.max(1, ...v.map((x) => x || 0));
  return v.map((x) => SPARK[Math.min(7, Math.round(((x || 0) / top) * 7))]).join("").padStart(width, " ");
};
const statusColor = (s) => (s >= 500 || s === 499 ? C.red : s >= 400 ? C.yellow : s >= 300 ? C.cyan : C.green);
const msColor = (ms) => (ms >= VERY_SLOW_MS ? C.red : ms >= SLOW_MS ? C.yellow : (x) => x);
const REDIS_WORDS = { ready: "ready", connect: "connecting", connecting: "connecting", reconnecting: "reconnecting", wait: "idle", end: "down", close: "down", "not-connected": "not connected" };
const redisWord = (s) => REDIS_WORDS[s] || s || "—";
const dot = (ok, warn = false) => (ok ? C.green("●") : warn ? C.yellow("●") : C.red("●"));

// ── Log file ────────────────────────────────────────────────────────────────────
let logDay = "";
let logStream = null;
let logPath = "";
function log(kind, text, at = Date.now()) {
  if (!LOGGING) return;
  const now = at;
  const day = stamp(now).slice(0, 10);
  if (day !== logDay) {
    logStream?.end();
    fs.mkdirSync(LOG_DIR, { recursive: true });
    logPath = path.join(LOG_DIR, `activity-${day}.log`);
    logStream = fs.createWriteStream(logPath, { flags: "a" });
    logDay = day;
  }
  logStream.write(`${stamp(now)} ${kind.padEnd(6)} ${text}\n`);
}

// One line per event, used for the log file and the --plain output.
function lineOf(e) {
  switch (e.type) {
    case "request":
      return ["REQ", `${e.method.padEnd(6)} ${String(e.status).padEnd(3)} ${dur(e.ms).padStart(7)}  ${e.path}  ${e.user || "-"}  ${e.ip || ""}`];
    case "login":
      return ["LOGIN", `${e.ok ? "ok    " : "FAILED"} ${e.email || "?"}  ${e.ip || ""}  (${e.portal}, ${e.status})`];
    case "error":
      return [e.level === "warn" ? "WARN" : "ERROR", `[${e.source}] ${e.msg}${e.detail && e.detail !== e.msg ? ` — ${e.detail}` : ""}${e.path ? `  ${e.method} ${e.path} (${e.status})` : ""}${e.user ? `  ${e.user}` : ""}`];
    default:
      return null;
  }
}

function plainPrint(kind, text) {
  const tint = kind === "ERROR" || kind === "ALERT" ? C.red : kind === "WARN" ? C.yellow : kind === "LOGIN" ? C.magenta : kind === "INFO" ? C.cyan : (x) => x;
  process.stdout.write(`${C.gray(clock(Date.now()))} ${tint(kind.padEnd(6))} ${text}\n`);
}

// ── Taking events in ────────────────────────────────────────────────────────────
function trim() {
  const cutoff = Date.now() - KEEP_MS;
  while (S.reqs.length && (S.reqs[0].t < cutoff || S.reqs.length > 20000)) S.reqs.shift();
  if (S.errs.length > 500) S.errs.splice(0, S.errs.length - 500);
  if (S.logins.length > 300) S.logins.splice(0, S.logins.length - 300);
  if (S.vitals.length > 600) S.vitals.splice(0, S.vitals.length - 600);
}

function take(e, live = true) {
  if (e.type === "vitals") {
    S.vitals.push(e);
    return;
  }
  if (e.t <= S.seen && !live) return;
  S.seen = Math.max(S.seen, e.t);
  if (e.type === "request") {
    S.reqs.push(e);
    S.totals.requests++;
    if (e.status >= 500) S.totals.s5xx++;
    else if (e.status >= 400) S.totals.s4xx++;
  } else if (e.type === "login") {
    S.logins.push(e);
    if (e.ok) S.totals.loginOk++;
    else S.totals.loginFail++;
  } else if (e.type === "error") {
    S.errs.push(e);
    if (e.level === "warn") S.totals.warns++;
    else S.totals.errors++;
  }
  const line = lineOf(e);
  if (line && (live ? e.t >= S.loggedTo : e.t > S.loggedTo)) {
    S.loggedTo = e.t;
    log(line[0], line[1], e.t);
    if (!TTY) plainPrint(line[0], line[1]);
  }
}

// ── Connection ──────────────────────────────────────────────────────────────────
const client = BASE.startsWith("https") ? https : http;
const headers = TOKEN ? { "x-monitor-token": TOKEN } : {};

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = client.get(url, { headers, timeout: 8000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          let msg = `HTTP ${res.statusCode}`;
          try {
            msg = JSON.parse(body).error || msg;
          } catch {
            // keep the status
          }
          return reject(new Error(msg));
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
  });
}

let retryTimer = null;
function scheduleReconnect(reason) {
  if (S.connected) {
    S.connected = false;
    log("INFO", `Lost the backend: ${reason}`);
    if (!TTY) plainPrint("INFO", `Lost the backend: ${reason} — retrying`);
  }
  S.lastError = reason;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, 2000);
}

async function connect() {
  let snap;
  try {
    snap = await getJson(`${BASE}/internal/monitor/snapshot`);
  } catch (e) {
    return scheduleReconnect(e.code === "ECONNREFUSED" ? "not running (connection refused)" : e.message);
  }
  const restarted = S.server && S.server.pid !== snap.pid;
  S.server = { pid: snap.pid, node: snap.node, env: snap.env, startedAt: snap.startedAt };
  if (restarted) log("INFO", `Backend restarted (pid ${snap.pid})`);
  for (const e of [...snap.requests, ...snap.logins, ...snap.errors].sort((a, b) => a.t - b.t)) take(e, false);
  S.vitals = snap.vitals.slice();

  const req = client.get(`${BASE}/internal/monitor/stream`, { headers }, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      return scheduleReconnect(`stream refused (HTTP ${res.statusCode})`);
    }
    S.connected = true;
    S.everConnected = true;
    S.connectedAt = Date.now();
    S.lastError = "";
    log("INFO", `Connected to ${BASE} (pid ${snap.pid}, ${snap.env}, node ${snap.node})`);
    if (!TTY) plainPrint("INFO", `Connected to ${BASE} (pid ${snap.pid}, ${snap.env})`);
    res.setEncoding("utf8");
    let buf = "";
    res.on("data", (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            take(JSON.parse(line.slice(6)));
          } catch {
            // a malformed line is skipped
          }
        }
      }
    });
    res.on("end", () => scheduleReconnect("stream ended"));
    res.on("error", (e) => scheduleReconnect(e.message));
  });
  req.on("error", (e) => scheduleReconnect(e.message));
}

// ── Numbers for the panels ──────────────────────────────────────────────────────
function compute() {
  const now = S.paused ? S.pausedAt : Date.now();
  const last60 = S.reqs.filter((r) => r.t > now - 60000);
  const last5m = S.reqs.filter((r) => r.t > now - WINDOW_MS);
  const lat60 = last60.map((r) => r.ms);

  // Requests per second over the last minute, for the sparkline.
  const perSec = new Array(60).fill(0);
  const nowSec = Math.floor(now / 1000);
  for (const r of last60) {
    const k = 59 - (nowSec - Math.floor(r.t / 1000));
    if (k >= 0 && k < 60) perSec[k]++;
  }

  const status = { s2: 0, s3: 0, s4: 0, s5: 0 };
  for (const r of last5m) status[r.status >= 500 || r.status === 499 ? "s5" : r.status >= 400 ? "s4" : r.status >= 300 ? "s3" : "s2"]++;

  const routes = new Map();
  for (const r of last5m) {
    const key = `${r.method} ${r.route}`;
    const x = routes.get(key) || { key, n: 0, total: 0, lat: [], err: 0, max: 0 };
    x.n++;
    x.total += r.ms;
    x.lat.push(r.ms);
    x.max = Math.max(x.max, r.ms);
    if (r.status >= 500) x.err++;
    routes.set(key, x);
  }
  const routeList = [...routes.values()].map((x) => ({ ...x, avg: x.total / x.n, p95: percentile(x.lat, 95) }));

  const users = new Map();
  for (const r of last5m) {
    if (!r.user) continue;
    const x = users.get(r.user) || { user: r.user, role: r.role, n: 0, last: 0, route: "", ip: r.ip };
    x.n++;
    if (r.t >= x.last) {
      x.last = r.t;
      x.route = `${r.method} ${r.path}`;
      x.ip = r.ip;
    }
    users.set(r.user, x);
  }

  const logins5m = S.logins.filter((l) => l.t > now - WINDOW_MS);
  const failsByIp = new Map();
  for (const l of logins5m) if (!l.ok) failsByIp.set(l.ip, (failsByIp.get(l.ip) || 0) + 1);

  return {
    now,
    rpm: last60.length,
    perSec,
    avg: lat60.length ? lat60.reduce((a, b) => a + b, 0) / lat60.length : null,
    p95: percentile(lat60, 95),
    max: lat60.length ? Math.max(...lat60) : null,
    e5: last60.filter((r) => r.status >= 500).length,
    e4: last60.filter((r) => r.status >= 400 && r.status < 500).length,
    status,
    busiest: routeList.sort((a, b) => b.n - a.n).slice(0, 12),
    slowest: [...routeList].sort((a, b) => b.avg - a.avg).slice(0, 12),
    users: [...users.values()].sort((a, b) => b.last - a.last),
    loginsOk: logins5m.filter((l) => l.ok).length,
    loginsFail: logins5m.filter((l) => !l.ok).length,
    failsByIp,
    vit: S.vitals[S.vitals.length - 1] || null,
  };
}

// ── Alerts ──────────────────────────────────────────────────────────────────────
function checkAlerts(m) {
  const want = new Map();
  const v = m.vit;
  const fresh = v && Date.now() - v.t < 5000;
  if (!S.connected && S.lastError) want.set("down", S.everConnected ? `Backend unreachable: ${S.lastError}` : `Can't reach the backend at ${BASE}: ${S.lastError}`);
  if (S.connected && fresh) {
    if (!v.db.connected) want.set("db", "Database pool is not connected");
    else if (v.db.pending > 0) {
      const waiting = S.vitals.slice(-5).every((x) => x.db && x.db.pending > 0);
      if (waiting) want.set("dbwait", `Database pool saturated: ${v.db.pending} queries waiting for a connection`);
    }
    if (v.redis !== "ready") want.set("redis", `Redis ${redisWord(v.redis)}: cache, rate limits and sessions are falling back`);
    if (!v.worker) want.set("worker", "Background worker is not running");
    if (v.loopP99 != null && v.loopP99 > 200) want.set("loop", `Event loop stalling: p99 ${dur(v.loopP99)}`);
    if (S.vitals.slice(-5).length === 5 && S.vitals.slice(-5).every((x) => x.cpu > 90)) want.set("cpu", `CPU above 90% for 5s (${v.cpu}%)`);
    if (v.heapMB > 1500) want.set("heap", `Heap at ${v.heapMB} MB`);
  }
  if (m.rpm >= 10 && m.e5 / m.rpm > 0.05) want.set("5xx", `Server errors: ${m.e5} of ${m.rpm} requests in the last minute (${pct(m.e5, m.rpm)})`);
  else if (m.e5 >= 5) want.set("5xx", `${m.e5} server errors in the last minute`);
  if (m.rpm >= 10 && m.p95 > VERY_SLOW_MS) want.set("slow", `Slow responses: p95 ${dur(m.p95)} over the last minute`);
  for (const [ip, n] of m.failsByIp) if (n >= 5) want.set(`brute:${ip}`, `${n} failed sign-ins from ${ip} in 5 minutes`);

  for (const [k, msg] of want) {
    if (!S.alerts.has(k)) {
      S.alerts.set(k, { msg, since: Date.now() });
      log("ALERT", `RAISED ${msg}`);
      if (!TTY) plainPrint("ALERT", msg);
    } else S.alerts.get(k).msg = msg;
  }
  for (const [k, a] of S.alerts) {
    if (!want.has(k)) {
      S.alerts.delete(k);
      log("ALERT", `CLEARED after ${span((Date.now() - a.since) / 1000)}: ${a.msg}`);
      if (!TTY) plainPrint("INFO", `Cleared: ${a.msg}`);
    }
  }
}

// ── Drawing ─────────────────────────────────────────────────────────────────────
/** A titled box of exactly w × h, rows already fitted to w-4 by the caller (coloured ok). */
function box(title, rows, w, h) {
  const inner = w - 4;
  const out = [`${C.gray("┌─ ")}${C.bold(title)}${C.gray(` ${"─".repeat(Math.max(0, w - visible(title).length - 5))}┐`)}`];
  for (let i = 0; i < h - 2; i++) out.push(`${C.gray("│")} ${fitColored(rows[i] ?? "", inner)} ${C.gray("│")}`);
  out.push(C.gray(`└${"─".repeat(w - 2)}┘`));
  return out;
}
/** Lays boxes side by side. */
const side = (...cols) => cols[0].map((_, i) => cols.map((c) => c[i]).join(""));

const VIEWS = { 1: "Live requests", 2: "Errors & warnings", 3: "Slow requests", 4: "Sign-ins" };

function render() {
  if (!TTY) return;
  const m = compute();
  checkAlerts(m);
  const W = Math.max(80, process.stdout.columns || 120);
  const H = Math.max(30, process.stdout.rows || 40);
  const lines = [];
  const v = m.vit;

  // Header
  const state = S.connected ? C.greenBg(" LIVE ") : C.redBg(" DOWN ");
  const srv = S.server ? `pid ${S.server.pid} · node ${S.server.node} · ${S.server.env}` : "no server yet";
  const up = v ? `up ${span(v.uptime)}` : "";
  const left = ` CIVILIER BACKEND MONITOR  ${BASE.replace(/^https?:\/\//, "")}  ${up}  ${srv}`;
  const right = `  ${S.paused ? "PAUSED · " : ""}${clock(Date.now())} `;
  lines.push(state + C.head(fit(left, W - 6 - right.length) + right));

  // Alerts
  if (S.alerts.size) {
    const list = [...S.alerts.values()];
    lines.push(C.red(fit(` ▲ ${list.length} alert${list.length > 1 ? "s" : ""}: ${list.map((a) => `${a.msg} (${ago(a.since)})`).join("  ·  ")}`, W)));
  } else lines.push(C.green(fit(" ✓ All clear", W)));

  // Row A: health · resources · traffic
  const wA = Math.floor(W / 3);
  const wC = W - wA * 2;
  const sw = Math.max(8, wA - 30);
  const hist = (key) => S.vitals.map((x) => x[key]);
  const db = v?.db || {};
  const health = [
    `API      ${dot(S.connected)} ${S.connected ? `up ${span(v?.uptime ?? 0)}` : C.red(S.lastError || "down")}`,
    `Database ${dot(!!db.connected)} ${db.connected ? `${db.size ?? 0} conn · ${db.borrowed ?? 0} busy · ${db.pending ? C.yellow(`${db.pending} wait`) : "0 wait"}` : C.red("not connected")}`,
    `Redis    ${dot(v?.redis === "ready", v?.redis === "connecting" || v?.redis === "reconnecting")} ${v ? redisWord(v.redis) : "—"}`,
    `Worker   ${dot(!!v?.worker)} ${v ? (v.worker ? "running" : "stopped") : "—"}`,
    `Sockets  ${v ? `${num(v.sockets)} live connection${v.sockets === 1 ? "" : "s"}` : "—"}`,
  ];
  const resources = [
    `CPU     ${fit(v ? `${v.cpu}%` : "—", 7)} ${C.cyan(spark(hist("cpu"), sw, 100))}`,
    `Heap    ${fit(v ? `${v.heapMB}/${v.heapTotalMB}MB` : "—", 11)} ${C.cyan(spark(hist("heapMB"), Math.max(4, sw - 4)))}`,
    `RSS     ${v ? `${v.rssMB} MB` : "—"}   handles ${v?.handles ?? "—"}`,
    `Loop    ${fit(v ? `p99 ${dur(v.loopP99)}` : "—", 11)} ${C.cyan(spark(hist("loopP99"), Math.max(4, sw - 4)))}`,
    `        p50 ${dur(v?.loopP50)} · max ${dur(v?.loopMax)}`,
  ];
  const traffic = [
    `Req/min ${fit(num(m.rpm), 6)} ${C.cyan(spark(m.perSec, Math.max(8, wC - 20)))}`,
    `Latency avg ${dur(m.avg)} · p95 ${msColor(m.p95 || 0)(dur(m.p95))} · max ${dur(m.max)}`,
    `Errors  ${m.e5 ? C.red(`5xx ${m.e5}`) : "5xx 0"} (${pct(m.e5, m.rpm)}) · 4xx ${m.e4}`,
    `Status  ${C.green(`2xx ${m.status.s2}`)} ${C.cyan(`3xx ${m.status.s3}`)} ${C.yellow(`4xx ${m.status.s4}`)} ${C.red(`5xx ${m.status.s5}`)}  ${C.gray("5m")}`,
    `Sign-in ${C.green(`ok ${m.loginsOk}`)} · ${m.loginsFail ? C.red(`failed ${m.loginsFail}`) : "failed 0"}  ${C.gray("5m")}`,
  ];
  lines.push(...side(box("Health", health, wA, 7), box("Resources", resources, wA, 7), box(`Traffic · 60s · ${num(S.totals.requests)} seen`, traffic, wC, 7)));

  // Row B: busiest routes · active users
  const hB = Math.max(6, Math.min(12, Math.floor((H - 16) / 2)));
  const wL = Math.floor(W * 0.58);
  const wR = W - wL;
  const rIn = wL - 4;
  const routeRows = [C.gray(`${fit("count", 6, true)} ${fit("avg", 7, true)} ${fit("p95", 7, true)} ${fit("err", 4, true)}  route`)];
  for (const r of m.busiest.slice(0, hB - 3)) {
    routeRows.push(`${fit(num(r.n), 6, true)} ${msColor(r.avg)(fit(dur(r.avg), 7, true))} ${msColor(r.p95)(fit(dur(r.p95), 7, true))} ${r.err ? C.red(fit(r.err, 4, true)) : fit("·", 4, true)}  ${fit(r.key, rIn - 30)}`);
  }
  if (m.busiest.length === 0) routeRows.push(C.gray("no requests in the last 5 minutes"));
  const uIn = wR - 4;
  const userRows = [C.gray(`${fit("user", Math.max(10, uIn - 26))} ${fit("req", 5, true)} ${fit("seen", 7, true)}  ip`)];
  for (const u of m.users.slice(0, hB - 3)) {
    userRows.push(`${fit(u.user, Math.max(10, uIn - 26))} ${fit(num(u.n), 5, true)} ${fit(ago(u.last), 7, true)}  ${fit(u.ip || "", 11)}`);
  }
  if (m.users.length === 0) userRows.push(C.gray("nobody signed in has been active"));
  lines.push(...side(box(`Busiest routes · 5 min (${m.busiest.length})`, routeRows, wL, hB), box(`Active users · 5 min (${m.users.length})`, userRows, wR, hB)));

  // Row C: the switchable panel, filling what's left
  const hC = H - lines.length - 1;
  const inner = W - 4;
  const tabs = Object.entries(VIEWS)
    .map(([k, label]) => (Number(k) === S.view ? C.inv(` ${k} ${label} `) : C.gray(` ${k} ${label} `)))
    .join(" ");
  const rows = panelRows(m, inner, hC - 3);
  lines.push(...box(`${VIEWS[S.view]}${S.paused ? " — paused" : ""}`, [tabs, ...rows], W, hC));

  // Footer
  const foot = ` 1-4 views · p ${S.paused ? "resume" : "pause"} · c clear counts · q quit   ${LOGGING ? `log ${path.relative(process.cwd(), logPath || path.join(LOG_DIR, "activity-<today>.log"))}` : "logging off"}`;
  lines.push(C.gray(fit(foot, W)));

  process.stdout.write(`\x1b[H${lines.slice(0, H).map((l) => `${l}\x1b[K`).join("\n")}\x1b[J`);
}

function panelRows(m, w, n) {
  const out = [];
  if (S.view === 1) {
    out.push(C.gray(`${fit("time", 8)} ${fit("method", 6)} ${fit("st", 3)} ${fit("took", 7, true)}  ${fit("user", 26)} path`));
    const list = S.reqs.filter((r) => r.t <= m.now).slice(-(n - 1)).reverse();
    for (const r of list) {
      out.push(`${C.gray(clock(r.t))} ${fit(r.method, 6)} ${statusColor(r.status)(fit(r.status, 3))} ${msColor(r.ms)(fit(dur(r.ms), 7, true))}  ${fit(r.user || "—", 26)} ${fit(r.path, Math.max(10, w - 57))}`);
    }
    if (!list.length) out.push(C.gray("waiting for requests…"));
  } else if (S.view === 2) {
    out.push(C.gray(`${fit("time", 8)} ${fit("level", 5)} ${fit("from", 7)} message`));
    const list = S.errs.slice(-(n - 1)).reverse();
    for (const e of list) {
      const tint = e.level === "warn" ? C.yellow : C.red;
      const where = e.path ? `  ${e.method} ${e.path} → ${e.status}${e.user ? ` · ${e.user}` : ""}` : "";
      const more = e.detail && e.detail !== e.msg ? ` — ${e.detail}` : "";
      out.push(`${C.gray(clock(e.t))} ${tint(fit(e.level, 5))} ${fit(e.source, 7)} ${fit(`${e.msg}${more}${where}`, Math.max(10, w - 23))}`);
    }
    if (!list.length) out.push(C.green("no errors or warnings yet"));
  } else if (S.view === 3) {
    out.push(C.gray(`${fit("time", 8)} ${fit("took", 7, true)} ${fit("st", 3)}  ${fit("user", 26)} route   ${C.gray(`(≥ ${dur(SLOW_MS)}, last 15 min, slowest first)`)}`));
    const list = S.reqs.filter((r) => r.ms >= SLOW_MS).sort((a, b) => b.ms - a.ms).slice(0, n - 1);
    for (const r of list) {
      out.push(`${C.gray(clock(r.t))} ${msColor(r.ms)(fit(dur(r.ms), 7, true))} ${statusColor(r.status)(fit(r.status, 3))}  ${fit(r.user || "—", 26)} ${fit(`${r.method} ${r.path}`, Math.max(10, w - 50))}`);
    }
    if (!list.length) out.push(C.green(`nothing slower than ${dur(SLOW_MS)} in the last 15 minutes`));
  } else {
    out.push(C.gray(`${fit("time", 8)} ${fit("result", 6)} ${fit("portal", 12)} ${fit("who", 34)} ip`));
    const list = S.logins.slice(-(n - 1)).reverse();
    for (const l of list) {
      out.push(`${C.gray(clock(l.t))} ${l.ok ? C.green(fit("ok", 6)) : C.red(fit("FAILED", 6))} ${fit(l.portal, 12)} ${fit(l.email || "?", 34)} ${fit(l.ip || "", Math.max(8, w - 64))}`);
    }
    if (!list.length) out.push(C.gray("no sign-ins yet"));
  }
  return out;
}

// ── Keys, start, stop ───────────────────────────────────────────────────────────
function restore() {
  if (TTY) process.stdout.write("\x1b[?25h\x1b[?1049l");
}
function quit() {
  restore();
  log("INFO", "Monitor stopped");
  logStream?.end();
  process.exit(0);
}

if (TTY) {
  process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[H\x1b[2J");
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (k) => {
      if (k === "q" || k === "Q" || k === "\u0003") return quit();
      if (/^[1-4]$/.test(k)) S.view = Number(k);
      else if (k === "\t") S.view = (S.view % 4) + 1;
      else if (k === "p" || k === "P") {
        S.paused = !S.paused;
        S.pausedAt = Date.now();
      } else if (k === "c" || k === "C") {
        S.totals = { requests: 0, s5xx: 0, s4xx: 0, loginOk: 0, loginFail: 0, errors: 0, warns: 0 };
        S.reqs = [];
        S.errs = [];
        S.logins = [];
      }
      render();
    });
  }
  process.stdout.on("resize", render);
  setInterval(() => {
    trim();
    render();
  }, 1000);
} else {
  plainPrint("INFO", `Watching ${BASE}${LOGGING ? ` · logging to ${LOG_DIR}` : ""}`);
  setInterval(() => {
    trim();
    checkAlerts(compute());
  }, 1000);
}

process.on("SIGINT", quit);
process.on("SIGTERM", quit);
process.on("uncaughtException", (e) => {
  restore();
  console.error(e);
  process.exit(1);
});

log("INFO", `Monitor started, watching ${BASE}`);
connect();
render();
