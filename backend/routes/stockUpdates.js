const express = require("express");
const router = express.Router();

const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const allowRoles = require("../middleware/role");
const { bumpCacheVersion } = require("../redis");
const { parseId } = require("../middleware/validateRequest");

// GET / — history of stock updates, newest first.
router.get("/", authenticateToken, requirePageRight("stock-update", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT su.StockUpdateId, su.DocNo, su.UpdateDate, su.CompanyId, su.ProjectId, su.GodownId,
             su.Remarks, su.CreatedBy, COALESCE(cu.name, su.CreatedBy) AS CreatedByName, su.CreatedAt,
             co.name AS CompanyName, pr.name AS ProjectName, g.GodownName,
             (SELECT COUNT(*) FROM dbo.StockUpdateItems i WHERE i.StockUpdateId = su.StockUpdateId) AS ItemCount,
             (SELECT ISNULL(SUM(i.Qty), 0) FROM dbo.StockUpdateItems i WHERE i.StockUpdateId = su.StockUpdateId) AS TotalQty
      FROM dbo.StockUpdate su
      LEFT JOIN dbo.enterprise co ON co.id = su.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = su.ProjectId
      LEFT JOIN dbo.Godowns g ON g.GodownID = su.GodownId
      LEFT JOIN dbo.users cu ON LOWER(cu.email) = LOWER(su.CreatedBy)
      ORDER BY su.UpdateDate DESC, su.StockUpdateId DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[stock-updates] GET / error:", err.message);
    res.status(500).json({ error: "Failed to fetch stock updates" });
  }
});

// GET /:id — one update with its items.
router.get("/:id", authenticateToken, requirePageRight("stock-update", "view"), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const header = await pool.request().input("id", sql.Int, id).query(`
      SELECT su.*, COALESCE(cu.name, su.CreatedBy) AS CreatedByName,
             co.name AS CompanyName, pr.name AS ProjectName, g.GodownName
      FROM dbo.StockUpdate su
      LEFT JOIN dbo.enterprise co ON co.id = su.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = su.ProjectId
      LEFT JOIN dbo.Godowns g ON g.GodownID = su.GodownId
      LEFT JOIN dbo.users cu ON LOWER(cu.email) = LOWER(su.CreatedBy)
      WHERE su.StockUpdateId = @id
    `);
    if (!header.recordset.length) return res.status(404).json({ error: "Not found" });
    const items = await pool.request().input("id", sql.Int, id).query(`
      SELECT i.StockUpdateItemId, i.ItemId, img.M_Name AS ItemName, i.UOM, i.Qty
      FROM dbo.StockUpdateItems i
      LEFT JOIN dbo.Item_Master_Group img ON CONVERT(NVARCHAR(50), img.M_Id) = i.ItemId
      WHERE i.StockUpdateId = @id
      ORDER BY i.StockUpdateItemId
    `);
    res.json({ ...header.recordset[0], items: items.recordset });
  } catch (err) {
    console.error("[stock-updates] GET /:id error:", err.message);
    res.status(500).json({ error: "Failed to fetch stock update" });
  }
});

