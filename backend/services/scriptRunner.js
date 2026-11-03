"use strict";

/**
 * Runs a script the way `docker compose exec backend node -` does: a child `node -` process, the script on its stdin,
 * the backend folder as its working directory (so `require("./db")` works) and the server's own environment plus the
 * variables given for the run. One run at a time; output is kept in memory for the page to read as it arrives.
 */

const { spawn } = require("child_process");
const crypto = require("crypto");
const path = require("path");

const BACKEND_DIR = path.join(__dirname, "..");
const MAX_OUTPUT = 3 * 1024 * 1024; // characters kept per run
const MAX_SCRIPT = 300 * 1024;
const MAX_ENV = 50;
const KEEP_FINISHED = 20; // finished runs kept in memory for the page to read back

const runs = new Map(); // id -> run
let activeId = null;

/** A validated { NAME: value } from the page's [{ key, value }] rows, or throws {status:400}. */
function parseEnv(rows) {
  const out = {};
  if (rows === undefined || rows === null) return out;
  if (!Array.isArray(rows) || rows.length > MAX_ENV) throw Object.assign(new Error(`At most ${MAX_ENV} variables.`), { status: 400 });
  for (const r of rows) {
    const key = String(r?.key ?? "").trim();
    if (!key) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) throw Object.assign(new Error(`"${key}" is not a valid variable name.`), { status: 400 });
    const value = String(r?.value ?? "");
    if (value.length > 4000) throw Object.assign(new Error(`The value of ${key} is too long.`), { status: 400 });
    out[key] = value;
  }
  return out;
}

const view = (run, from = 0) => ({
  id: run.id,
  status: run.status,
  exitCode: run.exitCode,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  chunks: run.chunks.slice(from),
  next: run.chunks.length,
  truncated: run.truncated,
});

const outputText = (run) => run.chunks.map((c) => c.t).join("");

function trimFinished() {
  const finished = [...runs.values()].filter((r) => r.status !== "running").sort((a, b) => b.startedAt - a.startedAt);
  for (const r of finished.slice(KEEP_FINISHED)) runs.delete(r.id);
}

/**
 * Starts a run. `onFinish(run)` is called once when it ends (the route persists it). Throws {status:409} when a run
 * is already going and {status:400} for a bad script or variables.
 */
function start({ id, script, env, timeoutMs, user, name, onFinish }) {
  if (typeof script !== "string" || !script.trim()) throw Object.assign(new Error("There is no script to run."), { status: 400 });
  if (script.length > MAX_SCRIPT) throw Object.assign(new Error(`The script is longer than ${MAX_SCRIPT / 1024} KB.`), { status: 400 });
  if (activeId && runs.get(activeId)?.status === "running") throw Object.assign(new Error("A script is already running. Stop it or wait for it to finish."), { status: 409 });
  const vars = parseEnv(env);

  const run = {
    id: id || newRunId(),
    user, name: name || null, script, env: vars,
    status: "running", exitCode: null, startedAt: Date.now(), finishedAt: null,
    chunks: [], size: 0, truncated: false, child: null, timer: null, killedBy: null,
  };
  runs.set(run.id, run);
  activeId = run.id;

  const push = (s, buf) => {
    if (run.truncated) return;
    let t = buf.toString("utf8");
    if (run.size + t.length > MAX_OUTPUT) {
      t = t.slice(0, Math.max(0, MAX_OUTPUT - run.size)) + "\n[output truncated]\n";
      run.truncated = true;
    }
    run.size += t.length;
    run.chunks.push({ s, t });
  };

  const done = (status, exitCode) => {
    if (run.status !== "running") return;
    clearTimeout(run.timer);
    run.status = status;
    run.exitCode = exitCode;
    run.finishedAt = Date.now();
    if (activeId === run.id) activeId = null;
    trimFinished();
    try { onFinish?.(run); } catch { /* persisting must not break the runner */ }
  };

  const child = spawn(process.execPath, ["-"], {
    cwd: BACKEND_DIR,
    env: { ...process.env, ...vars, FORCE_COLOR: "0" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  run.child = child;
  child.stdout.on("data", (b) => push("o", b));
  child.stderr.on("data", (b) => push("e", b));
  child.stdin.on("error", () => { /* the script may exit before reading all of stdin */ });
  child.on("error", (err) => { push("e", Buffer.from(`Could not start the script: ${err.message}\n`)); done("failed", null); });
  child.on("close", (code, signal) => {
    if (run.killedBy === "timeout") done("timeout", code);
    else if (run.killedBy) done("killed", code);
    else done(code === 0 ? "done" : "failed", code ?? (signal ? -1 : null));
  });
  child.stdin.end(script);

  const limit = Math.min(Math.max(Number(timeoutMs) || 10 * 60_000, 10_000), 60 * 60_000);
  run.timer = setTimeout(() => { run.killedBy = "timeout"; push("e", Buffer.from(`\nStopped: ran longer than ${Math.round(limit / 60000)} minute(s).\n`)); child.kill("SIGKILL"); }, limit);
  return run;
}

const newRunId = () => crypto.randomBytes(12).toString("hex");
const get = (id) => runs.get(id) ?? null;
const running = () => (activeId && runs.get(activeId)?.status === "running" ? runs.get(activeId) : null);

/** Stops a run (SIGKILL). The close handler records it as "killed". */
function kill(id, by) {
  const run = runs.get(id);
  if (!run || run.status !== "running") return false;
  run.killedBy = by || "user";
  run.chunks.push({ s: "e", t: "\nStopped by an administrator.\n" });
  run.child.kill("SIGKILL");
  return true;
}

module.exports = { start, newRunId, get, running, kill, view, outputText, parseEnv, MAX_SCRIPT };
