const allowRoles = require("../middleware/role");
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const { validateBody } = require("../middleware/validateRequest");
const { requireValidId, checkRowsAffected } = require("../utils/routeHelpers");
const {
  customerSaleOrderBodySchema,
  customerSaleOrderUpdateSchema,
} = require("../validation/financialRouteSchemas");
const {
  lockNextDocNumber,
  backPatchRecordId,
} = require("../utils/docNumberLock");

router.use(checkPermissionForMethod("Material", "CustomerSaleOrders"));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const requireUserName = (req, res) => {
  const name = req.user?.name || req.user?.email;
  if (!name) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return name;
};

const parseJson = (val) => {
  if (!val) return null;
  return typeof val === "string" ? val : JSON.stringify(val);
};

const safeJson = (str) => {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
};

// Compute total from SOItems array (sum of qty x rate) — falls back to the
// header-level Quantity x Rate when no line items were supplied.
const computeTotal = (items) => {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items.reduce((s, it) => {
    const qty = parseFloat(it.quantity) || 0;
    const rate = parseFloat(it.rate) || 0;
    const amt = it.amount != null ? parseFloat(it.amount) || 0 : qty * rate;
    return s + amt;
  }, 0);
};

// Resolve a FinYear.FId from its FName label (e.g. "2026-2027").
const resolveFyId = async (pool, finYearLabel) => {
  if (!finYearLabel) return null;
  try {
    const r = await pool
      .request()
      .input("FName", sql.NVarChar, finYearLabel)
      .query("SELECT FId FROM dbo.FinYear WHERE FName = @FName");
    return r.recordset[0]?.FId ?? null;
  } catch {
    return null;
  }
};

const buildUomMap = async (pool) => {
  try {
    const r = await pool
      .request()
      .query("SELECT Id, UOMName FROM dbo.UOMMaster WHERE IsActive = 1");
    const map = {};
    for (const row of r.recordset) map[row.UOMName] = row.Id;
    return map;
  } catch {
    return {};
  }
};

// ─── Sync SaleOrderItems child rows ──────────────────────────────────────────
// Same delete-and-reinsert strategy as purchaseOrders.js's syncLineItems.
const syncLineItems = async (transaction, sqlRef, saleOrderID, soItems, uomMap) => {
  if (!Array.isArray(soItems) || soItems.length === 0) return;

  await transaction
    .request()
    .input("SOID", sqlRef.Int, saleOrderID)
    .query("DELETE FROM dbo.CustomerSaleOrderItems WHERE SaleOrderID = @SOID");

  for (let i = 0; i < soItems.length; i++) {
    const it = soItems[i];
    const itemName = String(it.itemDescription || it.itemName || "").substring(
      0,
      255,
    );
    if (!itemName) continue;

    const qty = parseFloat(it.quantity) || 0;
    const rate = parseFloat(it.rate) || 0;
    const amount = parseFloat(it.amount) || qty * rate;
    const uomName = String(it.unit || "").substring(0, 50);
    const uomId = uomMap[uomName] || null;

    await transaction
      .request()
      .input("SOID", sqlRef.Int, saleOrderID)
      .input("ItemId", sqlRef.NVarChar(100), it.itemId || null)
      .input("ItemName", sqlRef.NVarChar(255), itemName)
      .input("ItemCode", sqlRef.NVarChar(50), it.itemCode || null)
      .input("Desc", sqlRef.NVarChar(sqlRef.MAX), it.description || null)
      .input("Qty", sqlRef.Decimal(18, 4), qty)
      .input("UomId", sqlRef.Int, uomId)
      .input("UomName", sqlRef.NVarChar(50), uomName || null)
      .input("Rate", sqlRef.Decimal(18, 4), rate)
      .input("LineAmt", sqlRef.Decimal(18, 2), amount)
      .input("Sort", sqlRef.Int, i)
      .input("Now", sqlRef.DateTime2, new Date()).query(`
        INSERT INTO dbo.CustomerSaleOrderItems
          (SaleOrderID, ItemId, ItemName, ItemCode, Description,
           Quantity, UomId, UomName, Rate, LineAmount, SortOrder, CreatedAt)
        VALUES
          (@SOID, @ItemId, @ItemName, @ItemCode, @Desc,
           @Qty, @UomId, @UomName, @Rate, @LineAmt, @Sort, @Now)
      `);
  }
};

