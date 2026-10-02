const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const { getPool, sql } = require("../db");
const { rungParamGuard } = require("../services/projectScope");
const { canUseThread, emitComment } = require("../services/activityThread");

// Persist-then-broadcast: the REST call is the source of truth (validated,
// authorised, rate-limited, idempotent); socket.io only fans the saved row out
// to people who have the thread open. A client that misses a broadcast (flaky
// network) catches up with GET ?afterId=<last id it has>.

const MAX_BODY = 2000;
const PAGE_DEFAULT = 50;
const PAGE_MAX = 200;

// Per-user, not per-IP: a whole site often shares one NAT address.
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  keyGenerator: (req) => `act-comment:${req.user?.userId ?? req.user?.id ?? req.ip}`,
  validate: false,
  message: { error: "You're sending messages too fast — wait a moment." },
});

router.param("rungId", rungParamGuard);

// Gate every thread route on participation. Authentication itself comes from
// the server-wide auth wall on /api (req.user is set before this router runs);
// with no user, canUseThread() is false, so this fails closed.
router.use("/:rungId", async (req, res, next) => {
  const rungId = parseInt(req.params.rungId, 10);
  if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });
  try {
    if (!(await canUseThread(req.user, rungId))) {
      return res.status(403).json({
        error: "Comments are limited to the engineers allocated to this activity and its approvers.",
      });
    }
    req.rungId = rungId;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const SELECT = `
  c.Id AS id, c.DependencyMasterActivityId AS rungId, c.AuthorUserId AS authorUserId,
  c.AuthorName AS authorName, c.Body AS body, c.ClientId AS clientId, c.CreatedAt AS createdAt`;

// GET /:rungId?beforeId=&afterId=&limit=
//   (none)    -> newest `limit` messages
//   beforeId  -> the `limit` messages older than that id (scroll back)
//   afterId   -> everything newer than that id (reconnect catch-up)
// Always returned oldest-first.
router.get("/:rungId", async (req, res) => {
  const limit = Math.min(PAGE_MAX, Math.max(1, parseInt(req.query.limit, 10) || PAGE_DEFAULT));
  const beforeId = req.query.beforeId ? parseInt(req.query.beforeId, 10) : null;
  const afterId = req.query.afterId ? parseInt(req.query.afterId, 10) : null;
  try {
    const request = getPool().request().input("rungId", sql.Int, req.rungId).input("limit", sql.Int, limit + 1);
    let query;
    if (Number.isFinite(afterId)) {
      request.input("afterId", sql.BigInt, afterId);
      query = `SELECT TOP (@limit) ${SELECT} FROM dbo.ActivityComment c
               WHERE c.DependencyMasterActivityId = @rungId AND c.Id > @afterId ORDER BY c.Id ASC`;
    } else {
      if (Number.isFinite(beforeId)) request.input("beforeId", sql.BigInt, beforeId);
      query = `SELECT TOP (@limit) ${SELECT} FROM dbo.ActivityComment c
               WHERE c.DependencyMasterActivityId = @rungId ${Number.isFinite(beforeId) ? "AND c.Id < @beforeId" : ""}
               ORDER BY c.Id DESC`;
    }
    const rows = (await request.query(query)).recordset;
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    // Newest-first queries were trimmed from the old end; present oldest-first.
    const messages = Number.isFinite(afterId) ? page : page.reverse();
    res.json({ messages: messages.map(norm), hasMore });
  } catch (err) {
    console.error("[activity-comments] GET error:", err.message);
    res.status(500).json({ error: "Failed to load comments" });
  }
});

// POST /:rungId { body, clientId }
router.post("/:rungId", sendLimiter, async (req, res) => {
  const body = String(req.body?.body ?? "").trim();
  if (!body) return res.status(400).json({ error: "Message can't be empty." });
  if (body.length > MAX_BODY) return res.status(400).json({ error: `Message is too long (max ${MAX_BODY} characters).` });
  const clientId = req.body?.clientId ? String(req.body.clientId).slice(0, 50) : null;
  const userId = Number(req.user?.userId ?? req.user?.id);
  const name = String(req.user?.name || req.user?.email || "User").slice(0, 200);

  try {
    const pool = getPool();
    let saved;
    try {
      const ins = await pool.request()
        .input("rungId", sql.Int, req.rungId)
        .input("uid", sql.Int, userId)
        .input("name", sql.NVarChar(200), name)
        .input("body", sql.NVarChar(2000), body)
        .input("cid", sql.NVarChar(50), clientId)
        .query(`
          INSERT INTO dbo.ActivityComment (DependencyMasterActivityId, AuthorUserId, AuthorName, Body, ClientId)
          OUTPUT INSERTED.Id AS id, INSERTED.DependencyMasterActivityId AS rungId, INSERTED.AuthorUserId AS authorUserId,
                 INSERTED.AuthorName AS authorName, INSERTED.Body AS body, INSERTED.ClientId AS clientId,
                 INSERTED.CreatedAt AS createdAt
          VALUES (@rungId, @uid, @name, @body, @cid)
        `);
      saved = ins.recordset[0];
      emitComment(req.rungId, norm(saved));
    } catch (err) {
      // UX_ActivityComment_Client — this exact send already landed (retry).
      if ((err.number === 2601 || err.number === 2627) && clientId) {
        const existing = await pool.request()
          .input("rungId", sql.Int, req.rungId).input("uid", sql.Int, userId).input("cid", sql.NVarChar(50), clientId)
          .query(`SELECT ${SELECT} FROM dbo.ActivityComment c
                  WHERE c.DependencyMasterActivityId = @rungId AND c.AuthorUserId = @uid AND c.ClientId = @cid`);
        return res.json({ message: norm(existing.recordset[0]), duplicate: true });
      }
      throw err;
    }
    res.status(201).json({ message: norm(saved) });
  } catch (err) {
    console.error("[activity-comments] POST error:", err.message);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// BIGINT comes back from mssql as a string — keep ids numeric for the client.
function norm(r) {
  return { ...r, id: Number(r.id) };
}

module.exports = router;
