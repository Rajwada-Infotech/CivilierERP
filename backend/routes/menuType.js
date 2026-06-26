const allowRoles = require("../middleware/role");
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");
const { validateBody } = require("../middleware/validateRequest");
const {
  menuTypeCreateSchema,
  menuTypeUpdateSchema,
} = require("../validation/menuTypeSchemas");

// GET all menu types
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT Id, MenuReceipt, MenuPayment, MenuBOQ, MenuPurchaseOrder, MenuWorkOrder,
             CreatedBy, UpdatedBy, ApprovedBy, CreatedAt, UpdatedAt, ApprovedAt
      FROM dbo.MenuType
      ORDER BY Id ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("MenuType GET error:", err);
    res.status(500).json({ error: "Failed to fetch menu types" });
  }
});

// GET single
router.get("/:id", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
      .query(`SELECT * FROM dbo.MenuType WHERE Id = @Id`);
    if (result.recordset.length === 0)
      return res.status(404).json({ error: "Menu type not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("MenuType GET/:id error:", err);
    res.status(500).json({ error: "Failed to fetch menu type" });
  }
});

// POST
router.post("/", allowRoles("admin", "super_admin", "dba"), validateBody(menuTypeCreateSchema), async (req, res) => {
  const { MenuReceipt, MenuPayment, MenuBOQ, MenuPurchaseOrder, MenuWorkOrder, CreatedBy } = req.body;
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("MenuReceipt", sql.NVarChar(200), MenuReceipt || null)
      .input("MenuPayment", sql.NVarChar(200), MenuPayment || null)
      .input("MenuBOQ", sql.NVarChar(200), MenuBOQ || null)
      .input("MenuPurchaseOrder", sql.NVarChar(200), MenuPurchaseOrder || null)
      .input("MenuWorkOrder", sql.NVarChar(200), MenuWorkOrder || null)
      .input("CreatedBy", sql.NVarChar(100), CreatedBy || null)
      .input("CreatedAt", sql.DateTime, new Date())
      .query(`
        INSERT INTO dbo.MenuType
          (MenuReceipt, MenuPayment, MenuBOQ, MenuPurchaseOrder, MenuWorkOrder, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@MenuReceipt, @MenuPayment, @MenuBOQ, @MenuPurchaseOrder, @MenuWorkOrder, @CreatedBy, @CreatedAt)
      `);
    res.status(201).json({ id: result.recordset[0].Id, message: "Menu type created successfully" });
  } catch (err) {
    console.error("MenuType POST error:", err);
    res.status(500).json({ error: "Failed to create menu type" });
  }
});

// PUT
router.put("/:id", allowRoles("admin", "super_admin", "dba"), validateBody(menuTypeUpdateSchema), async (req, res) => {
  const { MenuReceipt, MenuPayment, MenuBOQ, MenuPurchaseOrder, MenuWorkOrder, UpdatedBy, ApprovedBy, ApprovedAt } = req.body;
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
      .input("MenuReceipt", sql.NVarChar(200), MenuReceipt || null)
      .input("MenuPayment", sql.NVarChar(200), MenuPayment || null)
      .input("MenuBOQ", sql.NVarChar(200), MenuBOQ || null)
      .input("MenuPurchaseOrder", sql.NVarChar(200), MenuPurchaseOrder || null)
      .input("MenuWorkOrder", sql.NVarChar(200), MenuWorkOrder || null)
      .input("UpdatedBy", sql.NVarChar(100), UpdatedBy || null)
      .input("UpdatedAt", sql.DateTime, new Date())
      .input("ApprovedBy", sql.NVarChar(100), ApprovedBy || null)
      .input("ApprovedAt", sql.DateTime, ApprovedAt ? new Date(ApprovedAt) : null)
      .query(`
        UPDATE dbo.MenuType SET
          MenuReceipt = @MenuReceipt,
          MenuPayment = @MenuPayment,
          MenuBOQ = @MenuBOQ,
          MenuPurchaseOrder = @MenuPurchaseOrder,
          MenuWorkOrder = @MenuWorkOrder,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = @UpdatedAt,
          ApprovedBy = @ApprovedBy,
          ApprovedAt = COALESCE(@ApprovedAt, ApprovedAt)
        WHERE Id = @Id
      `);
    res.json({ message: "Menu type updated successfully" });
  } catch (err) {
    console.error("MenuType PUT error:", err);
    res.status(500).json({ error: "Failed to update menu type" });
  }
});

// DELETE
router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
      .query(`DELETE FROM dbo.MenuType WHERE Id = @Id`);
    res.json({ message: "Menu type deleted successfully" });
  } catch (err) {
    console.error("MenuType DELETE error:", err);
    res.status(500).json({ error: "Failed to delete menu type" });
  }
});

module.exports = router;




