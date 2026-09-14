// backend/routes/pageDefinitions.js
// CRUD for dbo.PageDefinitions — the DB-backed replacement for the
// hardcoded PAGE_DEFINITIONS array in MenuRights.tsx.
//
// Routes:
//   GET    /api/page-definitions          → list all active (used by MenuRights + admin UI)
//   GET    /api/page-definitions/all      → list all including inactive (admin UI only)
//   POST   /api/page-definitions          → create
//   PUT    /api/page-definitions/:id      → update
//   DELETE /api/page-definitions/:id      → soft-delete (sets IsActive = 0)

const express = require("express");
const router  = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool } = require("../db");
const authMiddleware = require("../middleware/auth");
const requireSuperAdmin = (req, res, next) => {
  const role = req.user?.role;
  if (role !== "superadmin" && role !== "super_admin" && role !== "SuperAdmin" && req.user?.isSuperAdmin !== true) {
    return res.status(403).json({ error: "Super admin access required" });
  }
  next();
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const ALL_VALID_ACTIONS = ["view", "create", "edit", "delete", "print", "export", "import", "post-approval"];

function parseActions(raw) {
  if (!raw) return [];
  return raw.split(",").map(s => s.trim()).filter(a => ALL_VALID_ACTIONS.includes(a));
}

function validateBody(body) {
  const errors = [];
  if (!body.pageKey || typeof body.pageKey !== "string" || !body.pageKey.trim())
    errors.push("pageKey is required");
  if (!body.label || typeof body.label !== "string" || !body.label.trim())
    errors.push("label is required");
  if (!body.module || typeof body.module !== "string" || !body.module.trim())
    errors.push("module is required");
  if (!body.groupName || typeof body.groupName !== "string" || !body.groupName.trim())
    errors.push("groupName is required");
  if (!Array.isArray(body.actions) || body.actions.length === 0)
    errors.push("actions must be a non-empty array");
  return errors;
}

// ── GET /api/page-definitions ─────────────────────────────────────────────────
// Returns active rows only. Used by MenuRights.tsx at runtime.
router.get("/", authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        PageDefId   AS id,
        PageKey     AS [key],
        Label       AS label,
        Module      AS module,
        GroupName   AS [group],
        Actions     AS actions,
        SortOrder   AS sortOrder,
        IsActive    AS isActive
      FROM dbo.PageDefinitions
      WHERE IsActive = 1
      ORDER BY SortOrder, GroupName, Label
    `);
    // Convert comma-separated actions string → array for the frontend
    const rows = result.recordset.map(r => ({
      ...r,
      actions: parseActions(r.actions),
    }));
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    console.error("GET /page-definitions error:", err);
    res.status(500).json({ error: "Failed to fetch page definitions" });
  }
});

// ── GET /api/page-definitions/all ─────────────────────────────────────────────
// Returns ALL rows (active + inactive). Admin UI only.
router.get("/all", authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        PageDefId   AS id,
        PageKey     AS [key],
        Label       AS label,
        Module      AS module,
        GroupName   AS [group],
        Actions     AS actions,
        SortOrder   AS sortOrder,
        IsActive    AS isActive,
        CreatedBy   AS createdBy,
        CreatedAt   AS createdAt,
        UpdatedAt   AS updatedAt
      FROM dbo.PageDefinitions
      ORDER BY SortOrder, GroupName, Label
    `);
    const rows = result.recordset.map(r => ({
      ...r,
      actions: parseActions(r.actions),
    }));
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    console.error("GET /page-definitions/all error:", err);
    res.status(500).json({ error: "Failed to fetch page definitions" });
  }
});

