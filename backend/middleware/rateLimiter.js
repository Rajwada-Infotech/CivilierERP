"use strict";

/**
 * The rate limiter every route file uses (instead of requiring "express-rate-limit" directly).
 *
 * Same options as express-rate-limit; the one difference is the DEFAULT for who a request counts against: the
 * signed-in person (staff user or portal customer, from a verified token - see rateLimitIdentity.js), falling back
 * to the IP address only for anonymous visitors.
 *
 * Why: the server runs behind Docker, where every request arrives from the one gateway address. A limiter that
 * counts by IP therefore counts the WHOLE company as one visitor - "1000 per 15 minutes" per route file meant about
 * 66 requests a minute for all staff together on, say, Payments. Counting per person gives each user their own
 * allowance. A route that needs something different can still pass its own keyGenerator.
 */

const expressRateLimit = require("express-rate-limit");
const { rateLimitKey } = require("./rateLimitIdentity");

function rateLimit(options = {}) {
  return expressRateLimit({ keyGenerator: rateLimitKey, validate: false, ...options });
}

module.exports = rateLimit;
