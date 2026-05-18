const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { validateBody } = require("../middleware/validateRequest");
const allowRoles = require("../middleware/role");
const {
  tenantCreateSchema,
  tenantUpdateSchema,
  tenantPatchStatusSchema,
} = require("../validation/tenantSchemas");

router.use(allowRoles("dba", "super_admin"));

// GET all tenants
router.get("/", cache("tenants", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .query("SELECT * FROM dbo.tenants ORDER BY created_at DESC");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single tenant by id
router.get("/:id", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("id", sql.NVarChar, req.params.id)
      .query("SELECT * FROM dbo.tenants WHERE tenant_id = @id");
    if (!result.recordset.length)
      return res.status(404).json({ error: "Tenant not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE tenant
router.post("/", validateBody(tenantCreateSchema), async (req, res) => {
  const {
    tenant_id,
    name,
    domain,
    admin_email,
    plan,
    max_users,
    db_name,
    server,
  } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("tenant_id", sql.NVarChar, tenant_id)
      .input("name", sql.NVarChar, name)
      .input("domain", sql.NVarChar, domain || null)
      .input("admin_email", sql.NVarChar, admin_email || null)
      .input("plan", sql.NVarChar, plan || "Starter")
      .input("max_users", sql.Int, max_users || 10)
      .input("db_name", sql.NVarChar, db_name || null)
      .input("server", sql.NVarChar, server || null)
      .input("status", sql.NVarChar, "active").query(`
        INSERT INTO dbo.tenants
          (tenant_id, name, domain, admin_email, plan, max_users, db_name, server, status, created_at)
        VALUES
          (@tenant_id, @name, @domain, @admin_email, @plan, @max_users, @db_name, @server, @status, GETDATE())
      `);
    await bumpCacheVersion("tenants");
    res.json({ message: "Tenant created", tenant_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE tenant (including tenant_id rename)
router.put("/:id", validateBody(tenantUpdateSchema), async (req, res) => {
  const { id } = req.params;
  const {
    tenant_id,
    name,
    domain,
    admin_email,
    plan,
    max_users,
    db_name,
    server,
    status,
  } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("old_id", sql.NVarChar, id)
      .input("tenant_id", sql.NVarChar, tenant_id)
      .input("name", sql.NVarChar, name)
      .input("domain", sql.NVarChar, domain || null)
      .input("admin_email", sql.NVarChar, admin_email || null)
      .input("plan", sql.NVarChar, plan || "Starter")
      .input("max_users", sql.Int, max_users || 10)
      .input("db_name", sql.NVarChar, db_name || null)
      .input("server", sql.NVarChar, server || null)
      .input("status", sql.NVarChar, status || "active").query(`
        UPDATE dbo.tenants SET
          tenant_id=@tenant_id, name=@name, domain=@domain,
          admin_email=@admin_email, plan=@plan, max_users=@max_users,
          db_name=@db_name, server=@server, status=@status
        WHERE tenant_id=@old_id
      `);
    await bumpCacheVersion("tenants");
    res.json({ message: "Tenant updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH tenant status (suspend / activate)
router.patch(
  "/:id/status",
  validateBody(tenantPatchStatusSchema),
  async (req, res) => {
    const { status } = req.body;
    try {
      const pool = getPool();
      await pool
        .request()
        .input("id", sql.NVarChar, req.params.id)
        .input("status", sql.NVarChar, status)
        .query("UPDATE dbo.tenants SET status=@status WHERE tenant_id=@id");
      await bumpCacheVersion("tenants");
      res.json({ message: `Tenant ${status}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// DELETE tenant
router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.NVarChar, req.params.id)
      .query("DELETE FROM dbo.tenants WHERE tenant_id=@id");
    await bumpCacheVersion("tenants");
    res.json({ message: "Tenant deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