// POST / — save: header + items + a StockLedger IN row per item, in one
// transaction so the ledger can never get ahead of (or behind) the record.
router.post("/", authenticateToken, requirePageRight("stock-update", "create"), async (req, res) => {
  const { UpdateDate, CompanyId, ProjectId, GodownId, Remarks, items } = req.body || {};
  const companyId = parseInt(CompanyId, 10);
  const projectId = parseInt(ProjectId, 10);
  const godownId = parseInt(GodownId, 10);

  if (!UpdateDate || Number.isNaN(Date.parse(UpdateDate))) return res.status(400).json({ error: "Update date is required." });
  if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Company is required." });
  if (!Number.isFinite(projectId)) return res.status(400).json({ error: "Project is required." });
  if (!Number.isFinite(godownId)) return res.status(400).json({ error: "Godown is required." });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "Add at least one item." });

  const seen = new Set();
  for (const it of items) {
    if (!it.ItemId) return res.status(400).json({ error: "Every row needs an item." });
    const qty = Number(it.Qty);
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: "Every quantity must be greater than zero." });
    const key = String(it.ItemId);
    if (seen.has(key)) return res.status(400).json({ error: "The same item is listed twice. Combine the quantities into one row." });
    seen.add(key);
  }

  const actor = req.user?.email || req.user?.name || "system";
  const pool = getPool();
  const tx = new sql.Transaction(pool);
  try {
    const godown = await pool.request().input("g", sql.Int, godownId).query(
      "SELECT GodownID, ProjectID, EnterpriseID FROM dbo.Godowns WHERE GodownID = @g AND IsDeleted = 0",
    );
    if (!godown.recordset.length) return res.status(400).json({ error: "Selected godown not found." });
    const gd = godown.recordset[0];
    if (gd.ProjectID != null && Number(gd.ProjectID) !== projectId) {
      return res.status(400).json({ error: "That godown does not belong to the selected project." });
    }

    await tx.begin();
    const head = await new sql.Request(tx)
      .input("UpdateDate", sql.Date, UpdateDate)
      .input("CompanyId", sql.Int, companyId)
      .input("ProjectId", sql.Int, projectId)
      .input("GodownId", sql.Int, godownId)
      .input("Remarks", sql.NVarChar(500), Remarks ? String(Remarks).slice(0, 500) : null)
      .input("CreatedBy", sql.NVarChar(150), actor).query(`
        INSERT INTO dbo.StockUpdate (UpdateDate, CompanyId, ProjectId, GodownId, Remarks, CreatedBy)
        OUTPUT INSERTED.StockUpdateId
        VALUES (@UpdateDate, @CompanyId, @ProjectId, @GodownId, @Remarks, @CreatedBy)
      `);
    const suId = head.recordset[0].StockUpdateId;
    const docNo = `SU-${new Date(UpdateDate).getFullYear()}-${String(suId).padStart(5, "0")}`;
    await new sql.Request(tx).input("id", sql.Int, suId).input("docNo", sql.NVarChar(50), docNo)
      .query("UPDATE dbo.StockUpdate SET DocNo = @docNo WHERE StockUpdateId = @id");

    for (const it of items) {
      const qty = Number(it.Qty);
      const uom = it.UOM ? String(it.UOM).slice(0, 20) : null;
      await new sql.Request(tx)
        .input("id", sql.Int, suId)
        .input("ItemId", sql.NVarChar(50), String(it.ItemId))
        .input("UOM", sql.NVarChar(20), uom)
        .input("Qty", sql.Decimal(18, 3), qty).query(`
          INSERT INTO dbo.StockUpdateItems (StockUpdateId, ItemId, UOM, Qty) VALUES (@id, @ItemId, @UOM, @Qty)
        `);
      await new sql.Request(tx)
        .input("ItemID", sql.NVarChar(50), String(it.ItemId))
        .input("Qty", sql.Decimal(18, 3), qty)
        .input("UOM", sql.NVarChar(20), uom)
        .input("RefID", sql.Int, suId)
        .input("DocNo", sql.NVarChar(100), docNo)
        .input("GodownID", sql.Int, godownId)
        .input("CreatedDate", sql.DateTime, new Date(`${UpdateDate}T12:00:00`)).query(`
          INSERT INTO dbo.StockLedger (ItemID, Qty, UOM, Type, RefType, RefID, DocNo, GodownID, CreatedDate)
          VALUES (@ItemID, @Qty, @UOM, 'IN', 'STKUPD', @RefID, @DocNo, @GodownID, @CreatedDate)
        `);
    }
    await tx.commit();

    await bumpCacheVersion("stock-ledger").catch(() => {});
    res.status(201).json({ StockUpdateId: suId, DocNo: docNo, message: "Stock updated" });
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* not begun or already rolled back */ }
    console.error("[stock-updates] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — super_admin only. Removes the StockLedger IN rows this
// update posted, then its items, then the header, in one transaction —
// same hard-delete-by-RefType/RefID shape GRN and Material Issue already
// use for their own StockLedger rows. Blocked if any item's godown balance
// would go negative, i.e. the stock this update added has since been
// consumed elsewhere (an Issue, another transfer, ...).
router.delete("/:id", authenticateToken, allowRoles("super_admin"), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const pool = getPool();
  const tx = new sql.Transaction(pool);
  try {
    const header = await pool.request().input("id", sql.Int, id).query(
      "SELECT StockUpdateId, GodownId, DocNo FROM dbo.StockUpdate WHERE StockUpdateId = @id",
    );
    if (!header.recordset.length) return res.status(404).json({ error: "Not found" });
    const { GodownId: godownId } = header.recordset[0];

    const items = await pool.request().input("id", sql.Int, id).query(
      "SELECT ItemId, Qty FROM dbo.StockUpdateItems WHERE StockUpdateId = @id",
    );

    for (const it of items.recordset) {
      const avail = await pool.request()
        .input("itemId", sql.NVarChar(50), it.ItemId)
        .input("godownId", sql.Int, godownId).query(`
          SELECT ISNULL(SUM(CASE WHEN Type='IN' THEN Qty ELSE -Qty END), 0) AS Available
          FROM dbo.StockLedger
          WHERE ItemID = @itemId AND GodownID = @godownId
        `);
      const available = Number(avail.recordset[0].Available || 0);
      if (available < Number(it.Qty)) {
        return res.status(409).json({
          error: `Can't delete — item ${it.ItemId} has only ${available} left in this godown, less than the ${it.Qty} this update added. Some of it has already been used elsewhere.`,
        });
      }
    }

    await tx.begin();
    await new sql.Request(tx).input("id", sql.Int, id).query(
      "DELETE FROM dbo.StockLedger WHERE RefType = 'STKUPD' AND RefID = @id",
    );
    await new sql.Request(tx).input("id", sql.Int, id).query(
      "DELETE FROM dbo.StockUpdateItems WHERE StockUpdateId = @id",
    );
    await new sql.Request(tx).input("id", sql.Int, id).query(
      "DELETE FROM dbo.StockUpdate WHERE StockUpdateId = @id",
    );
    await tx.commit();

    await bumpCacheVersion("stock-ledger").catch(() => {});
    res.json({ message: "Stock update deleted" });
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* not begun or already rolled back */ }
    console.error("[stock-updates] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
