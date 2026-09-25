const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");

router.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    validate: false,
    message: { error: "Too many requests, please try again later." },
  }),
);

const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { bumpCacheVersion } = require("../redis");
const { resolveDocTypeId, lockNextDocNumber, backPatchRecordId } = require("../utils/docNumberLock");
const { transition } = require("../services/approvalService");
const { getLastPurchaseRateByCompany } = require("../services/lastPurchaseRate");
const { postInterCompanyStockTransferToGL } = require("../services/interCompanyStockTransferGL");

function parsePositiveInt(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function asItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) return JSON.parse(raw);
  return [];
}

function userEmail(req) {
  return req.user?.email || req.user?.name || "system";
}

async function getProject(pool, projectId) {
  const result = await pool
    .request()
    .input("ProjectId", sql.Int, projectId).query(`
      SELECT p.id AS ProjectId, p.name AS ProjectName, p.company_id AS CompanyId,
             c.name AS CompanyName, c.gst_no AS CompanyGST
      FROM dbo.enterprise p
      LEFT JOIN dbo.enterprise c ON c.id = p.company_id
      WHERE p.id = @ProjectId AND p.business_type = 'P'
    `);
  return result.recordset[0] || null;
}

async function getProjectGodown(pool, projectId) {
  const result = await pool
    .request()
    .input("ProjectId", sql.Int, projectId).query(`
      SELECT TOP 1 GodownID, GodownName
      FROM dbo.Godowns
      WHERE ProjectID = @ProjectId AND IsDeleted = 0 AND IsActive = 1
      ORDER BY IsMain DESC, GodownID
    `);
  return result.recordset[0] || null;
}

