// api/index.js — Vercel serverless entrypoint
// Wraps the Express app so Vercel can treat it as a serverless function.
// All /api/* requests are routed here by vercel.json.

const app = require("../backend/server.js");

module.exports = app;
