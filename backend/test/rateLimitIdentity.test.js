process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { attachRateLimitUser, rateLimitKey } = require("../middleware/rateLimitIdentity");

const token = (userId, secret = process.env.JWT_SECRET) => jwt.sign({ userId, role: "user" }, secret);
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

// A tiny limiter wired exactly like the real one (identity first, then the bucket), 3 requests a minute.
function appWithLimit(max = 3) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(attachRateLimitUser);
  app.use(rateLimit({ windowMs: 60_000, max, keyGenerator: rateLimitKey, validate: false, standardHeaders: true, legacyHeaders: false }));
  app.get("/ping", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("rate limit identity", () => {
  test("a valid token is counted as that person, anything else as the IP", () => {
    const run = (headers) => {
      const req = { headers, ip: "10.0.0.5" };
      attachRateLimitUser(req, {}, () => {});
      return rateLimitKey(req);
    };
    expect(run({ authorization: `Bearer ${token(42)}` })).toBe("user:42");
    expect(run({})).toBe("10.0.0.5");
    expect(run({ authorization: "Bearer garbage" })).toBe("10.0.0.5");
    expect(run({ authorization: `Bearer ${token(42, "someone-elses-secret")}` })).toBe("10.0.0.5"); // forged
    expect(run({ authorization: `Bearer ${jwt.sign({ role: "user" }, process.env.JWT_SECRET)}` })).toBe("10.0.0.5"); // no userId
  });

  test("two people on the same IP (one office, one load balancer) no longer share a bucket", async () => {
    const app = appWithLimit(3);
    const a = bearer(token(1));
    const b = bearer(token(2));
    for (let i = 0; i < 3; i++) expect((await request(app).get("/ping").set(a)).status).toBe(200);
    const fourth = await request(app).get("/ping").set(a);
    expect(fourth.status).toBe(429); // person 1 used up their own bucket...
    expect((await request(app).get("/ping").set(b)).status).toBe(200); // ...person 2, same IP, is unaffected
  });

  test("requests with no valid token still share the IP bucket, and a forged token cannot borrow someone's", async () => {
    const app = appWithLimit(2);
    expect((await request(app).get("/ping")).status).toBe(200);
    expect((await request(app).get("/ping").set(bearer("garbage"))).status).toBe(200);
    expect((await request(app).get("/ping")).status).toBe(429);

    const app2 = appWithLimit(1);
    expect((await request(app2).get("/ping").set(bearer(token(7)))).status).toBe(200);
    // a forged token naming user 7 is counted by IP, not against user 7's bucket
    expect((await request(app2).get("/ping").set(bearer(token(7, "forged")))).status).toBe(200);
  });

  test("a 429 says how long to wait", async () => {
    const app = appWithLimit(1);
    await request(app).get("/ping");
    const res = await request(app).get("/ping");
    expect(res.status).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });
});
