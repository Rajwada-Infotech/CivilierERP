"use strict";

const express = require("express");
const request = require("supertest");
const bcrypt = require("bcrypt");

// ── In-memory stand-in for the database side ──────────────────────────────────────────────────────────────────────
const mockMem = { key: null, library: [], runs: new Map(), nextId: 1 };
const vaultLib = require("../services/scriptVault");

jest.mock("../services/scriptConsoleStore", () => {
  const mockVault = require("../services/scriptVault");
  return {
  getKeyRow: async () => mockMem.key,
  insertKeyRow: async ({ salt, hash }) => { mockMem.key = { Salt: salt, KeyHash: hash }; },
  listLibrary: async (encKey) => mockMem.library.map((r) => ({ id: r.id, name: r.name, description: r.description, script: mockVault.decrypt(encKey, r.script) ?? "", env: JSON.parse(mockVault.decrypt(encKey, r.env) ?? "[]") })),
  saveLibrary: async (encKey, { id, name, description, script, env }) => {
    const row = { id: id || mockMem.nextId++, name, description, script: mockVault.encrypt(encKey, script), env: mockVault.encrypt(encKey, JSON.stringify(env || [])) };
    mockMem.library = [...mockMem.library.filter((r) => r.id !== row.id), row];
    return row.id;
  },
  deleteLibrary: async (id) => { const n = mockMem.library.length; mockMem.library = mockMem.library.filter((r) => r.id !== id); return mockMem.library.length < n; },
  insertRun: async (encKey, run) => { mockMem.runs.set(run.id, { runId: run.id, script: mockVault.encrypt(encKey, run.script), status: "running", user: run.user }); },
  finishRun: async (encKey, run, output) => { Object.assign(mockMem.runs.get(run.id), { status: run.status, exitCode: run.exitCode, output: mockVault.encrypt(encKey, output) }); },
  markInterrupted: async () => {},
  listRuns: async () => [...mockMem.runs.values()].map((r) => ({ RunId: r.runId, Status: r.status })),
  getRun: async (encKey, id) => { const r = mockMem.runs.get(id); return r ? { runId: id, status: r.status, script: mockVault.decrypt(encKey, r.script), output: mockVault.decrypt(encKey, r.output) ?? "" } : null; },
  rotateKey: async (oldEnc, newEnc, { salt, hash }) => {
    mockMem.library = mockMem.library.map((r) => ({ ...r, script: mockVault.encrypt(newEnc, mockVault.decrypt(oldEnc, r.script)), env: mockVault.encrypt(newEnc, mockVault.decrypt(oldEnc, r.env)) }));
    mockMem.key = { Salt: salt, KeyHash: hash };
  },
};
});

let mockPasswordHash;
jest.mock("../db", () => ({
  sql: { Int: "Int", NVarChar: () => "NVarChar", VarBinary: () => "VarBinary" },
  getPool: () => ({ request: () => ({ input() { return this; }, query: async () => ({ recordset: [{ password: mockPasswordHash }] }) }) }),
}));
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/rateLimiter", () => () => (_req, _res, next) => next());

const scriptRoutes = require("../routes/scriptConsole");

const app = express();
app.use(express.json());
// Stand-in for the auth middleware: role and sign-in token come from headers.
app.use((req, _res, next) => {
  req.user = { userId: Number(req.headers["x-uid"] || 1), email: "boss@x.in", role: req.headers["x-role"] || "super_admin" };
  req.token = req.headers["x-token"] || "token-A";
  next();
});
app.use("/api/script-console", scriptRoutes);
const as = (role, token = "token-A", uid = 1) => ({ "x-role": role, "x-token": token, "x-uid": String(uid) });
const api = (method, path, headers = as("super_admin")) => request(app)[method](`/api/script-console${path}`).set(headers);

beforeAll(async () => { mockPasswordHash = await bcrypt.hash("correct-password", 4); });
beforeEach(() => { mockMem.key = null; mockMem.library = []; mockMem.runs.clear(); vaultLib.closeAllSessions(); vaultLib.resetAttempts(); });

