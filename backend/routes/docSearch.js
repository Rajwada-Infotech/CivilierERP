/**
 * docSearch.js — GET /api/doc-search?q=<doc number>
 *
 * Backs the Alt+Shift+D "Find a document" dialog. See services/docFinder.js.
 * authMiddleware is applied globally (app.use("/api", authMiddleware)) and
 * req.projectScope by attachProjectScope, both in server.js.
 */
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 60 * 1000, max: 240, validate: false, message: { error: "Too many searches, slow down." } }));
const { getPool } = require("../db");
const { findDocuments } = require("../services/docFinder");

router.get("/", async (req, res) => {
  try {
    const out = await findDocuments(getPool(), {
      q: req.query.q,
      user: req.user,
      scope: req.projectScope ?? null,
    });
    res.json(out);
  } catch (err) {
    console.error("DOC SEARCH ERROR:", err.message);
    res.status(500).json({ error: "Document search failed" });
  }
});

module.exports = router;
