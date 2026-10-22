const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const { getPool, sql } = require("../db");
const { projectAllowed } = require("../services/projectScope");

// A transfer belongs to the projects of its two godowns. A restricted user can
// see it if EITHER end is one of their projects (the receiving project needs to
// see what's coming in), but can only create one out of their own project.
const scopedGodownIds = (scope) => scope.map(Number).filter(Number.isFinite).join(",") || "NULL";
const transferVisibleSql = (scope, alias = "st") =>
  scope
    ? ` AND EXISTS (SELECT 1 FROM dbo.Godowns sg WHERE sg.GodownID IN (${alias}.FromGodownID, ${alias}.ToGodownID) AND sg.ProjectID IN (${scopedGodownIds(scope)}))`
    : "";

router.param("id", async (req, res, next, id) => {
  if (!req.projectScope) return next();
  const tid = parseInt(id, 10);
  if (!Number.isFinite(tid)) return next();
  try {
    const r = await getPool().request().input("id", sql.Int, tid).query(
      `SELECT 1 AS found, CASE WHEN 1=1${transferVisibleSql(req.projectScope, "st")} THEN 1 ELSE 0 END AS visible FROM dbo.StockTransfers st WHERE st.TransferID = @id`,
    );
    if (r.recordset.length && !r.recordset[0].visible) {
      return res.status(403).json({ error: "You don't have access to this project." });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
const { requirePageRight } = require("../middleware/requirePageRight");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { transition } = require("../services/approvalService");

// Approve/Reject are exempt — transition() (approvalService.js) is the real
// authority there (role whitelist / approval-inbox edit right / named
// workflow approver), not this blanket per-module permission gate.
router.use((req, res, next) => {
  if (req.path.endsWith("/approve") || req.path.endsWith("/reject")) return next();
  return checkPermissionForMethod("Material", "StockTransfer")(req, res, next);
});

function parseItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) return JSON.parse(raw);
  return [];
}

// ─── GET list of transfers ────────────────────────────────────────────────────
router.get("/", cache("stock-transfers", 60), async (req, res) => {
  try {
    const pool = getPool();
    const { fromGodown, toGodown, limit = 100, page = 1 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const request = pool
      .request()
      .input("limit", sql.Int, parseInt(limit))
      .input("offset", sql.Int, offset);

    let where = "WHERE 1=1" + transferVisibleSql(req.projectScope, "st");
    if (fromGodown) {
      request.input("from", sql.Int, parseInt(fromGodown));
      where += " AND st.FromGodownID=@from";
    }
    if (toGodown) {
      request.input("to", sql.Int, parseInt(toGodown));
      where += " AND st.ToGodownID=@to";
    }

    // ── Total count (real DB count, not page size) ────────────────────────────
    const countReq = pool.request();
    if (fromGodown) countReq.input("from", sql.Int, parseInt(fromGodown));
    if (toGodown)   countReq.input("to",   sql.Int, parseInt(toGodown));
    const countResult = await countReq.query(`
      SELECT COUNT(*) AS total
      FROM dbo.StockTransfers st
      ${where}
    `);
    const dbTotal = Number(countResult.recordset[0].total || 0);

    const result = await request.query(`
      SELECT
        st.TransferID, st.DocNo, st.TransferDate,
        st.FromGodownID, fg.GodownName AS FromGodownName,
        st.ToGodownID,   tg.GodownName AS ToGodownName,
        st.TransferItems, st.Remarks, st.Status,
        st.CreatedBy, st.CreatedAt
      FROM dbo.StockTransfers st
      JOIN dbo.Godowns fg ON fg.GodownID = st.FromGodownID
      JOIN dbo.Godowns tg ON tg.GodownID = st.ToGodownID
      ${where}
      ORDER BY st.CreatedAt DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const rows = result.recordset.map((r) => ({
      ...r,
      TransferItems: parseItems(r.TransferItems),
    }));

    res.json({ data: rows, total: dbTotal });
  } catch (err) {
    console.error("[stock-transfers] GET /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /history - stock transfers + inter-company transfers, one page ───────
// The Transfer History tab shows both kinds in one list, newest transfer date first. They live in two tables, so
// paging them separately and merging on the client can't produce a correct page; this pages the union of their keys
// in SQL, then loads just that page's rows with the same columns GET / and GET /api/inter-company-transfer return.
// Order matches the tab's own: transfer date desc; on the same date stock transfers first (newest created first),
// then inter-company transfers (highest ICTId first). Visibility uses each table's own project-scope rule.
// dropOnAnyWrite: ICT writes and approvals go through other routes that don't bump "stock-transfers".
const ictScopeIds = (scope) => scope.map(Number).filter(Number.isFinite).join(",") || "NULL";
const ictVisibleSql = (scope, alias = "ict") => // same rule as routes/interCompanyTransfer.js
  scope ? ` AND (${alias}.SenderProjectId IN (${ictScopeIds(scope)}) OR ${alias}.ReceiverProjectId IN (${ictScopeIds(scope)}))` : "";

router.get("/history", cache("stock-transfer-history", 60, { dropOnAnyWrite: true }), async (req, res) => {
  try {
    const pool = getPool();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;
    const stWhere = "WHERE 1=1" + transferVisibleSql(req.projectScope, "st");
    const ictWhere = "WHERE 1=1" + ictVisibleSql(req.projectScope, "ict");

    const keys = await pool.request()
      .input("limit", sql.Int, limit)
      .input("offset", sql.Int, offset)
      .query(`
        SELECT u.Kind, u.Id
        FROM (
          SELECT 'plain' AS Kind, st.TransferID AS Id, CAST(st.TransferDate AS date) AS D, 0 AS KindOrder,
                 st.CreatedAt AS C, 0 AS IctId
          FROM dbo.StockTransfers st ${stWhere}
          UNION ALL
          SELECT 'ict', ict.ICTId, CAST(ict.TransferDate AS date), 1, NULL, ict.ICTId
          FROM dbo.InterCompanyTransfer ict ${ictWhere}
        ) u
        ORDER BY u.D DESC, u.KindOrder, u.C DESC, u.IctId DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;

        SELECT (SELECT COUNT(*) FROM dbo.StockTransfers st ${stWhere}) AS plainTotal,
               (SELECT COUNT(*) FROM dbo.InterCompanyTransfer ict ${ictWhere}) AS ictTotal;
      `);
    const order = keys.recordsets[0];
    const { plainTotal = 0, ictTotal = 0 } = keys.recordsets[1][0] || {};
    const plainIds = order.filter((k) => k.Kind === "plain").map((k) => Number(k.Id)).filter(Number.isFinite);
    const ictIds = order.filter((k) => k.Kind === "ict").map((k) => Number(k.Id)).filter(Number.isFinite);

    const [plainRows, ictRows] = await Promise.all([
      plainIds.length
        ? pool.request().query(`
            SELECT
              st.TransferID, st.DocNo, st.TransferDate,
              st.FromGodownID, fg.GodownName AS FromGodownName,
              st.ToGodownID,   tg.GodownName AS ToGodownName,
              st.TransferItems, st.Remarks, st.Status,
              st.CreatedBy, st.CreatedAt
            FROM dbo.StockTransfers st
            JOIN dbo.Godowns fg ON fg.GodownID = st.FromGodownID
            JOIN dbo.Godowns tg ON tg.GodownID = st.ToGodownID
            WHERE st.TransferID IN (${plainIds.join(",")})`).then((r) => r.recordset)
        : [],
      ictIds.length
        ? pool.request().query(`
            SELECT ict.*, sp.name AS SenderProjectName, sc.name AS SenderCompanyName,
                   rp.name AS ReceiverProjectName, rc.name AS ReceiverCompanyName
            FROM dbo.InterCompanyTransfer ict
            LEFT JOIN dbo.enterprise sp ON sp.id = ict.SenderProjectId
            LEFT JOIN dbo.enterprise sc ON sc.id = ict.SenderCompanyId
            LEFT JOIN dbo.enterprise rp ON rp.id = ict.ReceiverProjectId
            LEFT JOIN dbo.enterprise rc ON rc.id = ict.ReceiverCompanyId
            WHERE ict.ICTId IN (${ictIds.join(",")})`).then((r) => r.recordset)
        : [],
    ]);
    const plainById = new Map(plainRows.map((r) => [Number(r.TransferID), { ...r, TransferItems: parseItems(r.TransferItems) }]));
    const ictById = new Map(ictRows.map((r) => [Number(r.ICTId), r]));
    const rows = order
      .map((k) => (k.Kind === "plain"
        ? { kind: "plain", data: plainById.get(Number(k.Id)) }
        : { kind: "ict", data: ictById.get(Number(k.Id)) }))
      .filter((r) => r.data);

    res.json({ data: rows, total: Number(plainTotal) + Number(ictTotal), plainTotal: Number(plainTotal), ictTotal: Number(ictTotal), page, limit });
  } catch (err) {
    console.error("[stock-transfers] GET /history:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST create transfer ─────────────────────────────────────────────────────
// Validates stock availability up front (fast feedback), but no longer moves
// any stock here — the record is created as a Draft and auto-submitted for
// approval; the actual StockLedger IN/OUT rows are only written once the
// transfer is fully approved (see PUT /:id/approve below), so an approval
// workflow configured for it genuinely gates the stock movement instead of
// the movement already having happened before anyone could approve it.
// One entry per item with its quantities added up — the same item on two lines must be
// checked against the godown's stock as one demand, not line by line.
function demandByItem(items) {
  const m = new Map();
  for (const it of items) {
    const key = String(it.itemId);
    const cur = m.get(key);
    if (cur) cur.qty += Number(it.qty) || 0;
    else m.set(key, { itemId: it.itemId, itemName: it.itemName, qty: Number(it.qty) || 0 });
  }
  return [...m.values()];
}

router.post("/", requirePageRight("stock-transfers", "create"), async (req, res) => {
  const pool = getPool();
  try {
    const {
      FromGodownID,
      ToGodownID,
      TransferItems, // [{itemId, itemName, qty, uom, remarks}]
      Remarks,
      TransferDate,
    } = req.body;

    if (!FromGodownID || !ToGodownID)
      return res
        .status(400)
        .json({ error: "FromGodownID and ToGodownID are required" });
    if (req.projectScope) {
      const fg = await pool.request().input("g", sql.Int, parseInt(FromGodownID, 10))
        .query("SELECT ProjectID FROM dbo.Godowns WHERE GodownID = @g");
      if (!projectAllowed(req.projectScope, fg.recordset[0]?.ProjectID)) {
        return res.status(403).json({ error: "You can only transfer stock out of a godown in your own projects." });
      }
    }
    if (FromGodownID === ToGodownID)
      return res
        .status(400)
        .json({ error: "Source and destination godown must differ" });

    const items = parseItems(TransferItems);
    if (!items.length)
      return res
        .status(400)
        .json({ error: "At least one transfer item is required" });

    const userEmail = req.user?.email || null;
    const tDate = TransferDate || new Date().toISOString().slice(0, 10);

    // ── Validate available stock per item in FromGodown ──────────────────────
    // Informational at this stage — the authoritative check happens again at
    // approval time, since availability can change while this is Pending.
    for (const item of items) {
      if (!item.itemId || !(Number(item.qty) > 0))
        return res
          .status(400)
          .json({ error: `Invalid item entry: itemId=${item.itemId} qty=${item.qty}` });
    }
    for (const item of demandByItem(items)) {
      const { itemId, qty } = item;
      const avail = await pool
        .request()
        .input("itemId", sql.NVarChar(100), String(itemId))
        .input("godownId", sql.Int, parseInt(FromGodownID)).query(`
          SELECT ISNULL(SUM(CASE WHEN Type='IN' THEN Qty ELSE -Qty END), 0) AS Available
          FROM dbo.StockLedger
          WHERE ItemID = @itemId AND GodownID = @godownId
        `);

      const available = Number(avail.recordset[0].Available || 0);
      if (available < Number(qty))
        return res.status(400).json({
          error: `Insufficient stock for item ${item.itemName || itemId}: available=${available}, requested=${qty}`,
        });
    }

    // ── Build a doc number (simple sequential: TRF-YYYYMMDD-N) ──────────────
    const countRes = await pool.request().query(`
      SELECT COUNT(1)+1 AS N FROM dbo.StockTransfers
      WHERE CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)
    `);
    const seq = String(countRes.recordset[0].N).padStart(3, "0");
    const ymd = tDate.replace(/-/g, "");
    const docNo = `TRF-${ymd}-${seq}`;

    // ── Insert StockTransfers header — Draft, no ledger rows yet ─────────────
    const insertRes = await pool
      .request()
      .input("DocNo", sql.NVarChar(100), docNo)
      .input("TransferDate", sql.Date, tDate)
      .input("FromGodownID", sql.Int, parseInt(FromGodownID))
      .input("ToGodownID", sql.Int, parseInt(ToGodownID))
      .input("TransferItems", sql.NVarChar(sql.MAX), JSON.stringify(items))
      .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
      .input("CreatedBy", sql.NVarChar(255), userEmail).query(`
        INSERT INTO dbo.StockTransfers
          (DocNo, TransferDate, FromGodownID, ToGodownID, TransferItems, Remarks, Status, CreatedBy)
        OUTPUT INSERTED.TransferID
        VALUES
          (@DocNo, @TransferDate, @FromGodownID, @ToGodownID, @TransferItems, @Remarks, 'Draft', @CreatedBy)
      `);
    const transferId = insertRes.recordset[0].TransferID;

    await bumpCacheVersion("stock-transfers");

    // Auto-submit: transition Draft → Pending immediately so no manual
    // "Submit" step is required after creation (same pattern as Material
    // Requests / Vehicle In-Out). Non-fatal — record is saved either way.
    try {
      await transition("stock-transfers", transferId, "Pending", userEmail, req.user?.role);
    } catch (submitErr) {
      console.warn("[stock-transfers] auto-submit failed (non-fatal):", submitErr.message);
    }

    res.status(201).json({
      TransferID: transferId,
      DocNo: docNo,
      message: "Stock transfer created and submitted for approval",
    });
  } catch (err) {
    console.error("[stock-transfers] POST /:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── PUT /:id/submit — Draft/Rejected → Pending ────────────────────────────────
// Records are auto-submitted on creation; this is only needed to re-submit
// after a rejection (or as a fallback if auto-submit failed).
router.put("/:id/submit", requirePageRight("stock-transfers", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const result = await transition("stock-transfers", id, "Pending", req.user?.email, req.user?.role);
    await bumpCacheVersion("stock-transfers");
    res.json({ message: "Submitted for approval", ...result });
  } catch (err) {
    res.status(err.status || (err.message.includes("not authorized") ? 403 : 400)).json({ error: err.message });
  }
});

// ── PUT /:id/approve — posts stock on final approval ──────────────────────────
// No requirePageRight gate — transition() is the real authority (role
// whitelist / approval-inbox edit right / named workflow approver); the
// page-right gate used to 403 a named approver before transition() ever
// ran, same bug fixed for journal-voucher.js.
router.put("/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const pool = getPool();
  try {
    const result = await transition("stock-transfers", id, "Approved", req.user?.email, req.user?.role, null, req.user?.userId ?? req.user?.id ?? null);

    // Only once the record is genuinely fully approved (transition() itself
    // is the authority on this — it already accounts for multi-level and
    // "everyone must approve" steps) does the actual stock movement happen.
    let postWarning = null;
    if (result.newStatus === "Approved") {
      const transaction = pool.transaction();
      await transaction.begin();
      try {
        // Lock the row so two concurrent final approvals can't both see
        // PostedToStock=0 and both post (double OUT/IN movement).
        const headerRes = await transaction
          .request()
          .input("id", sql.Int, id)
          .query(
            `SELECT TransferID, DocNo, FromGodownID, ToGodownID, TransferItems, PostedToStock
             FROM dbo.StockTransfers WITH (UPDLOCK, HOLDLOCK) WHERE TransferID=@id`,
          );
        const header = headerRes.recordset[0];
        if (!header) throw new Error("Stock transfer not found");

        if (!header.PostedToStock) {
          const items = parseItems(header.TransferItems);

          // Re-validate availability — time has passed since submission and
          // stock could have moved elsewhere in the meantime.
          for (const item of demandByItem(items)) {
            const { itemId, qty } = item;
            const avail = await transaction
              .request()
              .input("itemId", sql.NVarChar(100), String(itemId))
              .input("godownId", sql.Int, header.FromGodownID).query(`
                SELECT ISNULL(SUM(CASE WHEN Type='IN' THEN Qty ELSE -Qty END), 0) AS Available
                FROM dbo.StockLedger
                WHERE ItemID = @itemId AND GodownID = @godownId
              `);
            const available = Number(avail.recordset[0].Available || 0);
            if (available < Number(qty))
              throw new Error(
                `Insufficient stock for item ${item.itemName || itemId}: available=${available}, requested=${qty}`,
              );
          }

          for (const item of items) {
            const itemId = String(item.itemId);
            const qty = Number(item.qty);
            const uom = item.uom || null;

            await transaction
              .request()
              .input("ItemID", sql.NVarChar(50), itemId)
              .input("Qty", sql.Decimal(18, 2), qty)
              .input("UOM", sql.NVarChar(20), uom)
              .input("GodownID", sql.Int, header.FromGodownID)
              .input("DocNo", sql.NVarChar(100), header.DocNo)
              .input("RefID", sql.Int, id).query(`
                INSERT INTO dbo.StockLedger (ItemID,Qty,UOM,Type,RefType,RefID,GodownID,DocNo,CreatedDate)
                VALUES (@ItemID,@Qty,@UOM,'OUT','TRF',@RefID,@GodownID,@DocNo,GETDATE())
              `);

            await transaction
              .request()
              .input("ItemID", sql.NVarChar(50), itemId)
              .input("Qty", sql.Decimal(18, 2), qty)
              .input("UOM", sql.NVarChar(20), uom)
              .input("GodownID", sql.Int, header.ToGodownID)
              .input("DocNo", sql.NVarChar(100), header.DocNo)
              .input("RefID", sql.Int, id).query(`
                INSERT INTO dbo.StockLedger (ItemID,Qty,UOM,Type,RefType,RefID,GodownID,DocNo,CreatedDate)
                VALUES (@ItemID,@Qty,@UOM,'IN','TRF',@RefID,@GodownID,@DocNo,GETDATE())
              `);
          }

          await transaction
            .request()
            .input("id", sql.Int, id)
            .query(`UPDATE dbo.StockTransfers SET PostedToStock = 1 WHERE TransferID = @id`);
        }

        await transaction.commit();
      } catch (postErr) {
        try {
          await transaction.rollback();
        } catch {}
        // The approval itself already committed via transition() above — do
        // not fail the request over this, but surface it clearly so it can
        // be reconciled (same tolerance the GL-posting modules use for a
        // post-approval posting failure).
        console.error(`[stock-transfers] stock posting failed for #${id} after approval:`, postErr.message);
        postWarning = `Approved, but stock could not be posted: ${postErr.message}`;
      }
    }

    await bumpCacheVersion("stock-transfers");
    await bumpCacheVersion("inventory-master");
    res.json({ message: "Stock transfer approved", ...result, ...(postWarning ? { warning: postWarning } : {}) });
  } catch (err) {
    res.status(err.status || (err.message.includes("not authorized") ? 403 : 400)).json({ error: err.message });
  }
});

// ── PUT /:id/reject ────────────────────────────────────────────────────────────
// Nothing was ever posted to StockLedger before approval, so there is
// nothing to reverse here.
router.put("/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const { note } = req.body || {};
    const result = await transition("stock-transfers", id, "Rejected", req.user?.email, req.user?.role, note || null, req.user?.userId ?? req.user?.id ?? null);
    await bumpCacheVersion("stock-transfers");
    res.json({ message: "Stock transfer rejected", ...result });
  } catch (err) {
    res.status(err.status || (err.message.includes("not authorized") ? 403 : 400)).json({ error: err.message });
  }
});

// ─── GET single transfer ──────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, parseInt(req.params.id)).query(`
        SELECT st.*, fg.GodownName AS FromGodownName, tg.GodownName AS ToGodownName
        FROM dbo.StockTransfers st
        JOIN dbo.Godowns fg ON fg.GodownID = st.FromGodownID
        JOIN dbo.Godowns tg ON tg.GodownID = st.ToGodownID
        WHERE st.TransferID = @id
      `);
    if (!result.recordset.length)
      return res.status(404).json({ error: "Transfer not found" });
    const row = {
      ...result.recordset[0],
      TransferItems: parseItems(result.recordset[0].TransferItems),
    };
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;