describe("the key", () => {
  test("256 bits, written as 13 groups of 4, read back the same - also typed in lower case with spaces", () => {
    const key = vaultLib.generateKey();
    expect(key.length).toBe(32);
    const text = vaultLib.formatKey(key);
    expect(text).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){12}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(vaultLib.parseKey(text).equals(key)).toBe(true);
    expect(vaultLib.parseKey(text.toLowerCase().replace(/-/g, " ")).equals(key)).toBe(true);
    expect(vaultLib.parseKey("ABCD-EFGH")).toBeNull();
    expect(vaultLib.parseKey(text.slice(0, -1) + "U")).toBeNull();
  });
  test("only a salted hash is kept, and it checks the right key only", () => {
    const key = vaultLib.generateKey();
    const v = vaultLib.newVerifier(key);
    const row = { Salt: v.salt, KeyHash: v.hash };
    expect(vaultLib.verifyKey(key, row)).toBe(true);
    expect(vaultLib.verifyKey(vaultLib.generateKey(), row)).toBe(false);
    expect(v.hash.equals(key)).toBe(false);
  });
  test("AES-256-GCM: round trip; wrong key or a changed byte gives nothing", () => {
    const a = vaultLib.deriveEncKey(vaultLib.generateKey());
    const b = vaultLib.deriveEncKey(vaultLib.generateKey());
    const blob = vaultLib.encrypt(a, "SELECT * FROM secrets");
    expect(blob).not.toContain("SELECT");
    expect(vaultLib.decrypt(a, blob)).toBe("SELECT * FROM secrets");
    expect(vaultLib.decrypt(b, blob)).toBeNull();
    const tampered = blob.slice(0, -3) + (blob.endsWith("AAA") ? "BBB" : "AAA");
    expect(vaultLib.decrypt(a, tampered)).toBeNull();
    expect(vaultLib.encrypt(a, "x")).not.toBe(vaultLib.encrypt(a, "x")); // fresh IV every time
  });
});

describe("who can get in", () => {
  test("anyone but a super admin is refused on every route, even before the vault", async () => {
    for (const role of ["admin", "dba", "director", "user"]) {
      expect((await api("get", "/status", as(role))).status).toBe(403);
      expect((await api("post", "/unlock", as(role)).send({ key: "x" })).status).toBe(403);
      expect((await api("post", "/run", as(role)).send({ script: "console.log(1)" })).status).toBe(403);
    }
  });

  test("a super admin with a locked vault can do nothing but see the status, set up and unlock", async () => {
    for (const [m, p] of [["get", "/library"], ["post", "/library"], ["get", "/history"], ["post", "/run"], ["get", "/runs/abc"], ["post", "/rotate"]]) {
      const res = await api(m, p).send({});
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("VAULT_LOCKED");
    }
    expect((await api("get", "/status")).body).toMatchObject({ configured: false, unlocked: false });
  });
});

describe("the vault", () => {
  const setup = async () => (await api("post", "/setup").send({ password: "correct-password" })).body.key;

  test("setup needs the person's own password, makes the key once, and opens the vault", async () => {
    expect((await api("post", "/setup").send({ password: "nope" })).status).toBe(403);
    expect(mockMem.key).toBeNull();
    const res = await api("post", "/setup").send({ password: "correct-password" });
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
    expect(JSON.stringify(mockMem.key)).not.toContain(res.body.key);          // the key itself is not stored
    expect((await api("get", "/library")).status).toBe(200);              // and the vault is open for this sign-in
    expect((await api("post", "/setup").send({ password: "correct-password" })).status).toBe(409);
  });

  test("the right key opens it for that sign-in only; another sign-in stays locked", async () => {
    const key = await setup();
    await api("post", "/lock");
    expect((await api("get", "/library")).status).toBe(403);
    expect((await api("post", "/unlock").send({ key: "0000-0000" })).status).toBe(403);
    expect((await api("post", "/unlock").send({ key })).status).toBe(200);
    expect((await api("get", "/library")).status).toBe(200);
    expect((await api("get", "/library", as("super_admin", "token-B"))).status).toBe(403);   // same person, another login
    expect((await api("get", "/library", as("super_admin", "token-A", 2))).status).toBe(403); // another super admin
  });

  test("five wrong keys lock that person out, even for the right key", async () => {
    const key = await setup();
    await api("post", "/lock");
    let last;
    for (let i = 0; i < 5; i++) last = await api("post", "/unlock").send({ key: vaultLib.formatKey(vaultLib.generateKey()) });
    expect(last.status).toBe(429);
    expect((await api("post", "/unlock").send({ key })).status).toBe(429);
    expect((await api("post", "/unlock", as("super_admin", "token-A", 2)).send({ key })).status).toBe(200); // others are not locked out
  });

  test("saved scripts are encrypted at rest and only read back with the key", async () => {
    await setup();
    const res = await api("post", "/library").send({ name: "JV fix", script: "console.log('db password is hunter2')", env: [{ key: "APPLY", value: "1" }] });
    expect(res.status).toBe(201);
    expect(JSON.stringify(mockMem.library)).not.toContain("hunter2");
    const list = (await api("get", "/library")).body;
    expect(list[0]).toMatchObject({ name: "JV fix", script: "console.log('db password is hunter2')", env: [{ key: "APPLY", value: "1" }] });
    expect((await api("post", "/library").send({ name: "", script: "x" })).status).toBe(400);
  });

  test("rotating needs the current key, makes a new one and keeps the saved scripts readable", async () => {
    const key = await setup();
    await api("post", "/library").send({ name: "keep me", script: "console.log(1)" });
    expect((await api("post", "/rotate").send({ currentKey: vaultLib.formatKey(vaultLib.generateKey()) })).status).toBe(403);
    const res = await api("post", "/rotate").send({ currentKey: key });
    expect(res.status).toBe(200);
    expect(res.body.key).not.toBe(key);
    expect((await api("get", "/library")).body[0].script).toBe("console.log(1)");
    await api("post", "/lock");
    expect((await api("post", "/unlock").send({ key })).status).toBe(403);                       // the old key is dead
    expect((await api("post", "/unlock").send({ key: res.body.key })).status).toBe(200);
  });
});

