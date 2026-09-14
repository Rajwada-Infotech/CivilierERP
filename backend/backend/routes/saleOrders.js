const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
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
  so.SaleItems, so.TotalAmount, so.Remarks, so.Status, so.PostedToStock,
  so.CreatedBy, so.CreatedAt, so.UpdatedAt
`;

const HEADER_JOINS = `
  FROM dbo.SaleOrders so
  JOIN dbo.enterprise fc ON fc.id = so.FromCompanyID
  JOIN dbo.enterprise fp ON fp.id = so.FromProjectID
  JOIN dbo.Godowns    fg ON fg.GodownID = so.FromGodownID
  JOIN dbo.enterprise tc ON tc.id = so.ToCompanyID
  JOIN dbo.enterprise tp ON tp.id = so.ToProjectID
  JOIN dbo.Godowns    tg ON tg.GodownID = so.ToGodownID
`;

// ─── GET list of sale orders ───────────────────────────────────────────────
router.get("/", requirePageRight("sale-order", "view"), cache("sale-orders", 60), async (req, res) => {
  try {
    const pool = getPool();
    const {
      fromCompany,
      toCompany,
      fromProject,
      toProject,
      limit = 100,
      page = 1,
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const request = pool
      .request()
      .input("limit", sql.Int, parseInt(limit))
      .input("offset", sql.Int, offset);

    let where = "WHERE 1=1";
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

    const countReq = pool.request();
    if (fromCompany)
      countReq.input("fromCompany", sql.Int, parseInt(fromCompany));
    if (toCompany) countReq.input("toCompany", sql.Int, parseInt(toCompany));
    if (fromProject)
      countReq.input("fromProject", sql.Int, parseInt(fromProject));
    if (toProject) countReq.input("toProject", sql.Int, parseInt(toProject));
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
// Sale orders go through the same Draft -> Pending -> Approved/Rejected
// lifecycle as GRN/BOQ/PurchaseOrders. Creation only records the header +
// items; stock is NOT touched here. Every new order is auto-submitted for
// approval immediately after creation (Draft -> Pending), so it shows up
// in the Approval Inbox right away. StockLedger OUT/IN entries are only
// posted once the order clears its final approval level (see PUT /:id/approve).
router.post("/", requirePageRight("sale-order", "create"), async (req, res) => {
  const pool = getPool();
  try {
    const {
      FromCompanyID,
      FromProjectID,
      FromGodownID,
      ToCompanyID,
      ToProjectID,
      ToGodownID,
      SaleItems, // [{itemId, itemName, qty, uom, rate, remarks}]
      Remarks,
      OrderDate,
    } = req.body;

    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    if (
      !FromCompanyID ||
      !FromProjectID ||
      !FromGodownID ||
      !ToCompanyID ||
      !ToProjectID ||
      !ToGodownID
    )
      return res.status(400).json({
        error:
          "FromCompanyID, FromProjectID, FromGodownID, ToCompanyID, ToProjectID and ToGodownID are all required",
      });
    if (FromGodownID === ToGodownID)
      return res
        .status(400)
        .json({ error: "Source and destination godown must differ" });

    // ── Verify each Company/Project/Godown triple is internally consistent ──
    // The UI only ever derives FromGodownID/ToGodownID from the selected
    // project, so this never fires from normal use — but nothing stops a
    // stale tab, script, or future caller from posting a mismatched triple
    // (the same bug class that made Stock.tsx/StockTransfer.tsx godowns
    // invisible when EnterpriseID didn't match: see migrations 105/106).
    // Confirm up front instead of trusting the request body.
    const triples = [
      {
        label: "From",
        companyId: FromCompanyID,
        projectId: FromProjectID,
        godownId: FromGodownID,
      },
      {
        label: "To",
        companyId: ToCompanyID,
        projectId: ToProjectID,
        godownId: ToGodownID,
      },
    ];
    for (const t of triples) {
      const check = await pool
        .request()
        .input("godownId", sql.Int, parseInt(t.godownId))
        .input("projectId", sql.Int, parseInt(t.projectId))
        .input("companyId", sql.Int, parseInt(t.companyId)).query(`
          SELECT g.GodownID, g.ProjectID, p.company_id AS CompanyID
          FROM dbo.Godowns g
          JOIN dbo.enterprise p ON p.id = g.ProjectID AND p.business_type = 'P'
          WHERE g.GodownID = @godownId
        `);

      if (!check.recordset.length)
        return res.status(400).json({
          error: `${t.label} godown not found or not linked to a project`,
        });

      const row = check.recordset[0];
      if (row.ProjectID !== parseInt(t.projectId))
        return res.status(400).json({
          error: `${t.label} godown does not belong to the selected project`,
        });
      if (row.CompanyID !== parseInt(t.companyId))
        return res.status(400).json({
          error: `${t.label} project does not belong to the selected company`,
        });
    }

    const rawItems = parseItems(SaleItems);
    if (!rawItems.length)
      return res.status(400).json({ error: "At least one item is required" });

    // Normalize rate/amount per item. Stock availability is only checked
    // at approval time (not here), since stock hasn't moved yet and may
    // change between submission and approval.
    const items = rawItems.map((it) => {
      const qty = Number(it.qty);
      const rate = Number(it.rate) || 0;
      if (!it.itemId || !(qty > 0))
        throw new Error(`Invalid item entry: itemId=${it.itemId} qty=${qty}`);
      return {
        itemId: it.itemId,
        itemName: it.itemName || "",
        qty,
        uom: it.uom || "",
        rate,
        amount: Math.round(qty * rate * 100) / 100,
        remarks: it.remarks || "",
        // Revenue GL Head this item posts to once invoiced — see
        // createSaleInvoiceInternal's GL posting in saleInvoices.js.
        glHeadId: it.glHeadId ? parseInt(it.glHeadId, 10) : null,
      };
    });
    const totalAmount =
      Math.round(items.reduce((sum, it) => sum + it.amount, 0) * 100) / 100;

    const oDate = OrderDate || new Date().toISOString().slice(0, 10);

    // ── Build a doc number (simple sequential: SO-YYYYMMDD-N) ────────────
    const countRes = await pool.request().query(`
      SELECT COUNT(1)+1 AS N FROM dbo.SaleOrders
      WHERE CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)
    `);
    const seq = String(countRes.recordset[0].N).padStart(3, "0");
    const ymd = oDate.replace(/-/g, "");
    const docNo = `SO-${ymd}-${seq}`;

    // ── Insert SaleOrders header as Draft ─────────────────────────────────
    const insertRes = await pool
      .request()
      .input("DocNo", sql.NVarChar(100), docNo)
      .input("OrderDate", sql.Date, oDate)
      .input("FromCompanyID", sql.Int, parseInt(FromCompanyID))
      .input("FromProjectID", sql.Int, parseInt(FromProjectID))
      .input("FromGodownID", sql.Int, parseInt(FromGodownID))
      .input("ToCompanyID", sql.Int, parseInt(ToCompanyID))
      .input("ToProjectID", sql.Int, parseInt(ToProjectID))
      .input("ToGodownID", sql.Int, parseInt(ToGodownID))
      .input("SaleItems", sql.NVarChar(sql.MAX), JSON.stringify(items))
      .input("TotalAmount", sql.Decimal(18, 2), totalAmount)
      .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
      .input("CreatedBy", sql.NVarChar(255), userEmail).query(`
        INSERT INTO dbo.SaleOrders
          (DocNo, OrderDate, FromCompanyID, FromProjectID, FromGodownID,
           ToCompanyID, ToProjectID, ToGodownID, SaleItems, TotalAmount,
           Remarks, Status, CreatedBy)
        OUTPUT INSERTED.SaleOrderID
        VALUES
          (@DocNo, @OrderDate, @FromCompanyID, @FromProjectID, @FromGodownID,
           @ToCompanyID, @ToProjectID, @ToGodownID, @SaleItems, @TotalAmount,
           @Remarks, 'Draft', @CreatedBy)
      `);
    const saleOrderId = insertRes.recordset[0].SaleOrderID;

    // ── Auto-submit for approval (Draft -> Pending) ───────────────────────
    let submitResult = { newStatus: "Draft" };
    try {
      submitResult = await transition(
        "sale-orders",
        saleOrderId,
        "Pending",
        userEmail,
        req.user?.role,
      );
    } catch (submitErr) {
      // Header is already saved as Draft; surface the submit failure but
      // don't lose the record — the user (or an admin) can resubmit later.
      console.error("[sale-orders] auto-submit failed:", submitErr.message);
    }

    await bumpCacheVersion("sale-orders");

    res.status(201).json({
      SaleOrderID: saleOrderId,
      DocNo: docNo,
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
  const id = parseInt(req.params.id, 10);
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

// ── PUT /:id/approve — Pending → Approved (posts stock on final approval) ──
router.put("/:id/approve", requirePageRight("sale-order", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
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

            await transaction
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
    }

    // Stock is posted (or this isn't the final level yet) — now it's safe
    // to commit the approval transition itself.
    const result = await transition(
      "sale-orders",
      id,
      "Approved",
      userEmail,
      req.user?.role,
    );

    await bumpCacheVersion("sale-orders");
    if (isFinalLevel) await bumpCacheVersion("inventory-master");

    res.json({
      message: isFinalLevel
        ? "Sale order approved and stock posted"
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
router.put("/:id/reject", requirePageRight("sale-order", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
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