const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermission } = require("../middleware/permissions");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { validateBody } = require("../middleware/validateRequest");
const {
  roleMasterCreateSchema,
  roleMasterUpdateSchema,
} = require("../validation/roleMasterSchemas");

const cleanStr = (v, len = 255) => {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().slice(0, len);
};

// ─── ROLE RIGHTS ↔ PAGE KEY MAP ───────────────────────────────────────────────
// Single source of truth for translating between the page keys the Permission
// Editor / Role Rights UI sends and the exact {Module, SubModule} pair each
// route actually checks via checkPermission()/checkPermissionForMethod().
//
// Previously this list only covered 6 page keys; every other page (e.g.
// "engineering-work-order") fell back to `page.replace(/-/g, " ")` for BOTH
// Module and SubModule — producing values like Module="engineering work
// order" that never match any route's real check (Engineering/WorkOrders),
// so granting that right from the UI silently did nothing and the page kept
// 403'ing. This map is built directly from a grep of every checkPermission /
// checkPermissionForMethod call in routes/, so it reflects what's actually
// enforced.
const ROLE_RIGHTS_PAGE_MAP = {
  "document-type": { module: "Admin", submodule: "DocumentType" },
  typeofdoc: { module: "Admin", submodule: "DocumentType" },
  "type-of-doc": { module: "Admin", submodule: "DocumentType" },
  boq: { module: "Engineering", submodule: "BOQ" },
  "engineering-boq": { module: "Engineering", submodule: "BOQ" },
  "work-done": { module: "Engineering", submodule: "WorkDone" },
  "engineering-dashboard": { module: "Engineering", submodule: "WorkDone" },
  dpr: { module: "Engineering", submodule: "DPR" },
  "work-order": { module: "Engineering", submodule: "WorkOrders" },
  "engineering-work-order": { module: "Engineering", submodule: "WorkOrders" },
  brs: { module: "Finance", submodule: "BRS" },
  "expense-booking": { module: "Finance", submodule: "ExpenseBooking" },
  "new-payment": { module: "Finance", submodule: "Payments" },
  payments: { module: "Finance", submodule: "Payments" },
  "received-payment": { module: "Finance", submodule: "ReceivedPayments" },
  reports: { module: "Finance", submodule: "Reports" },
  transactions: { module: "Finance", submodule: "Transactions" },
  "trial-balance": { module: "Finance", submodule: "Transactions" },
  "followup-agreement-workflow": {
    module: "Followup",
    submodule: "AgreementWorkflow",
  },
  "followup-agreements": { module: "Followup", submodule: "Agreements" },
  "followup-construction-updates": {
    module: "Followup",
    submodule: "ConstructionUpdates",
  },
  "followup-escalation": { module: "Followup", submodule: "Escalation" },
  "followup-handover": { module: "Followup", submodule: "Handover" },
  "followup-legal-milestones": {
    module: "Followup",
    submodule: "LegalMilestones",
  },
  "followup-noc": { module: "Followup", submodule: "NOC" },
  "followup-possession-notice": {
    module: "Followup",
    submodule: "PossessionNotice",
  },
  "followup-pre-possession": { module: "Followup", submodule: "PrePossession" },
  "followup-sales-deed": { module: "Followup", submodule: "SalesDeed" },
  "followup-unit-selections": {
    module: "Followup",
    submodule: "UnitSelections",
  },
  "followup-unit-selection": {
    module: "Followup",
    submodule: "UnitSelections",
  },
  "sale-order": { module: "Material", submodule: "CustomerSaleOrders" },
  "grn-master": { module: "Material", submodule: "GRN" },
  grns: { module: "Material", submodule: "GRN" },
  "purchase-orders": { module: "Material", submodule: "PurchaseOrders" },
  "vehicle-in-out": { module: "Material", submodule: "VehicleInOut" },
  "menu-rights": { module: "Rights", submodule: "Menu" },
  admin_menu_rights: { module: "Rights", submodule: "Menu" },
  roles: { module: "Rights", submodule: "Menu" },
  "widgets-rights": { module: "Rights", submodule: "Widgets" },
  "fin-year": { module: "Rights", submodule: "Financial Year" },
  "user-activity": { module: "UserActivity", submodule: "List" },
  "activity-browser": { module: "UserActivity", submodule: "List" },
  users: { module: "Users", submodule: "List" },
};

// Reverse lookup (Module_SubModule -> page key) for GET, built from the same
// map above so the read and write directions can never drift apart again.
const ROLE_RIGHTS_REVERSE_MAP = {};
for (const [page, { module, submodule }] of Object.entries(
  ROLE_RIGHTS_PAGE_MAP,
)) {
  const key = `${module}_${submodule}`;
  if (!ROLE_RIGHTS_REVERSE_MAP[key]) ROLE_RIGHTS_REVERSE_MAP[key] = page; // first match wins
}