// ─── Internal creation function ──────────────────────────────────────────────
// Extracted from POST / so other server-side callers (the Inter-Company
// Stock Transfer orchestrator) can create a real, fully-validated Sale
// Order in-process without duplicating this validation/numbering/insert
// logic or making an HTTP self-call. Mechanical extraction — the POST route
// below now just calls this and maps thrown errors to a response; behavior
// is unchanged. Thrown errors carry a `.status` for the HTTP code to use.
const createSaleOrderInternal = async (pool, payload, userEmail) => {
  const {
    SaleOrderNo: soNoFromClient,
    SODate,
    CustomerID,
    CompanyId,
    ProjectId,
    ItemDescription,
    Quantity,
    Unit,
    Rate,
    TotalAmount,
    ReceivingGodownId,
    ReferenceNumber,
    PaymentTerms,
    Status,
    Remarks,
    DocTypeId,
    finYear,
    SOItems,
  } = payload;

  const soItemsArray = Array.isArray(SOItems)
    ? SOItems
    : (safeJson(parseJson(SOItems)) ?? []);
  const soItemsJson = JSON.stringify(soItemsArray);
  const total =
    computeTotal(soItemsArray) ??
    (parseFloat(TotalAmount) ||
      parseFloat(Quantity) * parseFloat(Rate) ||
      0);

  // Customer must actually be a Customer-type ledger head, not a supplier
  // or any other account — this is the one thing PurchaseOrders doesn't
  // need to check (suppliers aren't filtered by type at this layer either,
  // but getting the party type wrong here is the more common mistake
  // since Sale Order is new and customers/suppliers share one master).
  const custCheck = await pool
    .request()
    .input("CustomerID", sql.Int, parseInt(CustomerID, 10))
    .query(
      "SELECT LHeadType FROM dbo.AccountHeadMaster WHERE LHeadId = @CustomerID",
    );
  if (!custCheck.recordset.length) {
    const err = new Error("Customer not found.");
    err.status = 404;
    throw err;
  }
  if (custCheck.recordset[0].LHeadType !== "C") {
    const err = new Error("Selected account is not a Customer.");
    err.status = 400;
    throw err;
  }

  const uomMap = await buildUomMap(pool);
  const fyId = await resolveFyId(pool, finYear);

  const transaction = pool.transaction();
  await transaction.begin();

  try {
    let finalDocNo = null;
    if (DocTypeId) {
      finalDocNo = await lockNextDocNumber(pool, sql, {
        docTypeId: parseInt(DocTypeId, 10),
        finYear,
        tableName: "CustomerSaleOrders",
        docNoColumn: "SaleOrderNo",
        issuedBy: userEmail,
      });
    } else {
      finalDocNo = soNoFromClient || null;
    }

    if (!finalDocNo) {
      const err = new Error(
        "SaleOrderNo is required. Select a document type or enter a sale order number manually.",
      );
      err.status = 400;
      throw err;
    }

    const result = await transaction
      .request()
      .input("SaleOrderNo", sql.NVarChar(100), finalDocNo)
      .input("SODate", sql.Date, SODate || new Date())
      .input("CustomerID", sql.Int, parseInt(CustomerID, 10))
      .input("CompanyId", sql.Int, CompanyId ? parseInt(CompanyId, 10) : null)
      .input("ProjectId", sql.Int, ProjectId ? parseInt(ProjectId, 10) : null)
      .input("ItemDescription", sql.NVarChar(sql.MAX), ItemDescription || null)
      .input("Quantity", sql.Decimal(18, 4), parseFloat(Quantity) || 0)
      .input("Unit", sql.NVarChar(50), Unit || "NOS")
      .input("Rate", sql.Decimal(18, 4), parseFloat(Rate) || 0)
      .input("TotalAmount", sql.Decimal(18, 2), total)
      .input(
        "ReceivingGodownId",
        sql.Int,
        ReceivingGodownId ? parseInt(ReceivingGodownId, 10) : null,
      )
      .input("ReferenceNumber", sql.NVarChar(100), ReferenceNumber || null)
      .input("PaymentTerms", sql.NVarChar(sql.MAX), PaymentTerms || null)
      .input("Status", sql.NVarChar(50), Status || "Open")
      .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
      .input("DocTypeId", sql.Int, DocTypeId ? parseInt(DocTypeId, 10) : null)
      .input("CreatedBy", sql.NVarChar(100), userEmail)
      .input("CreatedAt", sql.DateTime2, new Date())
      .input("SOItems", sql.NVarChar(sql.MAX), soItemsJson)
      .input("FyId", sql.Int, fyId).query(`
        INSERT INTO dbo.CustomerSaleOrders (
          SaleOrderNo, SODate, CustomerID, CompanyId, ProjectId,
          ItemDescription, Quantity, Unit, Rate, TotalAmount,
          ReceivingGodownId, ReferenceNumber, PaymentTerms, Status, Remarks,
          DocTypeId, CreatedBy, CreatedAt, SOItems, fy_id
        )
        OUTPUT INSERTED.SaleOrderID
        VALUES (
          @SaleOrderNo, @SODate, @CustomerID, @CompanyId, @ProjectId,
          @ItemDescription, @Quantity, @Unit, @Rate, @TotalAmount,
          @ReceivingGodownId, @ReferenceNumber, @PaymentTerms, @Status, @Remarks,
          @DocTypeId, @CreatedBy, @CreatedAt, @SOItems, @FyId
        )
      `);

    const newId = result.recordset[0].SaleOrderID;

    await syncLineItems(transaction, sql, newId, soItemsArray, uomMap);

    await transaction.commit();

    await backPatchRecordId(pool, sql, finalDocNo, "CustomerSaleOrders", newId);

    return { SaleOrderID: newId, SaleOrderNo: finalDocNo };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      // already rolled back
    }
    throw err;
  }
};

