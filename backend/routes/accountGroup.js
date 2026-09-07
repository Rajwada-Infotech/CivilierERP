const { requirePageRight } = require("../middleware/requirePageRight");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");

// Where an AccountHeadMaster ledger head (Supplier/Contractor/Customer/Bank/GL)
// can actually be referenced from — used to tell the user WHICH real
// documents (POs, GRNs, invoices, payments…) are blocking a group deletion,
// instead of just naming the one ledger account. Each check is independently
// wrapped so a missing table/column in a given environment doesn't blank
// out the whole list.
const USAGE_SOURCES = [
  { label: "Purchase Orders", table: "dbo.PurchaseOrders", column: "SupplierID", path: "/material/purchase-order" },
  { label: "GRNs", table: "dbo.GoodsReceiptNotes", column: "SupplierID", path: "/material/grn" },
  { label: "Expense Bookings / Invoices", table: "dbo.ExpenseBooking", column: "LHeadId", path: "/material/expense-booking" },
  { label: "Payments", table: "dbo.NewPayment", column: "PPartyId", path: "/finance/payment" },
  { label: "Work Orders (as Supplier)", table: "dbo.WorkOrderHeader", column: "SupplierId", path: "/material/work-order" },
  { label: "Work Orders (as Contractor)", table: "dbo.WorkOrderHeader", column: "ContractorId", path: "/material/work-order" },
  { label: "On Account Ledger", table: "dbo.OnAccountLedger", column: "PartyId", path: "/finance/on-account-adjustment" },
];

async function findLinkedUsage(pool, lHeadId) {
  const usage = [];
  for (const src of USAGE_SOURCES) {
    try {
      const r = await pool
        .request()
        .input("id", sql.Int, lHeadId)
        .query(`SELECT COUNT(*) AS cnt FROM ${src.table} WHERE ${src.column} = @id`);
      const count = r.recordset[0]?.cnt ?? 0;
      if (count > 0) usage.push({ label: src.label, count, path: src.path });
    } catch {
      // Table/column not present in this environment — skip silently.
    }
  }
  return usage;
}

