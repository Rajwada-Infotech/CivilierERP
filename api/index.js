// api/index.js — Vercel serverless entrypoint
// Wraps the Express app so Vercel can treat it as a serverless function.
// All /api/* requests are routed here by vercel.json.
//
// createApp() builds the Express app but does NOT connect to the database —
// connectDB() previously only ran inside startServer(), which Vercel never
// calls (there's no persistent process to listen() on a port). Without it,
// every route handler's getPool() call throws synchronously
// ("DB pool not initialized. Call connectDB() first."), producing a 500 on
// every single request.
//
// Fix: lazily connect on first invocation and reuse the pool + app across
// warm invocations. A single shared promise (rather than a separate
// "dbReady" boolean) avoids a cold-start race: if two requests hit a cold
// container before the first connectDB() resolves, both would otherwise
// call connectDB() concurrently, and db.js's module-level `pool` variable
// would get overwritten by whichever call resolves last — leaking the first
// pool's connections.
//
// Note (see audit 16.3): Socket.io, the background worker, and the
// escalation engine all live inside startServer() and do NOT run in this
// serverless entrypoint. If those are required, the Docker/EC2 deployment
// is the supported target — this entrypoint only covers stateless HTTP
// request/response routes.

const { createApp } = require("../backend/server.js");
const { connectDB } = require("../backend/db.js");

let appPromise = null;

module.exports = async (req, res) => {
  try {
    if (!appPromise) {
      appPromise = (async () => {
        await connectDB();
        return createApp();
      })();
    }

    const app = await appPromise;
    app(req, res);
  } catch (err) {
    // Allow the next invocation to retry initialization from scratch.
    appPromise = null;
    console.error("[api/index] initialization failed:", err);
    res.status(503).json({
      success: false,
      error: "Service unavailable",
      message: "Backend failed to initialize. Please try again.",
    });
  }
};