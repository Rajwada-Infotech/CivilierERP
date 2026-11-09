/**
 * docAmendment.js — the universal amendment logic.
 *
 * An amendment is a proposed new version of an APPROVED document, with a mandatory reason. It is stored in
 * dbo.DocAmendment as Pending and goes through approval like any other record (approval module "doc-amendment").
 * Only when fully approved is it applied: the document is updated and the change cascades down its chain.
 *
 * This sits beside the ordinary edit path, which keeps its own guards (a PO with VIOs / GRNs still can't simply be
 * edited). Each document type plugs in as an adapter:
 *
 *   load(pool, id)                    -> the document as it is now { row, items, docNo, projectId, companyId, value, stamp }
 *   check(pool, id, proposed, current)-> { blockers: string[], cascade: [...], oldValue, newValue }
 *   apply(pool, amendment, userEmail) -> writes the document and its chain (one transaction), then re-posts ledgers
 *
 * First adapter: purchase-order.
 *   - Everything on the PO can change (lines, quantity, rate, GST, discount, header), with a reason.
 *   - Blocked while an invoice (Expense Booking) exists anywhere in the chain — amendments reach as far as GRNs only.
 *   - The supplier can only change while no GRN exists.
 *   - A line that has been received (GRN) or gated in (Vehicle In/Out) can't be removed or cut below what arrived.
 *   - On apply, existing PO lines are updated IN PLACE (their ids are what Vehicle In/Out lines point at); every GRN
 *     of the PO is revalued at the amended rates / GST, and an approved GRN's ledger posting is reversed and posted
 *     again at the new value. Vehicle In/Out records carry quantities only and read the PO's rate, so they follow.
 */
"use strict";

const { getPool, sql } = require("../db");
const { ebCoversGrnSql } = require("./expenseGrnLink");
const { snapshotRow, recordAmendment } = require("./amendmentLog");

/** Any invoice in the chain blocks an amendment. Set false to block only invoices that have a payment against them. */
const BLOCK_ON_ANY_INVOICE = true;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (v) => Math.round(num(v) * 100) / 100;
const parseArr = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
};
const lineName = (it) => String(it?.itemDescription || it?.itemName || "").trim();
const sameItem = (a, b) => (a.itemId && b.itemId ? String(a.itemId) === String(b.itemId) : lineName(a).toLowerCase() === lineName(b).toLowerCase());

// Lazy: routes/purchaseOrders.js pulls in a lot; only load it when a PO amendment is actually applied.
const poHelpers = () => require("../routes/purchaseOrders").poSaveHelpers;

// ─── Purchase Order ──────────────────────────────────────────────────────────

async function loadPO(pool, id) {
  const r = await pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @id");
  const row = r.recordset[0];
  if (!row) return null;
  const lines = (
    await pool
      .request()
      .input("id", sql.Int, id)
      .query("SELECT Id, ItemId, ItemName, Quantity, ReceivedQty, Rate, TaxPct, SortOrder FROM dbo.PurchaseOrderItems WHERE PurchaseOrderID = @id ORDER BY SortOrder, Id")
  ).recordset;
  return {
    row,
    items: parseArr(row.POItems),
    lines,
    docNo: row.DocNo || row.PurchaseOrderNo || `PO-${id}`,
    projectId: row.ProjectId ?? null,
    companyId: row.CompanyId ?? null,
    value: round2(row.TotalAmount),
    // Changes to the PO after the amendment was raised make it stale (it was approved against other figures).
    stamp: row.UpdatedAt ? new Date(row.UpdatedAt).toISOString() : null,
  };
}

/** Pairs each proposed line with the existing PurchaseOrderItems row it amends (same position and item first, then the
 * same item anywhere); the rest are new lines, and existing rows left over are removed. */
function mapPOLines(existing, proposedItems) {
  const used = new Set();
  const pairs = proposedItems.map((line, i) => {
    const atIndex = existing[i];
    if (atIndex && !used.has(atIndex.Id) && sameItem({ itemId: atIndex.ItemId, itemName: atIndex.ItemName }, line)) {
      used.add(atIndex.Id);
      return { line, index: i, row: atIndex };
    }
    return { line, index: i, row: null };
  });
  for (const p of pairs) {
    if (p.row) continue;
    const match = existing.find((e) => !used.has(e.Id) && sameItem({ itemId: e.ItemId, itemName: e.ItemName }, p.line));
    if (match) {
      used.add(match.Id);
      p.row = match;
    }
  }
  return { pairs, removed: existing.filter((e) => !used.has(e.Id)) };
}

/** A GRN's lines at the amended rates and GST: each GRN line takes the rate / GST % of the amended PO line for the same
 * item (the one whose old rate it carried, when the PO has the item twice). Quantities stay as received. */
function revalueGrnItems(grnItems, oldPoItems, newPoItems) {
  return grnItems.map((g) => {
    const candidates = newPoItems.filter((p) => sameItem(p, g));
    if (!candidates.length) return g;
    let pick = candidates[0];
    if (candidates.length > 1) {
      // The PO has this item on more than one line: take the amended line at the position of the old line whose rate
      // this GRN line carried.
      const oldIdx = oldPoItems.findIndex((o) => sameItem(o, g) && round2(o.rate) === round2(g.rate));
      if (oldIdx >= 0 && newPoItems[oldIdx] && sameItem(newPoItems[oldIdx], g)) pick = newPoItems[oldIdx];
    }
    const rate = num(pick.rate);
    const gstPct = pick.tax != null && pick.tax !== "" ? num(pick.tax) : num(g.gstPct);
    const qty = num(g.quantity) || num(g.receivedQty);
    const totalAmount = round2(rate * qty);
    return { ...g, rate, gstPct, totalAmount, gstAmount: round2(totalAmount * (gstPct / 100)) };
  });
}

// Same formula as routes/grns.js computeGRNTotal: base (rate × qty, or the stored line amount) + its GST.
const grnTotal = (items) => round2(items.reduce((s, it) => {
  const base = num(it.totalAmount) > 0 ? num(it.totalAmount) : num(it.rate) * num(it.quantity);
  return s + base + base * (num(it.gstPct) / 100);
}, 0));

async function poChain(pool, id) {
  const grns = (
    await pool
      .request()
      .input("id", sql.Int, id)
      .query("SELECT GRNID, DocNo, GRNNo, Status, GRNItems, TotalAmount FROM dbo.GoodsReceiptNotes WHERE POID = @id AND Status <> 'Rejected' ORDER BY GRNID")
  ).recordset;
  const vios = (
    await pool
      .request()
      .input("id", sql.Int, id)
      .query("SELECT VehicleInOutID, DocNo, Status FROM dbo.VehicleInOut WHERE POID = @id AND ISNULL(Status, '') NOT IN ('Rejected', 'Deleted') ORDER BY VehicleInOutID")
      .catch(() => ({ recordset: [] }))
  ).recordset;
  // Invoices raised straight on the PO, or on any of its GRNs (a merged invoice covers several).
  const req = pool.request().input("id", sql.Int, id);
  const grnConds = grns.map((g, i) => {
    req.input(`g${i}`, sql.Int, g.GRNID);
    return ebCoversGrnSql("eb", `@g${i}`);
  });
  const invoices = (
    await req.query(`
      SELECT eb.Eid, eb.EDocNo, eb.EStatus,
             (SELECT COUNT(*) FROM dbo.NewPayment np
               WHERE np.PExpenseRef = eb.EDocNo AND ISNULL(np.Status, '') NOT IN ('Rejected', 'Deleted')) AS PaymentCount
      FROM dbo.ExpenseBooking eb
      WHERE ISNULL(eb.EStatus, '') <> 'Rejected'
        AND ((eb.ESourceType IN ('PO', 'WO_PO') AND TRY_CAST(eb.ESourceId AS INT) = @id)
             ${grnConds.length ? `OR ${grnConds.join(" OR ")}` : ""})
    `).catch(async () =>
      // Older schemas without the payment link column: count no payments, the invoice itself still blocks.
      req.query(`
        SELECT eb.Eid, eb.EDocNo, eb.EStatus, 0 AS PaymentCount
        FROM dbo.ExpenseBooking eb
        WHERE ISNULL(eb.EStatus, '') <> 'Rejected'
          AND ((eb.ESourceType IN ('PO', 'WO_PO') AND TRY_CAST(eb.ESourceId AS INT) = @id)
               ${grnConds.length ? `OR ${grnConds.join(" OR ")}` : ""})
      `))
  ).recordset;
  return { grns, vios, invoices };
}