// ── POST /api/page-definitions ────────────────────────────────────────────────
router.post("/", authMiddleware, requireSuperAdmin, async (req, res) => {
  const errors = validateBody(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });

  const { pageKey, label, module, groupName, actions, sortOrder } = req.body;
  const actionsStr = actions.filter(a => ALL_VALID_ACTIONS.includes(a)).join(",");
  const order = Number.isInteger(sortOrder) ? sortOrder : 100;
  const createdBy = req.user?.email || req.user?.name || "admin";

  try {
    const pool = await getPool();

    // Check for duplicate key
    const dup = await pool.request()
      .input("PageKey", pageKey.trim())
      .query("SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = @PageKey AND IsActive = 1");
    if (dup.recordset.length > 0)
      return res.status(409).json({ error: `Page key '${pageKey.trim()}' already exists` });

    const result = await pool.request()
      .input("PageKey",   pageKey.trim())
      .input("Label",     label.trim())
      .input("Module",    module.trim())
      .input("GroupName", groupName.trim())
      .input("Actions",   actionsStr)
      .input("SortOrder", order)
      .input("CreatedBy", createdBy)
      .query(`
        INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.PageDefId
        VALUES (@PageKey, @Label, @Module, @GroupName, @Actions, @SortOrder, 1, @CreatedBy, GETDATE())
      `);

    res.status(201).json({ id: result.recordset[0].PageDefId, message: "Page definition created" });
  } catch (err) {
    console.error("POST /page-definitions error:", err);
    res.status(500).json({ error: "Failed to create page definition" });
  }
});

// ── PUT /api/page-definitions/:id ─────────────────────────────────────────────
router.put("/:id", authMiddleware, requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const errors = validateBody(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });

  const { pageKey, label, module, groupName, actions, sortOrder, isActive } = req.body;
  const actionsStr = actions.filter(a => ALL_VALID_ACTIONS.includes(a)).join(",");
  const order = Number.isInteger(sortOrder) ? sortOrder : 100;
  const active = isActive === false ? 0 : 1;

  try {
    const pool = await getPool();

    // Check exists
    const exists = await pool.request()
      .input("PageDefId", id)
      .query("SELECT 1 FROM dbo.PageDefinitions WHERE PageDefId = @PageDefId");
    if (exists.recordset.length === 0)
      return res.status(404).json({ error: "Page definition not found" });

    // Duplicate key check (exclude self)
    const dup = await pool.request()
      .input("PageKey",   pageKey.trim())
      .input("PageDefId", id)
      .query(`
        SELECT 1 FROM dbo.PageDefinitions
        WHERE PageKey = @PageKey AND PageDefId <> @PageDefId AND IsActive = 1
      `);
    if (dup.recordset.length > 0)
      return res.status(409).json({ error: `Page key '${pageKey.trim()}' already used by another definition` });

    await pool.request()
      .input("PageKey",   pageKey.trim())
      .input("Label",     label.trim())
      .input("Module",    module.trim())
      .input("GroupName", groupName.trim())
      .input("Actions",   actionsStr)
      .input("SortOrder", order)
      .input("IsActive",  active)
      .input("PageDefId", id)
      .query(`
        UPDATE dbo.PageDefinitions SET
          PageKey   = @PageKey,
          Label     = @Label,
          Module    = @Module,
          GroupName = @GroupName,
          Actions   = @Actions,
          SortOrder = @SortOrder,
          IsActive  = @IsActive,
          UpdatedAt = GETDATE()
        WHERE PageDefId = @PageDefId
      `);

    res.json({ message: "Page definition updated" });
  } catch (err) {
    console.error("PUT /page-definitions/:id error:", err);
    res.status(500).json({ error: "Failed to update page definition" });
  }
});

// ── DELETE /api/page-definitions/:id ─────────────────────────────────────────
// Soft delete — sets IsActive = 0. This means permissions referencing this
// page key still exist in the DB and are simply ignored at runtime.
router.delete("/:id", authMiddleware, requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("PageDefId", id)
      .query(`
        UPDATE dbo.PageDefinitions
        SET IsActive = 0, UpdatedAt = GETDATE()
        WHERE PageDefId = @PageDefId AND IsActive = 1
      `);
    if (result.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Page definition not found or already inactive" });

    res.json({ message: "Page definition deactivated" });
  } catch (err) {
    console.error("DELETE /page-definitions/:id error:", err);
    res.status(500).json({ error: "Failed to deactivate page definition" });
  }
});

module.exports = router;