// ─── SELECT columns shared by GET / and GET /:id ─────────────────────────────

const SO_SELECT = `
  SELECT
    so.SaleOrderID,
    so.SaleOrderNo,
    so.SODate,
    so.CustomerID,
    ah.LHeadName          AS CustomerName,
    so.CompanyId,
    co.name                AS CompanyName,
    so.ProjectId,
    pr.name                AS ProjectName,
    so.ItemDescription,
    so.Quantity,
    so.Unit,
    so.Rate,
    so.TotalAmount,
    so.ReceivingGodownId,
    g.GodownName           AS ReceivingGodownName,
    so.ReferenceNumber,
    so.PaymentTerms,
    so.Remarks,
    so.Status,
    so.CreatedBy,
    so.CreatedAt,
    so.UpdatedBy,
    so.UpdatedAt,
    so.DocTypeId,
    so.fy_id,
    fy.FName                AS FinYearName,
    so.SOItems,
    td.Prefix               AS DocTypePrefix,
    td.Description          AS DocTypeDescription
  FROM dbo.CustomerSaleOrders so
  LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId     = so.CustomerID
  LEFT JOIN dbo.enterprise        co ON co.id          = so.CompanyId
  LEFT JOIN dbo.enterprise        pr ON pr.id          = so.ProjectId
  LEFT JOIN dbo.Godowns            g ON g.GodownID     = so.ReceivingGodownId
  LEFT JOIN dbo.FinYear           fy ON fy.FId         = so.fy_id
  LEFT JOIN dbo.TypeOfDoc         td ON td.TypeOfDocId = so.DocTypeId
  WHERE so.IsDeleted = 0
`;