router.get("/", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const { companyId, projectId, dateFrom, dateTo, status, limit = 100, page = 1 } = req.query;
    const request = pool.request();
    const where = [];

    if (companyId) {
      where.push("(ict.SenderCompanyId = @companyId OR ict.ReceiverCompanyId = @companyId)");
      request.input("companyId", sql.Int, parsePositiveInt(companyId));
    }
    if (projectId) {
      where.push("(ict.SenderProjectId = @projectId OR ict.ReceiverProjectId = @projectId)");
      request.input("projectId", sql.Int, parsePositiveInt(projectId));
    }
    if (status) {
      where.push("ict.Status = @status");
      request.input("status", sql.NVarChar(20), String(status));
    }
    if (dateFrom) {
      where.push("ict.TransferDate >= @dateFrom");
      request.input("dateFrom", sql.Date, dateFrom);
    }
    if (dateTo) {
      where.push("ict.TransferDate <= @dateTo");
      request.input("dateTo", sql.Date, dateTo);
    }

    const offset = (Math.max(parseInt(page, 10), 1) - 1) * Math.max(parseInt(limit, 10), 1);
    request.input("limit", sql.Int, Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500));
    request.input("offset", sql.Int, offset);

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const result = await request.query(`
      SELECT ict.*, sp.name AS SenderProjectName, sc.name AS SenderCompanyName,
             rp.name AS ReceiverProjectName, rc.name AS ReceiverCompanyName,
             COUNT(*) OVER() AS TotalRows
      FROM dbo.InterCompanyTransfer ict
      LEFT JOIN dbo.enterprise sp ON sp.id = ict.SenderProjectId
      LEFT JOIN dbo.enterprise sc ON sc.id = ict.SenderCompanyId
      LEFT JOIN dbo.enterprise rp ON rp.id = ict.ReceiverProjectId
      LEFT JOIN dbo.enterprise rc ON rc.id = ict.ReceiverCompanyId
      ${whereSql}
      ORDER BY ict.TransferDate DESC, ict.ICTId DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);
    const total = result.recordset[0]?.TotalRows ?? 0;
    res.json({ data: result.recordset.map(({ TotalRows, ...row }) => row), total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/summary", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    // Default to Completed only — a Pending/Rejected request never actually
    // moved stock or money, so counting it here would overstate real
    // inter-company transfer volume. Pass ?status= to see other statuses.
    const status = req.query.status || "Completed";
    const request = pool.request();
    let query = `
      SELECT YEAR(TransferDate) AS Year,
             COUNT(*) AS TransferCount,
             SUM(TotalAmount) AS TotalAmount
      FROM dbo.InterCompanyTransfer
    `;
    if (status !== "all") {
      request.input("status", sql.NVarChar(20), status);
      query += " WHERE Status = @status";
    }
    query += " GROUP BY YEAR(TransferDate) ORDER BY Year DESC";
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Re-resolves every entity needed to move stock + post GL for a transfer,
// either from a fresh POST body (creation time) or from a stored ICT header
// (approval time) — same shape either way.
async function resolveTransferContext(pool, { senderProjectId, receiverProjectId }) {
  const sender = await getProject(pool, senderProjectId);
  const receiver = await getProject(pool, receiverProjectId);
  if (!sender || !receiver) {
    const err = new Error("Sender or receiver project not found.");
    err.status = 404;
    throw err;
  }
  if (!sender.CompanyId || !receiver.CompanyId) {
    const err = new Error("Both projects must be linked to a company.");
    err.status = 400;
    throw err;
  }
  if (sender.CompanyId === receiver.CompanyId) {
    const err = new Error("Use normal Stock Transfer for same-company project moves.");
    err.status = 400;
    throw err;
  }

  const senderGodown = await getProjectGodown(pool, senderProjectId);
  const receiverGodown = await getProjectGodown(pool, receiverProjectId);
  if (!senderGodown || !receiverGodown) {
    const err = new Error("Both projects must have active project godowns.");
    err.status = 400;
    throw err;
  }

  return { sender, receiver, senderGodown, receiverGodown };
}

// Priced at the SENDING COMPANY's own most recent purchase rate — across
// every project that company owns, not just the one project the stock
// happens to be leaving from (a sibling project may have bought the same
// item more recently) — excluding GST, per getLastPurchaseRateByCompany.
async function priceItems(pool, senderCompanyId, senderCompanyName, items) {
  const pricedItems = [];
  for (const [idx, item] of items.entries()) {
    const itemId = item.itemId || item.ItemId || item.ItemID;
    const qty = Number(item.qty ?? item.Quantity ?? item.quantity);
    if (!itemId || !(qty > 0)) {
      const err = new Error(`Invalid item at line ${idx + 1}.`);
      err.status = 400;
      throw err;
    }
    const rateInfo = await getLastPurchaseRateByCompany(pool, senderCompanyId, itemId);
    if (!rateInfo) {
      const err = new Error(
        `No last purchase rate found for item ${item.itemName || itemId} anywhere under ${senderCompanyName}.`,
      );
      err.status = 400;
      throw err;
    }
    const rate = Number(rateInfo.rate);
    pricedItems.push({
      itemId: String(itemId),
      itemName: item.itemName || item.ItemName || null,
      itemCode: item.itemCode || item.ItemCode || null,
      description: item.description || item.itemName || item.ItemName || null,
      quantity: qty,
      qty,
      unit: item.uom || item.Unit || item.unit || "NOS",
      uom: item.uom || item.Unit || item.unit || "NOS",
      rate,
      amount: Math.round(qty * rate * 100) / 100,
      sourceDocNo: rateInfo.sourceDocNo || null,
    });
  }
  return pricedItems;
}

// Runs for an already-Approved ICT header: moves stock directly (no GRN/SO
// needed) and posts the two-sided GL voucher. Only called from
// PUT /:id/approve — no further manual steps after approval.
async function executeTransfer(pool, ctx, createdBy, opts = {}) {
  const { sender, receiver, senderGodown, receiverGodown, pricedItems, totalAmount, transferDate } = ctx;
  const { docNo = null, ictId = null } = opts;

  // Validate stock is actually available before moving anything.
  for (const item of pricedItems) {
    const avail = await pool.request()
      .input("itemId", sql.NVarChar(100), String(item.itemId))
      .input("godownId", sql.Int, senderGodown.GodownID).query(`
        SELECT ISNULL(SUM(CASE WHEN Type='IN' THEN Qty ELSE -Qty END), 0) AS Available
        FROM dbo.StockLedger
        WHERE ItemID = @itemId AND GodownID = @godownId
      `);
    const available = Number(avail.recordset[0].Available || 0);
    if (available < item.qty) {
      const err = new Error(
        `Insufficient stock for item ${item.itemName || item.itemId} in sender project ${sender.ProjectName}: available=${available}, requested=${item.qty}.`,
      );
      err.status = 400;
      throw err;
    }
  }

  // Credit the sender's godown OUT, debit the receiver's godown IN —
  // straight StockLedger movement, same shape stockTransfers.js already
  // uses for intra-company transfers. No GRN/SO/Invoice needed to move
  // stock between two godowns just because they sit under different
  // companies.
  for (const item of pricedItems) {
    await pool.request()
      .input("ItemID", sql.NVarChar(50), String(item.itemId))
      .input("Qty", sql.Decimal(18, 2), item.qty)
      .input("UOM", sql.NVarChar(20), item.uom || null)
      .input("RefID", sql.Int, ictId || 0)
      .input("GodownID", sql.Int, senderGodown.GodownID)
      .input("DocNo", sql.NVarChar(100), docNo).query(`
        INSERT INTO dbo.StockLedger (ItemID,Qty,UOM,Type,RefType,RefID,GodownID,DocNo,CreatedDate)
        VALUES (@ItemID,@Qty,@UOM,'OUT','ICT',@RefID,@GodownID,@DocNo,GETDATE())
      `);
    await pool.request()
      .input("ItemID", sql.NVarChar(50), String(item.itemId))
      .input("Qty", sql.Decimal(18, 2), item.qty)
      .input("UOM", sql.NVarChar(20), item.uom || null)
      .input("RefID", sql.Int, ictId || 0)
      .input("GodownID", sql.Int, receiverGodown.GodownID)
      .input("DocNo", sql.NVarChar(100), docNo).query(`
        INSERT INTO dbo.StockLedger (ItemID,Qty,UOM,Type,RefType,RefID,GodownID,DocNo,CreatedDate)
        VALUES (@ItemID,@Qty,@UOM,'IN','ICT',@RefID,@GodownID,@DocNo,GETDATE())
      `);
  }

  await postInterCompanyStockTransferToGL(pool, {
    transferId: ictId,
    docNo,
    transferDate,
    senderCompanyId: sender.CompanyId,
    senderCompanyName: sender.CompanyName,
    receiverCompanyId: receiver.CompanyId,
    receiverCompanyName: receiver.CompanyName,
    totalAmount,
    createdBy,
  });
}

// Loads an ICT header + its stored items back into the same context shape
// resolveTransferContext()/priceItems() produce at creation time, so
// executeTransfer() can run identically whether called fresh or from a
// later approval action.
async function loadStoredTransferContext(pool, ictRow) {
  const ctx = await resolveTransferContext(pool, {
    senderProjectId: ictRow.SenderProjectId,
    receiverProjectId: ictRow.ReceiverProjectId,
  });

  const itemRows = await pool.request().input("id", sql.Int, ictRow.ICTId).query(`
    SELECT ItemId, ItemName, UOMCode, Quantity, Rate, Amount, SourceDocNo
    FROM dbo.InterCompanyTransferItems
    WHERE ICTId = @id
    ORDER BY SortOrder, ICTItemId
  `);
  const pricedItems = itemRows.recordset.map((row) => ({
    itemId: row.ItemId,
    itemName: row.ItemName,
    itemCode: null,
    description: row.ItemName,
    quantity: Number(row.Quantity),
    qty: Number(row.Quantity),
    unit: row.UOMCode || "NOS",
    uom: row.UOMCode || "NOS",
    rate: Number(row.Rate),
    amount: Number(row.Amount),
    tax: 0,
    sourceDocNo: row.SourceDocNo,
  }));

  return {
    ...ctx,
    pricedItems,
    totalAmount: Number(ictRow.TotalAmount),
    transferDate: ictRow.TransferDate,
  };
}

// POST /preview — prices items at the sending company's most recent
// purchase rate (excl. GST) WITHOUT creating anything, so the form's
// Posting tab can show exactly what will be booked before the user submits.
router.post("/preview", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const senderProjectId = parsePositiveInt(req.body.SenderProjectId);
    const receiverProjectId = parsePositiveInt(req.body.ReceiverProjectId);
    const items = asItems(req.body.Items || req.body.TransferItems);

    if (!senderProjectId || !receiverProjectId) {
      return res.status(400).json({ error: "SenderProjectId and ReceiverProjectId are required." });
    }
    if (!items.length) {
      return res.json({ items: [], totalAmount: 0 });
    }

    const ctx = await resolveTransferContext(pool, { senderProjectId, receiverProjectId });
    const pricedItems = await priceItems(pool, ctx.sender.CompanyId, ctx.sender.CompanyName, items);
    const totalAmount = pricedItems.reduce((sum, item) => sum + item.amount, 0);

    res.json({
      items: pricedItems,
      totalAmount,
      senderCompanyId: ctx.sender.CompanyId,
      senderCompanyName: ctx.sender.CompanyName,
      receiverCompanyId: ctx.receiver.CompanyId,
      receiverCompanyName: ctx.receiver.CompanyName,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/", authenticateToken, requirePageRight("stock-transfers", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const createdBy = userEmail(req);
    const transferDate = req.body.TransferDate || new Date().toISOString().slice(0, 10);
    const senderProjectId = parsePositiveInt(req.body.SenderProjectId);
    const receiverProjectId = parsePositiveInt(req.body.ReceiverProjectId);
    const items = asItems(req.body.Items || req.body.TransferItems);
    const finYear = req.body.finYear || req.body.FinYear || null;
    const remarks = req.body.Remarks || null;

    if (!senderProjectId || !receiverProjectId) {
      return res.status(400).json({ error: "SenderProjectId and ReceiverProjectId are required." });
    }
    if (senderProjectId === receiverProjectId) {
      return res.status(400).json({ error: "Sender and receiver projects must differ." });
    }
    if (!items.length) {
      return res.status(400).json({ error: "At least one transfer item is required." });
    }

    const ctx = await resolveTransferContext(pool, { senderProjectId, receiverProjectId });
    const pricedItems = await priceItems(pool, ctx.sender.CompanyId, ctx.sender.CompanyName, items);
    const totalAmount = pricedItems.reduce((sum, item) => sum + item.amount, 0);

    // Only validate + record the request here — no stock/GL happens yet.
    // That only fires once a super_admin approves this request via
    // PUT /:id/approve, matching the same Draft -> Pending -> Approved gate
    // every other module already uses.
    const ictDocTypeId = await resolveDocTypeId(pool, sql, "ICT");
    const ictDocNo = await lockNextDocNumber(pool, sql, {
      docTypeId: ictDocTypeId,
      finYear,
      tableName: "InterCompanyTransfer",
      docNoColumn: "DocNo",
      issuedBy: createdBy,
    });

    const tx = pool.transaction();
    await tx.begin();
    let ictId;
    try {
      const header = await tx.request()
        .input("DocNo", sql.NVarChar(100), ictDocNo)
        .input("TransferDate", sql.Date, transferDate)
        .input("SenderProjectId", sql.Int, ctx.sender.ProjectId)
        .input("SenderCompanyId", sql.Int, ctx.sender.CompanyId)
        .input("ReceiverProjectId", sql.Int, ctx.receiver.ProjectId)
        .input("ReceiverCompanyId", sql.Int, ctx.receiver.CompanyId)
        .input("TotalAmount", sql.Decimal(18, 2), totalAmount)
        .input("Remarks", sql.NVarChar(500), remarks)
        .input("DocTypeId", sql.Int, ictDocTypeId)
        .input("CreatedBy", sql.NVarChar(150), createdBy).query(`
          INSERT INTO dbo.InterCompanyTransfer
            (DocNo, TransferDate, SenderProjectId, SenderCompanyId, ReceiverProjectId, ReceiverCompanyId,
             Status, TotalAmount, Remarks, DocTypeId, CreatedBy)
          OUTPUT INSERTED.ICTId
          VALUES
            (@DocNo, @TransferDate, @SenderProjectId, @SenderCompanyId, @ReceiverProjectId, @ReceiverCompanyId,
             'Draft', @TotalAmount, @Remarks, @DocTypeId, @CreatedBy)
        `);
      ictId = header.recordset[0].ICTId;

      for (const [idx, item] of pricedItems.entries()) {
        await tx.request()
          .input("ICTId", sql.Int, ictId)
          .input("ItemId", sql.NVarChar(50), item.itemId)
          .input("ItemName", sql.NVarChar(200), item.itemName)
          .input("UOMCode", sql.NVarChar(20), item.uom)
          .input("Quantity", sql.Decimal(18, 4), item.qty)
          .input("Rate", sql.Decimal(18, 4), item.rate)
          .input("Amount", sql.Decimal(18, 2), item.amount)
          .input("SourceDocNo", sql.NVarChar(100), item.sourceDocNo)
          .input("SortOrder", sql.Int, idx).query(`
            INSERT INTO dbo.InterCompanyTransferItems
              (ICTId, ItemId, ItemName, UOMCode, Quantity, Rate, Amount, SourceDocNo, SortOrder)
            VALUES
              (@ICTId, @ItemId, @ItemName, @UOMCode, @Quantity, @Rate, @Amount, @SourceDocNo, @SortOrder)
          `);
      }

      await tx.commit();
    } catch (err) {
      try { await tx.rollback(); } catch {}
      throw err;
    }
    await backPatchRecordId(pool, sql, ictDocNo, "InterCompanyTransfer", ictId);

    // Auto-submit Draft -> Pending immediately, matching journal-voucher.js
    // and grns.js's convention — no separate manual "Submit" step.
    try {
      await transition("inter-company-transfer", ictId, "Pending", createdBy, req.user?.role);
    } catch (submitErr) {
      console.warn("ICT auto-submit failed (non-fatal):", submitErr.message);
    }

    await bumpCacheVersion("stock-transfers");

    res.status(201).json({
      ICTId: ictId,
      DocNo: ictDocNo,
      TotalAmount: totalAmount,
      Status: "Pending",
      message: "Submitted for super_admin approval — stock will move and the GL voucher will post automatically once approved.",
    });
  } catch (err) {
    console.error("[inter-company-transfer] POST /:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── PUT /:id/approve — Pending → Approved (super_admin only); fires the
// direct stock move + two-sided GL voucher the moment full approval lands ──
// No requirePageRight gate — transition() is the real authority (role
// whitelist / approval-inbox edit right / named workflow approver); the
// page-right gate used to 403 a named approver before transition() ever
// ran, same bug fixed for journal-voucher.js.
router.put("/:id/approve", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    const createdBy = userEmail(req);

    const headerRes = await pool.request().input("id", sql.Int, id)
      .query("SELECT * FROM dbo.InterCompanyTransfer WHERE ICTId = @id");
    const ictRow = headerRes.recordset[0];
    if (!ictRow) return res.status(404).json({ error: "Not found" });

    const result = await transition("inter-company-transfer", id, "Approved", createdBy, req.user?.role, req.body?.note, req.user?.userId ?? req.user?.id ?? null);

    if (result.newStatus !== "Approved") {
      // Multi-level workflow, more approvals still required — no stock/GL yet.
      return res.json({ message: "Approval level recorded", ...result });
    }

    const ctx = await loadStoredTransferContext(pool, ictRow);
    await executeTransfer(pool, ctx, createdBy, {
      docNo: ictRow.DocNo,
      ictId: id,
    });

    await pool.request().input("id", sql.Int, id)
      .query("UPDATE dbo.InterCompanyTransfer SET Status = 'Completed' WHERE ICTId = @id");

    await Promise.all([
      bumpCacheVersion("stock-transfers"),
      bumpCacheVersion("inventory-master"),
      bumpCacheVersion("trial-balance"),
      bumpCacheVersion("general-ledger"),
      bumpCacheVersion("balance-sheet"),
      bumpCacheVersion("account-head-master"),
    ]);

    res.json({ message: "Approved — stock moved and GL posted", ICTId: id });
  } catch (err) {
    console.error("[inter-company-transfer] PUT /:id/approve:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── PUT /:id/reject — Pending → Rejected; no documents are ever generated ───
router.put("/:id/reject", authenticateToken, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });

    const result = await transition("inter-company-transfer", id, "Rejected", userEmail(req), req.user?.role, req.body?.note, req.user?.userId ?? req.user?.id ?? null);
    await bumpCacheVersion("stock-transfers");
    res.json({ message: "Rejected", ...result });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });

    const header = await pool.request().input("id", sql.Int, id).query(`
      SELECT ict.*, sp.name AS SenderProjectName, sc.name AS SenderCompanyName,
             rp.name AS ReceiverProjectName, rc.name AS ReceiverCompanyName
      FROM dbo.InterCompanyTransfer ict
      LEFT JOIN dbo.enterprise sp ON sp.id = ict.SenderProjectId
      LEFT JOIN dbo.enterprise sc ON sc.id = ict.SenderCompanyId
      LEFT JOIN dbo.enterprise rp ON rp.id = ict.ReceiverProjectId
      LEFT JOIN dbo.enterprise rc ON rc.id = ict.ReceiverCompanyId
      WHERE ict.ICTId = @id
    `);
    if (!header.recordset.length) return res.status(404).json({ error: "Not found" });

    const items = await pool.request().input("id", sql.Int, id).query(`
      SELECT *
      FROM dbo.InterCompanyTransferItems
      WHERE ICTId = @id
      ORDER BY SortOrder, ICTItemId
    `);

    res.json({ ...header.recordset[0], items: items.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
