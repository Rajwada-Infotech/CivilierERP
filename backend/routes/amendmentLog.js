// backend/routes/amendmentLog.js
// Read-only endpoints for the three per-module Amendment (audit trail)
// pages. Records themselves are written by amendmentLog.recordAmendment(),
// called from each document's own PUT route when it edits an
// already-Approved record — there is no propose/approve step here.

const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/auth");
const { listAmendments, getAmendmentDetail, MODULES } = require("../services/amendmentLog");

router.get("/:module", authenticateToken, async (req, res) => {
  const { module } = req.params;
  if (!MODULES.includes(module)) {
    return res.status(400).json({ error: `Unknown amendment module: ${module}` });
  }
  try {
    const rows = await listAmendments(module);
    res.json(rows);
  } catch (err) {
    console.error("List amendments error:", err);
    res.status(500).json({ error: "Failed to load amendments." });
  }
});

router.get("/detail/:id", authenticateToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid amendment id." });
  }
  try {
    const detail = await getAmendmentDetail(id);
    if (!detail) return res.status(404).json({ error: "Amendment not found." });
    res.json(detail);
  } catch (err) {
    console.error("Get amendment detail error:", err);
    res.status(500).json({ error: "Failed to load amendment detail." });
  }
});

module.exports = router;
