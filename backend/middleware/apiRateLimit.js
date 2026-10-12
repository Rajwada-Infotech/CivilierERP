// Required directly (not via ./rateLimiter) so CodeQL recognises it as a rate limiter on every router that uses it.
const rateLimit = require("express-rate-limit");
const { rateLimitKey } = require("./rateLimitIdentity");

// Router-level rate limiter — satisfies static analysis tooling that can't
// trace the global app.use("/api", apiLimiter) registration in server.js.
// The dynamic per-user limiter in server.js remains the actual enforcement;
// this provides a high static ceiling (1 000 req/min) as a visible backstop.
module.exports =
  process.env.NODE_ENV === "test"
    ? (_req, _res, next) => next()
    : rateLimit({
        keyGenerator: rateLimitKey,
        validate: false,
        windowMs: 60_000,
        max: 1000,
        standardHeaders: true,
        legacyHeaders: false,
      });