describe("running", () => {
  const unlock = async () => { await api("post", "/setup").send({ password: "correct-password" }); };
  const finish = async (id) => {
    for (let i = 0; i < 100; i++) {
      const r = (await api("get", `/runs/${id}`)).body;
      if (r.status !== "running") return r;
      await new Promise((r2) => setTimeout(r2, 50));
    }
    throw new Error("run did not finish");
  };

  test("a script runs like `node -`, with the given variables, and its output and result are kept encrypted", async () => {
    await unlock();
    const res = await api("post", "/run").send({ script: "console.log(6 * 7, process.env.APPLY, require('path').basename(process.cwd()));", env: [{ key: "APPLY", value: "yes" }] });
    expect(res.status).toBe(202);
    const done = await finish(res.body.id);
    expect(done.status).toBe("done");
    expect(done.exitCode).toBe(0);
    expect(done.chunks.map((c) => c.t).join("")).toContain("42 yes backend");
    await new Promise((r) => setTimeout(r, 100));
    expect(JSON.stringify([...mockMem.runs.values()])).not.toContain("process.env.APPLY");           // the script is not stored in the clear
    const saved = (await api("get", `/history/${res.body.id}`)).body;
    expect(saved.script).toContain("process.env.APPLY");
    expect(saved.output).toContain("42 yes");
  });

  test("a failing script is 'failed' with its exit code and stderr; a bad variable name is refused", async () => {
    await unlock();
    const res = await api("post", "/run").send({ script: "console.error('boom'); process.exit(3);" });
    const done = await finish(res.body.id);
    expect(done).toMatchObject({ status: "failed", exitCode: 3 });
    expect(done.chunks.some((c) => c.s === "e" && c.t.includes("boom"))).toBe(true);
    expect((await api("post", "/run").send({ script: "1", env: [{ key: "BAD NAME", value: "x" }] })).status).toBe(400);
    expect((await api("post", "/run").send({ script: "   " })).status).toBe(400);
  });

  test("terminal colour codes in the output are removed, so the page never shows [32mINFO[39m", async () => {
    const runner = require("../services/scriptRunner");
    expect(runner.stripAnsi("\u001b[32mINFO\u001b[39m ok \u001b[90m{\"a\":1}\u001b[39m")).toBe("INFO ok {\"a\":1}");
    await unlock();
    const res = await api("post", "/run").send({ script: "console.log('\\u001b[32mINFO\\u001b[39m coloured line');" });
    const done = await finish(res.body.id);
    const text = done.chunks.map((c) => c.t).join("");
    expect(text).toContain("INFO coloured line");
    expect(text).not.toMatch(/\u001b|\[32m/);
  });

  test("one run at a time, and a running script can be stopped", async () => {
    await unlock();
    const first = await api("post", "/run").send({ script: "setInterval(() => {}, 1000);" });
    expect(first.status).toBe(202);
    expect((await api("post", "/run").send({ script: "console.log(1)" })).status).toBe(409);
    expect((await api("post", `/runs/${first.body.id}/kill`)).status).toBe(200);
    expect((await finish(first.body.id)).status).toBe("killed");
    expect((await api("post", "/run").send({ script: "console.log(2)" })).status).toBe(202);
  });
});
