process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret";

const fs = require("fs");
const path = require("path");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const rateLimit = require("../middleware/rateLimiter");
const { attachRateLimitUser } = require("../middleware/rateLimitIdentity");

const bearer = (id) => ({ Authorization: `Bearer ${jwt.sign({ userId: id }, process.env.JWT_SECRET)}` });

describe("the shared rateLimiter", () => {
  function appWith(options) {
    const app = express();
    app.use(attachRateLimitUser);
    const router = express.Router();
    router.use(rateLimit(options)); // exactly how every route file uses it
    router.get("/ping", (_req, res) => res.json({ ok: true }));
    app.use(router);
    return app;
  }

  test("counts each signed-in person separately by default - the company is not one visitor", async () => {
    const app = appWith({ windowMs: 60_000, max: 2, message: { error: "Too many requests, please try again later." } });
    for (let i = 0; i < 2; i++) expect((await request(app).get("/ping").set(bearer(1))).status).toBe(200);
    const refused = await request(app).get("/ping").set(bearer(1));
    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({ error: "Too many requests, please try again later." });
    expect((await request(app).get("/ping").set(bearer(2))).status).toBe(200); // same IP, other person
  });

  test("anonymous visitors still share the IP bucket", async () => {
    const app = appWith({ windowMs: 60_000, max: 1 });
    expect((await request(app).get("/ping")).status).toBe(200);
    expect((await request(app).get("/ping")).status).toBe(429);
  });

  test("a route can still choose its own key", async () => {
    const app = appWith({ windowMs: 60_000, max: 1, keyGenerator: () => "everyone" });
    expect((await request(app).get("/ping").set(bearer(1))).status).toBe(200);
    expect((await request(app).get("/ping").set(bearer(2))).status).toBe(429);
  });
});

describe("no route file brings back an IP-counted limiter", () => {
  // server.js builds the global and login limiters itself, with explicit keys; the wrapper is the one allowed importer.
  const ALLOWED = new Set(["rateLimiter.js"]);
  const dirs = ["routes", "middleware", "services"];

  test.each(dirs)("%s/ never requires express-rate-limit directly", (dir) => {
    const root = path.join(__dirname, "..", dir);
    const offenders = [];
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".js") && !ALLOWED.has(entry.name) && /require\(["']express-rate-limit["']\)/.test(fs.readFileSync(full, "utf8"))) {
          offenders.push(path.relative(path.join(__dirname, ".."), full));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  test("the global limiter skips activity logging by the FULL url (req.path has /api stripped)", () => {
    const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    expect(server).toMatch(/skip: \(req\) => req\.originalUrl\.startsWith\("\/api\/user-activity"\)/);
    expect(server).not.toMatch(/req\.path\.startsWith\("\/api\/user-activity"\)/);
  });
});
