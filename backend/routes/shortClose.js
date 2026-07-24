"use strict";

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool } = require("../db");
const authenticateToken = require("../middleware/auth");
const { bumpCacheVersion } = require("../redis");
const { requirePageRight } = require("../middleware/requirePageRight");
const { searchCandidates, processShortClose } = require("../services/shortClose");

const requireUser = (req, res) => {
  const name = req.user?.name || req.user?.email;
  if (!name) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return name;
};

// ── GET /search ────────────────────────────────────────────────────────────────
router.get("/search", authenticateToken, requirePageRight("short-close", "view"), async (req, res) => {
  try {
    const docType = (req.query.docType || "").toUpperCase();
    if (!["PO", "MR"].includes(docType))
      return res.status(400).json({ error: "docType must be PO or MR" });
    const pool = getPool();
    const rows = await searchCandidates(pool, {
      docType,
      finYearId: req.query.finYearId || null,
      companyId: req.query.companyId || null,
      projectId: req.query.projectId || null,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /process ─────────────────────────────────────────────────────────────
router.post("/process", authenticateToken, requirePageRight("short-close", "edit"), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const docType = (req.body.docType || "").toUpperCase();
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!["PO", "MR"].includes(docType))
      return res.status(400).json({ error: "docType must be PO or MR" });
    if (ids.length === 0)
      return res.status(400).json({ error: "Select at least one document." });

    const pool = getPool();
    const results = await processShortClose(pool, {
      docType,
      ids,
      remarks: req.body.remarks || null,
      userEmail: user,
    });

    await bumpCacheVersion(docType === "PO" ? "purchase-orders" : "material-requests");

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    res.json({
      message: `${succeeded} of ${results.length} document(s) Short Closed.`,
      results,
      succeeded,
      failedCount: failed.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
