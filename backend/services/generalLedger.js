// backend/services/generalLedger.js
//
// Double-entry posting engine. Every approved transaction (GRN, Expense
// Booking, Payment Made, Received Payment) posts a balanced voucher here —
// two or more legs sharing a VoucherNo, where total debits = total credits.
//
// Trial Balance reads straight off this table (GROUP BY LHeadId) instead of
// re-deriving balances by scanning source documents per account type.
//
// Posting starts capturing from 2026-06-28 — no historical backfill.

const { sql } = require("../db");
const { autoCreateFixedAssetsFromGRN } = require("./fixedAssetAutoAlloc");

// ── System GL account names (seeded by migration 125) ───────────────────────
const GL_ACCOUNTS = {
  PURCHASE: "Purchase A/c",
  PENDING_GRN_PROVISION: "PROVISION FOR PENDING GRN A/C",
  PROVISIONAL_CREDIT: "Provisional Credit Available",
  // Singleton pooled "advance to supplier/contractor" head (migration 178,
  // AccountGroup wiring in 230) — was seeded but never actually posted to
  // until postOnAccountAdjustment/postPaymentApproval below.
  ON_ACCOUNT: "Company On Account A/c",
  // Singleton counter-account for Cash-mode Direct Payments (migration 339)
  // — Cash payments never carry a PBankID (Payment.tsx disables the Bank
  // field for Cash), so this stands in for the bank leg on the credit side.
  CASH_IN_HAND: "Cash-in-Hand A/c",
};

/** Same "advance / on account" Payment Reason match used by newPayment.js's
 * standalone-advance OnAccountLedger hook — kept identical so GL posting and
 * the OA-balance side-effect always agree on what counts as an advance. */
function isAdvancePaymentReason(paymentName) {
  const reasonNorm = (paymentName || "").trim().toLowerCase();
  return (
    reasonNorm.includes("advance") ||
    reasonNorm.includes("on a/c") ||
    reasonNorm.includes("on ac") ||
    reasonNorm.includes("on-account") ||
    reasonNorm.includes("on account")
  );
}

// Small in-process cache — these are fixed system accounts, id never changes
// once seeded, so there's no need to hit the DB on every posting call.
const glHeadIdCache = new Map();

async function getGLHeadId(pool, name) {
  if (glHeadIdCache.has(name)) return glHeadIdCache.get(name);
  const result = await pool
    .request()
    .input("Name", sql.NVarChar(200), name)
    .query(
      `SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = @Name AND LHeadType = 'GL'`,
    );
  const id = result.recordset[0]?.LHeadId ?? null;
  if (!id) {
    throw new Error(
      `GL account "${name}" not found in AccountHeadMaster (LHeadType='GL')`,
    );
  }
  glHeadIdCache.set(name, id);
  return id;
}

/** Resolve an AccountHeadMaster row by exact name match (the established
 * convention in this codebase for Contractor/Supplier links that don't have
 * a direct FK — e.g. ExpenseBooking.EName is literally the chosen head's
 * LHeadName). Returns null if no match. */
async function getHeadIdByName(pool, name) {
  if (!name) return null;
  const result = await pool
    .request()
    .input("Name", sql.NVarChar(200), name)
    .query(
      `SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = @Name`,
    );
  return result.recordset[0]?.LHeadId ?? null;
}

/** Has this source document already been posted? Guards against double
 * posting if an approval transition is somehow re-entered. */
async function hasPosting(pool, sourceType, sourceId) {
  const result = await pool
    .request()
    .input("SourceType", sql.NVarChar(30), sourceType)
    .input("SourceId", sql.Int, sourceId)
    .query(
      `SELECT TOP 1 1 AS found FROM dbo.GeneralLedgerEntry WHERE SourceType = @SourceType AND SourceId = @SourceId AND IsReversed = 0`,
    );
  return result.recordset.length > 0;
}

/**
 * Post a balanced voucher. `legs` is an array of
 *   { lHeadId, debit?, credit?, narration? }
 * Throws if total debit !== total credit (to the cent) — a balance error here
 * means the calling code's accounting logic is wrong, not a retryable issue.
 */
