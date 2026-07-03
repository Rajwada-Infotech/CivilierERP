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
    const result = await pool.request().query(`
      SELECT YEAR(TransferDate) AS Year,
             COUNT(*) AS TransferCount,
             SUM(TotalAmount) AS TotalAmount
      FROM dbo.InterCompanyTransfer
      GROUP BY YEAR(TransferDate)
      ORDER BY Year DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    if (!senderProjectId || !receiverProjectId) {
      return res.status(400).json({ error: "SenderProjectId and ReceiverProjectId are required." });
    }
    if (senderProjectId === receiverProjectId) {
      return res.status(400).json({ error: "Sender and receiver projects must differ." });
    }
    if (!items.length) {
      return res.status(400).json({ error: "At least one transfer item is required." });
    }

    const sender = await getProject(pool, senderProjectId);
    const receiver = await getProject(pool, receiverProjectId);
    if (!sender || !receiver) return res.status(404).json({ error: "Sender or receiver project not found." });
    if (!sender.CompanyId || !receiver.CompanyId) return res.status(400).json({ error: "Both projects must be linked to a company." });
    if (sender.CompanyId === receiver.CompanyId) {
      return res.status(400).json({ error: "Use normal Stock Transfer for same-company project moves." });
    }

    const receiverCustomer = await getProjectLedger(pool, receiverProjectId, "C");
    const senderSupplier = await getProjectLedger(pool, senderProjectId, "S");
    if (!receiverCustomer || !senderSupplier) {
      return res.status(400).json({
        error: "Auto-created customer/supplier ledger heads are missing. Re-save the projects or create PRJ-{id}-CUST and PRJ-{id}-SUPP approved heads.",
      });
    }

    const senderGodown = await getProjectGodown(pool, senderProjectId);
    const receiverGodown = await getProjectGodown(pool, receiverProjectId);
    if (!senderGodown || !receiverGodown) {
      return res.status(400).json({ error: "Both projects must have active project godowns." });
    }

    const dummyBank = await getDummyBank(pool);
    if (!dummyBank) return res.status(500).json({ error: "Dummy Bank account not found." });

    const pricedItems = [];
    for (const [idx, item] of items.entries()) {
      const itemId = item.itemId || item.ItemId || item.ItemID;
      const qty = Number(item.qty ?? item.Quantity ?? item.quantity);
      if (!itemId || !(qty > 0)) {
        return res.status(400).json({ error: `Invalid item at line ${idx + 1}.` });
      }
      const rateInfo = await getLastPurchaseRate(pool, senderProjectId, itemId);
      if (!rateInfo) {
        return res.status(400).json({
          error: `No last purchase rate found for item ${item.itemName || itemId} in sender project ${sender.ProjectName}.`,
        });
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

    const totalAmount = pricedItems.reduce((sum, item) => sum + item.amount, 0);
    const soDocTypeId = await resolveDocType(pool, ["SO"], "Sale Order");
    const poDocTypeId = await resolveDocType(pool, ["DPO", "PO"], "Purchase Order");
    const ebDocTypeId = await resolveDocType(pool, ["INV-GRN", "ExB-GRN"], "Expense Booking");
    if (!soDocTypeId || !poDocTypeId || !ebDocTypeId) {
      return res.status(500).json({ error: "Required document types for SO/PO/Expense Booking are missing." });
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
      ReferenceNumber: req.body.ReferenceNumber || null,
      PaymentTerms: "System generated inter-company stock transfer",
      Status: "Open",
      Remarks: req.body.Remarks || `Inter-company stock transfer to ${receiver.ProjectName}`,
      DocTypeId: soDocTypeId,
      finYear: req.body.finYear || req.body.FinYear || null,
      SOItems: pricedItems,
    }, createdBy);

    const si = await createSaleInvoiceInternal(pool, {
      SaleOrderID: so.SaleOrderID,
      InvoiceDate: transferDate,
      Amount: totalAmount,
      Remarks: `Auto-generated for inter-company transfer ${so.SaleOrderNo}`,
      RPFinYear: req.body.finYear || req.body.FinYear || null,
    }, createdBy, createdBy);

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
      finYear: req.body.finYear || req.body.FinYear || null,
      POItems: pricedItems,
      POType: "InterCompanyTransfer",
      SourceSaleOrderId: so.SaleOrderID,
      SourceSaleOrderDocNo: so.SaleOrderNo,
      SourceSaleInvoiceId: si.SaleInvoiceID,
      SourceSaleInvoiceDocNo: si.SaleInvoiceNo,
    }, createdBy);
    await approve("purchase-orders", po.PurchaseOrderID, createdBy, "System-approved inter-company transfer PO");

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
      finYear: req.body.finYear || req.body.FinYear || null,
      parentDocNo: po.PurchaseOrderNo,
      godownId: receiverGodown.GodownID,
      projectId: receiver.ProjectId,
    }, createdBy);
    await approve("grn", grn.GRNID, createdBy, "System-approved inter-company transfer GRN");

    const eb = await createExpenseBookingInternal(pool, {
      EName: senderSupplier.LHeadName,
      EProjectName: receiver.ProjectName,
      EDocumentType: "GRN",
      EDocDate: transferDate,
      EAmount: totalAmount,
      ENetAmount: totalAmount,
      ECompanyId: receiver.CompanyId,
      EDocTypeId: ebDocTypeId,
      EFinYear: req.body.finYear || req.body.FinYear || null,
      ESourceId: grn.GRNID,
      ERemarks: `Auto expense booking for inter-company transfer ${si.SaleInvoiceNo}`,
    }, createdBy, req.user?.userId || null);
    await approve("expense-booking", eb.id, createdBy, "System-approved inter-company transfer invoice");

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

    const ictDocTypeId = await resolveDocTypeId(pool, sql, "ICT");
    const ictDocNo = await lockNextDocNumber(pool, sql, {
      docTypeId: ictDocTypeId,
      finYear: req.body.finYear || req.body.FinYear || null,
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
        .input("SenderProjectId", sql.Int, sender.ProjectId)
        .input("SenderCompanyId", sql.Int, sender.CompanyId)
        .input("ReceiverProjectId", sql.Int, receiver.ProjectId)
        .input("ReceiverCompanyId", sql.Int, receiver.CompanyId)
        .input("TotalAmount", sql.Decimal(18, 2), totalAmount)
        .input("Remarks", sql.NVarChar(500), req.body.Remarks || null)
        .input("SaleOrderId", sql.Int, so.SaleOrderID)
        .input("SaleInvoiceId", sql.Int, si.SaleInvoiceID)
        .input("ReceivedPaymentId", sql.Int, rp.RPPaymentID)
        .input("PurchaseOrderId", sql.Int, po.PurchaseOrderID)
        .input("GRNId", sql.Int, grn.GRNID)
        .input("ExpenseBookingId", sql.Int, eb.id)
        .input("NewPaymentId", sql.Int, payment.PPaymentID)
        .input("DocTypeId", sql.Int, ictDocTypeId)
        .input("CreatedBy", sql.NVarChar(150), createdBy).query(`
          INSERT INTO dbo.InterCompanyTransfer
            (DocNo, TransferDate, SenderProjectId, SenderCompanyId, ReceiverProjectId, ReceiverCompanyId,
             Status, TotalAmount, Remarks, SaleOrderId, SaleInvoiceId, ReceivedPaymentId,
             PurchaseOrderId, GRNId, ExpenseBookingId, NewPaymentId, DocTypeId, CreatedBy)
          OUTPUT INSERTED.ICTId
          VALUES
            (@DocNo, @TransferDate, @SenderProjectId, @SenderCompanyId, @ReceiverProjectId, @ReceiverCompanyId,
             'Completed', @TotalAmount, @Remarks, @SaleOrderId, @SaleInvoiceId, @ReceivedPaymentId,
             @PurchaseOrderId, @GRNId, @ExpenseBookingId, @NewPaymentId, @DocTypeId, @CreatedBy)
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

    await Promise.all([
      bumpCacheVersion("stock-transfers"),
      bumpCacheVersion("inventory-master"),
      bumpCacheVersion("journal-voucher"),
      bumpCacheVersion("new-payment"),
      bumpCacheVersion("received-payment"),
    ]);

    res.status(201).json({
      ICTId: ictId,
      DocNo: ictDocNo,
      TotalAmount: totalAmount,
      links: {
        SaleOrderID: so.SaleOrderID,
        SaleInvoiceID: si.SaleInvoiceID,
        ReceivedPaymentID: rp.RPPaymentID,
        PurchaseOrderID: po.PurchaseOrderID,
        GRNID: grn.GRNID,
        ExpenseBookingID: eb.id,
        NewPaymentID: payment.PPaymentID,
      },
    });
  } catch (err) {
    console.error("[inter-company-transfer] POST /:", err);
    res.status(err.status || 500).json({ error: err.message });
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