function generateRoleCode(rName) {
  if (!rName) return null;
  const words = rName
    .trim()
    .split(/\s+/)
    .filter((w) => w);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .map((w) => w[0])
    .join("")
    .slice(0, 5)
    .toUpperCase();
}

// GET LIST (minimal) — for dropdowns; only requires a valid token
// Returns RId + RName so any authenticated user can populate a role select.
router.get(
  "/list",
  authMiddleware,
  cache("roles:list", 120),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
      SELECT RId, RName FROM dbo.Role ORDER BY RName ASC
    `);
      res.json(result.recordset);
    } catch (err) {
      console.error("GET ROLES LIST ERROR:", err);
      res
        .status(500)
        .json({ error: "Failed to fetch roles list", message: err.message });
    }
  },
);

// GET ALL (full detail) — admin only, used by Role Master page
router.get(
  "/",
  authMiddleware,
  checkPermission("Rights", "Menu", "CanView"),
  cache("roles", 120),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
      SELECT RId, RName, RCode, RDesc, RCreatedBy, RCreatedAt,
             RUpdatedBy, RUpdatedAt, RApprovedBy, RApprovedAt
      FROM dbo.Role ORDER BY RId DESC
    `);
      res.json(result.recordset);
    } catch (err) {
      console.error("GET ROLES ERROR:", err);
      res
        .status(500)
        .json({ error: "Failed to fetch roles", message: err.message });
    }
  },
);

// CREATE
router.post(
  "/",
  authMiddleware,
  checkPermission("Rights", "Menu", "CanAdd"),
  validateBody(roleMasterCreateSchema),
  async (req, res) => {
    const { RName, RDesc } = req.body;

    try {
      const userEmail = req.user?.name || String(req.user?.id || "system"); // ✅ email
      const pool = getPool();
      const cleanName = RName.trim();
      const rCode = generateRoleCode(cleanName);

      const existing = await pool
        .request()
        .input("RName", sql.NVarChar(100), cleanName)
        .query("SELECT COUNT(*) as cnt FROM dbo.Role WHERE RName = @RName");
      if (existing.recordset[0].cnt > 0)
        return res.status(400).json({ error: "Role Name must be unique" });

      const result = await pool
        .request()
        .input("RName", sql.NVarChar(100), cleanName)
        .input("RCode", sql.NVarChar(20), rCode)
        .input("RDesc", sql.NVarChar(255), cleanStr(RDesc))
        .input("RCreatedBy", sql.NVarChar(100), userEmail) // ✅ was NVarChar(50) with integer string
        .query(`
        INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
        OUTPUT INSERTED.*
        VALUES (@RName, @RCode, @RDesc, @RCreatedBy)
      `);

      // Invalidate cached GET /api/roles and /api/roles/list so the new
      // row is visible immediately instead of waiting out the cache TTL.
      await bumpCacheVersion("roles");
      await bumpCacheVersion("roles:list");

      res.status(201).json(result.recordset[0]);
    } catch (err) {
      console.error("CREATE ROLE ERROR:", err);
      res
        .status(500)
        .json({ error: "Failed to create role", message: err.message });
    }
  },
);

// UPDATE
router.put(
  "/:id",
  authMiddleware,
  checkPermission("Rights", "Menu", "CanEdit"),
  validateBody(roleMasterUpdateSchema),
  async (req, res) => {
    const { id } = req.params;
    const { RName, RDesc } = req.body;
    const userEmail = req.user?.name || String(req.user?.id || "system"); // ✅ email

    try {
      const pool = getPool();
      if (RName?.trim()) {
        const cleanName = RName.trim();
        const existing = await pool
          .request()
          .input("RName", sql.NVarChar(100), cleanName)
          .input("id", sql.Int, parseInt(id))
          .query(
            "SELECT COUNT(*) as cnt FROM dbo.Role WHERE RName = @RName AND RId != @id",
          );
        if (existing.recordset[0].cnt > 0)
          return res.status(400).json({ error: "Role Name must be unique" });

        const rCode = generateRoleCode(cleanName);
        await pool
          .request()
          .input("RId", sql.Int, parseInt(id))
          .input("RName", sql.NVarChar(100), cleanName)
          .input("RCode", sql.NVarChar(20), rCode)
          .input("RDesc", sql.NVarChar(255), cleanStr(RDesc))
          .input("RUpdatedBy", sql.NVarChar(100), userEmail) // ✅ email
          .query(`
          UPDATE dbo.Role SET
            RName=@RName, RCode=@RCode, RDesc=@RDesc,
            RUpdatedBy=@RUpdatedBy, RUpdatedAt=SYSDATETIME()
          WHERE RId=@RId
        `);
      } else if (RDesc !== undefined) {
        await pool
          .request()
          .input("RId", sql.Int, parseInt(id))
          .input("RDesc", sql.NVarChar(255), cleanStr(RDesc))
          .input("RUpdatedBy", sql.NVarChar(100), userEmail) // ✅ email
          .query(`
          UPDATE dbo.Role SET RDesc=@RDesc, RUpdatedBy=@RUpdatedBy, RUpdatedAt=SYSDATETIME()
          WHERE RId=@RId
        `);
      }

      // Invalidate cached GET /api/roles and /api/roles/list so the update
      // is visible immediately instead of waiting out the cache TTL.
      await bumpCacheVersion("roles");
      await bumpCacheVersion("roles:list");

      res.json({ success: true, message: "Role updated successfully" });
    } catch (err) {
      console.error("UPDATE ROLE ERROR:", err);
      res
        .status(500)
        .json({ error: "Failed to update role", message: err.message });
    }
  },
);

