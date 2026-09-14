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
const { postReceivedPaymentApproval } = require("../services/generalLedger");
const { getLastPurchaseRate } = require("../services/lastPurchaseRate");
const { createSaleOrderInternal } = require("./customerSaleOrders");
const { createSaleInvoiceInternal } = require("./saleInvoices");
const { createReceivedPaymentInternal } = require("./receivedPayment");
const { createPurchaseOrderInternal } = require("./purchaseOrders");
const { createGRNInternal } = require("./grns");
const { createExpenseBookingInternal } = require("./expenseBooking");

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

async function resolveDocType(pool, prefixes, linkLike = null) {
  const list = Array.isArray(prefixes) ? prefixes : [prefixes];
  for (const prefix of list) {
    try {
      return await resolveDocTypeId(pool, sql, prefix);
    } catch {
      /* try next option */
    }
  }
  if (!linkLike) return null;
  const result = await pool
    .request()
    .input("Link", sql.NVarChar(100), `%${linkLike}%`).query(`
      SELECT TOP 1 TypeOfDocId
      FROM dbo.TypeOfDoc
      WHERE IsActive = 1 AND links_to LIKE @Link
      ORDER BY TypeOfDocId
    `);
  return result.recordset[0]?.TypeOfDocId ?? null;
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

async function getProjectLedger(pool, projectId, type) {
  const suffix = type === "C" ? "CUST" : "SUPP";
  const result = await pool
    .request()
    .input("Code", sql.NVarChar(20), `PRJ-${projectId}-${suffix}`)
    .input("Type", sql.VarChar(50), type).query(`
      SELECT TOP 1 LHeadId, LHeadName
      FROM dbo.AccountHeadMaster
      WHERE LHeadCode = @Code AND LHeadType = @Type AND Status = 'Approved'
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

async function getDummyBank(pool) {
  const result = await pool.request().query(`
    SELECT TOP 1 LHeadId, LHeadName
    FROM dbo.AccountHeadMaster
    WHERE LHeadCode = 'DUMMY-BANK' AND Status = 'Approved'
  `);
  return result.recordset[0] || null;
}

async function createApprovedPayment(pool, payload, createdBy) {
  const {
    PPaymentName,
    PMode = "Cash",
    PAmount,
    PDate,
    PBankID,
    PBankName,
    PProject,
    PCompany,
    PExpenseRef,
    parentDocNo,
    rootExBDocNo,
  } = payload;

  const docTypeId = await resolveDocTypeId(pool, sql, "PAY");
  const finalDocNo = await lockNextDocNumber(pool, sql, {
    docTypeId,
    tableName: "NewPayment",
    docNoColumn: "DocNo",
    issuedBy: createdBy,
    parentDocNo,
    rootExBDocNo,
  });
  const parts = finalDocNo.split("-");
  const docYear = parseInt(parts[parts.length - 2], 10) || null;
  const docSerial = parseInt(parts[parts.length - 1], 10) || null;

  const insert = await pool
    .request()
    .input("PPaymentName", sql.VarChar, PPaymentName || "")
    .input("PMode", sql.VarChar, PMode)
    .input("PAmount", sql.Decimal(18, 2), Number(PAmount) || 0)
    .input("PDocType", sql.VarChar, "Inter-Company Transfer")
    .input("PDate", sql.Date, PDate || null)
    .input("PBankID", sql.Int, PBankID)
    .input("PBankName", sql.VarChar, PBankName || "Dummy Bank")
    .input("PProject", sql.VarChar, PProject != null ? String(PProject) : "")
    .input("PCompany", sql.VarChar, PCompany != null ? String(PCompany) : "")
    .input("PExpenseRef", sql.NVarChar(100), PExpenseRef || null)
    .input("DocNo", sql.NVarChar(100), finalDocNo)
    .input("DocTypeId", sql.Int, docTypeId)
    .input("DocYear", sql.SmallInt, docYear)
    .input("DocSerial", sql.Int, docSerial)
    .input("ParentDocNo", sql.NVarChar(100), parentDocNo || null)
    .input("RootExBDocNo", sql.NVarChar(100), rootExBDocNo || null)
    .input("PCreatedAt", sql.DateTime, new Date())
    .input("PCreatedBy", sql.NVarChar(100), createdBy)
    .input("Status", sql.NVarChar(20), "Pending").query(`
      INSERT INTO dbo.NewPayment (
        PPaymentName, PMode, PAmount, PDocType, PDate,
        PBankID, PBankName, PProject, PCompany, PExpenseRef,
        DocNo, DocTypeId, DocYear, DocSerial, ParentDocNo, RootExBDocNo,
        PCreatedAt, PCreatedBy, Status
      )
      OUTPUT INSERTED.PPaymentID
      VALUES (
        @PPaymentName, @PMode, @PAmount, @PDocType, @PDate,
        @PBankID, @PBankName, @PProject, @PCompany, @PExpenseRef,
        @DocNo, @DocTypeId, @DocYear, @DocSerial, @ParentDocNo, @RootExBDocNo,
        @PCreatedAt, @PCreatedBy, @Status
      )
    `);

  const paymentId = insert.recordset[0].PPaymentID;
  await backPatchRecordId(pool, sql, finalDocNo, "NewPayment", paymentId);
  await transition("payments", paymentId, "Approved", createdBy, "admin", "System-approved inter-company stock transfer payment");
  return { PPaymentID: paymentId, DocNo: finalDocNo };
}

// Drives a Draft record all the way to Approved regardless of how many
// levels the configured approval workflow has. transition(..., "Approved")
// only advances ONE level per call — for a 2+ level workflow, a single
// call leaves the record at "Pending" with remainingLevels > 0 and never
// fires GL posting. Loop until fully approved, capped by the workflow's
// own totalLevels (from the first call's response) as a safety bound.
async function approve(module, id, createdBy, note) {
  await transition(module, id, "Pending", createdBy, "admin", note);
  let result = await transition(module, id, "Approved", createdBy, "admin", note);
  let guard = result?.totalLevels || 10;
  while (result?.newStatus !== "Approved" && guard-- > 0) {
    result = await transition(module, id, "Approved", createdBy, "admin", note);
  }
  return result;
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

// Re-resolves every entity needed to run the document chain, either from a
// fresh POST body (creation time) or from a stored ICT header + items row
// (approval time) — same shape either way so executeTransferChain() never
// needs to know which caller it came from.
async function resolveTransferContext(pool, { senderProjectId, receiverProjectId, items }) {
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

  const receiverCustomer = await getProjectLedger(pool, receiverProjectId, "C");
  const senderSupplier = await getProjectLedger(pool, senderProjectId, "S");
  if (!receiverCustomer || !senderSupplier) {
    const err = new Error(
      "Auto-created customer/supplier ledger heads are missing. Re-save the projects or create PRJ-{id}-CUST and PRJ-{id}-SUPP approved heads.",
    );
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

  const dummyBank = await getDummyBank(pool);
  if (!dummyBank) {
    const err = new Error("Dummy Bank account not found.");
    err.status = 500;
    throw err;
  }

  return { sender, receiver, receiverCustomer, senderSupplier, senderGodown, receiverGodown, dummyBank };
}

async function priceItems(pool, senderProjectId, senderProjectName, items) {
  const pricedItems = [];
  for (const [idx, item] of items.entries()) {
    const itemId = item.itemId || item.ItemId || item.ItemID;
    const qty = Number(item.qty ?? item.Quantity ?? item.quantity);
    if (!itemId || !(qty > 0)) {
      const err = new Error(`Invalid item at line ${idx + 1}.`);
      err.status = 400;
      throw err;
    }
    const rateInfo = await getLastPurchaseRate(pool, senderProjectId, itemId);
    if (!rateInfo) {
      const err = new Error(
        `No last purchase rate found for item ${item.itemName || itemId} in sender project ${senderProjectName}.`,
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
      tax: Number(item.tax || item.TaxPct || 0),
      sourceDocNo: rateInfo.sourceDocNo || null,
    });
  }
  return pricedItems;
}

// Persists a single link column the moment its document is created, rather
// than waiting until the entire chain finishes. If a later step in the
// chain throws (a real incident that happened in production: GRN creation
// failed on a code bug, leaving the ICT stuck "Approved" with every link
// NULL and SO/SI/RP/PO already committed but untraceable from the header),
// the header still shows exactly how far the chain got — turning a manual
// forensic reconstruction into a simple "resume from here" story.
async function persistLink(pool, ictId, column, value) {
  if (!ictId || !value) return;
  try {
    await pool.request().input("id", sql.Int, ictId).input("v", sql.Int, value)
      .query(`UPDATE dbo.InterCompanyTransfer SET ${column} = @v WHERE ICTId = @id`);
  } catch (err) {
    console.error(`[inter-company-transfer] failed to persist ${column}=${value} for ICT ${ictId} (non-fatal):`, err.message);
  }
}

// Runs the full commercial-paper chain (SO -> SI -> Payment -> PO -> GRN ->
// Expense Booking -> Payment) for an already-Approved ICT header. Only
// called from PUT /:id/approve, once a super_admin has approved the
// request — everything from here on is 100% automatic, no further manual
// steps, matching the original "no manual work after approval" spec.
async function executeTransferChain(pool, ctx, createdBy, opts = {}) {
  const { sender, receiver, receiverCustomer, senderSupplier, senderGodown, receiverGodown, dummyBank, pricedItems, totalAmount, transferDate } = ctx;
  const { finYear = null, referenceNumber = null, remarks = null, docNo = null, ictId = null } = opts;

  // The GRN on the receiving side automatically credits the destination
  // godown's StockLedger — but nothing on the sending side ever debited the
  // sender's godown, so the same stock silently duplicated across both
  // projects on every inter-company transfer. Deduct it here, mirroring
  // stockTransfers.js's own OUT-entry shape, and fail before creating any
  // documents if the sender doesn't actually have enough stock.
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
  for (const item of pricedItems) {
    await pool.request()
      .input("ItemID", sql.NVarChar(50), String(item.itemId))
      .input("Qty", sql.Decimal(18, 2), item.qty)
      .input("UOM", sql.NVarChar(20), item.uom || null)
      .input("GodownID", sql.Int, senderGodown.GodownID)
      .input("DocNo", sql.NVarChar(100), docNo).query(`
        INSERT INTO dbo.StockLedger (ItemID,Qty,UOM,Type,RefType,RefID,GodownID,DocNo,CreatedDate)
        VALUES (@ItemID,@Qty,@UOM,'OUT','ICT',0,@GodownID,@DocNo,GETDATE())
      `);
  }

  const soDocTypeId = await resolveDocType(pool, ["SO"], "Sale Order");
  const poDocTypeId = await resolveDocType(pool, ["DPO", "PO"], "Purchase Order");
  const ebDocTypeId = await resolveDocType(pool, ["INV-GRN", "ExB-GRN"], "Expense Booking");
  if (!soDocTypeId || !poDocTypeId || !ebDocTypeId) {
    const err = new Error("Required document types for SO/PO/Expense Booking are missing.");
    err.status = 500;
    throw err;
  }

  const so = await createSaleOrderInternal(pool, {
      SODate: transferDate,
      CustomerID: receiverCustomer.LHeadId,
      CompanyId: sender.CompanyId,
      ProjectId: sender.ProjectId,
      ReceivingGodownId: receiverGodown.GodownID,
      ItemDescription: `Inter-company transfer to ${receiver.ProjectName}`,
      Quantity: pricedItems.reduce((sum, item) => sum + item.qty, 0),
      Unit: pricedItems[0]?.unit || "NOS",
      Rate: pricedItems[0]?.rate || 0,
      TotalAmount: totalAmount,
      ReferenceNumber: referenceNumber,
      PaymentTerms: "System generated inter-company stock transfer",
      Status: "Open",
      Remarks: remarks || `Inter-company stock transfer to ${receiver.ProjectName}`,
      DocTypeId: soDocTypeId,
      finYear,
      SOItems: pricedItems,
    }, createdBy);
    await persistLink(pool, ictId, "SaleOrderId", so.SaleOrderID);

    const si = await createSaleInvoiceInternal(pool, {
      SaleOrderID: so.SaleOrderID,
      SaleOrderSource: "CustomerSaleOrders",
      InvoiceDate: transferDate,
      Amount: totalAmount,
      Remarks: `Auto-generated for inter-company transfer ${so.SaleOrderNo}`,
      RPFinYear: finYear,
    }, createdBy, createdBy);
    await persistLink(pool, ictId, "SaleInvoiceId", si.SaleInvoiceID);

    const rp = await createReceivedPaymentInternal(pool, {
      RPCompanyName: sender.CompanyName,
      RPCompanyId: sender.CompanyId,
      RPReceivedFrom: si.SaleInvoiceNo,
      RPCustomerName: receiverCustomer.LHeadName,
      RPProjectName: sender.ProjectName,
      RPProjectId: sender.ProjectId,
      RPDocDate: transferDate,
      RPMode: "Cash",
      RPAmount: totalAmount,
      RPDepositBankId: dummyBank.LHeadId,
      RPDepositBankName: dummyBank.LHeadName,
      RPRemarks: `[InterCompanyTransfer] Auto receipt via Dummy Bank for ${si.SaleInvoiceNo}`,
      SourceSaleInvoiceId: si.SaleInvoiceID,
      SourceSaleInvoiceDocNo: si.SaleInvoiceNo,
    }, createdBy);
    await pool.request().input("Id", sql.Int, rp.RPPaymentID).query("UPDATE dbo.ReceivedPayment SET RPStatus='Approved' WHERE RPPaymentID=@Id");
    await postReceivedPaymentApproval(pool, rp.RPPaymentID, createdBy);
    await persistLink(pool, ictId, "ReceivedPaymentId", rp.RPPaymentID);

    const po = await createPurchaseOrderInternal(pool, {
      PODate: transferDate,
      ExpectedDeliveryDate: transferDate,
      SupplierID: senderSupplier.LHeadId,
      CompanyId: receiver.CompanyId,
      ProjectId: receiver.ProjectId,
      ItemDescription: `Inter-company transfer from ${sender.ProjectName}`,
      Quantity: pricedItems.reduce((sum, item) => sum + item.qty, 0),
      Unit: pricedItems[0]?.unit || "NOS",
      Rate: pricedItems[0]?.rate || 0,
      TotalAmount: totalAmount,
      PaymentTerms: "System generated inter-company stock transfer",
      Status: "Draft",
      Remarks: `Auto PO for ${si.SaleInvoiceNo}`,
      DocTypeId: poDocTypeId,
      finYear,
      POItems: pricedItems,
      POType: "InterCompanyTransfer",
      SourceSaleOrderId: so.SaleOrderID,
      SourceSaleOrderDocNo: so.SaleOrderNo,
      SourceSaleInvoiceId: si.SaleInvoiceID,
      SourceSaleInvoiceDocNo: si.SaleInvoiceNo,
    }, createdBy);
    await approve("purchase-orders", po.PurchaseOrderID, createdBy, "System-approved inter-company transfer PO");
    await persistLink(pool, ictId, "PurchaseOrderId", po.PurchaseOrderID);

    const grnItems = pricedItems.map((item) => ({
      itemId: item.itemId,
      itemName: item.itemName,
      receivedQty: item.qty,
      quantity: item.qty,
      uom: item.uom,
      rate: item.rate,
      totalAmount: item.amount,
      amount: item.amount,
    }));
    const grn = await createGRNInternal(pool, {
      grnDate: transferDate,
      supplierId: senderSupplier.LHeadId,
      poId: po.PurchaseOrderID,
      grnItems,
      status: "Draft",
      remarks: `Auto GRN for inter-company transfer ${si.SaleInvoiceNo}`,
      finYear,
      parentDocNo: po.PurchaseOrderNo,
      godownId: receiverGodown.GodownID,
      projectId: receiver.ProjectId,
    }, createdBy);
    await approve("grn", grn.GRNID, createdBy, "System-approved inter-company transfer GRN");
    await persistLink(pool, ictId, "GRNId", grn.GRNID);

    const eb = await createExpenseBookingInternal(pool, {
      EName: senderSupplier.LHeadName,
      EProjectName: receiver.ProjectName,
      EDocumentType: "GRN",
      EDocDate: transferDate,
      EAmount: totalAmount,
      ENetAmount: totalAmount,
      ECompanyId: receiver.CompanyId,
      EDocTypeId: ebDocTypeId,
      EFinYear: finYear,
      ESourceId: grn.GRNID,
      ERemarks: `Auto expense booking for inter-company transfer ${si.SaleInvoiceNo}`,
    }, createdBy, opts.userId || null);
    await approve("expense-booking", eb.id, createdBy, "System-approved inter-company transfer invoice");
    await persistLink(pool, ictId, "ExpenseBookingId", eb.id);

    const payment = await createApprovedPayment(pool, {
      PPaymentName: senderSupplier.LHeadName,
      PAmount: totalAmount,
      PDate: transferDate,
      PBankID: dummyBank.LHeadId,
      PBankName: dummyBank.LHeadName,
      PProject: receiver.ProjectId,
      PCompany: receiver.CompanyId,
      PExpenseRef: eb.docNo,
      parentDocNo: eb.docNo,
      rootExBDocNo: eb.docNo,
    }, createdBy);

  return {
    SaleOrderID: so.SaleOrderID,
    SaleInvoiceID: si.SaleInvoiceID,
    ReceivedPaymentID: rp.RPPaymentID,
    PurchaseOrderID: po.PurchaseOrderID,
    GRNID: grn.GRNID,
    ExpenseBookingID: eb.id,
    NewPaymentID: payment.PPaymentID,
  };
}

// Loads an ICT header + its stored items back into the same context shape
// resolveTransferContext()/priceItems() produce at creation time, so
// executeTransferChain() can run identically whether called fresh or from
// a later approval action.
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

    const ctx = await resolveTransferContext(pool, { senderProjectId, receiverProjectId, items });
    const pricedItems = await priceItems(pool, senderProjectId, ctx.sender.ProjectName, items);
    const totalAmount = pricedItems.reduce((sum, item) => sum + item.amount, 0);

    // Only validate + record the request here — no documents are generated
    // yet. The full auto-chain (SO -> ... -> Payment) only fires once a
    // super_admin approves this request via PUT /:id/approve, matching the
    // same Draft -> Pending -> Approved gate every other module already
    // uses ("as we usually do approve").
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
      message: "Submitted for super_admin approval — the full document chain will be generated automatically once approved.",
    });
  } catch (err) {
    console.error("[inter-company-transfer] POST /:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── PUT /:id/approve — Pending → Approved (super_admin only); fires the
// entire auto-generated document chain the moment full approval lands ──────
router.put("/:id/approve", authenticateToken, requirePageRight("stock-transfers", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    const createdBy = userEmail(req);

    const headerRes = await pool.request().input("id", sql.Int, id)
      .query("SELECT * FROM dbo.InterCompanyTransfer WHERE ICTId = @id");
    const ictRow = headerRes.recordset[0];
    if (!ictRow) return res.status(404).json({ error: "Not found" });

    const result = await transition("inter-company-transfer", id, "Approved", createdBy, req.user?.role, req.body?.note);

    if (result.newStatus !== "Approved") {
      // Multi-level workflow, more approvals still required — no chain yet.
      return res.json({ message: "Approval level recorded", ...result });
    }

    const ctx = await loadStoredTransferContext(pool, ictRow);
    const links = await executeTransferChain(pool, ctx, createdBy, {
      remarks: ictRow.Remarks,
      userId: req.user?.userId || null,
      docNo: ictRow.DocNo,
      ictId: id,
    });

    // Every link was already persisted incrementally inside
    // executeTransferChain as each document was created — this just flips
    // the header to its final state once the whole chain succeeds.
    await pool.request().input("id", sql.Int, id).input("NewPaymentId", sql.Int, links.NewPaymentID)
      .query("UPDATE dbo.InterCompanyTransfer SET Status = 'Completed', NewPaymentId = @NewPaymentId WHERE ICTId = @id");

    await Promise.all([
      bumpCacheVersion("stock-transfers"),
      bumpCacheVersion("inventory-master"),
      bumpCacheVersion("journal-voucher"),
      bumpCacheVersion("new-payment"),
      bumpCacheVersion("received-payment"),
    ]);

    res.json({ message: "Approved — transfer executed", ICTId: id, links });
  } catch (err) {
    console.error("[inter-company-transfer] PUT /:id/approve:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── PUT /:id/reject — Pending → Rejected; no documents are ever generated ───
router.put("/:id/reject", authenticateToken, requirePageRight("stock-transfers", "edit"), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });

    const result = await transition("inter-company-transfer", id, "Rejected", userEmail(req), req.user?.role, req.body?.note);
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