const mapRow = (so) => ({
  ...so,
  SOItems: safeJson(so.SOItems) ?? [],
});

// ── GET /  (List with pagination) ────────────────────────────────────────────
router.get("/", cache("customer-sale-orders", 300, { shared: true }), async (req, res) => {
  const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
  try {
    const pool = getPool();
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 500);
    const offset = (page - 1) * limit;

    const status = req.query.status ? req.query.status.toString().trim() : null;
    const customerId = req.query.customerId
      ? parseInt(req.query.customerId, 10)
      : null;

    const whereConditions = [];
    if (companyId) whereConditions.push("so.CompanyId = @companyId");
    if (status) whereConditions.push("so.Status = @status");
    if (customerId) whereConditions.push("so.CustomerID = @customerId");
    const extraWhere = whereConditions.length
      ? `AND ${whereConditions.join(" AND ")}`
      : "";

    const result = await pool
      .request()
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit)
      .input("companyId", sql.Int, companyId)
      .input("status", sql.NVarChar(50), status)
      .input("customerId", sql.Int, customerId).query(`
        SELECT *, COUNT(*) OVER() AS _total FROM (
          ${SO_SELECT}
          ${extraWhere}
        ) _so
        ORDER BY _so.SaleOrderID DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

    const total = result.recordset[0]?._total ?? 0;

    res.json({
      data: result.recordset.map((r) => {
        const { _total, ...rest } = r;
        return mapRow(rest);
      }),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("GET CustomerSaleOrders error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const id = requireValidId(req, res);
    if (!id) return;
    const pool = getPool();
    const result = await pool.request().input("SaleOrderID", sql.Int, id)
      .query(`
        ${SO_SELECT}
        AND so.SaleOrderID = @SaleOrderID
      `);

    if (result.recordset.length === 0)
      return res.status(404).json({ error: "Sale order not found" });

    const lineItems = await pool.request().input("SOID", sql.Int, id).query(`
        SELECT Id, SaleOrderID, ItemId, ItemName, ItemCode, Description,
               Quantity, UomId, UomName, Rate, LineAmount, SortOrder
        FROM dbo.CustomerSaleOrderItems
        WHERE SaleOrderID = @SOID
        ORDER BY SortOrder
      `);

    res.json({
      ...mapRow(result.recordset[0]),
      LineItems: lineItems.recordset,
    });
  } catch (err) {
    console.error("GET CustomerSaleOrder by id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /  (Create) ──────────────────────────────────────────────────────────
router.post("/", allowRoles("admin", "super_admin", "dba"), validateBody(customerSaleOrderBodySchema), async (req, res) => {
  try {
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;

    const pool = getPool();
    const { SaleOrderID, SaleOrderNo } = await createSaleOrderInternal(pool, req.body, userEmail);
    await bumpCacheVersion("customer-sale-orders");

    res.status(201).json({ SaleOrderID, SaleOrderNo });
  } catch (err) {
    console.error("POST CustomerSaleOrder error:", err);
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ── PUT /:id  (Update) ────────────────────────────────────────────────────────
router.put("/:id", allowRoles("admin", "super_admin", "dba"), validateBody(customerSaleOrderUpdateSchema), async (req, res) => {
  const id = requireValidId(req, res);
  if (!id) return;

  const {
    SODate,
    CustomerID,
    CompanyId,
    ProjectId,
    ItemDescription,
    Quantity,
    Unit,
    Rate,
    TotalAmount,
    ReceivingGodownId,
    ReferenceNumber,
    PaymentTerms,
    Status,
    Remarks,
    SOItems,
  } = req.body;

  const soItemsArray = Array.isArray(SOItems)
    ? SOItems
    : (safeJson(parseJson(SOItems)) ?? undefined);
  const total =
    soItemsArray !== undefined
      ? computeTotal(soItemsArray) ??
        (parseFloat(TotalAmount) || parseFloat(Quantity) * parseFloat(Rate) || 0)
      : (parseFloat(TotalAmount) || undefined);

  let transaction;
  try {
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;

    const pool = getPool();
    const uomMap = await buildUomMap(pool);

    transaction = pool.transaction();
    await transaction.begin();

    const result = await transaction
      .request()
      .input("SaleOrderID", sql.Int, id)
      .input("SODate", sql.Date, SODate || null)
      .input("CustomerID", sql.Int, CustomerID ? parseInt(CustomerID, 10) : null)
      .input("CompanyId", sql.Int, CompanyId ? parseInt(CompanyId, 10) : null)
      .input("ProjectId", sql.Int, ProjectId ? parseInt(ProjectId, 10) : null)
      .input("ItemDescription", sql.NVarChar(sql.MAX), ItemDescription ?? null)
      .input("Quantity", sql.Decimal(18, 4), parseFloat(Quantity) || 0)
      .input("Unit", sql.NVarChar(50), Unit || "NOS")
      .input("Rate", sql.Decimal(18, 4), parseFloat(Rate) || 0)
      .input("TotalAmount", sql.Decimal(18, 2), total ?? null)
      .input(
        "ReceivingGodownId",
        sql.Int,
        ReceivingGodownId ? parseInt(ReceivingGodownId, 10) : null,
      )
      .input("ReferenceNumber", sql.NVarChar(100), ReferenceNumber ?? null)
      .input("PaymentTerms", sql.NVarChar(sql.MAX), PaymentTerms ?? null)
      .input("Status", sql.NVarChar(50), Status || null)
      .input("Remarks", sql.NVarChar(sql.MAX), Remarks ?? null)
      .input("UpdatedBy", sql.NVarChar(100), userEmail)
      .input("UpdatedAt", sql.DateTime2, new Date())
      .input(
        "SOItems",
        sql.NVarChar(sql.MAX),
        soItemsArray !== undefined ? JSON.stringify(soItemsArray) : null,
      ).query(`
        UPDATE dbo.CustomerSaleOrders SET
          SODate            = COALESCE(@SODate, SODate),
          CustomerID        = COALESCE(@CustomerID, CustomerID),
          CompanyId         = @CompanyId,
          ProjectId         = @ProjectId,
          ItemDescription   = COALESCE(@ItemDescription, ItemDescription),
          Quantity          = COALESCE(@Quantity, Quantity),
          Unit              = COALESCE(@Unit, Unit),
          Rate              = COALESCE(@Rate, Rate),
          TotalAmount       = COALESCE(@TotalAmount, TotalAmount),
          ReceivingGodownId = @ReceivingGodownId,
          ReferenceNumber   = COALESCE(@ReferenceNumber, ReferenceNumber),
          PaymentTerms      = COALESCE(@PaymentTerms, PaymentTerms),
          Status            = COALESCE(@Status, Status),
          Remarks           = COALESCE(@Remarks, Remarks),
          UpdatedBy         = @UpdatedBy,
          UpdatedAt         = @UpdatedAt,
          SOItems           = COALESCE(@SOItems, SOItems)
        WHERE SaleOrderID = @SaleOrderID AND IsDeleted = 0
      `);

    if (!checkRowsAffected(result, res, "Sale order")) {
      await transaction.rollback();
      return;
    }

    if (soItemsArray !== undefined) {
      await syncLineItems(transaction, sql, id, soItemsArray, uomMap);
    }

    await transaction.commit();
    await bumpCacheVersion("customer-sale-orders");

    res.json({ success: true });
  } catch (err) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch {
        // already rolled back
      }
    }
    console.error("PUT CustomerSaleOrder error:", err);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
module.exports.createSaleOrderInternal = createSaleOrderInternal;