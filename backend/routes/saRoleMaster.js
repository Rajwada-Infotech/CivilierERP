const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const verifyToken = require("../middleware/auth");
const { isSaAdmin } = require("../services/saAccess");
const { userPermissionCache } = require("../middleware/permissions");
const rateLimit = require("express-rate-limit");

router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

function guard(req, res, next) {
  if (!isSaAdmin(req)) return res.status(403).json({ error: "Access denied" });
  next();
}

// ── GET /api/sa/role-master/users ─────────────────────────────────────────────
router.get("/users", verifyToken, guard, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT u.id, u.name, u.email, u.RoleId,
             r.RName AS RoleName, r.RDesc
      FROM dbo.Users u
      JOIN dbo.Role r ON r.RId = u.RoleId
      WHERE r.RName IN ('marketing_head', 'sales_team_lead', 'sales_person')
        AND u.discontinue = 0
      ORDER BY
        CASE r.RName
          WHEN 'marketing_head'  THEN 1
          WHEN 'sales_team_lead' THEN 2
          WHEN 'sales_person'    THEN 3
          ELSE 4
        END, u.name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[saRoleMaster] /users:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/sa/role-master/roles ─────────────────────────────────────────────
router.get("/roles", verifyToken, guard, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT r.RId, r.RName, r.RDesc,
             rr.SubModule,
             rr.CanView, rr.CanAdd, rr.CanEdit, rr.CanDelete, rr.CanPrint
      FROM dbo.Role r
      LEFT JOIN dbo.RoleRights rr
        ON rr.RoleId = r.RId AND rr.Module = 'Sales Automation'
      WHERE r.RName IN ('marketing_head', 'sales_team_lead', 'sales_person')
      ORDER BY r.RId, rr.SubModule
    `);

    const byRole = {};
    for (const row of result.recordset) {
      if (!byRole[row.RId]) {
        byRole[row.RId] = { RId: row.RId, RName: row.RName, RDesc: row.RDesc, pages: [] };
      }
      if (row.SubModule) {
        byRole[row.RId].pages.push({
          subModule: row.SubModule,
          canView:   !!row.CanView,
          canAdd:    !!row.CanAdd,
          canEdit:   !!row.CanEdit,
          canDelete: !!row.CanDelete,
          canPrint:  !!row.CanPrint,
        });
      }
    }
    res.json(Object.values(byRole));
  } catch (err) {
    console.error("[saRoleMaster] /roles:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/sa/role-master/user/:id/permissions ──────────────────────────────
router.get("/user/:id/permissions", verifyToken, guard, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const pool = getPool();

    const ur = await pool.request().input("id", sql.Int, userId)
      .query("SELECT RoleId FROM dbo.Users WHERE id = @id AND discontinue = 0");
    if (!ur.recordset.length) return res.status(404).json({ error: "User not found" });
    const roleId = ur.recordset[0].RoleId;

    const [roleRights, userRights] = await Promise.all([
      pool.request().input("RoleId", sql.Int, roleId).query(`
        SELECT SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint
        FROM dbo.RoleRights
        WHERE RoleId = @RoleId AND Module = 'Sales Automation'
        ORDER BY SubModule
      `),
      pool.request().input("UserId", sql.Int, userId).query(`
        SELECT RightsJson FROM dbo.UserPageRightsJson WHERE UserId = @UserId AND IsActive = 1
      `),
    ]);

    let customRights = [];
    try { customRights = JSON.parse(userRights.recordset[0]?.RightsJson || "[]"); } catch {}

    res.json({ roleId, roleRights: roleRights.recordset, customRights });
  } catch (err) {
    console.error("[saRoleMaster] /user/:id/permissions:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Page-key prefixes and explicit keys this endpoint is allowed to write.
// Explicit allowed page key prefixes for SA role master endpoint.
// "sale-" and "sales-" are intentionally excluded — those keys belong to the
// Sales (CRM) module and marketing_head should not be able to grant them.
const SA_ALLOWED_PREFIXES = ["sa-"];
function isAllowedSaPageKey(key) {
  const k = String(key).toLowerCase();
  return SA_ALLOWED_PREFIXES.some((p) => k.startsWith(p));
}

// ── PUT /api/sa/role-master/user/:id/permissions ──────────────────────────────
router.put("/user/:id/permissions", verifyToken, guard, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { rights } = req.body; // [{page, actions:[...]}]
    if (!Array.isArray(rights)) return res.status(400).json({ error: "rights must be an array" });

    // Only SA/Sales page keys are writable through this endpoint.
    const invalidKeys = rights.filter((r) => !isAllowedSaPageKey(r?.page));
    if (invalidKeys.length > 0) {
      return res.status(400).json({ error: "Only SA/Sales page rights may be set via this endpoint" });
    }

    // Target user must be an SA-role user.
    const pool = getPool();
    const userCheck = await pool.request()
      .input("UserId", sql.Int, userId)
      .query(`
        SELECT u.id FROM dbo.Users u
        JOIN dbo.Role r ON r.RId = u.RoleId
        WHERE u.id = @UserId AND u.discontinue = 0
          AND r.RName IN ('marketing_head', 'sales_team_lead', 'sales_person')
      `);
    if (!userCheck.recordset.length) {
      return res.status(403).json({ error: "Target user is not an SA-role user" });
    }

    const json = JSON.stringify(rights);

    await pool.request()
      .input("UserId",     sql.Int,              userId)
      .input("RightsJson", sql.NVarChar(sql.MAX), json)
      .query(`
        IF EXISTS (SELECT 1 FROM dbo.UserPageRightsJson WHERE UserId = @UserId)
          UPDATE dbo.UserPageRightsJson
          SET RightsJson = @RightsJson, IsActive = 1
          WHERE UserId = @UserId
        ELSE
          INSERT INTO dbo.UserPageRightsJson (UserId, RightsJson, IsActive)
          VALUES (@UserId, @RightsJson, 1)
      `);

    userPermissionCache.invalidateUser(userId);
    res.json({ message: "Permissions saved" });
  } catch (err) {
    console.error("[saRoleMaster] PUT /user/:id/permissions:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