async function checkPO(pool, id, proposed, current) {
  const blockers = [];
  const { row } = current;
  if (row.Status !== "Approved") blockers.push("Only an approved Purchase Order can be amended. While it is pending, edit it instead.");

  const items = parseArr(proposed?.POItems);
  if (!items.filter((it) => lineName(it)).length) blockers.push("The amended Purchase Order needs at least one line.");
  if (!proposed?.SupplierID) blockers.push("Choose a supplier.");
  if (!proposed?.PODate) blockers.push("The PO date is required.");

  const { grns, vios, invoices } = await poChain(pool, id);
  const blockingInvoices = BLOCK_ON_ANY_INVOICE ? invoices : invoices.filter((i) => num(i.PaymentCount) > 0);
  if (blockingInvoices.length) {
    const list = blockingInvoices.map((i) => `${i.EDocNo || `#${i.Eid}`}${num(i.PaymentCount) ? " (paid)" : ""}`).join(", ");
    blockers.push(`This Purchase Order already has an invoice (${list}). Amendments reach only as far as GRNs — it can't be amended now.`);
  }
  if (String(proposed?.SupplierID ?? "") !== String(row.SupplierID ?? "") && grns.length) {
    blockers.push("The supplier can't change once a GRN has been made against this Purchase Order.");
  }

  // Lines: a received / gated-in line can't be removed, nor cut below what has arrived.
  const { pairs, removed } = mapPOLines(current.lines, items.filter((it) => lineName(it)));
  const lineIds = current.lines.map((l) => l.Id);
  const vioQty = new Map();
  if (lineIds.length) {
    const vq = await pool
      .request()
      .query(`
        SELECT vi.POItemId, SUM(vi.ReceivedQty) AS Qty
        FROM dbo.VehicleInOutItems vi
        JOIN dbo.VehicleInOut v ON v.VehicleInOutID = vi.VehicleInOutID
        WHERE vi.POItemId IN (${lineIds.map(Number).join(",")}) AND ISNULL(v.Status, '') NOT IN ('Rejected', 'Deleted')
        GROUP BY vi.POItemId
      `)
      .catch(() => ({ recordset: [] }));
    for (const r of vq.recordset) vioQty.set(r.POItemId, num(r.Qty));
  }
  const arrived = (l) => Math.max(num(l.ReceivedQty), vioQty.get(l.Id) ?? 0);
  for (const l of removed) {
    if (arrived(l) > 0) blockers.push(`"${l.ItemName}" has already been received or gated in, so it can't be removed from the Purchase Order.`);
  }
  for (const p of pairs) {
    if (p.row && num(p.line.quantity) < arrived(p.row)) {
      blockers.push(`"${lineName(p.line)}" can't go below ${arrived(p.row)} — that much has already been received or gated in.`);
    }
  }

  // What the amendment does down the chain.
  const oldItems = current.items;
  const cascade = [
    ...grns.map((g) => {
      const revalued = revalueGrnItems(parseArr(g.GRNItems), oldItems, items);
      return { docType: "grn", id: g.GRNID, docNo: g.DocNo || g.GRNNo || `GRN-${g.GRNID}`, status: g.Status, oldValue: round2(g.TotalAmount), newValue: grnTotal(revalued) };
    }),
    // Vehicle In/Out lines hold quantities only; their value is read from the PO, so they follow it.
    ...vios.map((v) => ({ docType: "vehicle-in-out", id: v.VehicleInOutID, docNo: v.DocNo || `VIO-${v.VehicleInOutID}`, status: v.Status, oldValue: null, newValue: null })),
  ];
  return { blockers, cascade, oldValue: current.value, newValue: round2(proposed?.TotalAmount) };
}

async function applyPO(pool, amendment, userEmail) {
  const id = amendment.DocId;
  const proposed = JSON.parse(amendment.ProposedJson);
  const before = JSON.parse(amendment.BeforeJson);
  const current = await loadPO(pool, id);
  if (!current) throw new Error("This Purchase Order no longer exists.");
  if (before.stamp && current.stamp && before.stamp !== current.stamp) {
    throw new Error("The Purchase Order was changed after this amendment was raised. Raise a new amendment against its current figures.");
  }
  const { blockers } = await checkPO(pool, id, proposed, current);
  if (blockers.length) throw new Error(blockers.join(" "));

  const h = poHelpers();
  const items = parseArr(proposed.POItems).filter((it) => lineName(it));
  const { hsnCode, gstType, gstRate } = h.extractGstScalars(proposed.GST);
  const subtotal = h.computeSubtotal(items) ?? 0;
  const uomMap = await h.buildUomMap(pool);
  const fyId = await h.resolveFyId(pool, proposed.finYear);
  const { hasCC, hasVID, hasVIN, hasPT } = await h.getPOCols(pool);
  const { grns } = await poChain(pool, id);
  const beforeSnap = await snapshotRow(pool, "dbo.PurchaseOrders", "PurchaseOrderID", id);
  const revaluedGrns = grns.map((g) => {
    const revalued = revalueGrnItems(parseArr(g.GRNItems), current.items, items);
    return { ...g, items: revalued, total: grnTotal(revalued) };
  });

  const tx = pool.transaction();
  await tx.begin();
  try {
    const q = tx
      .request()
      .input("id", sql.Int, id)
      .input("PODate", sql.Date, proposed.PODate)
      .input("ExpectedDeliveryDate", sql.Date, proposed.ExpectedDeliveryDate || proposed.PODate)
      .input("SupplierID", sql.Int, parseInt(proposed.SupplierID, 10))
      .input("CompanyId", sql.Int, proposed.CompanyId ? parseInt(proposed.CompanyId, 10) : null)
      .input("ProjectId", sql.Int, proposed.ProjectId ? parseInt(proposed.ProjectId, 10) : null)
      .input("ItemDescription", sql.NVarChar(sql.MAX), proposed.ItemDescription || null)
      .input("Quantity", sql.Decimal(18, 2), num(proposed.Quantity))
      .input("Unit", sql.NVarChar(50), proposed.Unit || "NOS")
      .input("Rate", sql.Decimal(18, 2), num(proposed.Rate))
      .input("SubtotalAmount", sql.Decimal(18, 2), subtotal)
      .input("TotalAmount", sql.Decimal(18, 2), num(proposed.TotalAmount))
      .input("HsnCode", sql.NVarChar(20), hsnCode)
      .input("GstType", sql.NVarChar(20), gstType)
      .input("GstRate", sql.Decimal(5, 2), gstRate)
      .input("PaymentTerms", sql.NVarChar(sql.MAX), proposed.PaymentTerms || null)
      .input("Remarks", sql.NVarChar(sql.MAX), proposed.Remarks || null)
      .input("UpdatedBy", sql.NVarChar(100), userEmail)
      .input("UpdatedAt", sql.DateTime2, new Date())
      .input("POItems", sql.NVarChar(sql.MAX), JSON.stringify(items))
      .input("Discount", sql.NVarChar(sql.MAX), h.parseJson(proposed.Discount))
      .input("GST", sql.NVarChar(sql.MAX), h.parseJson(proposed.GST))
      .input("FyId", sql.Int, fyId);
    if (hasCC) q.input("CostCenterId2", sql.Int, proposed.CostCenterId != null && proposed.CostCenterId !== "" ? parseInt(proposed.CostCenterId, 10) : null);
    if (hasVID) q.input("VendorInvoiceDate2", sql.Date, proposed.VendorInvoiceDate || null);
    if (hasVIN) q.input("VendorInvoiceNo2", sql.NVarChar(100), proposed.VendorInvoiceNo || null);
    if (hasPT) q.input("PaymentTermId2", sql.Int, proposed.PaymentTermId ? parseInt(proposed.PaymentTermId, 10) : null);
    // Status stays Approved: the amendment itself was what got approved.
    await q.query(`
      UPDATE dbo.PurchaseOrders SET
        PODate = @PODate, ExpectedDeliveryDate = @ExpectedDeliveryDate, SupplierID = @SupplierID,
        CompanyId = @CompanyId, ProjectId = @ProjectId, ItemDescription = @ItemDescription,
        Quantity = @Quantity, Unit = @Unit, Rate = @Rate, SubtotalAmount = @SubtotalAmount, TotalAmount = @TotalAmount,
        HsnCode = @HsnCode, GstType = @GstType, GstRate = @GstRate, PaymentTerms = @PaymentTerms, Remarks = @Remarks,
        UpdatedBy = @UpdatedBy, UpdatedAt = @UpdatedAt, POItems = @POItems, Discount = @Discount, GST = @GST,
        fy_id = COALESCE(@FyId, fy_id)
        ${hasCC ? ", CostCenterId = @CostCenterId2" : ""}
        ${hasVID ? ", VendorInvoiceDate = @VendorInvoiceDate2" : ""}
        ${hasVIN ? ", VendorInvoiceNo = @VendorInvoiceNo2" : ""}
        ${hasPT ? ", PaymentTermId = @PaymentTermId2" : ""}
      WHERE PurchaseOrderID = @id
    `);

    // Lines in place: a Vehicle In/Out line points at its PO line's id, so an existing line is updated, never
    // deleted and re-inserted. Received quantities and MR links stay with the line.
    const { pairs, removed } = mapPOLines(current.lines, items);
    for (const p of pairs) {
      const it = p.line;
      const qty = num(it.quantity);
      const rate = num(it.rate);
      const uomName = String(it.unit || "").substring(0, 50);
      const lr = tx
        .request()
        .input("ItemId", sql.NVarChar(100), it.itemId || null)
        .input("ItemName", sql.NVarChar(255), lineName(it).substring(0, 255))
        .input("ItemCode", sql.NVarChar(50), it.itemCode || null)
        .input("Desc", sql.NVarChar(sql.MAX), it.description || null)
        .input("Qty", sql.Decimal(18, 4), qty)
        .input("UomId", sql.Int, uomMap[uomName] || null)
        .input("UomName", sql.NVarChar(50), uomName || null)
        .input("Rate", sql.Decimal(18, 4), rate)
        .input("TaxPct", sql.Decimal(5, 2), num(it.tax))
        .input("LineAmt", sql.Decimal(18, 2), num(it.amount) || qty * rate)
        .input("Sort", sql.Int, p.index)
        .input("CostCenterId", sql.Int, it.costCenterId != null && it.costCenterId !== "" ? parseInt(it.costCenterId, 10) : null);
      if (p.row) {
        await lr.input("LineId", sql.Int, p.row.Id).query(`
          UPDATE dbo.PurchaseOrderItems SET
            ItemId = @ItemId, ItemName = @ItemName, ItemCode = @ItemCode, Description = @Desc, Quantity = @Qty,
            UomId = @UomId, UomName = @UomName, Rate = @Rate, TaxPct = @TaxPct, LineAmount = @LineAmt,
            SortOrder = @Sort, CostCenterId = @CostCenterId
          WHERE Id = @LineId
        `);
      } else {
        await lr.input("POID", sql.Int, id).input("MRItemId", sql.Int, it.mrItemId ? parseInt(it.mrItemId, 10) : null).input("Now", sql.DateTime2, new Date()).query(`
          INSERT INTO dbo.PurchaseOrderItems
            (PurchaseOrderID, ItemId, ItemName, ItemCode, Description, Quantity, ReceivedQty, UomId, UomName, Rate, TaxPct,
             LineAmount, SortOrder, MRItemId, CostCenterId, CreatedAt)
          VALUES (@POID, @ItemId, @ItemName, @ItemCode, @Desc, @Qty, 0, @UomId, @UomName, @Rate, @TaxPct,
                  @LineAmt, @Sort, @MRItemId, @CostCenterId, @Now)
        `);
      }
    }
    for (const l of removed) {
      await tx.request().input("LineId", sql.Int, l.Id).query("DELETE FROM dbo.PurchaseOrderItemMRLinks WHERE PurchaseOrderItemId = @LineId").catch(() => {});
      await tx.request().input("LineId", sql.Int, l.Id).query("DELETE FROM dbo.PurchaseOrderItems WHERE Id = @LineId");
    }

    // Every GRN at the amended rates; an approved one's ledger posting is reversed here and posted again below.
    const { reversePostingBySource } = require("./generalLedger");
    for (const g of revaluedGrns) {
      await tx
        .request()
        .input("GRNID", sql.Int, g.GRNID)
        .input("Items", sql.NVarChar(sql.MAX), JSON.stringify(g.items))
        .input("Total", sql.Decimal(18, 2), g.total)
        .query("UPDATE dbo.GoodsReceiptNotes SET GRNItems = @Items, TotalAmount = @Total WHERE GRNID = @GRNID");
      if (g.Status === "Approved") {
        await reversePostingBySource(tx, "GRN", g.GRNID);
        await reversePostingBySource(tx, "GRNPosting", g.GRNID);
      }
    }
    await tx.commit();
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* already rolled back */
    }
    throw err;
  }

  // After the commit, like an ordinary approval: re-post each approved GRN at its new value. A failed posting is
  // recorded (GLPostingLog) and doesn't undo the amendment.
  const { postGRNApproval } = require("./generalLedger");
  const { recordGLPosting } = require("./approvalService");
  for (const g of revaluedGrns.filter((x) => x.Status === "Approved")) {
    try {
      const outcome = await postGRNApproval(pool, g.GRNID, userEmail);
      await recordGLPosting("grn", g.GRNID, outcome, userEmail);
    } catch (e) {
      await recordGLPosting("grn", g.GRNID, { failed: true, reason: `re-post after amendment: ${e.message}` }, userEmail).catch(() => {});
    }
  }

  // The existing audit trail (Amendment page log) records the before / after too.
  try {
    const afterSnap = await snapshotRow(pool, "dbo.PurchaseOrders", "PurchaseOrderID", id);
    await recordAmendment({
      refDocType: "purchase-order",
      refDocId: id,
      refDocNo: afterSnap?.DocNo || current.docNo,
      projectName: null,
      companyName: null,
      changedBy: userEmail,
      before: beforeSnap,
      after: afterSnap,
    });
  } catch (e) {
    console.error("[doc-amendment] audit log for PO failed:", e.message);
  }
  try {
    const { bumpCacheVersion } = require("../redis");
    await bumpCacheVersion("purchase-orders");
    await bumpCacheVersion("grns");
    const { getPoMrIds } = require("./poMrLinks");
    await h.recomputePoMrs(pool, await getPoMrIds(pool, id), userEmail);
  } catch {
    /* caches and MR status catch up on their own */
  }
  return { grnsRevalued: revaluedGrns.length };
}

