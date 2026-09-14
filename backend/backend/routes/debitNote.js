const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { resolveDocTypeId, lockNextDocNumber, backPatchRecordId } = require("../utils/docNumberLock");
const { syncBillStatus } = require("../utils/syncBillStatus");
const { reverseDebitNotePosting } = require("../services/generalLedger");
const { transition, guardEdit } = require("../services/approvalService");
const { buildGrnGstData } = require("../utils/buildGrnGstData");
const { applyBillingTermsToAmount } = require("../utils/billingTerms");

function userEmail(req) {
  return req.user?.email || req.user?.upn || "system";
}

router.use(authMiddleware);
router.use(apiRateLimit);

// Party Type -> AccountHeadMaster.LHeadType, matches the convention already
// established across SupplierMaster/ContractorMaster/CustomerMaster/CrmBrokerMaster.
const PARTY_TYPES = { S: "Supplier", C: "Contractor", A: "Customer", BR: "Broker" };

function toInt(val) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toDecimal(val) {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : null;
}

// Same "which party is this invoice linked to" condition used by
// onAccount.js's /invoices-for-party — kept identical so a Debit Note can
// only ever be raised against an invoice that's genuinely this party's.
const INVOICE_PARTY_MATCH = `
  grn.SupplierID     = @PartyId
  OR po.SupplierID   = @PartyId
  OR wd.SupplierId   = @PartyId
  OR wo.SupplierId   = @PartyId
  OR wo.ContractorId = @PartyId
  OR eb.LHeadId      = @PartyId
  OR EXISTS (
    SELECT 1 FROM dbo.NewPayment np
    WHERE np.PExpenseRef = eb.EDocNo
      AND np.PPartyId    = @PartyId
      AND np.Status      = 'Approved'
  )
`;

async function computeInvoiceAmount(pool, row) {
  const isMultiGRN = !!row.ELinkedGrnIds;
  let invoiceAmount = null;
  if (!isMultiGRN && row.ESourceType === "GRN" && row.ESourceId) {
    try {
      const grnData = await buildGrnGstData(pool, parseInt(row.ESourceId, 10));
      if (grnData && grnData.totals.netAmount > 0) {
        invoiceAmount = applyBillingTermsToAmount(
          grnData.totals.netAmount, grnData.totals.taxableAmount,
          grnData.cgstRate, grnData.sgstRate,
          row.EBillingTermsData, row.EDiscountData,
        );
      }
    } catch { /* fallback below */ }
  }
  if (invoiceAmount == null && isMultiGRN) {
    invoiceAmount = row.ENetAmount != null ? parseFloat(row.ENetAmount)
      : row.EAmount != null ? parseFloat(row.EAmount) : null;
  }
  if (invoiceAmount == null && row.ENetAmount != null) {
    invoiceAmount = applyBillingTermsToAmount(
      parseFloat(row.ENetAmount), parseFloat(row.EAmount ?? 0),
      parseFloat(row.ECgstRate ?? 0), parseFloat(row.ESgstRate ?? 0),
      row.EBillingTermsData, row.EDiscountData,
    );
  }
  return invoiceAmount;
}

