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
const { reversePostingBySource } = require("../services/generalLedger");

// Idempotent schema migration — adds GST columns if missing (safe to run every
// startup; IF NOT EXISTS pattern avoids errors on already-updated DBs).
async function ensureIctGstColumns(pool) {
  try {
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                     WHERE TABLE_NAME='InterCompanyTransferItems' AND COLUMN_NAME='GstPct')
        ALTER TABLE dbo.InterCompanyTransferItems ADD GstPct DECIMAL(5,2) NULL;

      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                     WHERE TABLE_NAME='InterCompanyTransferItems' AND COLUMN_NAME='GstAmount')
        ALTER TABLE dbo.InterCompanyTransferItems ADD GstAmount DECIMAL(18,2) NULL;

      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                     WHERE TABLE_NAME='InterCompanyTransferItems' AND COLUMN_NAME='AmountInclGst')
        ALTER TABLE dbo.InterCompanyTransferItems ADD AmountInclGst DECIMAL(18,2) NULL;

      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                     WHERE TABLE_NAME='InterCompanyTransferItems' AND COLUMN_NAME='SortOrder')
        ALTER TABLE dbo.InterCompanyTransferItems ADD SortOrder INT NULL;

      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                     WHERE TABLE_NAME='InterCompanyTransfer' AND COLUMN_NAME='TotalGstAmount')
        ALTER TABLE dbo.InterCompanyTransfer ADD TotalGstAmount DECIMAL(18,2) NULL;

      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                     WHERE TABLE_NAME='InterCompanyTransfer' AND COLUMN_NAME='TotalAmountInclGst')
        ALTER TABLE dbo.InterCompanyTransfer ADD TotalAmountInclGst DECIMAL(18,2) NULL;
    `);
  } catch (err) {
    console.warn("[ICT] GST column migration warning (non-fatal):", err.message);
  }
}

// Run migration once at module load time (pool may not be ready yet — the
// getPool() call inside will connect lazily on first request if needed, so
// we defer by one event-loop tick to let the connection pool initialise).
setImmediate(async () => {
  try { await ensureIctGstColumns(getPool()); }
  catch (e) { /* pool not ready yet — migration will be skipped; it will
                  re-run on next deploy */ }
});

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
// item more recently). Returns excl-GST rate + GST breakdown per item.
// applyGst=false is a real business choice (not just a display preference)
// — some inter-company movements genuinely aren't a taxable supply — so it
// zeroes the GST component entirely rather than just hiding it: gstPct/
// gstAmount come back 0 and amountInclGst equals the excl-GST amount.
//
// An item with no purchase history anywhere under the sending company used
// to hard-fail the whole preview/create call — one such item blocked
// pricing every other, perfectly priceable, item on the same transfer.
// Now it prices at 0 with needsManualRate: true instead, so /preview can
// still show every other item; the caller passes manualRate (and, if it
// matters, manualGstPct) once the user's typed one in, and this same
// function re-prices that item for real on the next call. POST / (actual
// creation) still refuses to create anything while any item is still
// unpriced — see its own check after calling this.
async function priceItems(pool, senderCompanyId, senderCompanyName, items, applyGst = true) {
  const pricedItems = [];
  for (const [idx, item] of items.entries()) {
    const itemId = item.itemId || item.ItemId || item.ItemID;
    const qty = Number(item.qty ?? item.Quantity ?? item.quantity);
    if (!itemId || !(qty > 0)) {
      const err = new Error(`Invalid item at line ${idx + 1}.`);
      err.status = 400;
      throw err;
    }
    const manualRate = Number(item.manualRate ?? item.ManualRate);
    const rateInfo = await getLastPurchaseRateByCompany(pool, senderCompanyId, itemId);

    let rate, gstPct, sourceDocNo, needsManualRate;
    if (rateInfo) {
      rate = Number(rateInfo.rate);
      gstPct = applyGst ? Number(rateInfo.gstPct || 0) : 0;
      sourceDocNo = rateInfo.sourceDocNo || null;
      needsManualRate = false;
    } else if (Number.isFinite(manualRate) && manualRate > 0) {
      rate = manualRate;
      gstPct = applyGst ? Number(item.manualGstPct ?? item.ManualGstPct ?? 0) || 0 : 0;
      sourceDocNo = "Manual entry — no purchase history found";
      needsManualRate = false;
    } else {
      rate = 0;
      gstPct = 0;
      sourceDocNo = null;
      needsManualRate = true;
    }

    const baseAmt  = Math.round(qty * rate * 100) / 100;
    const gstAmt   = Math.round(baseAmt * (gstPct / 100) * 100) / 100;
    pricedItems.push({
      itemId:       String(itemId),
      itemName:     item.itemName || item.ItemName || null,
      itemCode:     item.itemCode || item.ItemCode || null,
      description:  item.description || item.itemName || item.ItemName || null,
      quantity:     qty,
      qty,
      unit:         item.uom || item.Unit || item.unit || "NOS",
      uom:          item.uom || item.Unit || item.unit || "NOS",
      rate,
      amount:       baseAmt,          // excl. GST
      gstPct,
      gstAmount:    gstAmt,
      amountInclGst: Math.round((baseAmt + gstAmt) * 100) / 100,
      sourceDocNo,
      needsManualRate,
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
    // GL posts the real transacted amount, GST included when this transfer
    // actually applied it (TotalAmountInclGst equals TotalAmount when it
    // didn't) — falls back to TotalAmount for pre-GST-column rows.
    totalAmount: Number(ictRow.TotalAmountInclGst ?? ictRow.TotalAmount),
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
    // Optional company overrides — used when a project is cross-tagged to a
    // company that isn't its primary company_id (e.g. Pristine Enclave tagged
    // to Delta Gardens). The override governs GL posting; purchase rate
    // lookup still uses the project's own company for accurate pricing.
    const senderCompanyOverrideId = parsePositiveInt(req.body.SenderCompanyId);
    const receiverCompanyOverrideId = parsePositiveInt(req.body.ReceiverCompanyId);
    const items = asItems(req.body.Items || req.body.TransferItems);
    // Whether this transfer is a taxable supply at all — defaults to true;
    // pass ApplyGst: false when it genuinely isn't (see priceItems).
    const applyGst = req.body.ApplyGst !== false;

    if (!senderProjectId || !receiverProjectId) {
      return res.status(400).json({ error: "SenderProjectId and ReceiverProjectId are required." });
    }
    if (!items.length) {
      return res.json({ items: [], totalAmount: 0 });
    }

    const ctx = await resolveTransferContext(pool, { senderProjectId, receiverProjectId });

    // Resolve override company names if IDs were supplied
    let senderCompanyId = ctx.sender.CompanyId;
    let senderCompanyName = ctx.sender.CompanyName;
    let receiverCompanyId = ctx.receiver.CompanyId;
    let receiverCompanyName = ctx.receiver.CompanyName;

    if (senderCompanyOverrideId && senderCompanyOverrideId !== senderCompanyId) {
      const overrideRes = await pool.request()
        .input("Id", sql.Int, senderCompanyOverrideId)
        .query("SELECT id, name FROM dbo.enterprise WHERE id = @Id");
      if (overrideRes.recordset[0]) {
        senderCompanyId = overrideRes.recordset[0].id;
        senderCompanyName = overrideRes.recordset[0].name;
      }
    }
    if (receiverCompanyOverrideId && receiverCompanyOverrideId !== receiverCompanyId) {
      const overrideRes = await pool.request()
        .input("Id", sql.Int, receiverCompanyOverrideId)
        .query("SELECT id, name FROM dbo.enterprise WHERE id = @Id");
      if (overrideRes.recordset[0]) {
        receiverCompanyId = overrideRes.recordset[0].id;
        receiverCompanyName = overrideRes.recordset[0].name;
      }
    }

    const pricedItems = await priceItems(pool, ctx.sender.CompanyId, ctx.sender.CompanyName, items, applyGst);
    const totalAmount       = Math.round(pricedItems.reduce((s, i) => s + i.amount, 0) * 100) / 100;
    const totalGstAmount    = Math.round(pricedItems.reduce((s, i) => s + (i.gstAmount || 0), 0) * 100) / 100;
    const totalAmountInclGst = Math.round((totalAmount + totalGstAmount) * 100) / 100;

    res.json({
      items: pricedItems,
      totalAmount,
      totalGstAmount,
      totalAmountInclGst,
      applyGst,
      senderCompanyId,
      senderCompanyName,
      receiverCompanyId,
      receiverCompanyName,
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
    const senderCompanyOverrideId = parsePositiveInt(req.body.SenderCompanyId);
    const receiverCompanyOverrideId = parsePositiveInt(req.body.ReceiverCompanyId);
    const items = asItems(req.body.Items || req.body.TransferItems);
    const finYear = req.body.finYear || req.body.FinYear || null;
    const remarks = req.body.Remarks || null;
    const applyGst = req.body.ApplyGst !== false;

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

    // Apply company overrides (cross-tagged project support)
    let senderCompanyId = ctx.sender.CompanyId;
    let receiverCompanyId = ctx.receiver.CompanyId;
    if (senderCompanyOverrideId && senderCompanyOverrideId !== senderCompanyId) {
      const r = await pool.request().input("Id", sql.Int, senderCompanyOverrideId)
        .query("SELECT id FROM dbo.enterprise WHERE id = @Id");
      if (r.recordset[0]) senderCompanyId = senderCompanyOverrideId;
    }
    if (receiverCompanyOverrideId && receiverCompanyOverrideId !== receiverCompanyId) {
      const r = await pool.request().input("Id", sql.Int, receiverCompanyOverrideId)
        .query("SELECT id FROM dbo.enterprise WHERE id = @Id");
      if (r.recordset[0]) receiverCompanyId = receiverCompanyOverrideId;
    }

    const pricedItems = await priceItems(pool, ctx.sender.CompanyId, ctx.sender.CompanyName, items, applyGst);
    const unpriced = pricedItems.filter((i) => i.needsManualRate);
    if (unpriced.length) {
      return res.status(400).json({
        error: `No purchase history found for ${unpriced.map((i) => i.itemName || i.itemId).join(", ")} under ${ctx.sender.CompanyName} — enter a rate manually for ${unpriced.length === 1 ? "it" : "them"} before submitting.`,
      });
    }
    const totalAmount        = Math.round(pricedItems.reduce((s, i) => s + i.amount, 0) * 100) / 100;
    const totalGstAmount     = Math.round(pricedItems.reduce((s, i) => s + (i.gstAmount || 0), 0) * 100) / 100;
    const totalAmountInclGst = Math.round((totalAmount + totalGstAmount) * 100) / 100;


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
        .input("SenderCompanyId", sql.Int, senderCompanyId)
        .input("ReceiverProjectId", sql.Int, ctx.receiver.ProjectId)
        .input("ReceiverCompanyId", sql.Int, receiverCompanyId)
        .input("TotalAmount", sql.Decimal(18, 2), totalAmount)
        .input("TotalGstAmount", sql.Decimal(18, 2), totalGstAmount)
        .input("TotalAmountInclGst", sql.Decimal(18, 2), totalAmountInclGst)
        .input("Remarks", sql.NVarChar(500), remarks)
        .input("DocTypeId", sql.Int, ictDocTypeId)
        .input("CreatedBy", sql.NVarChar(150), createdBy).query(`
          INSERT INTO dbo.InterCompanyTransfer
            (DocNo, TransferDate, SenderProjectId, SenderCompanyId, ReceiverProjectId, ReceiverCompanyId,
             Status, TotalAmount, TotalGstAmount, TotalAmountInclGst, Remarks, DocTypeId, CreatedBy)
          OUTPUT INSERTED.ICTId
          VALUES
            (@DocNo, @TransferDate, @SenderProjectId, @SenderCompanyId, @ReceiverProjectId, @ReceiverCompanyId,
             'Draft', @TotalAmount, @TotalGstAmount, @TotalAmountInclGst, @Remarks, @DocTypeId, @CreatedBy)
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
          .input("GstPct", sql.Decimal(5, 2), item.gstPct || 0)
          .input("GstAmount", sql.Decimal(18, 2), item.gstAmount || 0)
          .input("AmountInclGst", sql.Decimal(18, 2), item.amountInclGst || item.amount)
          .input("SourceDocNo", sql.NVarChar(100), item.sourceDocNo)
          .input("SortOrder", sql.Int, idx).query(`
            INSERT INTO dbo.InterCompanyTransferItems
              (ICTId, ItemId, ItemName, UOMCode, Quantity, Rate, Amount,
               GstPct, GstAmount, AmountInclGst, SourceDocNo, SortOrder)
            VALUES
              (@ICTId, @ItemId, @ItemName, @UOMCode, @Quantity, @Rate, @Amount,
               @GstPct, @GstAmount, @AmountInclGst, @SourceDocNo, @SortOrder)
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
      TotalGstAmount: totalGstAmount,
      TotalAmountInclGst: totalAmountInclGst,
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

    // Explicit column list (no `ict.*`) so the ISNULL-wrapped GST columns
    // below don't collide with their own raw names from the header table —
    // a duplicate-named column pair is technically legal in a SQL Server
    // result set, but there's no reason to rely on the driver picking the
    // right one of two same-named keys when building the row object.
    const header = await pool.request().input("id", sql.Int, id).query(`
      SELECT ict.ICTId, ict.DocNo, ict.TransferDate,
             ict.SenderProjectId, ict.SenderCompanyId,
             ict.ReceiverProjectId, ict.ReceiverCompanyId,
             ict.Status, ict.TotalAmount,
             ISNULL(ict.TotalGstAmount, 0)    AS TotalGstAmount,
             ISNULL(ict.TotalAmountInclGst, ict.TotalAmount) AS TotalAmountInclGst,
             ict.Remarks, ict.SaleOrderId, ict.SaleInvoiceId, ict.ReceivedPaymentId,
             ict.PurchaseOrderId, ict.GRNId, ict.ExpenseBookingId, ict.NewPaymentId,
             ict.DocTypeId, ict.CreatedBy, ict.CreatedAt,
             sp.name AS SenderProjectName,     sc.name AS SenderCompanyName,
             rp.name AS ReceiverProjectName,   rc.name AS ReceiverCompanyName
      FROM dbo.InterCompanyTransfer ict
      LEFT JOIN dbo.enterprise sp ON sp.id = ict.SenderProjectId
      LEFT JOIN dbo.enterprise sc ON sc.id = ict.SenderCompanyId
      LEFT JOIN dbo.enterprise rp ON rp.id = ict.ReceiverProjectId
      LEFT JOIN dbo.enterprise rc ON rc.id = ict.ReceiverCompanyId
      WHERE ict.ICTId = @id
    `);
    if (!header.recordset.length) return res.status(404).json({ error: "Not found" });

    const items = await pool.request().input("id", sql.Int, id).query(`
      SELECT ICTItemId, ItemId, ItemName, UOMCode, Quantity, Rate, Amount,
             ISNULL(GstPct, 0)       AS GstPct,
             ISNULL(GstAmount, 0)    AS GstAmount,
             ISNULL(AmountInclGst, Amount) AS AmountInclGst,
             SourceDocNo,
             ISNULL(SortOrder, 0)   AS SortOrder
      FROM dbo.InterCompanyTransferItems
      WHERE ICTId = @id
      ORDER BY ISNULL(SortOrder, 0), ICTItemId
    `);

    res.json({ ...header.recordset[0], items: items.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/posting — the two-sided GL voucher this transfer posts/posted
// (Dr Inter-Company A/c — receivable / Cr Inter-Company Stock Transfer A/c
// in the sender's books, mirrored in the receiver's — see
// postInterCompanyStockTransferToGL), grouped by company same as
// fundTransfer.js's own /:id/posting. Real entries once Completed;
// otherwise just tells the UI nothing has posted yet.
router.get("/:id/posting", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });

    const ictRes = await pool.request().input("id", sql.Int, id).query(`
      SELECT ict.ICTId, ict.DocNo, ict.Status,
             ISNULL(ict.TotalAmountInclGst, ict.TotalAmount) AS Amount,
             sc.name AS SenderCompanyName, rc.name AS ReceiverCompanyName
      FROM dbo.InterCompanyTransfer ict
      LEFT JOIN dbo.enterprise sc ON sc.id = ict.SenderCompanyId
      LEFT JOIN dbo.enterprise rc ON rc.id = ict.ReceiverCompanyId
      WHERE ict.ICTId = @id
    `);
    if (!ictRes.recordset.length) return res.status(404).json({ error: "Not found" });
    const ict = ictRes.recordset[0];

    const postedRes = await pool.request().input("id", sql.Int, id).query(`
      SELECT gle.VoucherNo, gle.CompanyId, gle.DebitAmount, gle.CreditAmount,
             ah.LHeadName, ent.name AS CompanyName
      FROM dbo.GeneralLedgerEntry gle
      JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = gle.LHeadId
      LEFT JOIN dbo.enterprise ent ON ent.id = gle.CompanyId
      WHERE gle.SourceType = 'InterCompanyTransfer' AND gle.SourceId = @id AND gle.IsReversed = 0
      ORDER BY gle.CompanyId, gle.EntryId
    `);
    const isPosted = postedRes.recordset.length > 0;

    let vouchers;
    if (isPosted) {
      const byCompany = new Map();
      for (const row of postedRes.recordset) {
        const key = row.CompanyId ?? "none";
        if (!byCompany.has(key)) {
          byCompany.set(key, { jvNo: row.VoucherNo, companyName: row.CompanyName, rows: [] });
        }
        byCompany.get(key).rows.push({
          label: row.LHeadName,
          side: Number(row.DebitAmount) > 0 ? "debit" : "credit",
          amount: Number(row.DebitAmount) > 0 ? Number(row.DebitAmount) : Number(row.CreditAmount),
        });
      }
      vouchers = [...byCompany.values()];
    } else {
      // Preview only — the real ledger heads are get-or-create'd at posting
      // time (postInterCompanyStockTransferToGL), so this just names them
      // generically rather than guessing whether they already exist.
      vouchers = [
        {
          jvNo: null,
          companyName: ict.SenderCompanyName,
          rows: [
            { label: `Inter-Company A/c — ${ict.ReceiverCompanyName || "Receiver"}`, side: "debit", amount: Number(ict.Amount) || 0 },
            { label: `Inter-Company Stock Transfer — ${ict.SenderCompanyName || "Sender"}`, side: "credit", amount: Number(ict.Amount) || 0 },
          ],
        },
        {
          jvNo: null,
          companyName: ict.ReceiverCompanyName,
          rows: [
            { label: `Inter-Company Stock Transfer — ${ict.ReceiverCompanyName || "Receiver"}`, side: "debit", amount: Number(ict.Amount) || 0 },
            { label: `Inter-Company A/c — ${ict.SenderCompanyName || "Sender"}`, side: "credit", amount: Number(ict.Amount) || 0 },
          ],
        },
      ];
    }

    res.json({
      docNo: ict.DocNo,
      status: ict.Status,
      amount: Number(ict.Amount) || 0,
      senderCompanyName: ict.SenderCompanyName,
      receiverCompanyName: ict.ReceiverCompanyName,
      isPosted,
      vouchers,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id — any status is deletable; Completed reverses the stock
// move and the two-sided GL voucher first, same convention journal-
// voucher.js's DELETE uses (reversePostingBySource flips IsReversed rather
// than deleting the ledger rows, preserving the audit trail). Draft/Pending/
// Rejected never touched StockLedger/GL, so there's nothing to reverse for
// them — just remove the request.
router.delete("/:id", authenticateToken, requirePageRight("stock-transfers", "delete"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });

    const headerRes = await pool.request().input("id", sql.Int, id)
      .query("SELECT * FROM dbo.InterCompanyTransfer WHERE ICTId = @id");
    const ictRow = headerRes.recordset[0];
    if (!ictRow) return res.status(404).json({ error: "Not found" });

    if (ictRow.Status === "Completed") {
      const itemRows = await pool.request().input("id", sql.Int, id).query(`
        SELECT ItemId, Quantity FROM dbo.InterCompanyTransferItems WHERE ICTId = @id
      `);

      // Guard against pushing the receiver's godown negative — if any of
      // this transfer's stock has already been consumed downstream (issued
      // out, transferred again, etc.), un-doing the original IN movement
      // here would leave that later consumption unbacked.
      const receiverGodown = await getProjectGodown(pool, ictRow.ReceiverProjectId);
      if (receiverGodown) {
        for (const item of itemRows.recordset) {
          const avail = await pool.request()
            .input("itemId", sql.NVarChar(100), String(item.ItemId))
            .input("godownId", sql.Int, receiverGodown.GodownID).query(`
              SELECT ISNULL(SUM(CASE WHEN Type='IN' THEN Qty ELSE -Qty END), 0) AS Available
              FROM dbo.StockLedger
              WHERE ItemID = @itemId AND GodownID = @godownId
            `);
          const available = Number(avail.recordset[0].Available || 0);
          if (available < Number(item.Quantity)) {
            return res.status(409).json({
              error: `Cannot delete — item ${item.ItemId} has already been partly consumed from the receiver's godown (available=${available}, transferred=${item.Quantity}). Reverse those downstream movements first.`,
            });
          }
        }
      }

      await pool.request().input("RefID", sql.Int, id)
        .query("DELETE FROM dbo.StockLedger WHERE RefType = 'ICT' AND RefID = @RefID");

      await reversePostingBySource(pool, "InterCompanyTransfer", id);
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request().input("id", sql.Int, id)
        .query("DELETE FROM dbo.InterCompanyTransferItems WHERE ICTId = @id");
      await tx.request().input("id", sql.Int, id)
        .query("DELETE FROM dbo.InterCompanyTransfer WHERE ICTId = @id");
      await tx.commit();
    } catch (txErr) {
      try { await tx.rollback(); } catch {}
      throw txErr;
    }

    await Promise.all([
      bumpCacheVersion("stock-transfers"),
      bumpCacheVersion("inventory-master"),
      bumpCacheVersion("trial-balance"),
      bumpCacheVersion("general-ledger"),
      bumpCacheVersion("balance-sheet"),
      bumpCacheVersion("account-head-master"),
    ]);

    res.json({
      message:
        ictRow.Status === "Completed"
          ? "Deleted — stock movement and GL voucher reversed"
          : "Deleted",
    });
  } catch (err) {
    console.error("[inter-company-transfer] DELETE /:id:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