// ─── Documents applied through their own edit route (Finance) ───────────────
//
// A finance document has no chain to revalue — its own ledger entry is what follows. Applying one runs the document's
// OWN edit route, so every rule that route enforces still holds:
//   1. its ledger posting is reversed and it is set back to Draft — exactly what an edit does to an approved record,
//      except Draft rather than Pending, so approvers aren't told it "needs approval" again;
//   2. the edit route runs with the proposed body, as the person who raised the amendment (who had the page's edit
//      right to raise it). A Draft record is editable without the post-approval right, so nothing is bypassed;
//   3. it is marked Approved again (approved through the amendment) and posted to the ledger by the same poster a
//      normal approval uses.
// Guards an edit route only runs for an APPROVED record (a JV with payments, a CRM refund payout, a CRM receipt) are
// checked here instead — at raising, at every approval level, and again just before applying.

/** Runs an Express route of `router` in-process (validation and page-right middleware included) and resolves with its
 * { status, body }. */
function invokeRoute(router, method, path, { params, body, user }) {
  return new Promise((resolve, reject) => {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    if (!layer) return reject(new Error(`Internal: no ${method.toUpperCase()} ${path} route to apply the amendment with.`));
    let done = false;
    let statusCode = 200;
    const finish = (b) => {
      if (done) return;
      done = true;
      res.headersSent = true;
      resolve({ status: statusCode, body: b });
    };
    const res = {
      headersSent: false,
      locals: {},
      get statusCode() {
        return statusCode;
      },
      status(c) {
        statusCode = c;
        return res;
      },
      json: (b) => (finish(b), res),
      send: (b) => (finish(b), res),
      sendStatus: (c) => ((statusCode = c), finish({}), res),
      end: () => (finish(undefined), res),
      set: () => res,
      setHeader: () => res,
      header: () => res,
      type: () => res,
      getHeader: () => undefined,
      on: () => res,
      once: () => res,
    };
    const req = {
      method: method.toUpperCase(),
      params,
      body,
      user,
      query: {},
      headers: {},
      get: () => undefined,
      header: () => undefined,
      ip: "127.0.0.1",
      path,
      url: path,
      originalUrl: path,
      baseUrl: "",
      id: `amendment-${Date.now()}`,
    };
    Promise.resolve()
      .then(() => layer.route.dispatch(req, res, (err) => (done ? null : err ? ((done = true), reject(err)) : finish({ error: "The edit route did not answer." }))))
      .catch((err) => (done ? null : ((done = true), reject(err))));
  });
}

