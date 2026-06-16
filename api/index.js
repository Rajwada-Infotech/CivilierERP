// api/index.js — Vercel serverless entrypoint
// Wraps the Express app so Vercel can treat it as a serverless function.
// All /api/* requests are routed here by vercel.json.
//
// Previously this exported the server module object { startServer, createApp }
// which is NOT a valid request handler. Vercel requires module.exports to be
// a function(req, res). Fixed: we lazy-init the Express app on first request
// and reuse it across warm invocations (connection pool stays alive).

const { createApp } = require("../backend/server.js");

let app = null;

module.exports = async (req, res) => {
  if (!app) {
    app = await createApp();
  }
  app(req, res);
};
