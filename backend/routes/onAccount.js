const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const requireAuth = require("../middleware/auth");
const { requirePageRight, requireAnyPageRight } = require("../middleware/requirePageRight");
const { resolvePartyFromRef } = require("../utils/resolvePartyFromRef");
const { applyBillingTermsToAmount } = require("../utils/billingTerms");
const { buildGrnGstData }           = require("../utils/buildGrnGstData");
const { syncBillStatus }            = require("../utils/syncBillStatus");
const { getOAAdjustmentsForInvoice } = require("../utils/oaAdjustments");

router.use(requireAuth);
// Every route below previously had ONLY requireAuth (i.e. "is logged in",
// no role/page check at all) — any authenticated user of any role could
// move money between a party's on-account balance and any invoice. Gated
// the same way every other finance route file does, using the
// "on-account-adjustment" page key (view/create actions) already registered
// for this screen.

const PARTY_LABEL = { S: "Supplier", C: "Contractor", A: "Customer" };

// ── GET /balance/:partyId — running balance for a party ───────────────────
// Reads the materialized AccountHeadMaster.OnAccountBalance column — kept in
// lockstep with every dbo.OnAccountLedger write (see newPayment.js approve
// hook and POST /apply-adjustment below) — rather than summing the ledger on
// every call. dbo.OnAccountLedger remains the full audit trail (used by
// /report), this is just the fast current-balance read.
router.get("/balance/:partyId", requirePageRight("on-account-adjustment", "view"), async (req, res) => {
  const partyId = parseInt(req.params.partyId, 10);
  if (!partyId) return res.status(400).json({ error: "Invalid partyId" });
  try {
    const pool = getPool();
    const r = await pool.request().input("PartyId", sql.Int, partyId).query(`
      SELECT ISNULL(OnAccountBalance, 0) AS balance FROM dbo.AccountHeadMaster WHERE LHeadId = @PartyId
    `);
    const balance = Math.max(0, parseFloat(r.recordset[0]?.balance ?? 0));
    res.json({ partyId, balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /balance-by-ref/:expenseRef — resolve party from invoice ref, return balance
router.get("/balance-by-ref/:expenseRef", requirePageRight("on-account-adjustment", "view"), async (req, res) => {
  const expenseRef = decodeURIComponent(req.params.expenseRef);
  try {
    const pool = getPool();
    const party = await resolvePartyFromRef(pool, expenseRef);
    if (!party) return res.json({ balance: 0, partyId: null, partyType: null });
    const r = await pool.request().input("PartyId", sql.Int, party.partyId).query(`
      SELECT ISNULL(OnAccountBalance, 0) AS balance FROM dbo.AccountHeadMaster WHERE LHeadId = @PartyId
    `);
    const balance = Math.max(0, parseFloat(r.recordset[0]?.balance ?? 0));
    res.json({ ...party, balance, partyLabel: PARTY_LABEL[party.partyType] ?? party.partyType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /record — internal: called by payment flow to create/adjust OA entries
// Body: { partyId, partyType, txnDate, txnType, amount, refType, refDocNo, refId, adjRefDocNo, companyId, projectId, notes, createdBy }
router.post("/record", requirePageRight("on-account-adjustment", "create"), async (req, res) => {
  const { partyId, partyType, txnDate, txnType, amount, refType, refDocNo, refId, adjRefDocNo, companyId, projectId, notes } = req.body;
  const createdBy = req.user?.email || "system";
  if (!partyId || !txnType || !amount || amount <= 0) return res.status(400).json({ error: "Missing required fields" });
  try {
    const pool = getPool();

    // This is an "internal" route in name only — it's reachable directly by
    // anyone holding on-account-adjustment/create, and previously trusted
    // refId with zero verification. That let a caller mint an arbitrary
    // CREDIT (inflating a party's OnAccountBalance) by passing a refId that
    // was never approved, didn't belong to that party, or had already been
    // used to fund an earlier ledger entry (replaying one approved payment
    // into multiple credits). CREDIT entries now must point at a real,
    // approved source row, and that source can only be used once.
    // NOTE: NewPayment's PPartyId/Status columns are confirmed from
    // invoices-for-party above; ReceivedPayment has no confirmed PartyId
    // column in what I've read, so that branch checks status/amount only —
    // flag if RPPartyId (or equivalent) exists and should be added here.
    if (String(txnType).toUpperCase() === "CREDIT") {
      if (!refId || !refType) {
        return res.status(400).json({ error: "refId and refType are required for a CREDIT entry" });
      }
      const rid = parseInt(refId, 10);
      const amt = parseFloat(amount);
      let sourceOk = false;

      if (refType === "Payment") {
        const src = await pool.request().input("id", sql.Int, rid).query(
          `SELECT PPartyId, Status, PAmount FROM dbo.NewPayment WHERE PPaymentID = @id`
        );
        const row = src.recordset[0];
        sourceOk = !!row && row.Status === "Approved" && row.PPartyId === partyId && parseFloat(row.PAmount) >= amt;
      } else if (refType === "ReceivedPayment") {
        const src = await pool.request().input("id", sql.Int, rid).query(
          `SELECT RPStatus, RPAmount FROM dbo.ReceivedPayment WHERE RPPaymentID = @id`
        );
        const row = src.recordset[0];
        sourceOk = !!row && row.RPStatus === "Approved" && parseFloat(row.RPAmount) >= amt;
      } else {
        return res.status(400).json({ error: `Unrecognized refType '${refType}' for a CREDIT entry` });
      }

      if (!sourceOk) {
        return res.status(400).json({ error: "refId does not reference an approved payment for this party/amount" });
      }

      const dup = await pool.request().input("rt", sql.NVarChar(30), refType).input("rid", sql.Int, rid).query(
        `SELECT TOP 1 OAId FROM dbo.OnAccountLedger WHERE RefType = @rt AND RefId = @rid AND TxnType = 'CREDIT'`
      );
      if (dup.recordset.length) {
        return res.status(409).json({ error: "This payment has already been recorded on-account" });
      }
    }

    const r = await pool.request()
      .input("PartyId",     sql.Int,           partyId)
      .input("PartyType",   sql.NVarChar(20),  partyType ?? "")
      .input("TxnDate",     sql.Date,          txnDate ? new Date(txnDate) : new Date())
      .input("TxnType",     sql.NVarChar(10),  txnType)
      .input("Amount",      sql.Decimal(18,2), parseFloat(amount))
      .input("RefType",     sql.NVarChar(30),  refType ?? "Payment")
      .input("RefDocNo",    sql.NVarChar(100), refDocNo ?? null)
      .input("RefId",       sql.Int,           refId ? parseInt(refId) : null)
      .input("AdjRefDocNo", sql.NVarChar(100), adjRefDocNo ?? null)
      .input("CompanyId",   sql.Int,           companyId ?? null)
      .input("ProjectId",   sql.Int,           projectId ?? null)
      .input("Notes",       sql.NVarChar(500), notes ?? null)
      .input("CreatedBy",   sql.NVarChar(150), createdBy)
      .query(`
        INSERT INTO dbo.OnAccountLedger
          (PartyId,PartyType,TxnDate,TxnType,Amount,RefType,RefDocNo,RefId,AdjRefDocNo,CompanyId,ProjectId,Notes,CreatedBy)
        OUTPUT INSERTED.OAId
        VALUES
          (@PartyId,@PartyType,@TxnDate,@TxnType,@Amount,@RefType,@RefDocNo,@RefId,@AdjRefDocNo,@CompanyId,@ProjectId,@Notes,@CreatedBy);
        UPDATE dbo.AccountHeadMaster
          SET OnAccountBalance = OnAccountBalance + (CASE WHEN @TxnType = 'CREDIT' THEN @Amount ELSE -@Amount END)
          WHERE LHeadId = @PartyId;
      `);
    res.status(201).json({ oaId: r.recordset[0].OAId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /invoices-for-party/:partyId — invoices linked to a specific supplier/contractor
router.get("/invoices-for-party/:partyId", requirePageRight("on-account-adjustment", "view"), async (req, res) => {
  const partyId = parseInt(req.params.partyId, 10);
  if (!partyId) return res.status(400).json({ error: "Invalid partyId" });
  try {
    const pool = getPool();
    const r = await pool.request().input("PartyId", sql.Int, partyId).query(`
      SELECT DISTINCT
        eb.EDocNo,
        eb.ENetAmount,
        eb.EAmount,
        eb.ECgstRate,
        eb.ESgstRate,
        eb.EBillingTermsData,
        eb.EDiscountData,
        eb.ESourceType,
        eb.ESourceId,
        eb.ELinkedGrnIds,
        eb.ETotalPaid,
        eb.EBillStatus,
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
      WHERE (
        grn.SupplierID     = @PartyId
        OR po.SupplierID   = @PartyId
        OR wd.SupplierId   = @PartyId
        OR wo.SupplierId   = @PartyId
        OR wo.ContractorId = @PartyId
        OR eb.LHeadId      = @PartyId
        -- Covers INV/, PAY/, CON/, DPO/, ICT/, QPO/, WD/, etc.
        -- where LHeadId may be NULL but a payment with PPartyId exists
        OR EXISTS (
          SELECT 1 FROM dbo.NewPayment np
          WHERE np.PExpenseRef = eb.EDocNo
            AND np.PPartyId    = @PartyId
            AND np.Status      = 'Approved'
        )
      )
      AND eb.EDocNo IS NOT NULL
      AND eb.EStatus = 'Approved'
      ORDER BY ECreatedAt DESC
    `);
    const rows = await Promise.all(r.recordset.map(async (row) => {
      // Multi-GRN combined invoices (see MaterialExpenseBooking's "combine
      // multiple GRNs" flow) have several source GRNs — ESourceId is only
      // the primary one. Recomputing from it alone would silently
      // understate the invoice (as it did before this fix); their stored
      // ENetAmount is already the correct combined total with billing
      // terms applied, so use it directly without reapplying terms.
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
        } catch { /* fallback */ }
      }
      if (invoiceAmount == null && isMultiGRN) {
        invoiceAmount = row.ENetAmount != null
          ? parseFloat(row.ENetAmount)
          : row.EAmount != null
            ? parseFloat(row.EAmount)
            : null;
      }
      if (invoiceAmount == null && row.ENetAmount != null) {
        invoiceAmount = applyBillingTermsToAmount(
          parseFloat(row.ENetAmount), parseFloat(row.EAmount ?? 0),
          parseFloat(row.ECgstRate ?? 0), parseFloat(row.ESgstRate ?? 0),
          row.EBillingTermsData, row.EDiscountData,
        );
      }
      const totalPaid = parseFloat(row.ETotalPaid ?? 0);
      return {
        docNo: row.EDocNo,
        invoiceAmount,
        totalPaid,
        remaining: Math.max(0, (invoiceAmount ?? 0) - totalPaid),
        billStatus: row.EBillStatus,
      };
    }));
    res.json(rows.filter((r) => r.invoiceAmount != null));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /apply-adjustment — apply OA balance to an invoice ───────────────
// Body: { expenseRef, amount (to apply), partyId? (override), paymentId?, paymentDocNo? }
// No second approval step here, deliberately — unlike a brand-new payment
// entering the system, this reallocates a balance that was already approved
// when it first arrived (same reasoning as CRM's own on-account-to-milestone
// sweep, also legitimately no-approval). The control that matters here is
// WHO can call this — requirePageRight below — plus a clear, queryable
// audit trail: every adjustment already lands in dbo.OnAccountLedger with
// CreatedBy/TxnDate/Notes (visible via GET /report), and is logged here too
// for fast incident-response grep.
router.post("/apply-adjustment", requirePageRight("on-account-adjustment", "create"), async (req, res) => {
  const { expenseRef, amount, paymentDocNo, paymentId, partyId: bodyPartyId } = req.body;
  const createdBy = req.user?.email || "system";
  if (!expenseRef || !amount || amount <= 0) return res.status(400).json({ error: "expenseRef and amount required" });
  try {
    const pool = getPool();

    // Resolve party — prefer explicitly supplied partyId (known from OA entry)
    let party = null;
    if (bodyPartyId) {
      const typeRes = await pool.request().input("PId", sql.Int, parseInt(bodyPartyId)).query(
        `SELECT TOP 1 LHeadId, LHeadType FROM dbo.AccountHeadMaster WHERE LHeadId = @PId`
      );
      if (typeRes.recordset.length) {
        party = { partyId: typeRes.recordset[0].LHeadId, partyType: typeRes.recordset[0].LHeadType };
      }
    }
    if (!party) party = await resolvePartyFromRef(pool, expenseRef);
    if (!party) return res.status(404).json({ error: "Party not found for this invoice" });

    // Check current OA balance
    const balRes = await pool.request().input("PartyId", sql.Int, party.partyId).query(`
      SELECT ISNULL(OnAccountBalance, 0) AS balance FROM dbo.AccountHeadMaster WHERE LHeadId = @PartyId
    `);
    const balance = parseFloat(balRes.recordset[0]?.balance ?? 0);
    if (balance <= 0) return res.status(400).json({ error: "No On Account balance available" });

    // Get invoice details for companyId/projectId, and — critically — how
    // much is actually still owed. This endpoint only ever checked the
    // PARTY's on-account balance, never the INVOICE's own remaining amount,
    // so once an invoice was fully paid by one adjustment, nothing stopped
    // it being "applied" again and again against the same already-settled
    // invoice as long as the party still had leftover OA balance — each
    // call created its own OnAccountLedger debit + synthetic Dummy Bank
    // payment, which is exactly how the same invoice ends up with a wall of
    // identical duplicate "On Account Adjustment" entries.
    const ebRes = await pool.request().input("EDocNo", sql.NVarChar(100), expenseRef).query(`
      SELECT TOP 1 ECompanyId, TRY_CAST(EProjectName AS INT) AS ProjectId,
             ENetAmount, EAmount, ETotalPaid, ERemainingAmount, EBillStatus
      FROM dbo.ExpenseBooking WHERE EDocNo = @EDocNo
    `);
    const eb = ebRes.recordset[0];
    let invoiceRemainingCap = null;
    if (eb) {
      const netAmount = parseFloat(eb.ENetAmount ?? 0) > 0 ? parseFloat(eb.ENetAmount) : (parseFloat(eb.EAmount ?? 0) || 0);
      const totalPaid = parseFloat(eb.ETotalPaid ?? 0) || 0;
      const invoiceRemaining = eb.ERemainingAmount != null ? parseFloat(eb.ERemainingAmount) : Math.max(0, netAmount - totalPaid);
      if (eb.EBillStatus === "Paid" || invoiceRemaining <= 0) {
        return res.status(400).json({ error: "This invoice is already fully paid — no further On Account adjustment is needed." });
      }
      invoiceRemainingCap = invoiceRemaining;
    }

    const applyAmt = Math.min(amount, balance, invoiceRemainingCap ?? amount);

    await pool.request()
      .input("PartyId",     sql.Int,           party.partyId)
      .input("PartyType",   sql.NVarChar(20),  PARTY_LABEL[party.partyType] ?? party.partyType)
      .input("TxnDate",     sql.Date,          new Date())
      .input("TxnType",     sql.NVarChar(10),  "DEBIT")
      .input("Amount",      sql.Decimal(18,2), applyAmt)
      .input("RefType",     sql.NVarChar(30),  "Invoice")
      .input("RefDocNo",    sql.NVarChar(100), expenseRef)
      .input("RefId",       sql.Int,           paymentId ?? null)
      .input("AdjRefDocNo", sql.NVarChar(100), paymentDocNo ?? null)
      .input("CompanyId",   sql.Int,           eb?.ECompanyId ?? null)
      .input("ProjectId",   sql.Int,           eb?.ProjectId ?? null)
      .input("Notes",       sql.NVarChar(500), `On Account adjusted for invoice ${expenseRef}`)
      .input("CreatedBy",   sql.NVarChar(150), createdBy)
      .query(`
        INSERT INTO dbo.OnAccountLedger
          (PartyId,PartyType,TxnDate,TxnType,Amount,RefType,RefDocNo,RefId,AdjRefDocNo,CompanyId,ProjectId,Notes,CreatedBy)
        VALUES
          (@PartyId,@PartyType,@TxnDate,@TxnType,@Amount,@RefType,@RefDocNo,@RefId,@AdjRefDocNo,@CompanyId,@ProjectId,@Notes,@CreatedBy);
        UPDATE dbo.AccountHeadMaster
          SET OnAccountBalance = OnAccountBalance - @Amount
          WHERE LHeadId = @PartyId;
      `);

    // Route the adjustment through the same payment-tracking system every
    // real vendor payment uses (see expenseBooking.js's contract-advance
    // auto-allocation for the same "Dummy Bank" convention) — a synthetic
    // Approved NewPayment row + syncBillStatus, so the invoice's own
    // ETotalPaid/ERemainingAmount/EBillStatus reflect this adjustment
    // everywhere (Payment page, invoice list, etc.) instead of only the
    // party's OA balance knowing about it.
    const dummyBank = await pool.request().query(
      "SELECT TOP 1 LHeadId, LHeadName FROM dbo.AccountHeadMaster WHERE LHeadCode = 'DUMMY-BANK' AND Status = 'Approved'",
    );
    if (dummyBank.recordset.length) {
      const syntheticDocNo = `OA-ADJ-${expenseRef}-${Date.now()}`;
      await pool.request()
        .input("PPaymentName", sql.VarChar, `On Account Adjustment (${expenseRef})`)
        .input("PMode", sql.VarChar, "Cash")
        .input("PAmount", sql.Decimal(18, 2), applyAmt)
        .input("PDocType", sql.VarChar, "On Account Adjustment")
        .input("PDate", sql.Date, new Date())
        .input("PBankID", sql.Int, dummyBank.recordset[0].LHeadId)
        .input("PBankName", sql.VarChar, dummyBank.recordset[0].LHeadName)
        .input("PProject", sql.VarChar, eb?.ProjectId != null ? String(eb.ProjectId) : "")
        // PCompany feeds the Payment Register / new-payment list's
        // ISNULL(ec.name, np.PCompany) resolution (TRY_CAST(np.PCompany AS
        // INT) = enterprise.id) — this was previously hardcoded to "", so
        // synthetic OA-adjustment payments always showed a blank Company
        // there even though the invoice's company was already looked up
        // above for the OnAccountLedger entry.
        .input("PCompany", sql.VarChar, eb?.ECompanyId != null ? String(eb.ECompanyId) : "")
        .input("PExpenseRef", sql.NVarChar(100), expenseRef)
        .input("DocNo", sql.NVarChar(100), syntheticDocNo)
        .input("PCreatedAt", sql.DateTime, new Date())
        .input("PCreatedBy", sql.NVarChar(100), createdBy)
        .input("Status", sql.NVarChar(20), "Approved").query(`
          INSERT INTO dbo.NewPayment
            (PPaymentName, PMode, PAmount, PDocType, PDate, PBankID, PBankName,
             PProject, PCompany, PExpenseRef, DocNo,
             PCreatedAt, PCreatedBy, Status)
          VALUES
            (@PPaymentName, @PMode, @PAmount, @PDocType, @PDate, @PBankID, @PBankName,
             @PProject, @PCompany, @PExpenseRef, @DocNo,
             @PCreatedAt, @PCreatedBy, @Status)
        `);
      await syncBillStatus(pool, sql, expenseRef);
    }

    console.log(`[on-account] apply-adjustment: ${createdBy} applied ₹${applyAmt} from party ${party.partyId} onto invoice ${expenseRef}`);
    res.json({ applied: applyAmt, remainingBalance: Math.max(0, balance - applyAmt) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /adjustments-for-invoice/:expenseRef — OA adjustments applied to
// a specific invoice, so the Payment page can show "On A/C adjusted with
// ₹X from <Supplier>" in the amount breakdown when that invoice is picked
// again for payment (see utils/oaAdjustments.js).
router.get("/adjustments-for-invoice/:expenseRef", requireAnyPageRight(["new-payment", "on-account-adjustment"], "view"), async (req, res) => {
  const expenseRef = decodeURIComponent(req.params.expenseRef);
  try {
    const pool = getPool();
    const adjustments = await getOAAdjustmentsForInvoice(pool, sql, expenseRef);
    res.json(adjustments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /adjustable — credit entries for parties with available OA balance ──
// Used by the On A/C Adjustment page to list excess payments available for use.
// Includes both vendor-side entries (RefType='Payment', adjustable here
// against an ExpenseBooking invoice via POST /apply-adjustment) and CRM
// customer on-account credits (RefType='CrmOnAccountPayment', written by
// crmLedger.js's postCrmOnAccountToGL against the same ledger/balance
// columns) — the latter for VISIBILITY only. A CRM credit has no invoice
// to adjust against here; applying it stays a CRM-only action (Booking
// Detail / Payment Milestones' own "Apply On-Account" flow), so these rows
// carry Source='CRM' + booking context instead of invoice fields, and the
// frontend must not offer the Adjust action for them.
router.get("/adjustable", requirePageRight("on-account-adjustment", "view"), async (req, res) => {
  const { partyId } = req.query;
  try {
    const pool = getPool();
    const request = pool.request();
    const partyFilter = partyId ? "AND oa.PartyId = @PartyId" : "";
    if (partyId) request.input("PartyId", sql.Int, parseInt(partyId));

    const result = await request.query(`
      WITH PartyBalance AS (
        SELECT PartyId,
          SUM(CASE WHEN TxnType='CREDIT' THEN Amount ELSE -Amount END) AS Balance
        FROM dbo.OnAccountLedger
        GROUP BY PartyId
        HAVING SUM(CASE WHEN TxnType='CREDIT' THEN Amount ELSE -Amount END) > 0.005
      )
      SELECT
        oa.OAId,
        oa.PartyId,
        ahm.LHeadName  AS PartyName,
        ahm.LHeadType  AS PartyTypeCode,
        oa.TxnDate     AS PaymentDate,
        oa.RefDocNo    AS PaymentDocNo,
        oa.Amount              AS ExcessAmount,
        np.PExpenseRef         AS InvoiceRef,
        np.PAmount             AS PaymentAmount,
        eb.ENetAmount          AS ENetAmount,
        eb.EAmount             AS EAmount,
        eb.ECgstRate           AS ECgstRate,
        eb.ESgstRate           AS ESgstRate,
        eb.EBillingTermsData   AS EBillingTermsData,
        eb.EDiscountData       AS EDiscountData,
        eb.ESourceType         AS ESourceType,
        eb.ESourceId           AS ESourceId,
        eb.ELinkedGrnIds       AS ELinkedGrnIds,
        grn.TotalAmount        AS GrnTotalAmount,
        eb.ETotalPaid          AS InvoiceTotalPaid,
        eb.EDocNo              AS InvoiceDocNo,
        pb.Balance             AS AvailableBalance,
        oa.Notes,
        'Vendor'               AS Source,
        NULL                   AS CrmBookingNo,
        NULL                   AS CrmProjectName,
        NULL                   AS CrmUnitNo,
        NULL                   AS CrmApplicantName,
        NULL                   AS CrmNextMilestoneName,
        NULL                   AS CrmNextMilestoneDue,
        NULL                   AS CrmNextMilestoneDueDate
      FROM dbo.OnAccountLedger oa
      JOIN PartyBalance pb ON pb.PartyId = oa.PartyId
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = oa.PartyId
      LEFT JOIN dbo.NewPayment np
             ON np.DocNo = oa.RefDocNo AND oa.RefType = 'Payment'
      LEFT JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
      LEFT JOIN dbo.GoodsReceiptNotes grn ON eb.ESourceType = 'GRN' AND grn.GRNID = TRY_CAST(eb.ESourceId AS INT)
      WHERE oa.TxnType = 'CREDIT' AND oa.RefType = 'Payment'
        ${partyFilter}

      UNION ALL

      SELECT
        oa.OAId,
        oa.PartyId,
        ahm.LHeadName  AS PartyName,
        ahm.LHeadType  AS PartyTypeCode,
        oa.TxnDate     AS PaymentDate,
        oa.RefDocNo    AS PaymentDocNo,
        oa.Amount              AS ExcessAmount,
        cb.BookingNo           AS InvoiceRef,
        NULL                   AS PaymentAmount,
        NULL                   AS ENetAmount,
        NULL                   AS EAmount,
        NULL                   AS ECgstRate,
        NULL                   AS ESgstRate,
        NULL                   AS EBillingTermsData,
        NULL                   AS EDiscountData,
        NULL                   AS ESourceType,
        NULL                   AS ESourceId,
        NULL                   AS ELinkedGrnIds,
        NULL                   AS GrnTotalAmount,
        NULL                   AS InvoiceTotalPaid,
        NULL                   AS InvoiceDocNo,
        pb.Balance             AS AvailableBalance,
        oa.Notes,
        'CRM'                  AS Source,
        cb.BookingNo           AS CrmBookingNo,
        cb.ProjectName         AS CrmProjectName,
        cb.UnitNo              AS CrmUnitNo,
        ca.ApplicantName       AS CrmApplicantName,
        nm.MilestoneName       AS CrmNextMilestoneName,
        (nm.AmountDue - ISNULL(nm.AmountPaid, 0)) AS CrmNextMilestoneDue,
        nm.DueDate             AS CrmNextMilestoneDueDate
      FROM dbo.OnAccountLedger oa
      JOIN PartyBalance pb ON pb.PartyId = oa.PartyId
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = oa.PartyId
      LEFT JOIN dbo.CrmOnAccountPayment coa ON coa.Id = oa.RefId AND oa.RefType = 'CrmOnAccountPayment'
      LEFT JOIN dbo.CrmBooking cb ON cb.Id = coa.BookingId
      LEFT JOIN dbo.CrmApplication ca ON ca.Id = cb.ApplicationId
      -- The next milestone still open on this booking — the "underpay" side
      -- of the picture, shown alongside the on-account credit itself so
      -- staff can see both at once (this deposit will auto-apply onto it,
      -- see autoApplyOnAccount in crmPayments.js).
      OUTER APPLY (
        SELECT TOP 1 m.MilestoneName, m.AmountDue, m.AmountPaid, m.DueDate
        FROM dbo.CrmPaymentMilestone m
        WHERE m.BookingId = cb.Id AND m.Status NOT IN ('Paid', 'Waived') AND m.AmountDue > ISNULL(m.AmountPaid, 0)
        ORDER BY m.MilestoneNo ASC
      ) nm
      WHERE oa.TxnType = 'CREDIT' AND oa.RefType = 'CrmOnAccountPayment'
        ${partyFilter}

      UNION ALL

      -- Sanctioned loans — see routes/loanSanction.js. Amount lands as a
      -- CREDIT on the borrower's system-generated "Loan - <Company>" ledger
      -- head; visible here for adjustment, same as a vendor's excess payment.
      SELECT
        oa.OAId,
        oa.PartyId,
        ahm.LHeadName  AS PartyName,
        ahm.LHeadType  AS PartyTypeCode,
        oa.TxnDate     AS PaymentDate,
        oa.RefDocNo    AS PaymentDocNo,
        oa.Amount              AS ExcessAmount,
        ls.LoanNo               AS InvoiceRef,
        NULL                    AS PaymentAmount,
        NULL                    AS ENetAmount,
        NULL                    AS EAmount,
        NULL                    AS ECgstRate,
        NULL                    AS ESgstRate,
        NULL                    AS EBillingTermsData,
        NULL                    AS EDiscountData,
        NULL                    AS ESourceType,
        NULL                    AS ESourceId,
        NULL                    AS ELinkedGrnIds,
        NULL                    AS GrnTotalAmount,
        NULL                    AS InvoiceTotalPaid,
        ls.LoanNo               AS InvoiceDocNo,
        pb.Balance             AS AvailableBalance,
        oa.Notes,
        'Loan'                  AS Source,
        NULL                    AS CrmBookingNo,
        NULL                    AS CrmProjectName,
        NULL                    AS CrmUnitNo,
        NULL                    AS CrmApplicantName,
        NULL                    AS CrmNextMilestoneName,
        NULL                    AS CrmNextMilestoneDue,
        NULL                    AS CrmNextMilestoneDueDate
      FROM dbo.OnAccountLedger oa
      JOIN PartyBalance pb ON pb.PartyId = oa.PartyId
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = oa.PartyId
      LEFT JOIN dbo.LoanSanction ls ON ls.LoanId = oa.RefId AND oa.RefType = 'Loan'
      WHERE oa.TxnType = 'CREDIT' AND oa.RefType = 'Loan'
        ${partyFilter}

      ORDER BY AvailableBalance DESC, PaymentDate DESC
    `);
    // For GRN-source invoices, recompute the correct GST-inclusive net payable from
    // current GRN line items (same as the expense booking preview modal does).
    const rows = await Promise.all(result.recordset.map(async (row) => {
      // Same multi-GRN guard as /invoices-for-party — ESourceId is only
      // the primary linked GRN for a combined invoice, so recomputing from
      // it alone understates the total. Trust the stored ENetAmount
      // (already correct + billing-terms-applied) for those instead.
      const isMultiGRN = !!row.ELinkedGrnIds;
      let invoiceAmount = null;
      if (!isMultiGRN && row.ESourceType === "GRN" && row.ESourceId) {
        try {
          const grnData = await buildGrnGstData(pool, parseInt(row.ESourceId, 10));
          if (grnData && grnData.totals.netAmount > 0) {
            invoiceAmount = applyBillingTermsToAmount(
              grnData.totals.netAmount,
              grnData.totals.taxableAmount,
              grnData.cgstRate,
              grnData.sgstRate,
              row.EBillingTermsData,
              row.EDiscountData,
            );
          }
        } catch { /* fallback below */ }
      }
      if (invoiceAmount == null && isMultiGRN) {
        invoiceAmount = row.ENetAmount != null
          ? parseFloat(row.ENetAmount)
          : row.EAmount != null
            ? parseFloat(row.EAmount)
            : null;
      }
      if (invoiceAmount == null && row.ENetAmount != null) {
        invoiceAmount = applyBillingTermsToAmount(
          row.ENetAmount,
          row.EAmount,
          row.ECgstRate,
          row.ESgstRate,
          row.EBillingTermsData,
          row.EDiscountData,
        );
      }
      const { ENetAmount, EAmount, ECgstRate, ESgstRate, EBillingTermsData, EDiscountData, ESourceType, ESourceId, ELinkedGrnIds, GrnTotalAmount, ...rest } = row;
      return { ...rest, InvoiceAmount: invoiceAmount };
    }));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /report — On Account report ──────────────────────────────────────
router.get("/report", requireAnyPageRight(["on-account-report", "reports"], "view"), async (req, res) => {
  const { companyId, projectId, partyId, partyType, dateFrom, dateTo, page = 1, pageSize = 50 } = req.query;
  try {
    const pool = getPool();
    const request = pool.request();
    const countRequest = pool.request();
    const conditions = [];

    if (companyId) {
      conditions.push("oa.CompanyId = @CompanyId");
      const v = parseInt(companyId);
      request.input("CompanyId", sql.Int, v);
      countRequest.input("CompanyId", sql.Int, v);
    }
    if (projectId) {
      conditions.push("oa.ProjectId = @ProjectId");
      const v = parseInt(projectId);
      request.input("ProjectId", sql.Int, v);
      countRequest.input("ProjectId", sql.Int, v);
    }
    if (partyId) {
      conditions.push("oa.PartyId = @PartyId");
      const v = parseInt(partyId);
      request.input("PartyId", sql.Int, v);
      countRequest.input("PartyId", sql.Int, v);
    }
    if (partyType) {
      conditions.push("oa.PartyType = @PartyType");
      request.input("PartyType", sql.NVarChar(20), partyType);
      countRequest.input("PartyType", sql.NVarChar(20), partyType);
    }
    if (dateFrom) {
      conditions.push("oa.TxnDate >= @DateFrom");
      const v = new Date(dateFrom);
      request.input("DateFrom", sql.Date, v);
      countRequest.input("DateFrom", sql.Date, v);
    }
    if (dateTo) {
      conditions.push("oa.TxnDate <= @DateTo");
      const v = new Date(dateTo);
      request.input("DateTo", sql.Date, v);
      countRequest.input("DateTo", sql.Date, v);
    }

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

    // Running balance per row using window function
    const data = await request.query(`
      SELECT
        oa.OAId, oa.PartyId,
        ahm.LHeadName AS PartyName, ahm.LHeadType AS PartyTypeCode, oa.PartyType,
        oa.TxnDate, oa.TxnType,
        oa.Amount,
        CASE WHEN oa.TxnType='CREDIT' THEN oa.Amount ELSE 0 END AS OnAccountCreated,
        CASE WHEN oa.TxnType='DEBIT'  THEN oa.Amount ELSE 0 END AS OnAccountAdjusted,
        SUM(CASE WHEN oa.TxnType='CREDIT' THEN oa.Amount ELSE -oa.Amount END)
          OVER (PARTITION BY oa.PartyId ORDER BY oa.TxnDate, oa.OAId
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS RunningBalance,
        oa.RefDocNo, oa.AdjRefDocNo,
        oa.CompanyId, ISNULL(ec.name, '') AS CompanyName,
        oa.ProjectId, ISNULL(ep.name, '') AS ProjectName,
        oa.Notes, oa.CreatedBy, oa.CreatedAt
      FROM dbo.OnAccountLedger oa
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = oa.PartyId
      LEFT JOIN dbo.enterprise ec ON ec.id = oa.CompanyId AND ec.business_type = 'C'
      LEFT JOIN dbo.enterprise ep ON ep.id = oa.ProjectId AND ep.business_type = 'P'
      ${where}
      ORDER BY oa.TxnDate DESC, oa.OAId DESC
      OFFSET ${(parseInt(page)-1)*parseInt(pageSize)} ROWS
      FETCH NEXT ${parseInt(pageSize)} ROWS ONLY
    `);

    const countRes = await pool.request().query(`SELECT COUNT(*) AS total FROM dbo.OnAccountLedger oa ${where}`);

    res.json({ data: data.recordset, total: countRes.recordset[0].total, page: parseInt(page), pageSize: parseInt(pageSize) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /party-summary — balance summary per party ────────────────────────
router.get("/party-summary", requirePageRight("on-account-adjustment", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT
        oa.PartyId, ahm.LHeadName AS PartyName, oa.PartyType,
        SUM(CASE WHEN oa.TxnType='CREDIT' THEN oa.Amount ELSE 0 END) AS TotalCredit,
        SUM(CASE WHEN oa.TxnType='DEBIT'  THEN oa.Amount ELSE 0 END) AS TotalDebit,
        SUM(CASE WHEN oa.TxnType='CREDIT' THEN oa.Amount ELSE -oa.Amount END) AS Balance
      FROM dbo.OnAccountLedger oa
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = oa.PartyId
      GROUP BY oa.PartyId, ahm.LHeadName, oa.PartyType
      HAVING SUM(CASE WHEN oa.TxnType='CREDIT' THEN oa.Amount ELSE -oa.Amount END) > 0
      ORDER BY Balance DESC
    `);
    res.json(r.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;