const firstCol = (row, cols) => {
  for (const c of cols) if (row && row[c] != null && row[c] !== "") return row[c];
  return null;
};
// A row's fingerprint: any change to the document after the amendment was raised makes it stale.
const fingerprint = (row) => JSON.stringify(row, (k, v) => (v instanceof Date ? v.toISOString() : v));

function routeAdapter(cfg) {
  const load = async (pool, id) => {
    const r = await pool.request().input("id", sql.Int, id).query(`SELECT * FROM ${cfg.table} WHERE ${cfg.pk} = @id`);
    const row = r.recordset[0];
    if (!row) return null;
    return {
      row,
      docNo: firstCol(row, cfg.docNoCols) || `${cfg.label} #${id}`,
      projectId: cfg.projectCol ? row[cfg.projectCol] ?? null : null,
      companyId: cfg.companyCol ? row[cfg.companyCol] ?? null : null,
      value: cfg.valueOf ? await cfg.valueOf(pool, id) : round2(firstCol(row, cfg.valueCols)),
      stamp: fingerprint(row),
    };
  };
  const check = async (pool, id, proposed, current) => {
    const blockers = [];
    if (current.row[cfg.status] !== "Approved") blockers.push(`Only an approved ${cfg.label} can be amended. While it is pending, edit it instead.`);
    if (cfg.blockers) blockers.push(...(await cfg.blockers(pool, id, current.row)));
    const newValue = cfg.proposedValueOf ? cfg.proposedValueOf(proposed) : round2(firstCol(proposed, cfg.valueCols));
    return {
      blockers,
      // What follows a finance document: its own ledger entry, re-posted at the new value.
      cascade: cfg.poster ? [{ docType: "ledger", id, docNo: current.docNo, status: "Posted", oldValue: current.value, newValue }] : [],
      oldValue: current.value,
      newValue,
    };
  };
  const apply = async (pool, amendment, approverEmail) => {
    const id = amendment.DocId;
    const proposed = JSON.parse(amendment.ProposedJson);
    const before = JSON.parse(amendment.BeforeJson);
    const requester = amendment.RequesterJson ? JSON.parse(amendment.RequesterJson) : null;
    if (!requester?.userId) throw new Error("This amendment doesn't record who raised it, so it can't be applied. Raise it again.");
    const current = await load(pool, id);
    if (!current) throw new Error(`This ${cfg.label} no longer exists.`);
    if (before.stamp && before.stamp !== current.stamp) {
      throw new Error(`The ${cfg.label} was changed after this amendment was raised. Raise a new amendment against its current figures.`);
    }
    const { blockers } = await check(pool, id, proposed, current);
    if (blockers.length) throw new Error(blockers.join(" "));

    const { reversePostingBySource } = require("./generalLedger");
    const setStatus = (st) =>
      pool.request().input("id", sql.Int, id).input("st", sql.NVarChar(50), st).query(`UPDATE ${cfg.table} SET ${cfg.status} = @st WHERE ${cfg.pk} = @id`);
    // 1. As an edit of an approved record would: reverse its ledger entry (if it posts one); back to Draft for the edit.
    for (const src of cfg.glSources || []) await reversePostingBySource(pool, src, id);
    await setStatus("Draft");
    let out;
    try {
      // 2. Its own edit route, as the requester.
      out = await invokeRoute(require(cfg.routeFile), "put", cfg.routePath || "/:id", { params: { id: String(id) }, body: proposed, user: requester });
    } catch (err) {
      out = { status: 500, body: { error: err.message } };
    }
    if (out.status >= 400) {
      // The edit refused: put the document back exactly as it was (Approved, posted).
      await setStatus("Approved");
      try {
        if (cfg.poster) await cfg.poster(pool, id, approverEmail);
      } catch (e) {
        console.error(`[doc-amendment] could not re-post ${cfg.label} ${id} after a refused edit:`, e.message);
      }
      throw new Error(out.body?.error || out.body?.message || `The ${cfg.label} edit was refused.`);
    }
    // 3. Approved again, through the amendment, and posted at the new value.
    await setStatus("Approved");
    try {
      const { writeAuditLog, recordGLPosting } = require("./approvalService");
      await writeAuditLog(cfg.table.replace("dbo.", ""), id, 0, "amendment", approverEmail, "Approved", `Approved through amendment #${amendment.Id}: ${amendment.Reason}`);
      if (cfg.poster) {
        const outcome = await cfg.poster(pool, id, approverEmail);
        await recordGLPosting(cfg.approvalModule, id, outcome, approverEmail);
      }
    } catch (e) {
      const { recordGLPosting } = require("./approvalService");
      await recordGLPosting(cfg.approvalModule, id, { failed: true, reason: `re-post after amendment: ${e.message}` }, approverEmail).catch(() => {});
    }
    return { reposted: true };
  };
  return { module: cfg.module, label: cfg.label, pageKey: cfg.pageKey, load, check, apply };
}