async function postVoucher(pool, {
  voucherNo,
  voucherDate,
  legs,
  sourceType,
  sourceId,
  companyId = null,
  projectId = null,
  costCenterId = null,
  createdBy = null,
}) {
  if (!legs || legs.length < 2) {
    throw new Error("postVoucher requires at least 2 legs");
  }

  const totalDebit  = Math.round(legs.reduce((s, l) => s + (l.debit  || 0), 0) * 100) / 100;
  const totalCredit = Math.round(legs.reduce((s, l) => s + (l.credit || 0), 0) * 100) / 100;
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `Voucher ${voucherNo} does not balance: debit ${totalDebit} !== credit ${totalCredit}`,
    );
  }

  // All legs must be inserted atomically — a partial write leaves the ledger
  // unbalanced and hasPosting() then blocks any retry. Use a transaction.
  const tx = pool.transaction();
  await tx.begin();
  try {
    for (const leg of legs) {
      if (!leg.lHeadId) throw new Error(`Voucher ${voucherNo} has a leg with no lHeadId`);
      const debit = Math.round((leg.debit || 0) * 100) / 100;
      const credit = Math.round((leg.credit || 0) * 100) / 100;
      if (debit === 0 && credit === 0) continue;

      await tx
        .request()
        .input("VoucherNo", sql.NVarChar(50), voucherNo)
        .input("VoucherDate", sql.Date, voucherDate)
        .input("LHeadId", sql.Int, leg.lHeadId)
        .input("DebitAmount", sql.Decimal(18, 2), debit)
        .input("CreditAmount", sql.Decimal(18, 2), credit)
        .input("Narration", sql.NVarChar(255), leg.narration || null)
        .input("SourceType", sql.NVarChar(30), sourceType)
        .input("SourceId", sql.Int, sourceId)
        .input("CompanyId", sql.Int, companyId)
        .input("ProjectId", sql.Int, projectId)
        .input("CostCenterId", sql.Int, leg.costCenterId ?? costCenterId)
        .input("CreatedBy", sql.NVarChar(150), createdBy).query(`
          INSERT INTO dbo.GeneralLedgerEntry
            (VoucherNo, VoucherDate, LHeadId, DebitAmount, CreditAmount, Narration,
             SourceType, SourceId, CompanyId, ProjectId, CostCenterId, CreatedBy)
          VALUES
            (@VoucherNo, @VoucherDate, @LHeadId, @DebitAmount, @CreditAmount, @Narration,
             @SourceType, @SourceId, @CompanyId, @ProjectId, @CostCenterId, @CreatedBy)
        `);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-specific posting rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GRN approved — goods received, not yet invoiced (GR/IR clearing pattern).
 * Also the single point where a GRN's items are credited to StockLedger —
 * see the inline comment below for why that's gated on approval rather
 * than GRN creation.
 *   Dr Purchase A/c ................. taxable/base amount
 *   Dr Provisional Credit Available .. GST amount (input tax credit, pending)
 *   Cr PROVISION FOR PENDING GRN A/C . total incl. GST
 */
async function postGRNApproval(pool, grnId, userEmail) {
  if (await hasPosting(pool, "GRN", grnId))
    return { posted: true, reason: "already posted (idempotent)" };

  const result = await pool.request().input("GRNID", sql.Int, grnId).query(`
    SELECT grn.GRNID, grn.DocNo, grn.GRNNo, grn.GRNDate, grn.GRNItems,
           grn.TotalAmount, grn.SupplierID, grn.POID, grn.GodownID,
           p.CompanyId, p.ProjectId
    FROM dbo.GoodsReceiptNotes grn
    LEFT JOIN dbo.PurchaseOrders p ON p.PurchaseOrderID = grn.POID
    WHERE grn.GRNID = @GRNID
  `);
  const grn = result.recordset[0];
  if (!grn) return { posted: false, reason: `GRN ${grnId} not found` };
  if (!grn.SupplierID)
    return { posted: false, reason: `GRN ${grnId} has no SupplierID` };

  let items = [];
  try {
    items = JSON.parse(grn.GRNItems || "[]");
    if (!Array.isArray(items)) items = [];
  } catch {
    items = [];
  }

  const docNo = grn.DocNo || grn.GRNNo || `GRN-${grnId}`;

  // Credit the warehouse now that the delivery has cleared approval — stock
  // deliberately does NOT move at GRN creation (a Draft/Pending GRN hasn't
  // been vetted yet, so it shouldn't inflate available stock). This is the
  // single place a GRN's items ever get counted. Delete-then-insert makes
  // it idempotent against re-entrant approval attempts. Runs independently
  // of the GL voucher below — a zero/negative-value GRN (e.g. free samples)
  // still received real, countable goods even if there's nothing to post
  // to accounts.
  await pool
    .request()
    .input("RefID", sql.Int, grnId)
    .query(`DELETE FROM StockLedger WHERE RefType = 'GRN' AND RefID = @RefID`);
  for (const item of items) {
    if (item.itemId && Number(item.receivedQty) > 0) {
      await pool
        .request()
        .input("ItemID", sql.NVarChar(50), item.itemId)
        .input("Qty", sql.Decimal(18, 2), Number(item.receivedQty))
        .input("UOM", sql.NVarChar(20), item.uom || null)
        .input("RefID", sql.Int, grnId)
        .input("DocNo", sql.NVarChar(100), docNo)
        .input("GodownID", sql.Int, grn.GodownID || null).query(`
          INSERT INTO StockLedger (ItemID, Qty, UOM, Type, RefType, RefID, DocNo, GodownID, CreatedDate)
          VALUES (@ItemID, @Qty, @UOM, 'IN', 'GRN', @RefID, @DocNo, @GodownID, GETDATE())
        `);
    }
  }

  // Fixed-asset-tagged items (Item Master M_Type='Fixed Asset') get a
  // Pending Fixed Asset Record row the moment they're physically received —
  // regardless of whether this GRN ends up postable to GL below (e.g. a
  // free/zero-value receipt still received a real, trackable asset).
  try {
    await autoCreateFixedAssetsFromGRN(pool, grnId, userEmail);
  } catch (err) {
    console.error(`[postGRNApproval] fixed-asset auto-allocation failed for GRN ${grnId} (non-fatal):`, err.message);
  }

  const baseAmount = items.reduce(
    (s, i) => s + (Number(i.totalAmount) || 0),
    0,
  );
  const totalInclGst = Number(grn.TotalAmount) || 0;
  const gstAmount = Math.max(0, totalInclGst - baseAmount);

  if (totalInclGst <= 0)
    return { posted: false, stockPosted: true, reason: `GRN ${grnId} total is ${totalInclGst} (<= 0)` };

  const purchaseHeadId = await getGLHeadId(pool, GL_ACCOUNTS.PURCHASE);
  const provisionalCreditHeadId = await getGLHeadId(
    pool,
    GL_ACCOUNTS.PROVISIONAL_CREDIT,
  );
  const pendingGrnHeadId = await getGLHeadId(
    pool,
    GL_ACCOUNTS.PENDING_GRN_PROVISION,
  );

  await postVoucher(pool, {
    voucherNo: docNo,
    voucherDate: grn.GRNDate,
    sourceType: "GRN",
    sourceId: grnId,
    companyId: grn.CompanyId ?? null,
    projectId: grn.ProjectId ?? null,
    createdBy: userEmail,
    legs: [
      {
        lHeadId: purchaseHeadId,
        debit: baseAmount,
        narration: `GRN ${docNo} — goods received (base)`,
      },
      {
        lHeadId: provisionalCreditHeadId,
        debit: gstAmount,
        narration: `GRN ${docNo} — input GST credit (provisional)`,
      },
      {
        lHeadId: pendingGrnHeadId,
        credit: totalInclGst,
        narration: `GRN ${docNo} — goods received, not yet invoiced`,
      },
    ],
  });
  return { posted: true, stockPosted: true };
}

/**
 * Expense Booking approved.
 *
 * GRN-sourced: the invoice is now matched to the GRN — clear the GR/IR
 * provision into a real supplier liability.
 *   Dr PROVISION FOR PENDING GRN A/C . GRN's incl-GST total
 *   Dr Purchase A/c .................. billing-term delta, if ENetAmount
 *                                       differs from the GRN total (e.g.
 *                                       freight added at booking time) —
 *                                       simplification: lumped onto
 *                                       Purchase A/c rather than a
 *                                       dedicated "Other Charges" GL
 *   Cr Supplier ....................... final payable (ENetAmount)
 *
 * Non-GRN-sourced (PO / WO_PO / WORK_DONE / standalone):
 *   Dr Purchase A/c ................... EAmount (basic/taxable)
 *   Dr Provisional Credit Available ... ENetAmount - EAmount (GST + terms,
 *                                       simplification: not split further)
 *   Cr Supplier/Contractor ............ ENetAmount, resolved by matching
 *                                       EName to AccountHeadMaster.LHeadName
 *                                       (the existing convention in this
 *                                       codebase — EName IS the chosen
 *                                       head's label when no source doc
 *                                       supplies a stricter FK)
 */
async function postExpenseBookingApproval(pool, ebId, userEmail) {
  if (await hasPosting(pool, "ExpenseBooking", ebId))
    return { posted: true, reason: "already posted (idempotent)" };

  const result = await pool.request().input("Eid", sql.Int, ebId).query(`
    SELECT eb.Eid, eb.EDocNo, eb.EDocDate, eb.EAmount, eb.ENetAmount,
           eb.ESourceType, eb.ESourceId, eb.EName, eb.ECompanyId, eb.EProjectName
    FROM dbo.ExpenseBooking eb
    WHERE eb.Eid = @Eid
  `);
  const eb = result.recordset[0];
  if (!eb) return { posted: false, reason: `ExpenseBooking ${ebId} not found` };

  const netAmount = Number(eb.ENetAmount ?? eb.EAmount) || 0;
  if (netAmount <= 0)
    return { posted: false, reason: `ExpenseBooking ${ebId} net amount is ${netAmount} (<= 0)` };

  const companyId = eb.ECompanyId ?? null;
  const projectId = Number.isFinite(parseInt(eb.EProjectName, 10))
    ? parseInt(eb.EProjectName, 10)
    : null;
  const docNo = eb.EDocNo || `EXB-${ebId}`;
  const voucherDate = eb.EDocDate;

  if (eb.ESourceType === "GRN" && eb.ESourceId) {
    const grnId = parseInt(eb.ESourceId, 10);
    const grnResult = await pool
      .request()
      .input("GRNID", sql.Int, grnId)
      .query(
        `SELECT GRNID, TotalAmount, SupplierID FROM dbo.GoodsReceiptNotes WHERE GRNID = @GRNID`,
      );
    const grn = grnResult.recordset[0];
    if (!grn || !grn.SupplierID)
      return {
        posted: false,
        reason: `ExpenseBooking ${ebId}: source GRN ${grnId} missing or has no SupplierID`,
      };

    const grnTotal = Number(grn.TotalAmount) || 0;
    const delta = netAmount - grnTotal; // billing-term adjustment, can be negative

    const pendingGrnHeadId = await getGLHeadId(
      pool,
      GL_ACCOUNTS.PENDING_GRN_PROVISION,
    );
    const purchaseHeadId = await getGLHeadId(pool, GL_ACCOUNTS.PURCHASE);

    const legs = [
      {
        lHeadId: pendingGrnHeadId,
        debit: grnTotal,
        narration: `${docNo} — clear GR/IR provision against GRN`,
      },
      {
        lHeadId: grn.SupplierID,
        credit: netAmount,
        narration: `${docNo} — supplier liability booked`,
      },
    ];
    if (Math.abs(delta) > 0.01) {
      // Net debit-side adjustment to balance the voucher when billing terms
      // change the final payable vs. the GRN's original incl-GST total.
      if (delta > 0) {
        legs.push({
          lHeadId: purchaseHeadId,
          debit: delta,
          narration: `${docNo} — billing term adjustment`,
        });
      } else {
        legs.push({
          lHeadId: purchaseHeadId,
          credit: -delta,
          narration: `${docNo} — billing term adjustment`,
        });
      }
    }

    await postVoucher(pool, {
      voucherNo: docNo,
      voucherDate,
      sourceType: "ExpenseBooking",
      sourceId: ebId,
      companyId,
      projectId,
      createdBy: userEmail,
      legs,
    });
    return { posted: true };
  }

  // Non-GRN sourced (PO / WO_PO / WORK_DONE / standalone)
  const supplierHeadId = await getHeadIdByName(pool, eb.EName);
  // can't determine counter-account — skip rather than guess wrong
  if (!supplierHeadId)
    return {
      posted: false,
      reason: `ExpenseBooking ${ebId}: EName "${eb.EName}" did not match any AccountHeadMaster head`,
    };

  const baseAmount = Number(eb.EAmount) || 0;
  const gstAndTerms = Math.max(0, netAmount - baseAmount);

  const purchaseHeadId = await getGLHeadId(pool, GL_ACCOUNTS.PURCHASE);
  const provisionalCreditHeadId = await getGLHeadId(
    pool,
    GL_ACCOUNTS.PROVISIONAL_CREDIT,
  );

  await postVoucher(pool, {
    voucherNo: docNo,
    voucherDate,
    sourceType: "ExpenseBooking",
    sourceId: ebId,
    companyId,
    projectId,
    createdBy: userEmail,
    legs: [
      {
        lHeadId: purchaseHeadId,
        debit: baseAmount,
        narration: `${docNo} — expense booked (base)`,
      },
      {
        lHeadId: provisionalCreditHeadId,
        debit: gstAndTerms,
        narration: `${docNo} — GST / billing terms`,
      },
      {
        lHeadId: supplierHeadId,
        credit: netAmount,
        narration: `${docNo} — supplier/contractor liability`,
      },
    ],
  });
  return { posted: true };
}

/**
 * Payment Made approved.
 *   Dr Supplier/Contractor ... reduces what we owe them
 *   Cr Bank ................... cash leaves the bank
 *
 * The supplier/contractor head is resolved via the linked ExpenseBooking
 * (PExpenseRef → EDocNo): exact FK through the GRN if GRN-sourced, otherwise
 * name match on EName. If there's no expense ref to resolve from, the
 * posting is skipped rather than guessing the wrong counter-account.
 */
// Resolves the counter-account (supplier/contractor AccountHeadMaster row)
// a payment should post against. Shared by postPaymentApproval below and by
// newPayment.js's own posting endpoints, which previously searched for a
// system-generated GL head literally named "supplier"/"creditor" — no such
// account exists (every vendor has their own ledger), so that always failed
// with "Supplier/Creditor system ledger not configured."
//
// Precedence:
//   1. Contract-linked payment (advance against a Contract, no real invoice
//      yet) — resolve straight from the Contract's own party tag. Takes
//      priority because for this case PExpenseRef (if set at all) holds the
//      Contract's own DocNo, not a real ExpenseBooking reference.
//   2. PExpenseRef → the linked ExpenseBooking's own resolved supplier
//      (GRN's SupplierID, or a name-matched head for other source types).
//   3. PPartyId — the direct party picked on the payment form, last resort.
async function resolvePaymentSupplierHeadId(pool, payment) {
  let supplierHeadId = null;

  if (payment.ContractId) {
    const contractResult = await pool
      .request()
      .input("ContractId", sql.Int, payment.ContractId)
      .query(`SELECT ContactPartyId FROM dbo.Contract WHERE ContractId = @ContractId`);
    supplierHeadId = contractResult.recordset[0]?.ContactPartyId ?? null;
  }

  if (!supplierHeadId && payment.PExpenseRef) {
    // EMI payments store PExpenseRef as "{parentEDocNo}-EMI-{n}".
    // Strip the suffix to resolve the parent booking for GL purposes.
    const lookupRef = payment.PExpenseRef.replace(/-EMI-\d+$/i, "");

    const ebResult = await pool
      .request()
      .input("EDocNo", sql.NVarChar(100), lookupRef)
      .query(`
        SELECT eb.ESourceType, eb.ESourceId, eb.EName
        FROM dbo.ExpenseBooking eb
        WHERE eb.EDocNo = @EDocNo
      `);
    const eb = ebResult.recordset[0];
    if (eb) {
      if (eb.ESourceType === "GRN" && eb.ESourceId) {
        const grnResult = await pool
          .request()
          .input("GRNID", sql.Int, parseInt(eb.ESourceId, 10))
          .query(`SELECT SupplierID FROM dbo.GoodsReceiptNotes WHERE GRNID = @GRNID`);
        supplierHeadId = grnResult.recordset[0]?.SupplierID ?? null;
      } else {
        supplierHeadId = await getHeadIdByName(pool, eb.EName);
      }
    }
  }

  // Direct-invoice / manual payments carry PPartyId (AccountHeadMaster.LHeadId)
  // straight from the party picker — the last, most literal fallback.
  if (!supplierHeadId && payment.PPartyId) {
    supplierHeadId = payment.PPartyId;
  }

  return supplierHeadId;
}

async function postPaymentApproval(pool, paymentId, userEmail) {
  if (await hasPosting(pool, "NewPayment", paymentId))
    return { posted: true, reason: "already posted (idempotent)" };

  const result = await pool
    .request()
    .input("PPaymentID", sql.Int, paymentId)
    .query(`
      SELECT PPaymentID, PAmount, PDate, PBankID, PMode, PExpenseRef, DocNo,
             PCompany, PProject, ContractId, PPartyId, PPaymentName,
             ISNULL(TDSAmount, 0) AS TDSAmount
      FROM dbo.NewPayment
      WHERE PPaymentID = @PPaymentID
    `);
  const payment = result.recordset[0];
  if (!payment) return { posted: false, reason: `Payment ${paymentId} not found` };

  // Cash-mode payments never carry a PBankID (Payment.tsx disables the Bank
  // field for Cash) — Cash-in-Hand (migration 339) stands in for the bank
  // leg instead of hard-failing for lack of one.
  let bankId = payment.PBankID;
  if (!bankId && payment.PMode === "Cash") {
    bankId = await getGLHeadId(pool, GL_ACCOUNTS.CASH_IN_HAND).catch(() => null);
  }
  if (!bankId)
    return { posted: false, reason: `Payment ${paymentId} has no PBankID (bank account)` };

  const amount = Number(payment.PAmount) || 0;
  if (amount <= 0)
    return { posted: false, reason: `Payment ${paymentId} amount is ${amount} (<= 0)` };

  const companyId = parseInt(payment.PCompany, 10);
  const projectId = parseInt(payment.PProject, 10);
  const docNo = payment.DocNo || `PMT-${paymentId}`;

  // TDS (migration 304) — when set, the credit side splits into Bank (net
  // of TDS) + TDS Payable; every debit-side branch below (Expense Head
  // allocations, standalone advance, or a normal supplier payment) keeps
  // debiting its full, un-reduced amount — only the credit legs change.
  //
  // Invoice-linked payments (PExpenseRef set) are the one exception: TDS
  // was already carved out as its own liability leg when the INVOICE
  // itself was posted (see routes/expenseBooking.js post-to-gl). The
  // payment's own TDSAmount here is only an inherited display/eligibility
  // snapshot (tds.js's resolveInvoiceLinkedTds — "Section 8, read-only
  // inheritance, not re-selected") — applying it to the payment's own GL
  // split too would post a SECOND TDS Payable credit for the same amount,
  // double-counting the liability. Only a standalone/contract payment
  // (no linked invoice, TDS never deducted anywhere else yet) should
  // actually split TDS out of its own posting.
  const tdsAmount = payment.PExpenseRef ? 0 : Number(payment.TDSAmount) || 0;
  if (tdsAmount > amount) {
    return { posted: false, reason: `Payment ${paymentId}: TDS amount (₹${tdsAmount}) exceeds the payment amount (₹${amount}) — data issue, re-save the payment.` };
  }
  let tdsPayableHeadId = null;
  if (tdsAmount > 0) {
    const { GL_ACCOUNTS: TDS_GL_ACCOUNTS } = require("./tds");
    tdsPayableHeadId = await getGLHeadId(pool, TDS_GL_ACCOUNTS.TDS_PAYABLE);
    if (!tdsPayableHeadId) {
      return { posted: false, reason: `Payment ${paymentId}: TDS Payable system ledger not configured.` };
    }
  }
  const bankAndTdsLegs = (bankId, bankNarration, tdsNarration) => [
    { lHeadId: bankId, credit: amount - tdsAmount, narration: bankNarration },
    ...(tdsAmount > 0 ? [{ lHeadId: tdsPayableHeadId, credit: tdsAmount, narration: tdsNarration }] : []),
  ];

  // Direct Expense Payment (migration 303, dbo.ExpenseHeadAllocation) — pays
  // one or more Expense Heads straight from the bank, with no invoice,
  // contract, or party involved at all. When present, these ARE the debit
  // legs; the whole supplier/party/advance resolution below is skipped
  // entirely (there is no counter-party to resolve).
  const { getAllocations } = require("./expenseHeadAllocation");
  const allocations = await getAllocations(pool, sql, "NewPayment", paymentId);
  if (allocations.length > 0) {
    const allocSum = Math.round(allocations.reduce((s, a) => s + a.amount, 0) * 100) / 100;
    if (Math.abs(allocSum - amount) > 0.5) {
      return {
        posted: false,
        reason: `Payment ${paymentId}: Expense Head amounts (₹${allocSum.toFixed(2)}) no longer add up to the payment amount (₹${amount.toFixed(2)}) — re-save the payment before approving.`,
      };
    }
    await postVoucher(pool, {
      voucherNo: docNo,
      voucherDate: payment.PDate,
      sourceType: "NewPayment",
      sourceId: paymentId,
      companyId: Number.isFinite(companyId) ? companyId : null,
      projectId: Number.isFinite(projectId) ? projectId : null,
      createdBy: userEmail,
      legs: [
        ...allocations.map((a) => ({
          lHeadId: a.lHeadId,
          debit: a.amount,
          narration: `${docNo} — ${a.lHeadName} (direct expense payment)`,
        })),
        ...bankAndTdsLegs(bankId, `${docNo} — direct expense payment`, `${docNo} — TDS Payable`),
      ],
    });
    return { posted: true };
  }

  // A standalone advance/on-account payment (no invoice, no contract — see
  // newPayment.js's matching OnAccountLedger CREDIT hook) is booked as an
  // advance ASSET, not a reduction of what we owe the party — so its Dr leg
  // goes to the pooled "Company On Account A/c" head instead of the party's
  // own payable head. Everything else (a real invoice payment) keeps
  // debiting the party head as before.
  const isStandaloneAdvance =
    !payment.PExpenseRef && !payment.ContractId && payment.PPartyId &&
    isAdvancePaymentReason(payment.PPaymentName);

  const supplierHeadId = isStandaloneAdvance
    ? await getGLHeadId(pool, GL_ACCOUNTS.ON_ACCOUNT)
    : await resolvePaymentSupplierHeadId(pool, payment);

  if (!supplierHeadId)
    return {
      posted: false,
      reason: payment.PExpenseRef
        ? `Payment ${paymentId}: could not resolve supplier from expense ref "${payment.PExpenseRef}"`
        : `Payment ${paymentId}: no PExpenseRef/ContractId/PPartyId, cannot resolve counter-account`,
    };

  await postVoucher(pool, {
    voucherNo: docNo,
    voucherDate: payment.PDate,
    sourceType: "NewPayment",
    sourceId: paymentId,
    companyId: Number.isFinite(companyId) ? companyId : null,
    projectId: Number.isFinite(projectId) ? projectId : null,
    createdBy: userEmail,
    legs: [
      {
        lHeadId: supplierHeadId,
        debit: amount,
        narration: isStandaloneAdvance
          ? `${docNo} — advance / on account payment`
          : `${docNo} — payment made`,
      },
      ...bankAndTdsLegs(bankId, `${docNo} — payment made`, `${docNo} — TDS Payable`),
    ],
  });
  return { posted: true };
}

/**
 * On Account Adjustment — applies a party's existing advance balance against
 * an invoice's outstanding payable. Pure internal transfer, no cash/bank
 * account involved (per explicit spec — replaces the old "Dummy Bank"
 * synthetic-payment mechanism entirely):
 *
 *   Dr <party's own head>            (reduces what we owe them — Payable)
 *   Cr Company On Account A/c        (reduces the pooled advance asset)
 *
 * sourceId is the OnAccountLedger.OAId row this settles, so hasPosting()
 * guards each individual adjustment idempotently.
 */
async function postOnAccountAdjustment(pool, {
  oaId,
  partyHeadId,
  amount,
  expenseRef,
  voucherDate,
  companyId = null,
  projectId = null,
  createdBy = null,
}) {
  if (await hasPosting(pool, "OnAccountAdjustment", oaId))
    return { posted: true, reason: "already posted (idempotent)" };

  const onAccountHeadId = await getGLHeadId(pool, GL_ACCOUNTS.ON_ACCOUNT);
  const voucherNo = `OA-ADJ-${expenseRef}-${oaId}`;

  await postVoucher(pool, {
    voucherNo,
    voucherDate,
    sourceType: "OnAccountAdjustment",
    sourceId: oaId,
    companyId,
    projectId,
    createdBy,
    legs: [
      {
        lHeadId: partyHeadId,
        debit: amount,
        narration: `${voucherNo} — On Account adjusted against invoice ${expenseRef}`,
      },
      {
        lHeadId: onAccountHeadId,
        credit: amount,
        narration: `${voucherNo} — On Account adjusted against invoice ${expenseRef}`,
      },
    ],
  });
  return { posted: true, voucherNo };
}

/** Reverse a previously-posted On Account Adjustment voucher (deleting the
 * adjustment) — flips IsReversed so Trial Balance/hasPosting stop counting
 * it, without deleting the audit row itself. */
async function reverseOnAccountAdjustmentPosting(pool, oaId) {
  await pool
    .request()
    .input("OAId", sql.Int, oaId)
    .query(`
      UPDATE dbo.GeneralLedgerEntry
      SET IsReversed = 1
      WHERE SourceType = 'OnAccountAdjustment' AND SourceId = @OAId AND IsReversed = 0
    `);
}

/** Generic version of the reversal pattern above, for any (sourceType,
 * sourceId) pair — used by scripts/repostLegacyIntercompanyLoans.js to undo
 * a document's existing posting before reposting it with corrected values.
 * Preserves the audit trail (flips IsReversed rather than deleting), same
 * as every other reversal in this file. */
async function reversePostingBySource(pool, sourceType, sourceId) {
  await pool
    .request()
    .input("SourceType", sql.NVarChar(50), sourceType)
    .input("SourceId", sql.Int, sourceId)
    .query(`
      UPDATE dbo.GeneralLedgerEntry
      SET IsReversed = 1
      WHERE SourceType = @SourceType AND SourceId = @SourceId AND IsReversed = 0
    `);
}

/**
 * Received Payment approved.
 *   Dr Bank ...... cash comes into the bank
 *   Cr Customer ... reduces what they owe us
 *
 * Customer head resolved via the linked Sale Invoice (exact FK on
 * CustomerID) when present, otherwise by name match on RPCustomerName /
 * RPReceivedFrom.
 */
async function postReceivedPaymentApproval(pool, rpId, userEmail) {
  if (await hasPosting(pool, "ReceivedPayment", rpId))
    return { posted: true, reason: "already posted (idempotent)" };

  const result = await pool
    .request()
    .input("RPPaymentID", sql.Int, rpId)
    .query(`
      SELECT RPPaymentID, RPAmount, RPDocDate, RPDepositBankId, RPCustomerName,
             RPReceivedFrom, RPCompanyId, RPProjectId, SourceSaleInvoiceId, DocNo
      FROM dbo.ReceivedPayment
      WHERE RPPaymentID = @RPPaymentID
    `);
  const rp = result.recordset[0];
  if (!rp) return { posted: false, reason: `ReceivedPayment ${rpId} not found` };
  if (!rp.RPDepositBankId)
    return { posted: false, reason: `ReceivedPayment ${rpId} has no RPDepositBankId` };

  const amount = Number(rp.RPAmount) || 0;
  if (amount <= 0)
    return { posted: false, reason: `ReceivedPayment ${rpId} amount is ${amount} (<= 0)` };

  let customerHeadId = null;
  if (rp.SourceSaleInvoiceId) {
    const siResult = await pool
      .request()
      .input("SaleInvoiceID", sql.Int, rp.SourceSaleInvoiceId)
      .query(`SELECT CustomerID FROM dbo.SaleInvoices WHERE SaleInvoiceID = @SaleInvoiceID`);
    customerHeadId = siResult.recordset[0]?.CustomerID ?? null;
  }
  if (!customerHeadId) {
    customerHeadId = await getHeadIdByName(
      pool,
      rp.RPCustomerName || rp.RPReceivedFrom,
    );
  }
  if (!customerHeadId)
    return {
      posted: false,
      reason: `ReceivedPayment ${rpId}: could not resolve customer (invoice ${rp.SourceSaleInvoiceId ?? "none"}, name "${rp.RPCustomerName || rp.RPReceivedFrom}")`,
    };

  const docNo = rp.DocNo || `RCV-${rpId}`;

  await postVoucher(pool, {
    voucherNo: docNo,
    voucherDate: rp.RPDocDate,
    sourceType: "ReceivedPayment",
    sourceId: rpId,
    companyId: rp.RPCompanyId ?? null,
    projectId: rp.RPProjectId ?? null,
    createdBy: userEmail,
    legs: [
      {
        lHeadId: rp.RPDepositBankId,
        debit: amount,
        narration: `${docNo} — payment received`,
      },
      {
        lHeadId: customerHeadId,
        credit: amount,
        narration: `${docNo} — payment received`,
      },
    ],
  });
  return { posted: true };
}

/**
 * Journal Voucher approved.
 *
 * JV lines already ARE the legs (LHeadId + DebitAmount/CreditAmount) — no
 * derivation needed, unlike GRN/ExpenseBooking/Payment which compute their
 * legs from a document's amount fields. Just map each line straight onto
 * postVoucher()'s leg shape and post once.
 */
async function postJournalVoucherApproval(pool, jvId, userEmail) {
  if (await hasPosting(pool, "JournalVoucher", jvId))
    return { posted: true, reason: "already posted (idempotent)" };

  const hdrResult = await pool.request().input("JVID", sql.Int, jvId).query(`
    SELECT JVID, JVNo, JVDate, CompanyId, ProjectId FROM dbo.JournalVoucher WHERE JVID = @JVID
  `);
  const jv = hdrResult.recordset[0];
  if (!jv) return { posted: false, reason: `JournalVoucher ${jvId} not found` };

  const linesResult = await pool
    .request()
    .input("JVID", sql.Int, jvId)
    .query(
      `SELECT LHeadId, DebitAmount, CreditAmount, Narration FROM dbo.JournalVoucherLines WHERE JVID = @JVID ORDER BY SortOrder, LineID`,
    );
  const lines = linesResult.recordset;
  if (lines.length < 2)
    return { posted: false, reason: `JournalVoucher ${jvId} has fewer than 2 lines` };

  const docNo = jv.JVNo || `JV-${jvId}`;
  await postVoucher(pool, {
    voucherNo: docNo,
    voucherDate: jv.JVDate,
    sourceType: "JournalVoucher",
    sourceId: jvId,
    companyId: jv.CompanyId ?? null,
    projectId: jv.ProjectId ?? null,
    createdBy: userEmail,
    legs: lines.map((l) => ({
      lHeadId: l.LHeadId,
      debit: Number(l.DebitAmount) || 0,
      credit: Number(l.CreditAmount) || 0,
      narration: l.Narration || `${docNo} — journal voucher`,
    })),
  });
  return { posted: true };
}

// ── Fund Transfer (intra-company and inter-company bank-to-bank moves) ──────

/**
 * Fund Transfer approved.
 *
 * Intra-company (same company, two of its own bank accounts) — no loan
 * involved, per explicit instruction:
 *   Dr Destination Bank
 *   Cr Source Bank
 *
 * Inter-company (different companies): booked as a real dbo.LoanSanction
 * record (LoanType='Inter-Company', no interest, single bullet
 * installment) — not an ad-hoc GL head invented by this feature. Reuses
 * createLoanSanctionInternal() from routes/loanSanction.js, the same logic
 * the Loan Sanction page itself uses, so this loan shows up in the Loan
 * Dashboard/register exactly like one sanctioned by hand, with the same
 * per-company Loan ledger heads (LenderLHeadId/BorrowerLHeadId — one per
 * company, reused across every loan that company is ever a party to).
 *
 * The loan's own creation only credits the borrower's On-Account balance —
 * it deliberately does NOT touch GeneralLedgerEntry (a sanctioned loan can
 * predate real disbursement). Fund Transfer, unlike a loan sanctioned by
 * hand, *is* the disbursement — real cash actually left one bank and
 * arrived at another — so this posts the combined bank-movement +
 * lender/borrower legs itself, in one shot, instead of also calling
 * loanSanction.js's separate POST /:id/post-to-gl (which would double-count
 * both loan heads). See that route's own guard against exactly this.
 *   Source (lender) company's books:      Dr Lender Loan head / Cr Source Bank
 *   Destination (borrower) company's books: Dr Destination Bank / Cr Borrower Loan head
 */
async function postFundTransferApproval(pool, ftId, userEmail) {
  if (await hasPosting(pool, "FundTransfer", ftId))
    return { posted: true, reason: "already posted (idempotent)" };

  const result = await pool.request().input("id", sql.Int, ftId).query(`
    SELECT FTId, DocNo, TransferDate, TransferType, SourceCompanyId, DestinationCompanyId,
           SourceBankId, DestinationBankId, Amount, Narration
    FROM dbo.FundTransfer WHERE FTId = @id
  `);
  const ft = result.recordset[0];
  if (!ft) return { posted: false, reason: `FundTransfer ${ftId} not found` };

  const amount = Number(ft.Amount) || 0;
  if (amount <= 0)
    return { posted: false, reason: `FundTransfer ${ftId} amount is ${amount} (<= 0)` };

  const docNo = ft.DocNo || `FT-${ftId}`;
  const note = ft.Narration ? `: ${ft.Narration}` : "";

  if (ft.TransferType === "Intra") {
    await postVoucher(pool, {
      voucherNo: docNo,
      voucherDate: ft.TransferDate,
      sourceType: "FundTransfer",
      sourceId: ftId,
      companyId: ft.SourceCompanyId,
      createdBy: userEmail,
      legs: [
        { lHeadId: ft.DestinationBankId, debit: amount, narration: `${docNo} — fund transfer in${note}` },
        { lHeadId: ft.SourceBankId, credit: amount, narration: `${docNo} — fund transfer out${note}` },
      ],
    });
    return { posted: true };
  }

  const { createLoanSanctionInternal } = require("../routes/loanSanction");
  const { loanId, loanNo, lenderLHeadId, borrowerLHeadId } = await createLoanSanctionInternal({
    loanType: "Inter-Company",
    lenderCompanyId: ft.SourceCompanyId,
    lenderBankAccountId: ft.SourceBankId,
    borrowerCompanyId: ft.DestinationCompanyId,
    borrowerBankAccountId: ft.DestinationBankId,
    loanDate: ft.TransferDate,
    amount,
    hasInterest: false,
    purpose: `Inter-Company Fund Transfer ${docNo}${note}`,
  }, userEmail);

  await pool.request().input("id", sql.Int, ftId).input("loanId", sql.Int, loanId)
    .query(`UPDATE dbo.FundTransfer SET LinkedLoanId = @loanId WHERE FTId = @id`);

  await postVoucher(pool, {
    voucherNo: docNo,
    voucherDate: ft.TransferDate,
    sourceType: "FundTransfer",
    sourceId: ftId,
    companyId: ft.SourceCompanyId,
    createdBy: userEmail,
    legs: [
      { lHeadId: lenderLHeadId, debit: amount, narration: `${docNo} — inter-company loan ${loanNo} receivable (funds sent)${note}` },
      { lHeadId: ft.SourceBankId, credit: amount, narration: `${docNo} — fund transfer out` },
    ],
  });
  await postVoucher(pool, {
    voucherNo: docNo,
    voucherDate: ft.TransferDate,
    sourceType: "FundTransfer",
    sourceId: ftId,
    companyId: ft.DestinationCompanyId,
    createdBy: userEmail,
    legs: [
      { lHeadId: ft.DestinationBankId, debit: amount, narration: `${docNo} — fund transfer in` },
      { lHeadId: borrowerLHeadId, credit: amount, narration: `${docNo} — inter-company loan ${loanNo} payable (funds received)${note}` },
    ],
  });
  return { posted: true, loanId, loanNo };
}

module.exports = {
  GL_ACCOUNTS,
  getGLHeadId,
  getHeadIdByName,
  hasPosting,
  postVoucher,
  postGRNApproval,
  postExpenseBookingApproval,
  postPaymentApproval,
  resolvePaymentSupplierHeadId,
  postReceivedPaymentApproval,
  postJournalVoucherApproval,
  postFundTransferApproval,
  postOnAccountAdjustment,
  reverseOnAccountAdjustmentPosting,
  reversePostingBySource,
};