// DELETE
router.delete(
  "/:id",
  authMiddleware,
  checkPermission("Rights", "Menu", "CanDelete"),
  async (req, res) => {
    try {
      const pool = getPool();
      await pool
        .request()
        .input("RId", sql.Int, parseInt(req.params.id))
        .query("DELETE FROM dbo.Role WHERE RId=@RId");

      // Invalidate cached GET /api/roles and /api/roles/list so the
      // deletion is reflected immediately instead of waiting out the TTL.
      await bumpCacheVersion("roles");
      await bumpCacheVersion("roles:list");

      res.json({ success: true, message: "Role deleted successfully" });
    } catch (err) {
      console.error("DELETE ROLE ERROR:", err);
      res
        .status(500)
        .json({ error: "Failed to delete role", message: err.message });
    }
  },
);

// GET ROLE RIGHTS
router.get("/:roleId/rights", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("RoleId", sql.Int, parseInt(req.params.roleId)).query(`
        SELECT Module, SubModule, CanView, CanAdd, CanEdit, CanDelete
        FROM dbo.RoleRights WHERE RoleId = @RoleId
      `);

    const frontendRights = result.recordset.map((row) => {
      const key = `${row.Module}_${row.SubModule}`.trim();
      const page =
        ROLE_RIGHTS_REVERSE_MAP[key] || key.toLowerCase().replace(/\s+/g, "-");
      const actions = [];
      if (Number(row.CanView) === 1) actions.push("view");
      if (Number(row.CanAdd) === 1) actions.push("create");
      if (Number(row.CanEdit) === 1) actions.push("edit");
      if (Number(row.CanDelete) === 1) actions.push("delete");
      return { page, actions };
    });

    return res.json(frontendRights);
  } catch (err) {
    console.error("GET RIGHTS ERROR:", err);
    return res.status(500).json({ error: "Failed to fetch rights" });
  }
});

// SET ROLE RIGHTS
router.post(
  "/:roleId/rights",
  authMiddleware,
  checkPermission("Rights", "Menu", "CanEdit"),
  async (req, res) => {
  try {
    const roleId = parseInt(req.params.roleId);
    const { pagePermissions } = req.body;

    const pool = getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    await new sql.Request(transaction)
      .input("RoleId", sql.Int, roleId)
      .query("DELETE FROM dbo.RoleRights WHERE RoleId=@RoleId");

    for (const permission of pagePermissions || []) {
      const mapping = ROLE_RIGHTS_PAGE_MAP[permission.page] || {
        module: permission.page.replace(/-/g, " "),
        submodule: permission.page.replace(/-/g, " "),
      };
      const actions = permission.actions || [];
      await new sql.Request(transaction)
        .input("RoleId", sql.Int, roleId)
        .input("Module", sql.NVarChar(100), mapping.module)
        .input("SubModule", sql.NVarChar(100), mapping.submodule)
        .input("CanView", sql.Bit, actions.includes("view") ? 1 : 0)
        .input("CanAdd", sql.Bit, actions.includes("create") ? 1 : 0)
        .input("CanEdit", sql.Bit, actions.includes("edit") ? 1 : 0)
        .input("CanDelete", sql.Bit, actions.includes("delete") ? 1 : 0).query(`
          INSERT INTO dbo.RoleRights
            (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
          VALUES
            (@RoleId, @Module, @SubModule, @CanView, @CanAdd, @CanEdit, @CanDelete)
        `);
    }

    await transaction.commit();

    // Invalidate in-process permission cache for this role so the change
    // is effective immediately without waiting for the 5-minute TTL.
    try {
      const { permissionCache } = require("../middleware/permissions");
      permissionCache.invalidateRole(roleId);
    } catch {
      /* permissions module not loaded yet — no-op */
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("SAVE RIGHTS ERROR:", err);
    return res.status(500).json({ error: "Failed to save rights" });
  }
});

module.exports = router;