const gl = () => require("./generalLedger");
const count = async (pool, id, q) => num((await pool.request().input("id", sql.Int, id).query(q)).recordset[0]?.cnt);

const FINANCE_ADAPTERS = {
  "expense-booking": routeAdapter({
    module: "finance",
    label: "Invoice",
    pageKey: "expense-booking",
    approvalModule: "expense-booking",
    table: "dbo.ExpenseBooking",
    pk: "Eid",
    status: "EStatus",
    docNoCols: ["EDocNo"],
    valueCols: ["ENetAmount", "EAmount"],
    glSources: ["ExpenseBooking", "InvoicePosting"],
    poster: (...a) => gl().postExpenseBookingApproval(...a),
    routeFile: "../routes/expenseBooking",
    blockers: async (pool, id) => {
      // Paid: the same rule as material — once a payment exists the invoice can't be amended.
      const { downstreamOfExpenseBooking } = require("../utils/materialChainGuard");
      const by = await downstreamOfExpenseBooking(pool, id);
      return by ? [`This invoice already has ${by}, so it can't be amended.`] : [];
    },
  }),
  payment: routeAdapter({
    module: "finance",
    label: "Payment",
    pageKey: "new-payment",
    approvalModule: "payments",
    table: "dbo.NewPayment",
    pk: "PPaymentID",
    status: "Status",
    docNoCols: ["DocNo", "PChequeNo"],
    valueCols: ["PAmount"],
    // The Payment page sends the amount as "amount".
    proposedValueOf: (proposed) => round2(proposed?.amount ?? proposed?.PAmount),
    glSources: ["NewPayment", "PaymentPosting"],
    poster: (...a) => gl().postPaymentApproval(...a),
    routeFile: "../routes/newPayment",
    blockers: async (pool, id, row) => {
      const out = [];
      if (row.SourceCrmRefundId) out.push("A CRM refund payout can't be amended — its cash may already have moved. Use the reversal workflow.");
      if (row.PIsChequeCancelled) out.push("This payment's cheque was cancelled, so it can't be amended.");
      return out;
    },
  }),
  "received-payment": routeAdapter({
    module: "finance",
    label: "Received Payment",
    pageKey: "received-payment",
    approvalModule: "received-payment",
    table: "dbo.ReceivedPayment",
    pk: "RPPaymentID",
    status: "RPStatus",
    docNoCols: ["RPDocNo"],
    valueCols: ["RPAmount"],
    glSources: ["ReceivedPayment"],
    poster: (...a) => gl().postReceivedPaymentApproval(...a),
    routeFile: "../routes/receivedPayment",
    blockers: async (pool, id, row) =>
      row.CrmBookingId != null || row.CrmMilestoneId != null
        ? ["A CRM-linked receipt can't be amended. Use the payment bounce / reversal workflow, then enter a corrected receipt."]
        : [],
  }),
  "journal-voucher": routeAdapter({
    module: "finance",
    label: "Journal Voucher",
    pageKey: "journal-voucher",
    approvalModule: "journal-voucher",
    table: "dbo.JournalVoucher",
    pk: "JVID",
    status: "Status",
    docNoCols: ["JVNo"],
    valueCols: [],
    // A voucher's value is its total debit, kept on its lines — not on the voucher row.
    valueOf: async (pool, id) =>
      round2((await pool.request().input("id", sql.Int, id).query("SELECT SUM(DebitAmount) AS v FROM dbo.JournalVoucherLines WHERE JVID = @id")).recordset[0]?.v),
    proposedValueOf: (proposed) => round2((Array.isArray(proposed?.lines) ? proposed.lines : []).reduce((t, l) => t + num(l.DebitAmount), 0)),
    glSources: ["JournalVoucher"],
    poster: (...a) => gl().postJournalVoucherApproval(...a),
    routeFile: "../routes/journalVoucher",
    blockers: async (pool, id) => {
      const n = await count(pool, id, `
        SELECT (SELECT COUNT(*) FROM dbo.NewPayment np JOIN dbo.JournalVoucherLines jvl ON jvl.LineID = np.JVLineId WHERE jvl.JVID = @id)
             + (SELECT COUNT(*) FROM dbo.PaymentJvLineLink l JOIN dbo.JournalVoucherLines jvl ON jvl.LineID = l.JVLineId WHERE jvl.JVID = @id) AS cnt`).catch(() => 0);
      return n > 0 ? ["This voucher has payments recorded against it, so it can't be amended."] : [];
    },
  }),
  "fund-transfer": routeAdapter({
    module: "finance",
    label: "Fund Transfer",
    pageKey: "fund-transfer",
    approvalModule: "fund-transfer",
    table: "dbo.FundTransfer",
    pk: "FTId",
    status: "Status",
    docNoCols: ["DocNo"],
    valueCols: ["Amount"],
    glSources: ["FundTransfer"],
    poster: (...a) => gl().postFundTransferApproval(...a),
    routeFile: "../routes/fundTransfer",
    blockers: async (pool, id, row) => {
      const out = [];
      if (row.LinkedLoanId) out.push("This transfer created a loan, so it can't be amended. Reverse the loan first.");
      const n = await count(pool, id, "SELECT COUNT(*) AS cnt FROM dbo.CrmRebookingTransfer WHERE FundTransferId = @id AND Status <> 'PendingTransfer'").catch(() => 0);
      if (n > 0) out.push("This transfer has already been applied to a booking, so it can't be amended.");
      return out;
    },
  }),
};


// ─── Engineering chain: BOQ → Work Order → Work Done ─────────────────────────
//
// A Work Order copies its BOQ's activity rates once, when it is raised (matched by activity, as a rate per unit —
// WorkOrderEditPanel's boqToGroups), and keeps its own after that: a rate negotiated with the contractor is the WO's.
// So a BOQ amendment moves only the WO activities that still carry the BOQ's OLD rate. A Work Done takes its rate
// from the WO only when the WO has a single activity (several make it a lump sum, with no rate to revalue), so a WO
// rate change revalues the Work Done entries of a single-activity WO that still carry its old rate.
// Anything downstream that already has an invoice (a Work Done's, or a PO raised from the WO) blocks the amendment.

const RATE_EPS = 0.01;
const sameRate = (a, b) => Math.abs(num(a) - num(b)) < RATE_EPS;

/** A BOQ activity's rate per unit of area, as a Work Order inherits it (WorkOrderEditPanel boqToGroups). */
function boqPerUnit(a) {
  const hasArea = a?.area != null && a.area !== "" ? true : a?.Area != null;
  const area0 = a?.area ?? a?.Area;
  const qty = num(a?.quantity ?? a?.Quantity);
  const rate = num(a?.rate ?? a?.Rate);
  const legacy = !hasArea && qty !== 1;
  const area = hasArea ? num(area0) : legacy ? qty : 0;
  const total = legacy ? qty * rate : rate;
  return area > 0 ? total / area : 0;
}
const boqActKey = (a) => String(a?.activityId ?? a?.ActivityId ?? "");

