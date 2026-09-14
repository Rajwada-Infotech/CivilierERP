const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");

// Bust stale cache on every deploy/restart so schema changes take effect immediately
bumpCacheVersion("uom-master").catch(() => {});

// GET all UOM
router.get("/", cache("uom-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id, UOMName, UOMCode, CreatedAt, Symbol, Remarks, IsActive,
             UOMCategory, BaseFactor
      FROM dbo.UOMMaster
      ORDER BY UOMName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[uom-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Cache bust — call once after schema migrations
router.post("/cache-bust", async (req, res) => {
  try {
    await bumpCacheVersion("uom-master");
    res.json({ message: "UOM cache cleared" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADD UOM
router.post("/", requirePageRight("unit-of-measurement", "create"), async (req, res) => {
  const { UOMName, UOMCode, Symbol, Remarks, IsActive, UOMCategory, BaseFactor } = req.body;
  const createdBy = req.user?.userId || null;

  try {
    const pool = getPool();
    await pool
      .request()
      .input("UOMName", sql.NVarChar(50), UOMName)
      .input("UOMCode", sql.NVarChar(20), UOMCode)
      .input("Symbol", sql.NVarChar(20), Symbol || null)
      .input("Remarks", sql.NVarChar(250), Remarks || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UOMCategory", sql.NVarChar(30), UOMCategory || null)
      .input("BaseFactor", sql.Decimal(18, 6), BaseFactor != null && BaseFactor !== "" ? Number(BaseFactor) : 1)
      .input("CreatedBy", sql.Int, createdBy)
      .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
        INSERT INTO dbo.UOMMaster
          (UOMName, UOMCode, Symbol, Remarks, IsActive, UOMCategory, BaseFactor, CreatedBy, CreatedAt)
        VALUES
          (@UOMName, @UOMCode, @Symbol, @Remarks, @IsActive, @UOMCategory, @BaseFactor, @CreatedBy, @CreatedAt)
      `);
    await bumpCacheVersion("uom-master");
    await bumpCacheVersion("stock-ledger");
    res.json({ message: "UOM added successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE UOM
router.put("/:id", requirePageRight("unit-of-measurement", "edit"), async (req, res) => {
  const { id } = req.params;
  const { UOMName, UOMCode, Symbol, Remarks, IsActive, UOMCategory, BaseFactor } = req.body;
  const updatedBy = req.user?.userId || null;

  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(id))
      .input("UOMName", sql.NVarChar(50), UOMName)
      .input("UOMCode", sql.NVarChar(20), UOMCode)
      .input("Symbol", sql.NVarChar(20), Symbol || null)
      .input("Remarks", sql.NVarChar(250), Remarks || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UOMCategory", sql.NVarChar(30), UOMCategory || null)
      .input("BaseFactor", sql.Decimal(18, 6), BaseFactor != null && BaseFactor !== "" ? Number(BaseFactor) : 1)
      .input("UpdatedBy", sql.Int, updatedBy)
      .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
        UPDATE dbo.UOMMaster SET
          UOMName     = @UOMName,
          UOMCode     = @UOMCode,
          Symbol      = @Symbol,
          Remarks     = @Remarks,
          IsActive    = @IsActive,
          UOMCategory = @UOMCategory,
          BaseFactor  = @BaseFactor,
          UpdatedBy   = @UpdatedBy,
          UpdatedAt   = @UpdatedAt
        WHERE Id = @Id
      `);
    await bumpCacheVersion("uom-master");
    await bumpCacheVersion("stock-ledger");
    res.json({ message: "UOM updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE UOM — safe: check all reference tables first ──────────────────────
router.delete("/:id", requirePageRight("unit-of-measurement", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();

    // Get UOM details for context
    const uomResult = await pool
      .request()
      .input("Id", sql.Int, id)
      .query("SELECT UOMName, UOMCode FROM dbo.UOMMaster WHERE Id = @Id");

    if (!uomResult.recordset.length)
      return res.status(404).json({ error: "UOM not found" });

    const { UOMName, UOMCode } = uomResult.recordset[0];

    // ── Reference checks across all transaction tables ────────────────────
    // Each check returns the count of uses and a human-readable table name.
    const checks = [
      {
        label: "Purchase Orders",
        query: `SELECT COUNT(*) AS cnt FROM dbo.PurchaseOrders WHERE UOMId = @Id OR UOMCode = @UOMCode`,
      },
      {
        label: "Work Orders",
        query: `SELECT COUNT(*) AS cnt FROM dbo.WorkOrder WHERE UOMId = @Id OR UOMCode = @UOMCode`,
      },
      {
        label: "GRN",
        query: `SELECT COUNT(*) AS cnt FROM dbo.GRN WHERE UOMId = @Id OR UOMCode = @UOMCode`,
      },
      {
        label: "Expense Bookings",
        query: `SELECT COUNT(*) AS cnt FROM dbo.ExpenseBooking WHERE UOMId = @Id OR UOMCode = @UOMCode`,
      },
      {
        label: "Item Master",
        query: `SELECT COUNT(*) AS cnt FROM dbo.ItemMaster WHERE PurchaseUOMId = @Id OR StockUOMId = @Id OR UOMCode = @UOMCode`,
      },
      {
        label: "Stock Ledger",
        query: `SELECT COUNT(*) AS cnt FROM dbo.StockLedger WHERE UOMCode = @UOMCode`,
      },
    ];

    const usedIn = [];
    for (const check of checks) {
      try {
        const result = await pool
          .request()
          .input("Id", sql.Int, id)
          .input("UOMCode", sql.NVarChar(20), UOMCode)
          .query(check.query);
        const cnt = result.recordset[0]?.cnt ?? 0;
        if (cnt > 0)
          usedIn.push(`${check.label} (${cnt} record${cnt === 1 ? "" : "s"})`);
      } catch {
        // If the table/column doesn't exist in this schema, skip gracefully
      }
    }

    if (usedIn.length > 0) {
      return res.status(409).json({
        error: `Cannot delete UOM "${UOMName}" — it is referenced in: ${usedIn.join(", ")}. Remove those references first.`,
        usedIn,
      });
    }

    // Safe to delete
    await pool
      .request()
      .input("Id", sql.Int, id)
      .query("DELETE FROM dbo.UOMMaster WHERE Id = @Id");

    await bumpCacheVersion("uom-master");
    await bumpCacheVersion("stock-ledger");
    res.json({ message: `UOM "${UOMName}" deleted successfully` });
  } catch (err) {
    console.error("UOM DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;




