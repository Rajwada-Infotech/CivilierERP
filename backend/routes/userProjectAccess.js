const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");
const { invalidateProjectScope, getProjectScope } = require("../services/projectScope");

const adminOnly = allowRoles("admin", "super_admin", "dba");

// GET /my — the viewer's own scope (null = all projects).
router.get("/my", authMiddleware, async (req, res) => {
  try {
    res.json({ projectIds: await getProjectScope(req.user) });
  } catch (err) {
    res.status(500).json({ error: "Failed to load project access" });
  }
});

// GET /:userId — projects explicitly assigned to a user (empty = unrestricted).
router.get("/:userId", authMiddleware, adminOnly, async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid userId" });
  try {
    const r = await getPool().request().input("uid", sql.Int, userId)
      .query("SELECT ProjectId FROM dbo.UserProjectAccess WHERE UserId = @uid");
    res.json({ projectIds: r.recordset.map((x) => Number(x.ProjectId)) });
  } catch (err) {
    res.status(500).json({ error: "Failed to load project access" });
  }
});

// PUT /:userId  { projectIds: number[] } — replaces the user's assignments.
// An empty list removes all restrictions for that user.
router.put("/:userId", authMiddleware, adminOnly, async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid userId" });
  if (!Array.isArray(req.body?.projectIds)) return res.status(400).json({ error: "projectIds must be an array" });
  const ids = [...new Set(req.body.projectIds.map((v) => parseInt(v, 10)).filter(Number.isFinite))];
  const actor = req.user?.email || req.user?.name || "system";

  const pool = getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    await new sql.Request(tx).input("uid", sql.Int, userId)
      .query("DELETE FROM dbo.UserProjectAccess WHERE UserId = @uid");
    for (const pid of ids) {
      await new sql.Request(tx)
        .input("uid", sql.Int, userId).input("pid", sql.Int, pid).input("by", sql.NVarChar(200), actor)
        .query("INSERT INTO dbo.UserProjectAccess (UserId, ProjectId, CreatedBy) VALUES (@uid, @pid, @by)");
    }
    await tx.commit();
    invalidateProjectScope(userId);
    res.json({ success: true, projectIds: ids });
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* not begun */ }
    console.error("[user-project-access] PUT error:", err.message);
    res.status(500).json({ error: "Failed to save project access" });
  }
});

module.exports = router;
