const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { transition } = require("../services/approvalService");

router.use(checkPermissionForMethod("Material", "StockTransfer"));

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

    let where = "WHERE 1=1";
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

// ─── POST create transfer ─────────────────────────────────────────────────────
// Validates stock availability up front (fast feedback), but no longer moves
// any stock here — the record is created as a Draft and auto-submitted for
// approval; the actual StockLedger IN/OUT rows are only written once the
// transfer is fully approved (see PUT /:id/approve below), so an approval
// workflow configured for it genuinely gates the stock movement instead of
// the movement already having happened before anyone could approve it.
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
      const { itemId, qty } = item;
      if (!itemId || !(Number(qty) > 0))
        return res
          .status(400)
          .json({ error: `Invalid item entry: itemId=${itemId} qty=${qty}` });

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
          for (const item of items) {
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