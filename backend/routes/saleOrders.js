const express = require("express");
const { parseId } = require("../middleware/validateRequest");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const { getPool, sql } = require("../db");
const { projectAllowed } = require("../services/projectScope");

// A sale order sells our materials from one of our godowns to a buyer (any ledger). Older orders moved stock to
// another of our projects instead (To*), so a restricted user still sees one if either end is theirs; new ones are
// raised only out of the user's own project.
const soScopeIds = (scope) => scope.map(Number).filter(Number.isFinite).join(",") || "NULL";
const soVisibleSql = (scope, alias = "so") =>
  scope ? ` AND (${alias}.FromProjectID IN (${soScopeIds(scope)}) OR ${alias}.ToProjectID IN (${soScopeIds(scope)}))` : "";

router.param("id", async (req, res, next, id) => {
  if (!req.projectScope) return next();
  const oid = parseInt(id, 10);
  if (!Number.isFinite(oid)) return next();
  try {
    const r = await getPool().request().input("id", sql.Int, oid).query(
      `SELECT CASE WHEN 1=1${soVisibleSql(req.projectScope, "so")} THEN 1 ELSE 0 END AS visible FROM dbo.SaleOrders so WHERE so.SaleOrderID = @id`,
    );
    if (r.recordset.length && !r.recordset[0].visible) {
      return res.status(403).json({ error: "You don't have access to this project." });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { requirePageRight } = require("../middleware/requirePageRight");
const {
  transition,
  getWorkflow,
  getApprovedLevelCount,
} = require("../services/approvalService");

const requireUserEmail = (req, res) => {
  const email = req.user?.email;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
};

function parseItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) return JSON.parse(raw);
  return [];
}

const HEADER_SELECT = `
  so.SaleOrderID, so.DocNo, so.OrderDate,
  so.FromCompanyID, fc.name AS FromCompanyName,
  so.FromProjectID, fp.name AS FromProjectName,
  so.FromGodownID,  fg.GodownName AS FromGodownName,
  so.ToCompanyID,   tc.name AS ToCompanyName,
  so.ToProjectID,   tp.name AS ToProjectName,
  so.ToGodownID,    tg.GodownName AS ToGodownName,
  so.BuyerLHeadId,  ah.LHeadName AS BuyerName,
  so.SaleItems, so.BasicAmount, so.TaxAmount, so.TotalAmount, so.Remarks, so.Status, so.PostedToStock, so.GLPosted,
  so.CreatedBy, so.CreatedAt, so.UpdatedAt
`;

const HEADER_JOINS = `
  FROM dbo.SaleOrders so
  JOIN dbo.enterprise fc ON fc.id = so.FromCompanyID
  JOIN dbo.enterprise fp ON fp.id = so.FromProjectID
  JOIN dbo.Godowns    fg ON fg.GodownID = so.FromGodownID
  LEFT JOIN dbo.enterprise tc ON tc.id = so.ToCompanyID
  LEFT JOIN dbo.enterprise tp ON tp.id = so.ToProjectID
  LEFT JOIN dbo.Godowns    tg ON tg.GodownID = so.ToGodownID
  LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = so.BuyerLHeadId
`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ─── GET list of sale orders ───────────────────────────────────────────────
// dropOnAnyWrite: a sale order's status also changes from the Approval Inbox, which doesn't bump "sale-orders".
router.get("/", requirePageRight("sale-order", "view"), cache("sale-orders", 60, { dropOnAnyWrite: true }), async (req, res) => {
  try {
    const pool = getPool();
    const {
      fromCompany,
      toCompany,
      fromProject,
      toProject,
      buyer,
    } = req.query;
    // Bounded: a bad or huge ?limit used to reach SQL as NaN / any size.
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    const request = pool
      .request()
      .input("limit", sql.Int, limit)
      .input("offset", sql.Int, offset);

    let where = "WHERE 1=1" + soVisibleSql(req.projectScope, "so");
    if (fromCompany) {
      request.input("fromCompany", sql.Int, parseInt(fromCompany));
      where += " AND so.FromCompanyID=@fromCompany";
    }
    if (toCompany) {
      request.input("toCompany", sql.Int, parseInt(toCompany));
      where += " AND so.ToCompanyID=@toCompany";
    }
    if (fromProject) {
      request.input("fromProject", sql.Int, parseInt(fromProject));
      where += " AND so.FromProjectID=@fromProject";
    }
    if (toProject) {
      request.input("toProject", sql.Int, parseInt(toProject));
      where += " AND so.ToProjectID=@toProject";
    }
    if (buyer) {
      request.input("buyer", sql.Int, parseInt(buyer));
      where += " AND so.BuyerLHeadId=@buyer";
    }

    const countReq = pool.request();
    if (fromCompany)
      countReq.input("fromCompany", sql.Int, parseInt(fromCompany));
    if (toCompany) countReq.input("toCompany", sql.Int, parseInt(toCompany));
    if (fromProject)
      countReq.input("fromProject", sql.Int, parseInt(fromProject));
    if (toProject) countReq.input("toProject", sql.Int, parseInt(toProject));
    if (buyer) countReq.input("buyer", sql.Int, parseInt(buyer));
    const countResult = await countReq.query(`
      SELECT COUNT(*) AS total FROM dbo.SaleOrders so ${where}
    `);
    const dbTotal = Number(countResult.recordset[0].total || 0);

    const result = await request.query(`
      SELECT ${HEADER_SELECT}
      ${HEADER_JOINS}
      ${where}
      ORDER BY so.CreatedAt DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const rows = result.recordset.map((r) => ({
      ...r,
      SaleItems: parseItems(r.SaleItems),
    }));

    res.json({ data: rows, total: dbTotal });
  } catch (err) {
    console.error("[sale-orders] GET /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id/posting — the ledger entry for this sale ─────────────────────
// Once approved: the legs actually posted (GeneralLedgerEntry, SourceType 'SaleOrder'). Before that: what approval
// will post — Dr buyer (total) / Cr the company's sales ledger (basic) / Cr GST Output A/c (tax). An older transfer order posts nothing.
router.get("/:id/posting", requirePageRight("sale-order", "view"), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const so = (await pool.request().input("id", sql.Int, id).query(`
      SELECT so.DocNo, so.BuyerLHeadId, ah.LHeadName AS BuyerName, so.BasicAmount, so.TaxAmount, so.TotalAmount, so.GLPosted, so.Status,
             fc.name AS CompanyName, sh.LHeadName AS SalesHeadName
      FROM dbo.SaleOrders so
      LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = so.BuyerLHeadId
      LEFT JOIN dbo.enterprise fc ON fc.id = so.FromCompanyID
      LEFT JOIN dbo.AccountHeadMaster sh ON sh.LHeadCode = CONCAT('SALES-C-', so.FromCompanyID)
      WHERE so.SaleOrderID = @id`)).recordset[0];
    if (!so) return res.status(404).json({ error: "Sale order not found" });
    if (!so.BuyerLHeadId) return res.json({ state: "none", reason: "A transfer between our own godowns posts nothing to the ledger.", rows: [] });

    if (so.GLPosted) {
      const rows = (await pool.request().input("id", sql.Int, id).query(`
        SELECT g.VoucherNo, g.VoucherDate, a.LHeadName AS label, g.DebitAmount, g.CreditAmount, g.Narration
        FROM dbo.GeneralLedgerEntry g JOIN dbo.AccountHeadMaster a ON a.LHeadId = g.LHeadId
        WHERE g.SourceType = 'SaleOrder' AND g.SourceId = @id
        ORDER BY CASE WHEN g.DebitAmount > 0 THEN 0 ELSE 1 END, g.EntryId`)).recordset;
      return res.json({
        state: "posted",
        voucherNo: rows[0]?.VoucherNo ?? so.DocNo,
        voucherDate: rows[0]?.VoucherDate ?? null,
        rows: rows.map((r) => ({
          label: r.label,
          side: Number(r.DebitAmount) > 0 ? "debit" : "credit",
          amount: Number(r.DebitAmount) > 0 ? Number(r.DebitAmount) : Number(r.CreditAmount),
          narration: r.Narration,
        })),
      });
    }

    const total = round2(so.TotalAmount);
    const tax = round2(so.TaxAmount);
    const basic = round2(total - tax);
    const rows = [{ label: so.BuyerName || "Buyer", side: "debit", amount: total }];
    if (basic > 0) rows.push({ label: so.SalesHeadName || `Sales - ${so.CompanyName || "company"}`, side: "credit", amount: basic });
    if (tax > 0) rows.push({ label: "GST Output A/c", side: "credit", amount: tax });
    res.json({
      state: so.Status === "Rejected" ? "rejected" : "preview",
      voucherNo: so.DocNo,
      rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET single sale order ─────────────────────────────────────────────────
router.get("/:id", requirePageRight("sale-order", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, parseInt(req.params.id)).query(`
        SELECT ${HEADER_SELECT}
        ${HEADER_JOINS}
        WHERE so.SaleOrderID = @id
      `);
    if (!result.recordset.length)
      return res.status(404).json({ error: "Sale order not found" });
    const row = {
      ...result.recordset[0],
      SaleItems: parseItems(result.recordset[0].SaleItems),
    };
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST create sale order ────────────────────────────────────────────────
// Sells items out of one of our godowns to a buyer (any ledger head — the Journal Voucher's list). Each line:
// item, UOM, qty, rate, GST %. Same Draft -> Pending -> Approved lifecycle as GRN/PO: creation only records the
// order and auto-submits it; stock goes OUT and the sale is posted to the ledger on final approval (PUT /:id/approve).
router.post("/", requirePageRight("sale-order", "create"), async (req, res) => {
  const pool = getPool();
  if (req.projectScope && !projectAllowed(req.projectScope, parseInt(req.body?.FromProjectID, 10))) {
    return res.status(403).json({ error: "You can only raise a sale order out of one of your own projects." });
  }
  try {
    const {
      FromCompanyID,
      FromProjectID,
      FromGodownID,
      BuyerLHeadId,
      SaleItems, // [{itemId, itemName, qty, uom, rate, gstRate, remarks}]
      Remarks,
      OrderDate,
    } = req.body;

    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    if (!FromCompanyID || !FromProjectID || !FromGodownID)
      return res.status(400).json({ error: "Pick the company, project and godown the items are sold from." });
    const buyerId = parseInt(BuyerLHeadId, 10);
    if (!Number.isFinite(buyerId)) return res.status(400).json({ error: "Pick the buyer." });

    // The godown must belong to the project, and the project to the company (the UI only offers matching ones;
    // a stale tab or script could still post a mismatched triple).
    const check = await pool
      .request()
      .input("godownId", sql.Int, parseInt(FromGodownID))
      .query(`
        SELECT g.GodownID, g.ProjectID, p.company_id AS CompanyID
        FROM dbo.Godowns g
        JOIN dbo.enterprise p ON p.id = g.ProjectID AND p.business_type = 'P'
        WHERE g.GodownID = @godownId
      `);
    const g = check.recordset[0];
    if (!g) return res.status(400).json({ error: "Godown not found or not linked to a project." });
    if (g.ProjectID !== parseInt(FromProjectID)) return res.status(400).json({ error: "The godown does not belong to the selected project." });
    if (g.CompanyID !== parseInt(FromCompanyID)) return res.status(400).json({ error: "The project does not belong to the selected company." });

    const buyerRow = (await pool.request().input("id", sql.Int, buyerId)
      .query("SELECT LHeadId, LHeadName FROM dbo.AccountHeadMaster WHERE LHeadId = @id")).recordset[0];
    if (!buyerRow) return res.status(400).json({ error: "The buyer picked no longer exists." });

    const rawItems = parseItems(SaleItems);
    if (!rawItems.length) return res.status(400).json({ error: "Add at least one item." });

    // Stock is checked at approval (it can move between now and then), not here.
    const items = rawItems.map((it, i) => {
      const qty = Number(it.qty);
      const rate = Number(it.rate);
      const gstRate = Number(it.gstRate) || 0;
      if (!it.itemId) throw new Error(`Line ${i + 1}: pick an item.`);
      if (!(qty > 0)) throw new Error(`Line ${i + 1}: enter a quantity above 0.`);
      if (!(rate >= 0)) throw new Error(`Line ${i + 1}: enter a rate.`);
      if (gstRate < 0 || gstRate > 100) throw new Error(`Line ${i + 1}: GST % must be 0 to 100.`);
      const amount = round2(qty * rate);
      const taxAmount = round2((amount * gstRate) / 100);
      return {
        itemId: String(it.itemId),
        itemName: it.itemName || "",
        qty,
        uom: it.uom || "",
        rate,
        gstRate,
        amount,
        taxAmount,
        total: round2(amount + taxAmount),
        remarks: it.remarks || "",
      };
    });
    const basicAmount = round2(items.reduce((s, it) => s + it.amount, 0));
    const taxAmount = round2(items.reduce((s, it) => s + it.taxAmount, 0));
    const totalAmount = round2(basicAmount + taxAmount);
    if (!(totalAmount > 0)) return res.status(400).json({ error: "The order total must be above 0." });

    const oDate = OrderDate || new Date().toISOString().slice(0, 10);

    // ── Doc number (simple sequential: SO-YYYYMMDD-N) ────────────────────
    const countRes = await pool.request().query(`
      SELECT COUNT(1)+1 AS N FROM dbo.SaleOrders
      WHERE CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)
    `);
    const seq = String(countRes.recordset[0].N).padStart(3, "0");
    const docNo = `SO-${oDate.replace(/-/g, "")}-${seq}`;

    const insertRes = await pool
      .request()
      .input("DocNo", sql.NVarChar(100), docNo)
      .input("OrderDate", sql.Date, oDate)
      .input("FromCompanyID", sql.Int, parseInt(FromCompanyID))
      .input("FromProjectID", sql.Int, parseInt(FromProjectID))
      .input("FromGodownID", sql.Int, parseInt(FromGodownID))
      .input("BuyerLHeadId", sql.Int, buyerId)
      .input("SaleItems", sql.NVarChar(sql.MAX), JSON.stringify(items))
      .input("BasicAmount", sql.Decimal(18, 2), basicAmount)
      .input("TaxAmount", sql.Decimal(18, 2), taxAmount)
      .input("TotalAmount", sql.Decimal(18, 2), totalAmount)
      .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
      .input("CreatedBy", sql.NVarChar(255), userEmail).query(`
        INSERT INTO dbo.SaleOrders
          (DocNo, OrderDate, FromCompanyID, FromProjectID, FromGodownID, BuyerLHeadId,
           SaleItems, BasicAmount, TaxAmount, TotalAmount, Remarks, Status, CreatedBy)
        OUTPUT INSERTED.SaleOrderID
        VALUES
          (@DocNo, @OrderDate, @FromCompanyID, @FromProjectID, @FromGodownID, @BuyerLHeadId,
           @SaleItems, @BasicAmount, @TaxAmount, @TotalAmount, @Remarks, 'Draft', @CreatedBy)
      `);
    const saleOrderId = insertRes.recordset[0].SaleOrderID;

    // ── Auto-submit for approval (Draft -> Pending) ───────────────────────
    let submitResult = { newStatus: "Draft" };
    try {
      submitResult = await transition("sale-orders", saleOrderId, "Pending", userEmail, req.user?.role);
    } catch (submitErr) {
      // Saved as Draft; the user (or an admin) can resubmit later.
      console.error("[sale-orders] auto-submit failed:", submitErr.message);
    }

    await bumpCacheVersion("sale-orders");

    res.status(201).json({
      SaleOrderID: saleOrderId,
      DocNo: docNo,
      BasicAmount: basicAmount,
      TaxAmount: taxAmount,
      TotalAmount: totalAmount,
      Status: submitResult.newStatus,
      message:
        submitResult.newStatus === "Pending"
          ? "Sale order created and sent for approval"
          : "Sale order saved as draft (submission for approval failed — please retry)",
    });
  } catch (err) {
    console.error("[sale-orders] POST /:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── PUT /:id/submit — Draft/Rejected → Pending ─────────────────────────────
router.put("/:id/submit", requirePageRight("sale-order", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const result = await transition(
      "sale-orders",
      id,
      "Pending",
      userEmail,
      req.user?.role,
    );
    await bumpCacheVersion("sale-orders");
    res.json({ message: "Sale order submitted for approval", ...result });
  } catch (err) {
    console.error("[sale-orders] submit error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

/**
 * The selling company's own sales ledger, "Sales - <Company>" (LHeadCode SALES-C-<companyId>, under REVENUE FROM
 * OPERATIONS). Created the first time that company sells, the same way each company gets its own Cash in Hand head
 * (generalLedger.ensureCashInHandHead) — so each company's sales stay apart.
 */
async function ensureCompanySalesHead(pool, companyId, createdBy) {
  const code = `SALES-C-${companyId}`;
  const existing = (await pool.request().input("code", sql.NVarChar(20), code)
    .query("SELECT LHeadId FROM dbo.AccountHeadMaster WHERE LHeadCode = @code")).recordset[0];
  if (existing) return existing.LHeadId;
  const companyName = (await pool.request().input("id", sql.Int, companyId)
    .query("SELECT name FROM dbo.enterprise WHERE id = @id")).recordset[0]?.name || `Company ${companyId}`;
  const group = (await pool.request().query(`
    SELECT TOP 1 AGId FROM dbo.AccountGroup
    WHERE Name = 'REVENUE FROM OPERATIONS' OR Code = 'RO' OR Name LIKE '%REVENUE%'
    ORDER BY CASE WHEN Name = 'REVENUE FROM OPERATIONS' THEN 0 WHEN Code = 'RO' THEN 1 ELSE 2 END`)).recordset[0];
  const inserted = await pool
    .request()
    .input("LHeadName", sql.NVarChar(200), `Sales - ${companyName}`)
    .input("LHeadCode", sql.NVarChar(20), code)
    .input("LBelongsTo", sql.Int, group?.AGId ?? null)
    .input("CompanyName", sql.NVarChar(500), companyName)
    .input("CreatedBy", sql.NVarChar(150), createdBy || "system").query(`
      INSERT INTO dbo.AccountHeadMaster
        (LHeadName, LHeadCode, LHeadAddress, LHeadContactPerson, LHeadType, LHeadStatus, LBelongsTo, Status,
         DisplayName, CompanyName, IsSystemGenerated, ApprovedBy, ApprovedAt, CreatedBy, CreatedAt)
      OUTPUT INSERTED.LHeadId
      VALUES
        (@LHeadName, @LHeadCode, 'N/A', 'System Admin', 'GL', 1, @LBelongsTo, 'Approved',
         @LHeadName, @CompanyName, 1, @CreatedBy, SYSDATETIME(), @CreatedBy, SYSDATETIME())`);
  await bumpCacheVersion("account-head-master").catch(() => {});
  return inserted.recordset[0].LHeadId;
}

/**
 * Posts an approved sale to a buyer: Dr buyer (grand total) / Cr the selling company's sales ledger (basic) /
 * Cr GST Output A/c (tax).
 * Once only (GLPosted). An older transfer order (no buyer) posts nothing — its Sale Invoice does that.
 */
async function postSaleToLedger(pool, id, userEmail) {
  const so = (await pool.request().input("id", sql.Int, id).query(`
    SELECT SaleOrderID, DocNo, OrderDate, FromCompanyID, FromProjectID, BuyerLHeadId,
           BasicAmount, TaxAmount, TotalAmount, GLPosted
    FROM dbo.SaleOrders WHERE SaleOrderID = @id`)).recordset[0];
  if (!so || !so.BuyerLHeadId || so.GLPosted) return { posted: false };
  const { postVoucher, getGLHeadIdByCode } = require("../services/generalLedger");
  const total = round2(so.TotalAmount);
  const tax = round2(so.TaxAmount);
  const basic = round2(total - tax); // the exact rest, so the voucher balances to the paisa
  const legs = [{ lHeadId: so.BuyerLHeadId, debit: total, narration: `${so.DocNo} — Sale Order` }];
  if (basic > 0) legs.push({ lHeadId: await ensureCompanySalesHead(pool, so.FromCompanyID, userEmail), credit: basic, narration: `${so.DocNo} — sales` });
  if (tax > 0) legs.push({ lHeadId: await getGLHeadIdByCode(pool, "SALES-GST-OUTPUT", "GST Output A/c"), credit: tax, narration: `${so.DocNo} — GST output` });
  await postVoucher(pool, {
    voucherNo: so.DocNo,
    voucherDate: so.OrderDate || new Date(),
    sourceType: "SaleOrder",
    sourceId: so.SaleOrderID,
    companyId: so.FromCompanyID ?? null,
    projectId: so.FromProjectID ?? null,
    createdBy: userEmail,
    legs,
  });
  await pool.request().input("id", sql.Int, id).query("UPDATE dbo.SaleOrders SET GLPosted = 1 WHERE SaleOrderID = @id");
  try {
    const { recordGLPosting } = require("../services/approvalService");
    await recordGLPosting("sale-order", id, { posted: true }, userEmail);
  } catch {
    /* the audit note is optional */
  }
  return { posted: true };
}

// ── PUT /:id/approve — Pending → Approved (posts stock on final approval) ──
// No requirePageRight gate — transition() is the real authority (role
// whitelist / approval-inbox edit right / named workflow approver); the
// page-right gate used to 403 a named approver before transition() ever
// ran, same bug fixed for journal-voucher.js.
router.put("/:id/approve", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const pool = getPool();
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    // Work out up front whether this approval would clear the final level —
    // if so, stock must be posted successfully BEFORE we let transition()
    // commit the status to Approved. Otherwise a failed stock-post would
    // leave the record stuck as Approved with nothing actually moved.
    const workflow = await getWorkflow("sale-orders");
    const totalLevels = workflow?.Levels ?? 1;
    const approvedSoFar = await getApprovedLevelCount("SaleOrders", id);
    const isFinalLevel = approvedSoFar + 1 >= totalLevels;

    if (isFinalLevel) {
      // Lock the sale-order row for the whole stock-posting transaction so two
      // concurrent final approvals can't both read PostedToStock=0 and both
      // post stock (double OUT/IN movement). The second blocks on the UPDLOCK,
      // then sees PostedToStock=1 and skips.
      const transaction = pool.transaction();
      await transaction.begin();
      try {
        const headerRes = await transaction
          .request()
          .input("id", sql.Int, id)
          .query(
            `SELECT FromGodownID, ToGodownID, SaleItems, PostedToStock, DocNo
             FROM dbo.SaleOrders WITH (UPDLOCK, HOLDLOCK) WHERE SaleOrderID=@id`,
          );
        const header = headerRes.recordset[0];
        if (!header) throw new Error("Sale order not found");

        if (!header.PostedToStock) {
          const items = parseItems(header.SaleItems);
          // Re-validate stock availability now, since time may have passed
          // since the order was submitted and stock could have moved elsewhere.
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
                VALUES (@ItemID,@Qty,@UOM,'OUT','SO',@RefID,@GodownID,@DocNo,GETDATE())
              `);

            // Only an older transfer order moves the stock into another of our godowns; a sale to a buyer just
            // takes it out.
            if (header.ToGodownID) await transaction
              .request()
              .input("ItemID", sql.NVarChar(50), itemId)
              .input("Qty", sql.Decimal(18, 2), qty)
              .input("UOM", sql.NVarChar(20), uom)
              .input("GodownID", sql.Int, header.ToGodownID)
              .input("DocNo", sql.NVarChar(100), header.DocNo)
              .input("RefID", sql.Int, id).query(`
                INSERT INTO dbo.StockLedger (ItemID,Qty,UOM,Type,RefType,RefID,GodownID,DocNo,CreatedDate)
                VALUES (@ItemID,@Qty,@UOM,'IN','SO',@RefID,@GodownID,@DocNo,GETDATE())
              `);
          }

          await transaction
            .request()
            .input("id", sql.Int, id)
            .query(
              `UPDATE dbo.SaleOrders SET PostedToStock = 1 WHERE SaleOrderID = @id`,
            );
        }

        await transaction.commit();
      } catch (postErr) {
        try {
          await transaction.rollback();
        } catch {}
        // Stock posting failed — do NOT call transition(). The record
        // stays at its current (Pending) status so it can be retried.
        throw postErr;
      }

      // A sale to a buyer is posted to the ledger: Dr buyer (grand total) / Cr Sales A/c (basic) / Cr GST Output A/c
      // (tax). If the posting fails, the stock just taken out is put back and the order stays Pending.
      try {
        await postSaleToLedger(pool, id, userEmail);
      } catch (glErr) {
        await pool.request().input("id", sql.Int, id).query(`
          DELETE FROM dbo.StockLedger WHERE RefType = 'SO' AND RefID = @id;
          UPDATE dbo.SaleOrders SET PostedToStock = 0 WHERE SaleOrderID = @id;`);
        throw new Error(`The sale could not be posted to the ledger, so nothing was approved: ${glErr.message}`);
      }
    }

    // Stock is posted (or this isn't the final level yet) — now it's safe
    // to commit the approval transition itself.
    const result = await transition(
      "sale-orders",
      id,
      "Approved",
      userEmail,
      req.user?.role,
      null,
      req.user?.userId ?? req.user?.id ?? null,
    );

    await bumpCacheVersion("sale-orders");
    if (isFinalLevel) await bumpCacheVersion("inventory-master");

    res.json({
      message: isFinalLevel
        ? "Sale order approved: stock taken out and the sale posted"
        : "Sale order approval recorded",
      ...result,
    });
  } catch (err) {
    console.error("[sale-orders] approve error:", err.message);
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

// ── PUT /:id/reject — Pending → Rejected ───────────────────────────────────
router.put("/:id/reject", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const { note } = req.body;
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const result = await transition(
      "sale-orders",
      id,
      "Rejected",
      userEmail,
      req.user?.role,
      note || null,
      req.user?.userId ?? req.user?.id ?? null,
    );
    await bumpCacheVersion("sale-orders");
    res.json({ message: "Sale order rejected", ...result });
  } catch (err) {
    console.error("[sale-orders] reject error:", err.message);
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

// ── DELETE /:id — only Draft or Rejected sale orders may be deleted ────────
// Deleting a Pending or Approved order would silently reverse stock
// movements / lose an audit trail, so it's blocked here the same way
// material issues, GRNs, etc. guard their delete routes.
router.delete("/:id", requirePageRight("sale-order", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();
    const existing = await pool
      .request()
      .input("id", sql.Int, id)
      .query(
        "SELECT Status, PostedToStock FROM dbo.SaleOrders WHERE SaleOrderID = @id",
      );

    if (!existing.recordset.length)
      return res.status(404).json({ error: "Sale order not found" });

    const { Status, PostedToStock } = existing.recordset[0];
    if (!["Draft", "Rejected"].includes(Status))
      return res.status(409).json({
        error: `Cannot delete a sale order with status "${Status}". Only Draft or Rejected sale orders can be deleted.`,
      });

    if (PostedToStock) {
      await pool
        .request()
        .input("id", sql.Int, id)
        .query("DELETE FROM dbo.StockLedger WHERE RefType='SO' AND RefID=@id");
    }

    await pool
      .request()
      .input("id", sql.Int, id)
      .query(
        "DELETE FROM dbo.ApprovalAuditLog WHERE TableName='SaleOrders' AND RecordId=@id",
      );

    await pool
      .request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.SaleOrders WHERE SaleOrderID = @id");

    await bumpCacheVersion("sale-orders");
    if (PostedToStock) await bumpCacheVersion("inventory-master");

    res.json({ message: "Sale order deleted successfully" });
  } catch (err) {
    console.error("[sale-orders] delete error:", err.message);
    res.status(500).json({ error: "Failed to delete sale order" });
  }
});

module.exports = router;