router.get("/", authenticateToken, cache("account-group", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT ag.AGId,
             LTRIM(
               CASE WHEN LEFT(ISNULL(ag.Name, CONCAT('Unnamed-', ag.AGId)), 1) = '?'
                    THEN SUBSTRING(ISNULL(ag.Name, CONCAT('Unnamed-', ag.AGId)), 2, 4000)
                    ELSE ISNULL(ag.Name, CONCAT('Unnamed-', ag.AGId))
               END
             ) AS Name,
             ag.Code, ag.ParentGroupId, ag.Status,
             ag.CreatedAt, ag.UpdatedAt,
             parent.Name AS ParentName
      FROM dbo.AccountGroup ag
      LEFT JOIN dbo.AccountGroup parent ON parent.AGId = ag.ParentGroupId
      ORDER BY ag.Name ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", authenticateToken, requirePageRight("account-head", "create"), async (req, res) => {
  const { Name, Code, ParentGroupId, Status } = req.body;
  try {
    const userId = req.user?.id ?? req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "User context missing" });
    }

    const parentId = ParentGroupId != null ? parseInt(ParentGroupId, 10) : null;
    if (ParentGroupId != null && !Number.isFinite(parentId)) {
      return res
        .status(400)
        .json({ error: "ParentGroupId must be a valid integer" });
    }

    const pool = getPool();
    await pool
      .request()
      .input("Name", sql.NVarChar, Name || null)
      .input("Code", sql.NVarChar, Code || null)
      .input("ParentGroupId", sql.Int, parentId)
      .input("Status", sql.Bit, Status ? 1 : 0)
      .input("CreatedBy", sql.Int, userId)
      .input("CreatedAt", sql.DateTime2, new Date()).query(`
        INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
        VALUES (@Name, @Code, @ParentGroupId, @Status, @CreatedBy, @CreatedAt)
      `);
    await bumpCacheVersion("account-group");

    res.json({ message: "Account group added" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", authenticateToken, requirePageRight("account-head", "edit"), async (req, res) => {
  const { Name, Code, ParentGroupId, Status } = req.body;
  try {
    const userId = req.user?.id ?? req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "User context missing" });
    }

    const agId = parseInt(req.params.id, 10);
    if (!Number.isFinite(agId)) {
      return res.status(400).json({ error: "Invalid account group ID" });
    }

    const parentId = ParentGroupId != null ? parseInt(ParentGroupId, 10) : null;
    if (ParentGroupId != null && !Number.isFinite(parentId)) {
      return res
        .status(400)
        .json({ error: "ParentGroupId must be a valid integer" });
    }

    const pool = getPool();
    await pool
      .request()
      .input("AGId", sql.Int, agId)
      .input("Name", sql.NVarChar, Name || null)
      .input("Code", sql.NVarChar, Code || null)
      .input("ParentGroupId", sql.Int, parentId)
      .input("Status", sql.Bit, Status ? 1 : 0)
      .input("UpdatedBy", sql.Int, userId)
      .input("UpdatedAt", sql.DateTime2, new Date()).query(`
        UPDATE dbo.AccountGroup SET
          Name=@Name, Code=@Code, ParentGroupId=@ParentGroupId,
          Status=@Status, UpdatedBy=@UpdatedBy, UpdatedAt=@UpdatedAt
        WHERE AGId=@AGId
      `);
    await bumpCacheVersion("account-group");

    res.json({ message: "Account group updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", authenticateToken, requirePageRight("account-head", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid account group id" });
  }

  try {
    const agId = parseInt(req.params.id, 10);
    if (!Number.isFinite(agId)) {
      return res.status(400).json({ error: "Invalid account group ID" });
    }

    const pool = getPool();

    // ── 1. Collect the full descendant tree (BFS) ─────────────────────────
    // We need every AGId in the subtree rooted at @id so we can check whether
    // any of them are referenced by GL (AccountHeadMaster) records.
    const allGroupsResult = await pool
      .request()
      .query("SELECT AGId, ParentGroupId FROM dbo.AccountGroup");

    const rows = allGroupsResult.recordset;

    // Build a map: parentId → [childIds]
    const childMap = new Map();
    for (const row of rows) {
      if (row.ParentGroupId != null) {
        if (!childMap.has(row.ParentGroupId))
          childMap.set(row.ParentGroupId, []);
        childMap.get(row.ParentGroupId).push(row.AGId);
      }
    }

    // BFS to collect the target group + all descendants
    const subtreeIds = [];
    const queue = [id];
    while (queue.length > 0) {
      const current = queue.shift();
      subtreeIds.push(current);
      const children = childMap.get(current) || [];
      queue.push(...children);
    }

    // ── 2. Check for child sub-groups ─────────────────────────────────────
    const directChildren = childMap.get(id) || [];
    if (directChildren.length > 0) {
      console.warn(
        `[AccountGroup DELETE] Blocked: AGId=${id} has ${directChildren.length} child sub-group(s)`,
      );
      return res.status(409).json({
        error:
          "This Account Group cannot be deleted because it contains one or more Sub Groups. " +
          "Please delete all Sub Groups first.",
        code: "HAS_SUBGROUPS",
        childCount: directChildren.length,
      });
    }

    // ── 3. Check for accounts (GL / Supplier / Contractor / Bank / Customer)
    //      linked to this group or any descendant ────────────────────────────
    // Build a parameterised IN list for the subtree (always at least the id itself)
    const request = pool.request();
    const paramNames = subtreeIds.map((agId, i) => {
      request.input(`agId${i}`, sql.Int, agId);
      return `@agId${i}`;
    });

    const glCheckResult = await request.query(`
      SELECT TOP 1
        ah.LHeadId,
        ISNULL(ah.DisplayName, ah.LHeadName) AS LHeadName,
        ah.LHeadType,
        ah.LBelongsTo
      FROM dbo.AccountHeadMaster ah
      WHERE ah.LBelongsTo IN (${paramNames.join(", ")})
    `);

    if (glCheckResult.recordset.length > 0) {
      const sample = glCheckResult.recordset[0];
      const typeLabels = {
        S: "Supplier",
        C: "Contractor",
        B: "Bank",
        A: "Customer",
        BR: "Broker",
        GL: "General Ledger",
      };
      const pageLabel = typeLabels[sample.LHeadType] || "General Ledger";
      const usage = await findLinkedUsage(pool, sample.LHeadId);

      console.warn(
        `[AccountGroup DELETE] Blocked: AGId=${id} (subtree: [${subtreeIds}]) ` +
          `linked to ${pageLabel} account LHeadId=${sample.LHeadId} (${sample.LHeadName}); ` +
          `used in: ${usage.map((u) => `${u.label}(${u.count})`).join(", ") || "none found"}`,
      );

      const usageSuffix = usage.length
        ? ` It's used in ${usage.map((u) => `${u.label} (${u.count})`).join(", ")}.`
        : "";

      return res.status(409).json({
        error:
          `This Account Group cannot be deleted — it is linked to a ${pageLabel} record: ` +
          `"${sample.LHeadName}".${usageSuffix} Please delete or reassign this ${pageLabel} record first.`,
        code: "HAS_LINKED_ACCOUNTS",
        linkedType: pageLabel,
        linkedName: sample.LHeadName,
        usedIn: usage,
      });
    }

    // ── 4. Safe to delete ─────────────────────────────────────────────────
    await pool
      .request()
      .input("AGId", sql.Int, agId)
      .query("DELETE FROM dbo.AccountGroup WHERE AGId=@AGId");

    await bumpCacheVersion("account-group");
    res.json({ message: "Account group deleted" });
  } catch (err) {
    console.error("[AccountGroup DELETE] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