async function woActivities(pool, woId) {
  return (
    await pool
      .request()
      .input("id", sql.Int, woId)
      .query("SELECT Id, ActivityId, Rate, Area, LabourAmount, MaterialAmount, GrandTotal, HsnGstRate FROM dbo.WorkOrderActivities WHERE WorkOrderHeaderId = @id ORDER BY Id")
  ).recordset;
}

/** Invoices anywhere below a Work Order: on its Work Done entries, on POs raised from it, or on the WO itself. */
async function woInvoiceBlockers(pool, woId, label) {
  const r = await pool
    .request()
    .input("id", sql.Int, woId)
    .query(`
      SELECT TOP 5 eb.EDocNo, eb.Eid FROM dbo.ExpenseBooking eb
      WHERE ISNULL(eb.EStatus, '') <> 'Rejected' AND (
        (eb.ESourceType = 'WORK_DONE' AND TRY_CAST(eb.ESourceId AS INT) IN (SELECT ID FROM dbo.WorkDone WHERE WorkOrderID = @id))
        OR (eb.ESourceType IN ('PO', 'WO_PO') AND TRY_CAST(eb.ESourceId AS INT) IN (SELECT PurchaseOrderID FROM dbo.PurchaseOrders WHERE SourceWOId = @id))
        OR (eb.ESourceType IN ('WO', 'WORK_ORDER') AND TRY_CAST(eb.ESourceId AS INT) = @id)
      )`)
    .catch(() => ({ recordset: [] }));
  if (!r.recordset.length) return [];
  return [`${label} already has an invoice (${r.recordset.map((x) => x.EDocNo || `#${x.Eid}`).join(", ")}) on its Work Done or its POs, so it can't be amended.`];
}

/** The Work Done entries of a single-activity WO that still carry `oldRate`, at `newRate`. */
async function workDoneAtRate(pool, woId, oldRate, newRate) {
  const rows = (
    await pool
      .request()
      .input("id", sql.Int, woId)
      .query("SELECT ID, DocNo, Status, QuantityDone, RatePerUnit, Deductions, CertifiedAmount FROM dbo.WorkDone WHERE WorkOrderID = @id AND ISNULL(Status, '') <> 'Rejected' ORDER BY ID")
  ).recordset;
  return rows
    .filter((w) => sameRate(w.RatePerUnit, oldRate))
    .map((w) => {
      const gross = round2(num(w.QuantityDone) * num(newRate));
      return { id: w.ID, docNo: w.DocNo || `WD-${w.ID}`, status: w.Status, oldValue: round2(w.CertifiedAmount), gross, certified: round2(gross - num(w.Deductions)), rate: num(newRate) };
    });
}

async function applyWorkDone(db, entries) {
  for (const w of entries) {
    await db
      .request()
      .input("id", sql.Int, w.id)
      .input("rate", sql.Decimal(18, 4), w.rate)
      .input("gross", sql.Decimal(18, 2), w.gross)
      .input("cert", sql.Decimal(18, 2), w.certified)
      .query("UPDATE dbo.WorkDone SET RatePerUnit = @rate, GrossAmount = @gross, CertifiedAmount = @cert WHERE ID = @id");
  }
}

// WO total: Σ (labour + materials) × (1 + GST %) — WorkOrderEditPanel's grandTotal.
const woTotal = (acts) => round2(acts.reduce((t, a) => t + (num(a.LabourAmount) + num(a.MaterialAmount)) * (1 + num(a.HsnGstRate) / 100), 0));

// ── Work Order ──

async function loadWO(pool, id) {
  const r = await pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.WorkOrderHeader WHERE Id = @id");
  const row = r.recordset[0];
  if (!row) return null;
  const acts = await woActivities(pool, id);
  return {
    row,
    acts,
    docNo: row.DocNo || row.DocumentNumber || `WO-${id}`,
    projectId: row.ProjectId ?? null,
    companyId: row.CompanyId ?? null,
    value: round2(row.TotalAmount),
    stamp: fingerprint({ row, acts }),
  };
}

/** The single-activity rate change a WO amendment makes (null when it isn't one). */
function woRateChange(currentActs, proposedActs) {
  if (currentActs.length !== 1 || proposedActs.length !== 1) return null;
  const oldRate = num(currentActs[0].Rate);
  const newRate = num(proposedActs[0].Rate);
  return sameRate(oldRate, newRate) ? null : { oldRate, newRate };
}

async function checkWO(pool, id, proposed, current) {
  const blockers = [];
  if (current.row.Status !== "Approved") blockers.push("Only an approved Work Order can be amended. While it is pending, edit it instead.");
  const acts = Array.isArray(proposed?.activities) ? proposed.activities : null;
  if (!acts) blockers.push("The amended Work Order has no activities.");
  blockers.push(...(await woInvoiceBlockers(pool, id, "This Work Order")));
  const change = acts ? woRateChange(current.acts, acts) : null;
  const wd = change ? await workDoneAtRate(pool, id, change.oldRate, change.newRate) : [];
  return {
    blockers,
    cascade: wd.map((w) => ({ docType: "work-done", id: w.id, docNo: w.docNo, status: w.status, oldValue: w.oldValue, newValue: w.certified })),
    oldValue: current.value,
    newValue: round2(proposed?.header?.TotalAmount),
  };
}

async function applyWO(pool, amendment, approverEmail) {
  const id = amendment.DocId;
  const proposed = JSON.parse(amendment.ProposedJson);
  const before = JSON.parse(amendment.BeforeJson);
  const requester = amendment.RequesterJson ? JSON.parse(amendment.RequesterJson) : null;
  if (!requester?.userId) throw new Error("This amendment doesn't record who raised it, so it can't be applied. Raise it again.");
  const current = await loadWO(pool, id);
  if (!current) throw new Error("This Work Order no longer exists.");
  if (before.stamp && before.stamp !== current.stamp) throw new Error("The Work Order was changed after this amendment was raised. Raise a new amendment against its current figures.");
  const { blockers } = await checkWO(pool, id, proposed, current);
  if (blockers.length) throw new Error(blockers.join(" "));
  const change = woRateChange(current.acts, proposed.activities);
  const wd = change ? await workDoneAtRate(pool, id, change.oldRate, change.newRate) : [];
  const beforeSnap = await snapshotRow(pool, "dbo.WorkOrderHeader", "Id", id);

  // The WO's own bulk save (header + activities + materials, rows updated in place by id), as the requester. It
  // doesn't look at the WO's status, so the WO stays Approved; its "submit for approval" step only acts on a Draft.
  const out = await invokeRoute(require("../routes/workOrder"), "post", "/:id/save-full", { params: { id: String(id) }, body: proposed, user: requester });
  if (out.status >= 400) throw new Error(out.body?.error || out.body?.message || "The Work Order save was refused.");
  if (wd.length) await applyWorkDone(pool, wd);

  try {
    const { writeAuditLog } = require("./approvalService");
    await writeAuditLog("WorkOrderHeader", id, 0, "amendment", approverEmail, "Approved", `Amended through amendment #${amendment.Id}: ${amendment.Reason}`);
    const afterSnap = await snapshotRow(pool, "dbo.WorkOrderHeader", "Id", id);
    await recordAmendment({ refDocType: "work-order", refDocId: id, refDocNo: current.docNo, projectName: null, companyName: null, changedBy: approverEmail, before: beforeSnap, after: afterSnap });
    const { bumpCacheVersion } = require("../redis");
    await bumpCacheVersion("work-orders");
  } catch (e) {
    console.error("[doc-amendment] WO audit after amendment failed:", e.message);
  }
  return { workDoneRevalued: wd.length };
}

// ── BOQ ──

/** Which WOs a BOQ amendment moves: per WO, the activities still carrying the BOQ's old rate per unit, at the new one. */
async function boqCascade(pool, boqId, oldActs, newActs) {
  const oldBy = new Map(oldActs.map((a) => [boqActKey(a), boqPerUnit(a)]));
  const changed = new Map();
  for (const a of newActs) {
    const k = boqActKey(a);
    if (!k || !oldBy.has(k)) continue;
    const nu = boqPerUnit(a);
    if (!sameRate(oldBy.get(k), nu)) changed.set(k, { oldRate: oldBy.get(k), newRate: nu });
  }
  if (!changed.size) return [];
  const wos = (
    await pool
      .request()
      .input("id", sql.Int, boqId)
      .query("SELECT Id, DocNo, DocumentNumber, Status, TotalAmount FROM dbo.WorkOrderHeader WHERE BoqID = @id AND ISNULL(Status, '') <> 'Rejected' ORDER BY Id")
  ).recordset;
  const out = [];
  for (const wo of wos) {
    const acts = await woActivities(pool, wo.Id);
    const moved = [];
    const after = acts.map((a) => {
      const c = changed.get(String(a.ActivityId ?? ""));
      if (!c || !sameRate(a.Rate, c.oldRate)) return a;
      const rate = round2(c.newRate);
      const labour = round2(rate * num(a.Area));
      const next = { ...a, Rate: rate, LabourAmount: labour, GrandTotal: round2(labour + num(a.MaterialAmount)) };
      moved.push(next);
      return next;
    });
    if (!moved.length) continue;
    const wd = acts.length === 1 ? await workDoneAtRate(pool, wo.Id, acts[0].Rate, after[0].Rate) : [];
    out.push({ wo, moved, newTotal: woTotal(after), wd });
  }
  return out;
}

async function loadBOQ(pool, id) {
  const r = await pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.BOQ WHERE BoqID = @id");
  const row = r.recordset[0];
  if (!row) return null;
  return {
    row,
    activities: parseArr(row.BoqActivities),
    docNo: row.DocNo || row.BoqNo || `BOQ-${id}`,
    projectId: row.ProjectId ?? null,
    companyId: row.CompanyId ?? null,
    value: round2(row.TotalAmount),
    stamp: fingerprint(row),
  };
}

// BOQ total: Σ quantity × rate over items and activities (routes/boq.js computeTotal).
const boqTotal = (items, acts) => round2([...items, ...acts].reduce((t, x) => t + num(x.quantity) * num(x.rate), 0));

async function checkBOQ(pool, id, proposed, current) {
  const blockers = [];
  if (current.row.Status !== "Approved") blockers.push("Only an approved BOQ can be amended. While it is pending, edit it instead.");
  const newActs = parseArr(proposed?.BoqActivities);
  const cascade = await boqCascade(pool, id, current.activities, newActs);
  for (const c of cascade) blockers.push(...(await woInvoiceBlockers(pool, c.wo.Id, `Work Order ${c.wo.DocNo || c.wo.DocumentNumber || c.wo.Id}, which follows this BOQ,`)));
  return {
    blockers,
    cascade: cascade.flatMap((c) => [
      { docType: "work-order", id: c.wo.Id, docNo: c.wo.DocNo || c.wo.DocumentNumber || `WO-${c.wo.Id}`, status: c.wo.Status, oldValue: round2(c.wo.TotalAmount), newValue: c.newTotal },
      ...c.wd.map((w) => ({ docType: "work-done", id: w.id, docNo: w.docNo, status: w.status, oldValue: w.oldValue, newValue: w.certified })),
    ]),
    oldValue: current.value,
    newValue: boqTotal(parseArr(proposed?.BoqItems), newActs),
  };
}

async function applyBOQ(pool, amendment, approverEmail) {
  const id = amendment.DocId;
  const proposed = JSON.parse(amendment.ProposedJson);
  const before = JSON.parse(amendment.BeforeJson);
  const requester = amendment.RequesterJson ? JSON.parse(amendment.RequesterJson) : null;
  if (!requester?.userId) throw new Error("This amendment doesn't record who raised it, so it can't be applied. Raise it again.");
  const current = await loadBOQ(pool, id);
  if (!current) throw new Error("This BOQ no longer exists.");
  if (before.stamp && before.stamp !== current.stamp) throw new Error("The BOQ was changed after this amendment was raised. Raise a new amendment against its current figures.");
  const { blockers } = await checkBOQ(pool, id, proposed, current);
  if (blockers.length) throw new Error(blockers.join(" "));
  const cascade = await boqCascade(pool, id, current.activities, parseArr(proposed.BoqActivities));

  // The BOQ's own edit as the requester: back to Draft first (an approved BOQ needs the post-approval right to edit;
  // a Draft one doesn't), then Approved again — approved through the amendment.
  const setStatus = (st) => pool.request().input("id", sql.Int, id).input("st", sql.NVarChar(50), st).query("UPDATE dbo.BOQ SET Status = @st WHERE BoqID = @id");
  await setStatus("Draft");
  let out;
  try {
    out = await invokeRoute(require("../routes/boq"), "put", "/:id", { params: { id: String(id) }, body: proposed, user: requester });
  } catch (err) {
    out = { status: 500, body: { error: err.message } };
  }
  await setStatus("Approved");
  if (out.status >= 400) throw new Error(out.body?.error || out.body?.message || "The BOQ edit was refused.");

  // Down the chain: the WO activities still on the old rate, their WO totals, and a single-activity WO's Work Done.
  const tx = pool.transaction();
  await tx.begin();
  try {
    for (const c of cascade) {
      for (const a of c.moved) {
        await tx
          .request()
          .input("id", sql.Int, a.Id)
          .input("rate", sql.Decimal(18, 2), a.Rate)
          .input("lab", sql.Decimal(18, 4), a.LabourAmount)
          .input("gt", sql.Decimal(18, 4), a.GrandTotal)
          .query("UPDATE dbo.WorkOrderActivities SET Rate = @rate, LabourAmount = @lab, GrandTotal = @gt WHERE Id = @id");
      }
      await tx.request().input("id", sql.Int, c.wo.Id).input("t", sql.Decimal(18, 2), c.newTotal).query("UPDATE dbo.WorkOrderHeader SET TotalAmount = @t WHERE Id = @id");
      await applyWorkDone(tx, c.wd);
    }
    await tx.commit();
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* already rolled back */
    }
    throw new Error(`The BOQ was amended, but its Work Orders could not be updated: ${err.message}`);
  }
  try {
    const { writeAuditLog } = require("./approvalService");
    await writeAuditLog("BOQ", id, 0, "amendment", approverEmail, "Approved", `Approved through amendment #${amendment.Id}: ${amendment.Reason}`);
    const { bumpCacheVersion } = require("../redis");
    await bumpCacheVersion("boq");
    await bumpCacheVersion("work-orders");
  } catch (e) {
    console.error("[doc-amendment] BOQ audit after amendment failed:", e.message);
  }
  return { workOrdersUpdated: cascade.length, workDoneRevalued: cascade.reduce((n, c) => n + c.wd.length, 0) };
}

