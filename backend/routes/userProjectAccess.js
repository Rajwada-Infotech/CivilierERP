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

// A table that may not exist yet (migration not applied) reads as "no rows".
const rowsOrNone = async (request, query) => {
  try {
    return (await request.query(query)).recordset;
  } catch (err) {
    if (err.number === 208) return [];
    throw err;
  }
};

// Replace a user's / role's list in one transaction. An empty list removes it.
// `table` / `keyCol` come from the two fixed call sites below, never from input.
async function replaceList({ table, keyCol, keyVal, ids, actor }) {
  const tx = new sql.Transaction(getPool());
  try {
    await tx.begin();
    await new sql.Request(tx).input("k", sql.Int, keyVal).query(`DELETE FROM dbo.${table} WHERE ${keyCol} = @k`);
    for (const pid of ids) {
      await new sql.Request(tx)
        .input("k", sql.Int, keyVal).input("pid", sql.Int, pid).input("by", sql.NVarChar(200), actor)
        .query(`INSERT INTO dbo.${table} (${keyCol}, ProjectId, CreatedBy) VALUES (@k, @pid, @by)`);
    }
    await tx.commit();
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* not begun */ }
    throw err;
  }
}

const cleanIds = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => parseInt(x, 10)).filter(Number.isFinite))];
const actorOf = (req) => req.user?.email || req.user?.name || "system";

// GET /role/:roleId — projects assigned to a role (empty = unrestricted).
router.get("/role/:roleId", authMiddleware, adminOnly, async (req, res) => {
  const roleId = parseInt(req.params.roleId, 10);
  if (!Number.isFinite(roleId)) return res.status(400).json({ error: "Invalid roleId" });
  try {
    const rows = await rowsOrNone(
      getPool().request().input("rid", sql.Int, roleId),
      "SELECT ProjectId FROM dbo.RoleProjectAccess WHERE RoleId = @rid",
    );
    res.json({ projectIds: rows.map((x) => Number(x.ProjectId)) });
  } catch (err) {
    res.status(500).json({ error: "Failed to load role project access" });
  }
});

// PUT /role/:roleId  { projectIds: number[] } — replaces the role's list. It
// applies to every user in the role who has no personal list. An empty list
// removes the role's restriction.
router.put("/role/:roleId", authMiddleware, adminOnly, async (req, res) => {
  const roleId = parseInt(req.params.roleId, 10);
  if (!Number.isFinite(roleId)) return res.status(400).json({ error: "Invalid roleId" });
  if (!Array.isArray(req.body?.projectIds)) return res.status(400).json({ error: "projectIds must be an array" });
  const ids = cleanIds(req.body.projectIds);
  try {
    await replaceList({ table: "RoleProjectAccess", keyCol: "RoleId", keyVal: roleId, ids, actor: actorOf(req) });
    invalidateProjectScope(); // any member of the role may be affected
    res.json({ success: true, projectIds: ids });
  } catch (err) {
    console.error("[user-project-access] role PUT error:", err.message);
    res.status(500).json({ error: "Failed to save role project access" });
  }
});

// GET /:userId — the user's OWN list (empty = none), plus the list of the role
// they fall back to when they have none.
router.get("/:userId", authMiddleware, adminOnly, async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid userId" });
  try {
    const own = await getPool().request().input("uid", sql.Int, userId)
      .query("SELECT ProjectId FROM dbo.UserProjectAccess WHERE UserId = @uid");
    const roleRow = (await getPool().request().input("uid", sql.Int, userId).query(
      "SELECT u.RoleId AS roleId, r.RName AS roleName FROM dbo.users u LEFT JOIN dbo.Role r ON r.RId = u.RoleId WHERE u.id = @uid",
    )).recordset[0];
    const roleProjects = roleRow?.roleId != null
      ? await rowsOrNone(
          getPool().request().input("rid", sql.Int, roleRow.roleId),
          "SELECT ProjectId FROM dbo.RoleProjectAccess WHERE RoleId = @rid",
        )
      : [];
    res.json({
      projectIds: own.recordset.map((x) => Number(x.ProjectId)),
      roleId: roleRow?.roleId ?? null,
      roleName: roleRow?.roleName ?? null,
      roleProjectIds: roleProjects.map((x) => Number(x.ProjectId)),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load project access" });
  }
});

// PUT /:userId  { projectIds: number[] } — replaces the user's own list. An
// empty list leaves the user with no personal list, so they follow their role's
// list (or see everything if the role has none).
router.put("/:userId", authMiddleware, adminOnly, async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid userId" });
  if (!Array.isArray(req.body?.projectIds)) return res.status(400).json({ error: "projectIds must be an array" });
  const ids = cleanIds(req.body.projectIds);
  try {
    await replaceList({ table: "UserProjectAccess", keyCol: "UserId", keyVal: userId, ids, actor: actorOf(req) });
    invalidateProjectScope(userId);
    res.json({ success: true, projectIds: ids });
  } catch (err) {
    console.error("[user-project-access] PUT error:", err.message);
    res.status(500).json({ error: "Failed to save project access" });
  }
});

module.exports = router;
