// backend/routes/amendmentLog.js
// Read-only endpoints for the three per-module Amendment (audit trail)
// pages. Records themselves are written by amendmentLog.recordAmendment(),
// called from each document's own PUT route when it edits an
// already-Approved record — there is no propose/approve step here.

const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/auth");
const { listAmendments, getAmendmentDetail, MODULES, DOC_TYPES } = require("../services/amendmentLog");
const { requirePageRight } = require("../middleware/requirePageRight");

// Reading a module's amendments takes that module's Amendment page right (any signed-in user could read every
// module's, Admin's included). Admin's project amendments go with the Project page.
const PAGE_FOR_MODULE = {
  finance: "finance-amendment",
  material: "material-amendment",
  engineering: "engineering-amendment",
  admin: "project-master",
};
const canView = (module, req, res) =>
  new Promise((resolve) => {
    // requirePageRight answers 403 itself when the right is missing; resolve(true) only when it lets the request on.
    requirePageRight(PAGE_FOR_MODULE[module], "view")(req, res, () => resolve(true)).then(() => resolve(false), () => resolve(false));
  });

router.get("/:module", authenticateToken, async (req, res) => {
  const { module } = req.params;
  if (!MODULES.includes(module)) {
    return res.status(400).json({ error: `Unknown amendment module: ${module}` });
  }
  if (!(await canView(module, req, res))) return;
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
    const module = DOC_TYPES[detail.RefDocType]?.module;
    if (!module || !(await canView(module, req, res))) {
      if (!res.headersSent) res.status(403).json({ error: "You do not have access to this amendment." });
      return;
    }
    res.json(detail);
  } catch (err) {
    console.error("Get amendment detail error:", err);
    res.status(500).json({ error: "Failed to load amendment detail." });
  }
});

module.exports = router;