// Engineering documents applied through their own edit route.
const ENGINEERING_ADAPTERS = {
  "work-order": { module: "engineering", label: "Work Order", pageKey: "engineering-work-order", load: loadWO, check: checkWO, apply: applyWO },
  boq: { module: "engineering", label: "BOQ", pageKey: "boq", load: loadBOQ, check: checkBOQ, apply: applyBOQ },
  // Work Done: quantity × rate − deductions; no ledger entry of its own. Blocked once an invoice is booked on it.
  "work-done": routeAdapter({
    module: "engineering",
    label: "Work Done",
    pageKey: "work-done",
    approvalModule: "work-done",
    table: "dbo.WorkDone",
    pk: "ID",
    status: "Status",
    docNoCols: ["DocNo"],
    valueCols: ["CertifiedAmount", "GrossAmount"],
    proposedValueOf: (p) => round2(p?.CertifiedAmount ?? num(p?.QuantityDone) * num(p?.RatePerUnit) - num(p?.Deductions)),
    routeFile: "../routes/engineering",
    routePath: "/work-done/:id",
    blockers: async (pool, id) => {
      const n = await count(pool, id, `
        SELECT COUNT(*) AS cnt FROM dbo.ExpenseBooking
        WHERE ESourceType = 'WORK_DONE' AND TRY_CAST(ESourceId AS INT) = @id AND ISNULL(EStatus, '') <> 'Rejected'`).catch(() => 0);
      return n > 0 ? ["This Work Done already has an invoice booked on it, so it can't be amended."] : [];
    },
  }),
};