// ─── GET /party-options — unified Party Type -> Party dropdown ──────────────
// Thin wrapper around AccountHeadMaster (this codebase has no separate
// Supplier/Contractor/Customer/Broker tables — see accountHeadMaster.js
// /options), gated behind debit-note:view instead of account-head:view so
// this page doesn't need an extra right grant.
router.get("/party-options", requirePageRight("debit-note", "view"), async (req, res) => {
  const type = String(req.query.type || "").toUpperCase();
  if (!PARTY_TYPES[type]) return res.status(400).json({ error: "Invalid party type" });
  try {
    const pool = getPool();
    const result = await pool.request().input("Type", sql.NVarChar(5), type).query(`
      SELECT LHeadId AS id, LHeadName AS label, RTRIM(LHeadType) AS type
      FROM dbo.AccountHeadMaster
      WHERE LHeadStatus = 1 AND LHeadType = @Type AND ISNULL(LHeadCode, '') NOT LIKE '%CUST%'
      ORDER BY LHeadName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[debitNote] GET /party-options:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /invoices-for-party/:partyId — invoices this party can be debited against
router.get("/invoices-for-party/:partyId", requirePageRight("debit-note", "view"), async (req, res) => {
  const partyId = toInt(req.params.partyId);
  if (!partyId) return res.status(400).json({ error: "Invalid partyId" });
  try {
    const pool = getPool();
    const r = await pool.request().input("PartyId", sql.Int, partyId).query(`
      SELECT DISTINCT
        eb.Eid, eb.EDocNo, eb.ENetAmount, eb.EAmount, eb.ECgstRate, eb.ESgstRate,
        eb.EBillingTermsData, eb.EDiscountData, eb.ESourceType, eb.ESourceId,
        eb.ELinkedGrnIds, eb.ETotalPaid, eb.EBillStatus, eb.ECompanyId,
        TRY_CAST(eb.EProjectName AS INT) AS EProjectId,
        ISNULL(eb.ECreatedAt, GETDATE()) AS ECreatedAt
      FROM dbo.ExpenseBooking eb
      LEFT JOIN dbo.GoodsReceiptNotes grn
        ON eb.ESourceType = 'GRN' AND grn.GRNID = TRY_CAST(eb.ESourceId AS INT)
      LEFT JOIN dbo.PurchaseOrders po
        ON eb.ESourceType IN ('PO','WO_PO') AND po.PurchaseOrderID = TRY_CAST(eb.ESourceId AS INT)
      LEFT JOIN dbo.WorkDone wd
        ON eb.ESourceType = 'WORK_DONE' AND wd.ID = TRY_CAST(eb.ESourceId AS INT)
      LEFT JOIN dbo.WorkOrderHeader wo
        ON eb.ESourceType = 'WO' AND wo.Id = TRY_CAST(eb.ESourceId AS INT)
      WHERE (${INVOICE_PARTY_MATCH})
        AND eb.EDocNo IS NOT NULL
        AND eb.EStatus = 'Approved'
      ORDER BY ECreatedAt DESC
    `);

    const dnRes = await pool.request().input("PartyId", sql.Int, partyId).query(`
      SELECT dn.bill_id, SUM(dn.TotalAmount) AS TotalDebited
      FROM dbo.DebitNote dn
      WHERE dn.is_active = 1
      GROUP BY dn.bill_id
    `);
    const debitedByBillId = new Map(dnRes.recordset.map((row) => [row.bill_id, parseFloat(row.TotalDebited) || 0]));

    const rows = await Promise.all(r.recordset.map(async (row) => {
      const invoiceAmount = await computeInvoiceAmount(pool, row);
      const totalPaid = parseFloat(row.ETotalPaid ?? 0);
      const previousDebitAmount = debitedByBillId.get(row.Eid) || 0;
      const adjustedInvoiceValue = (invoiceAmount ?? 0) + previousDebitAmount;
      return {
        billId: row.Eid,
        docNo: row.EDocNo,
        invoiceAmount,
        previousDebitAmount,
        adjustedInvoiceValue,
        totalPaid,
        remaining: Math.max(0, adjustedInvoiceValue - totalPaid),
        billStatus: row.EBillStatus,
        companyId: row.ECompanyId,
        projectId: row.EProjectId,
        // Drives the frontend's item-picker-vs-amount-adjuster split:
        // GRN/PO/WO_PO/WORK_DONE/WO-sourced invoices (Material Request →
        // PO → GRN, or Work Order → PO) keep the old line-item picker;
        // a direct/TOD invoice (no PO/GRN/WO behind it) gets the
        // value-only amount adjuster.
        sourceType: row.ESourceType ?? null,
      };
    }));
    res.json(rows.filter((r) => r.invoiceAmount != null));
  } catch (err) {
    console.error("[debitNote] GET /invoices-for-party:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /for-invoice/:billId — debit note history for one invoice ──────────
router.get("/for-invoice/:billId", requirePageRight("debit-note", "view"), async (req, res) => {
  const billId = toInt(req.params.billId);
  if (!billId) return res.status(400).json({ error: "Invalid billId" });
  try {
    const pool = getPool();
    const result = await pool.request().input("BillId", sql.Int, billId).query(`
      SELECT dn.id, dn.DocNo, dn.DebitDate, dn.TotalAmount, dn.Reason, dn.Status,
             dn.created_by, u.name AS created_by_name, dn.created_at
      FROM dbo.DebitNote dn
      LEFT JOIN dbo.users u ON u.id = dn.created_by
      WHERE dn.bill_id = @BillId AND dn.is_active = 1
      ORDER BY dn.id DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[debitNote] GET /for-invoice:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET all debit notes ──────────────────────────────────────────────────────
router.get("/", requirePageRight("debit-note", "view"), cache("debit-note", 120), async (req, res) => {
  try {
    const pool = getPool();
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    const request = pool.request();
    if (companyId) request.input("companyId", sql.Int, companyId);
    const result = await request.query(`
      SELECT
        dn.id, dn.DocNo, dn.DebitDate, dn.company_id, dn.project_id,
        dn.supplier_id AS party_id, dn.party_type, dn.bill_id, dn.is_active, dn.created_by,
        dn.created_at, dn.updated_at, dn.Reason, dn.TotalAmount,
        ISNULL(dn.Status, 'Draft') AS Status,
        u.name AS created_by_name,
        co.name AS company_name,
        pr.name AS project_name,
        party.LHeadName AS party_name,
        eb.EDocNo AS invoice_doc_no,
        eb.ESourceType AS invoice_source_type
      FROM dbo.DebitNote dn
      LEFT JOIN dbo.users u ON u.id = dn.created_by
      LEFT JOIN dbo.enterprise co ON co.id = dn.company_id
      LEFT JOIN dbo.enterprise pr ON pr.id = dn.project_id
      LEFT JOIN dbo.AccountHeadMaster party ON party.LHeadId = dn.supplier_id
      LEFT JOIN dbo.ExpenseBooking eb ON eb.Eid = dn.bill_id
      ${companyId ? "WHERE dn.company_id = @companyId" : ""}
      ORDER BY dn.id DESC
    `);

    const ids = result.recordset.map((r) => r.id);
    const itemsByDebitNoteId = new Map();
    if (ids.length) {
      const itemsRes = await pool.request().query(
        `SELECT * FROM dbo.DebitNoteItems WHERE DebitNoteId IN (${ids.join(",")}) ORDER BY ItemId`
      );
      for (const item of itemsRes.recordset) {
        if (!itemsByDebitNoteId.has(item.DebitNoteId)) itemsByDebitNoteId.set(item.DebitNoteId, []);
        itemsByDebitNoteId.get(item.DebitNoteId).push(item);
      }
    }
    const rows = result.recordset.map((r) => ({ ...r, items: itemsByDebitNoteId.get(r.id) ?? [] }));
    res.json(rows);
  } catch (err) {
    console.error("[debitNote] GET /:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET single debit note ────────────────────────────────────────────────
router.get("/:id", requirePageRight("debit-note", "view"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const header = await pool.request().input("id", sql.Int, id).query(`
      SELECT dn.*, dn.supplier_id AS party_id, ISNULL(dn.Status, 'Draft') AS Status,
             co.name AS company_name, pr.name AS project_name,
             party.LHeadName AS party_name, eb.EDocNo AS invoice_doc_no
      FROM dbo.DebitNote dn
      LEFT JOIN dbo.enterprise co ON co.id = dn.company_id
      LEFT JOIN dbo.enterprise pr ON pr.id = dn.project_id
      LEFT JOIN dbo.AccountHeadMaster party ON party.LHeadId = dn.supplier_id
      LEFT JOIN dbo.ExpenseBooking eb ON eb.Eid = dn.bill_id
      WHERE dn.id = @id
    `);
    if (!header.recordset.length) return res.status(404).json({ error: "Not found" });
    const itemsRes = await pool.request().input("id2", sql.Int, id).query(
      `SELECT * FROM dbo.DebitNoteItems WHERE DebitNoteId = @id2 ORDER BY ItemId`
    );
    res.json({ ...header.recordset[0], items: itemsRes.recordset });
  } catch (err) {
    console.error("[debitNote] GET /:id:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function validatePartyAndInvoice(pool, { party_id, party_type, bill_id }) {
  const partyRes = await pool.request().input("PartyId", sql.Int, party_id).query(
    `SELECT LHeadId, RTRIM(LHeadType) AS LHeadType, LHeadName FROM dbo.AccountHeadMaster WHERE LHeadId = @PartyId AND LHeadStatus = 1`
  );
  const party = partyRes.recordset[0];
  if (!party) return { error: "Party not found" };
  if (party.LHeadType !== party_type) return { error: `Selected party does not belong to Party Type '${PARTY_TYPES[party_type] || party_type}'` };

  const invRes = await pool.request().input("BillId", sql.Int, bill_id).input("PartyId", sql.Int, party_id).query(`
    SELECT eb.Eid, eb.EDocNo, eb.ECompanyId, eb.ESourceType, TRY_CAST(eb.EProjectName AS INT) AS EProjectId
    FROM dbo.ExpenseBooking eb
    LEFT JOIN dbo.GoodsReceiptNotes grn ON eb.ESourceType = 'GRN' AND grn.GRNID = TRY_CAST(eb.ESourceId AS INT)
    LEFT JOIN dbo.PurchaseOrders po ON eb.ESourceType IN ('PO','WO_PO') AND po.PurchaseOrderID = TRY_CAST(eb.ESourceId AS INT)
    LEFT JOIN dbo.WorkDone wd ON eb.ESourceType = 'WORK_DONE' AND wd.ID = TRY_CAST(eb.ESourceId AS INT)
    LEFT JOIN dbo.WorkOrderHeader wo ON eb.ESourceType = 'WO' AND wo.Id = TRY_CAST(eb.ESourceId AS INT)
    WHERE eb.Eid = @BillId AND (${INVOICE_PARTY_MATCH})
  `);
  const invoice = invRes.recordset[0];
  if (!invoice) return { error: "Selected invoice does not belong to this party" };

  return { party, invoice };
}

// Item mode (Material Request -> PO -> GRN -> Invoice, or Work Order -> PO)
// vs amount mode (a direct/TOD invoice, no PO/GRN/WO behind it) — same
// split the frontend's PartyInvoiceRenderer uses to decide which UI to show.
// The server re-derives this from the invoice's own ESourceType rather than
// trusting a client-sent flag.
const ITEM_MODE_SOURCE_TYPES = new Set(["GRN", "PO", "WO_PO", "WORK_DONE", "WO"]);

function validItems(items) {
  return (Array.isArray(items) ? items : []).filter((i) => {
    const desc = String(i.Description || i.description || "").trim();
    const amt = parseFloat(i.Amount ?? i.amount);
    return desc && Number.isFinite(amt) && amt >= 0;
  });
}

async function replaceItems(pool, debitNoteId, items) {
  await pool.request().input("DebitNoteId", sql.Int, debitNoteId)
    .query("DELETE FROM dbo.DebitNoteItems WHERE DebitNoteId = @DebitNoteId");
  for (const item of items) {
    await pool.request()
      .input("DebitNoteId", sql.Int, debitNoteId)
      .input("Description", sql.NVarChar(500), String(item.Description || item.description || ""))
      .input("Quantity", sql.Decimal(18, 4), toDecimal(item.Quantity ?? item.quantity))
      .input("UOMSymbol", sql.NVarChar(30), item.UOMSymbol || item.uomSymbol || null)
      .input("Rate", sql.Decimal(18, 4), toDecimal(item.Rate ?? item.rate))
      .input("Amount", sql.Decimal(18, 2), toDecimal(item.Amount ?? item.amount))
      .query(`
        INSERT INTO dbo.DebitNoteItems (DebitNoteId, Description, Quantity, UOMSymbol, Rate, Amount)
        VALUES (@DebitNoteId, @Description, @Quantity, @UOMSymbol, @Rate, @Amount)
      `);
  }
}

// ─── POST — create a Debit Note (item-level for GRN/PO/WO-sourced invoices,
// value-only for a direct/TOD invoice) ───────────────────────────────────────
router.post("/", requirePageRight("debit-note", "create"), async (req, res) => {
  const { company_id, project_id, party_id, party_type, bill_id, DebitDate, Reason, DebitAmount, items } = req.body;

  const company_id_val = toInt(company_id);
  const project_id_val = toInt(project_id);
  const party_id_val = toInt(party_id);
  const bill_id_val = toInt(bill_id);
  const partyType = String(party_type || "").toUpperCase();

  if (!company_id_val || !project_id_val || !party_id_val || !bill_id_val || !PARTY_TYPES[partyType]) {
    return res.status(400).json({ error: "company_id, project_id, party_id, party_type, bill_id are required" });
  }

  try {
    const pool = getPool();
    const email = userEmail(req);
    const createdBy = req.user?.id ?? req.user?.userId ?? null;

    const check = await validatePartyAndInvoice(pool, { party_id: party_id_val, party_type: partyType, bill_id: bill_id_val });
    if (check.error) return res.status(400).json({ error: check.error });

    const isItemMode = ITEM_MODE_SOURCE_TYPES.has(check.invoice.ESourceType);
    const okItems = isItemMode ? validItems(items) : [];
    const debitAmount = isItemMode
      ? okItems.reduce((s, i) => s + (parseFloat(i.Amount ?? i.amount) || 0), 0)
      : parseFloat(DebitAmount);

    if (isItemMode && okItems.length === 0) {
      return res.status(400).json({ error: "At least one item with a valid non-negative amount is required" });
    }
    if (!Number.isFinite(debitAmount) || debitAmount <= 0) {
      return res.status(400).json({ error: "Debit Note Amount must be greater than 0" });
    }

    const docTypeId = await resolveDocTypeId(pool, sql, "DN");
    const docNo = await lockNextDocNumber(pool, sql, {
      docTypeId,
      tableName: "DebitNote",
      docNoColumn: "DocNo",
      issuedBy: email,
    });

    const debitDate = DebitDate ? new Date(DebitDate) : new Date();

    const headerResult = await pool.request()
      .input("company_id", sql.Int, company_id_val)
      .input("project_id", sql.Int, project_id_val)
      .input("supplier_id", sql.Int, party_id_val)
      .input("party_type", sql.Char(2), partyType)
      .input("bill_id", sql.Int, bill_id_val)
      .input("is_active", sql.Bit, 1)
      .input("created_by", sql.Int, createdBy)
      .input("created_at", sql.DateTime2, new Date())
      .input("DocNo", sql.NVarChar(50), docNo)
      .input("DebitDate", sql.Date, debitDate)
      .input("Reason", sql.NVarChar(1000), Reason || null)
      .input("TotalAmount", sql.Decimal(18, 2), debitAmount)
      .input("Status", sql.NVarChar(20), "Draft")
      .query(`
        INSERT INTO dbo.DebitNote
          (company_id, project_id, supplier_id, party_type, bill_id, is_active, created_by, created_at,
           DocNo, DebitDate, Reason, TotalAmount, Status)
        OUTPUT INSERTED.id
        VALUES
          (@company_id, @project_id, @supplier_id, @party_type, @bill_id, @is_active, @created_by, @created_at,
           @DocNo, @DebitDate, @Reason, @TotalAmount, @Status)
      `);
    const newId = headerResult.recordset[0].id;
    await backPatchRecordId(pool, sql, docNo, "DebitNote", newId);
    if (isItemMode) await replaceItems(pool, newId, okItems);
    await bumpCacheVersion("debit-note");

    // Auto-submit: Draft -> Pending immediately, same pattern as Material
    // Requests / Vehicle In/Out / every other module in this codebase — no
    // manual "Submit" step required after creation. GL posting now happens
    // only once an approver clears this from the Approval Inbox (see
    // GL_POSTERS["debit-note"] -> postDebitNoteApproval in
    // services/generalLedger.js), not here.
    try {
      await transition("debit-note", newId, "Pending", email, req.user?.role);
      await bumpCacheVersion("debit-note");
    } catch (submitErr) {
      console.warn(`[debitNote] auto-submit failed for #${newId}:`, submitErr.message);
    }

    res.status(201).json({ message: "Debit note created", id: newId, docNo });
  } catch (err) {
    console.error("[debitNote] POST /:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT — update a Debit Note ───────────────────────────────────────────────
router.put("/:id", requirePageRight("debit-note", "edit"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const { company_id, project_id, party_id, party_type, bill_id, DebitDate, Reason, DebitAmount, items } = req.body;

  const company_id_val = toInt(company_id);
  const project_id_val = toInt(project_id);
  const party_id_val = toInt(party_id);
  const bill_id_val = toInt(bill_id);
  const partyType = String(party_type || "").toUpperCase();

  if (!company_id_val || !project_id_val || !party_id_val || !bill_id_val || !PARTY_TYPES[partyType]) {
    return res.status(400).json({ error: "company_id, project_id, party_id, party_type, bill_id are required" });
  }

  try {
    const pool = getPool();
    const updatedBy = req.user?.id ?? req.user?.userId ?? null;

    const existingRes = await pool.request().input("id", sql.Int, id).query(
      `SELECT id FROM dbo.DebitNote WHERE id = @id`
    );
    if (!existingRes.recordset.length) return res.status(404).json({ error: "Not found" });

    // Pending/Approved records can't be silently rewritten out from under
    // the approval workflow (or an already-posted GL voucher) — a Pending
    // one must be rejected first, an Approved one has no amendment path
    // yet for Debit Note. Only Draft/Rejected records reach the UPDATE below.
    await guardEdit("debit-note", id);

    const check = await validatePartyAndInvoice(pool, { party_id: party_id_val, party_type: partyType, bill_id: bill_id_val });
    if (check.error) return res.status(400).json({ error: check.error });

    const isItemMode = ITEM_MODE_SOURCE_TYPES.has(check.invoice.ESourceType);
    const okItems = isItemMode ? validItems(items) : [];
    const debitAmount = isItemMode
      ? okItems.reduce((s, i) => s + (parseFloat(i.Amount ?? i.amount) || 0), 0)
      : parseFloat(DebitAmount);

    if (isItemMode && okItems.length === 0) {
      return res.status(400).json({ error: "At least one item with a valid non-negative amount is required" });
    }
    if (!Number.isFinite(debitAmount) || debitAmount <= 0) {
      return res.status(400).json({ error: "Debit Note Amount must be greater than 0" });
    }

    const debitDate = DebitDate ? new Date(DebitDate) : new Date();

    await pool.request()
      .input("id", sql.Int, id)
      .input("company_id", sql.Int, company_id_val)
      .input("project_id", sql.Int, project_id_val)
      .input("supplier_id", sql.Int, party_id_val)
      .input("party_type", sql.Char(2), partyType)
      .input("bill_id", sql.Int, bill_id_val)
      .input("updated_by", sql.Int, updatedBy)
      .input("updated_at", sql.DateTime2, new Date())
      .input("DebitDate", sql.Date, debitDate)
      .input("Reason", sql.NVarChar(1000), Reason || null)
      .input("TotalAmount", sql.Decimal(18, 2), debitAmount)
      .query(`
        UPDATE dbo.DebitNote SET
          company_id = @company_id, project_id = @project_id,
          supplier_id = @supplier_id, party_type = @party_type, bill_id = @bill_id,
          updated_by = @updated_by, updated_at = @updated_at,
          DebitDate = @DebitDate, Reason = @Reason, TotalAmount = @TotalAmount
        WHERE id = @id
      `);
    await replaceItems(pool, id, okItems);

    await bumpCacheVersion("debit-note");
    res.json({ message: "Debit note updated" });
  } catch (err) {
    console.error("[debitNote] PUT /:id:", err.message);
    res.status(400).json({ error: err.message || "Internal server error" });
  }
});

// ─── PUT /:id/submit — Draft|Rejected → Pending ──────────────────────────────
router.put("/:id/submit", requirePageRight("debit-note", "edit"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const result = await transition("debit-note", id, "Pending", userEmail(req), req.user?.role);
    await bumpCacheVersion("debit-note");
    res.json({ message: "Submitted for approval", ...result });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ─── PUT /:id/approve — Pending → Approved (posts GL) ────────────────────────
router.put("/:id/approve", requirePageRight("debit-note", "edit"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const result = await transition("debit-note", id, "Approved", userEmail(req), req.user?.role);
    await bumpCacheVersion("debit-note");
    res.json({ message: "Debit note approved", ...result });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ─── PUT /:id/reject — Pending → Rejected ────────────────────────────────────
router.put("/:id/reject", requirePageRight("debit-note", "edit"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const { note } = req.body;
    const result = await transition("debit-note", id, "Rejected", userEmail(req), req.user?.role, note || null);
    await bumpCacheVersion("debit-note");
    res.json({ message: "Debit note rejected", ...result });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ─── DELETE — cancel a Debit Note (soft-cancel + reverse GL) ────────────────
router.delete("/:id", requirePageRight("debit-note", "delete"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid record id" });
  try {
    const pool = getPool();
    const row = await pool.request().input("id", sql.Int, id).query(
      `SELECT bill_id FROM dbo.DebitNote WHERE id = @id`
    );
    if (!row.recordset.length) return res.status(404).json({ error: "Not found" });
    const billId = row.recordset[0].bill_id;

    await reverseDebitNotePosting(pool, id);
    await pool.request().input("id", sql.Int, id).query(
      `UPDATE dbo.DebitNote SET is_active = 0, Status = 'Cancelled' WHERE id = @id`
    );

    const invRes = await pool.request().input("BillId", sql.Int, billId).query(
      `SELECT EDocNo FROM dbo.ExpenseBooking WHERE Eid = @BillId`
    );
    if (invRes.recordset[0]?.EDocNo) await syncBillStatus(pool, sql, invRes.recordset[0].EDocNo);

    await bumpCacheVersion("debit-note");
    res.json({ message: "Debit note cancelled" });
  } catch (err) {
    console.error("[debitNote] DELETE /:id:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
