// Shared harness for the end-to-end scripts: the real routes and real SQL on the DEVELOPMENT database, every query
// inside one transaction that is rolled back at the end, so nothing stays behind. Refuses to run on production.
const path = require("path");
process.chdir(path.join(__dirname, ".."));
require("dotenv").config({ path: ".env" });
if (process.env.NODE_ENV === "production") { console.error("Refusing to run on production."); process.exit(1); }
const http = require("http");
const express = require("express");
const db = require("../db");

const stub = (rel, exportsValue) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports: exportsValue }; };

/**
 * mounts: { "/prefix": "routeFile" }. count: a read-only SQL whose one row must be the same before and after.
 * port: where it listens (0 = any free port).
 * Returns the helpers each script uses, and finish() which rolls back, checks nothing changed and exits.
 */
async function openHarness({ mounts, count, port = 0 }) {
  await db.connectDB();
  const realPool = db.getPool();
  const before = (await realPool.request().query(count)).recordset[0];
  const tx = new db.sql.Transaction(realPool);
  await tx.begin();

  // One connection runs one query at a time, so the queries of routes that use Promise.all take turns here.
  let turn = Promise.resolve();
  const request = () => {
    const req = tx.request();
    for (const m of ["query", "execute", "batch"]) {
      const run = req[m].bind(req);
      req[m] = (text) => { const p = turn.then(() => run(text)); turn = p.catch(() => {}); return p; };
    }
    return req;
  };
  // A route's own transaction becomes a savepoint, so its rollback really undoes its work, as it would in production.
  let savepoints = 0;
  const transaction = () => {
    const name = `e2e${++savepoints}`;
    return { begin: () => request().query(`SAVE TRANSACTION ${name}`), commit: async () => {}, rollback: () => request().query(`ROLLBACK TRANSACTION ${name}`), request };
  };
  const fakePool = { request, transaction, connected: true };
  db.getPool = () => fakePool;
  // Code that opens its own transaction on the pool (new sql.Transaction(pool), as the approval engine does) gets a
  // savepoint too.
  const RealTransaction = db.sql.Transaction;
  db.sql.Transaction = function (pool) { return pool === fakePool ? transaction() : new RealTransaction(pool); };

  let actor = { userId: 1, id: 1, role: "super_admin", email: "e2e" };
  let portal = {};
  const pass = (req, _r, n) => { req.user = actor; n(); };
  stub("../middleware/auth", pass);
  stub("../middleware/apiRateLimit", (_q, _r, n) => n());
  stub("../middleware/crmPortalAuth", (req, _r, n) => { req.portalUser = portal; n(); });
  stub("../services/notify", new Proxy({}, { get: () => async () => {} })); // no bell, socket or phone push from a test
  const rights = require("../middleware/requirePageRight");
  for (const k of Object.keys(rights)) if (/^require/.test(k)) rights[k] = () => pass;

  const app = express();
  app.use(express.json());
  // Every request carries the test user, as the server's own auth does before routes that rely on it (e.g. Payments).
  app.use((req, _r, n) => { req.user = actor; n(); });
  for (const [at, file] of Object.entries(mounts)) app.use(at, require(`../routes/${file}`));
  const srv = http.createServer(app);
  await new Promise((ok) => srv.listen(port, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${srv.address().port}`;

  const results = [];
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const type = res.headers.get("content-type") || "";
    return { status: res.status, type, json: type.includes("json") ? await res.json() : null };
  };
  const upload = async (url, fields, fileName = "e2e.pdf") => {
    const f = new FormData();
    f.append("files", new Blob(["%PDF-1.4\n%E2E"], { type: "application/pdf" }), fileName);
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    const res = await fetch(base + url, { method: "POST", body: f });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const q = async (text) => (await request().query(text)).recordset;
  const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  -> ${detail}` : ""}`); };
  const expectCall = (name, r, status, text) => {
    const msg = r.json?.error || "";
    check(name, r.status === status && (!text || msg.toLowerCase().includes(text.toLowerCase())), `got ${r.status} ${msg}`);
    return r;
  };
  const section = (t) => console.log(`\n-- ${t}`);
  const finish = async () => {
    try { await turn; await new Promise((ok) => setTimeout(ok, 800)); await turn; await tx.rollback(); } catch (e) { console.error("ROLLBACK FAILED", e.message); }
    const after = (await realPool.request().query(count)).recordset[0];
    check("Rolled back: the database is exactly as it was", JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
    srv.close();
    const failed = results.filter((x) => !x.ok);
    console.log(`\nRESULT: ${results.length - failed.length} of ${results.length} passed`);
    await db.closeDB();
    process.exit(failed.length ? 1 : 0);
  };
  return {
    base, call, upload, q, request, check, expectCall, section, finish,
    setActor: (a) => { actor = { ...actor, ...a }; },
    setPortal: (p) => { portal = p; },
  };
}

module.exports = { openHarness };