const ADAPTERS = {
  "purchase-order": {
    module: "material",
    label: "Purchase Order",
    // Raising an amendment needs this page right ("edit"), as editing the document would.
    pageKey: "purchase-orders",
    load: loadPO,
    check: checkPO,
    apply: applyPO,
  },
  ...FINANCE_ADAPTERS,
  ...ENGINEERING_ADAPTERS,
};

// ─── Requests ────────────────────────────────────────────────────────────────

function adapterFor(docType) {
  const a = ADAPTERS[docType];
  if (!a) {
    const e = new Error(`Documents of type "${docType}" can't be amended yet.`);
    e.status = 400;
    throw e;
  }
  return a;
}

/** What an amendment would do, without saving it: blockers, downstream documents, old and new value. */
async function previewAmendment(docType, docId, proposed) {
  const a = adapterFor(docType);
  const pool = getPool();
  const current = await a.load(pool, docId);
  if (!current) {
    const e = new Error("That document no longer exists.");
    e.status = 404;
    throw e;
  }
  return { ...(await a.check(pool, docId, proposed, current)), docNo: current.docNo, current };
}

async function createAmendment(docType, docId, proposed, reason, userEmail, requester = null) {
  if (!String(reason || "").trim()) {
    const e = new Error("Give a reason for the amendment.");
    e.status = 400;
    throw e;
  }
  const a = adapterFor(docType);
  const pool = getPool();
  const pending = await pool
    .request()
    .input("t", sql.NVarChar(40), docType)
    .input("id", sql.Int, docId)
    .query("SELECT TOP 1 Id FROM dbo.DocAmendment WHERE DocType = @t AND DocId = @id AND Status IN ('Draft', 'Pending')");
  if (pending.recordset[0]) {
    const e = new Error("An amendment for this document is already waiting for approval. Approve or reject it first.");
    e.status = 409;
    throw e;
  }
  const pv = await previewAmendment(docType, docId, proposed);
  if (pv.blockers.length) {
    const e = new Error(pv.blockers.join(" "));
    e.status = 409;
    e.blockers = pv.blockers;
    throw e;
  }
  const before = { stamp: pv.current.stamp, row: pv.current.row };
  const r = await pool
    .request()
    .input("DocType", sql.NVarChar(40), docType)
    .input("DocId", sql.Int, docId)
    .input("DocNo", sql.NVarChar(100), pv.docNo)
    .input("Module", sql.NVarChar(20), a.module)
    .input("ProjectId", sql.Int, pv.current.projectId)
    .input("CompanyId", sql.Int, pv.current.companyId)
    .input("Reason", sql.NVarChar(2000), String(reason).trim().slice(0, 2000))
    .input("BeforeJson", sql.NVarChar(sql.MAX), JSON.stringify(before))
    .input("ProposedJson", sql.NVarChar(sql.MAX), JSON.stringify(proposed))
    .input("CascadeJson", sql.NVarChar(sql.MAX), JSON.stringify(pv.cascade))
    .input("OldValue", sql.Decimal(18, 2), pv.oldValue)
    .input("NewValue", sql.Decimal(18, 2), pv.newValue)
    .input("RequestedBy", sql.NVarChar(150), userEmail)
    .input("RequesterJson", sql.NVarChar(1000), requester ? JSON.stringify(requester).slice(0, 1000) : null).query(`
      INSERT INTO dbo.DocAmendment
        (DocType, DocId, DocNo, Module, ProjectId, CompanyId, Status, Reason, BeforeJson, ProposedJson, CascadeJson,
         OldValue, NewValue, RequestedBy, RequesterJson)
      OUTPUT INSERTED.Id
      VALUES (@DocType, @DocId, @DocNo, @Module, @ProjectId, @CompanyId, 'Draft', @Reason, @BeforeJson, @ProposedJson,
              @CascadeJson, @OldValue, @NewValue, @RequestedBy, @RequesterJson)
    `);
  // Inserted as Draft; the route submits it (transition to Pending), which starts the approval cycle and notifies approvers.
  return r.recordset[0].Id;
}

async function getAmendment(id, pool = getPool()) {
  const r = await pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.DocAmendment WHERE Id = @id");
  return r.recordset[0] || null;
}

/** Re-checks the guards at approval time (an invoice may have been raised since it was requested). */
async function assertStillAmendable(amendment) {
  const pv = await previewAmendment(amendment.DocType, amendment.DocId, JSON.parse(amendment.ProposedJson));
  if (pv.blockers.length) {
    const e = new Error(pv.blockers.join(" "));
    e.status = 409;
    throw e;
  }
}

/** Applies a fully approved amendment. A failure is stored on the request (ApplyError) so it can be retried. */
async function applyAmendment(id, userEmail) {
  const pool = getPool();
  const am = await getAmendment(id, pool);
  if (!am) throw new Error("Amendment not found.");
  if (am.Status !== "Approved") throw new Error("Only an approved amendment can be applied.");
  if (am.AppliedAt) return { alreadyApplied: true };
  try {
    const out = await adapterFor(am.DocType).apply(pool, am, userEmail);
    await pool
      .request()
      .input("id", sql.Int, id)
      .query("UPDATE dbo.DocAmendment SET AppliedAt = SYSDATETIME(), ApplyError = NULL WHERE Id = @id");
    return { applied: true, ...out };
  } catch (err) {
    await pool
      .request()
      .input("id", sql.Int, id)
      .input("err", sql.NVarChar(2000), String(err.message || err).slice(0, 2000))
      .query("UPDATE dbo.DocAmendment SET ApplyError = @err WHERE Id = @id");
    throw err;
  }
}

module.exports = {
  ADAPTERS,
  previewAmendment,
  createAmendment,
  getAmendment,
  assertStillAmendable,
  applyAmendment,
  // exposed for tests / reuse
  mapPOLines,
  boqPerUnit,
  woTotal,
  revalueGrnItems,
};
