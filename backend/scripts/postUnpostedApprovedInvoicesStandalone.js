// Self-contained version of postUnpostedApprovedInvoices.js — does NOT
// require() services/generalLedger.js, so it works correctly even when
// copied into a running container whose own copy of that file still has
// the old (broken) EName-based supplier lookup. Every posting rule below
// is copy-pasted from the FIXED postExpenseBookingApproval (the non-GRN
// branch — the only one needed here, since every row this finds is
// ESourceType NOT IN ('GRN')).
//
// Dry-run by default — pass --apply to actually post.
//
// Usage:
//   node backend/scripts/postUnpostedApprovedInvoicesStandalone.js
//   node backend/scripts/postUnpostedApprovedInvoicesStandalone.js --apply

const { connectDB, getPool, closeDB, sql } = require("../db");

const APPLY = process.argv.includes("--apply");

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const glHeadIdCache = new Map();
async function getGLHeadId(pool, name) {
  if (glHeadIdCache.has(name)) return glHeadIdCache.get(name);
  const result = await pool.request().input("Name", sql.NVarChar(200), name).query(
    `SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = @Name AND LHeadType = 'GL'`,
  );
  const id = result.recordset[0]?.LHeadId ?? null;
  if (!id) throw new Error(`GL account "${name}" not found in AccountHeadMaster`);
  glHeadIdCache.set(name, id);
  return id;
}

async function hasPosting(pool, sourceType, sourceId) {
  const result = await pool.request()
    .input("SourceType", sql.NVarChar(30), sourceType)
    .input("SourceId", sql.Int, sourceId)
    .query(`SELECT TOP 1 1 AS found FROM dbo.GeneralLedgerEntry WHERE SourceType = @SourceType AND SourceId = @SourceId AND IsReversed = 0`);
  return result.recordset.length > 0;
}

async function postVoucher(pool, { voucherNo, voucherDate, legs, sourceType, sourceId, companyId, projectId, createdBy }) {
  const totalDebit = Math.round(legs.reduce((s, l) => s + (l.debit || 0), 0) * 100) / 100;
  const totalCredit = Math.round(legs.reduce((s, l) => s + (l.credit || 0), 0) * 100) / 100;
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Voucher ${voucherNo} does not balance: debit ${totalDebit} !== credit ${totalCredit}`);
  }
  const tx = pool.transaction();
  await tx.begin();
  try {
    for (const leg of legs) {
      if (!leg.lHeadId) throw new Error(`Voucher ${voucherNo} has a leg with no lHeadId`);
      const debit = Math.round((leg.debit || 0) * 100) / 100;
      const credit = Math.round((leg.credit || 0) * 100) / 100;
      if (debit === 0 && credit === 0) continue;
      await tx.request()
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
        .input("CreatedBy", sql.NVarChar(150), createdBy)
        .query(`
          INSERT INTO dbo.GeneralLedgerEntry
            (VoucherNo, VoucherDate, LHeadId, DebitAmount, CreditAmount, Narration, SourceType, SourceId, CompanyId, ProjectId, CreatedBy)
          VALUES
            (@VoucherNo, @VoucherDate, @LHeadId, @DebitAmount, @CreditAmount, @Narration, @SourceType, @SourceId, @CompanyId, @ProjectId, @CreatedBy)
        `);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

// Direct port of postExpenseBookingApproval's non-GRN branch (see
// services/generalLedger.js) — the fixed version, using eb.LHeadId
// directly instead of an EName string match.
async function postDirectInvoice(pool, ebId, userEmail) {
  if (await hasPosting(pool, "ExpenseBooking", ebId)) return { posted: true, reason: "already posted (idempotent)" };
  if (await hasPosting(pool, "InvoicePosting", ebId)) return { posted: true, reason: "already posted via InvoicePosting (authoritative)" };

  const result = await pool.request().input("Eid", sql.Int, ebId).query(`
    SELECT eb.Eid, eb.EDocNo, eb.EDocDate, eb.EAmount, eb.ENetAmount,
           eb.ESourceType, eb.EName, eb.ECompanyId, eb.EProjectName, eb.LHeadId
    FROM dbo.ExpenseBooking eb
    WHERE eb.Eid = @Eid
  `);
  const eb = result.recordset[0];
  if (!eb) return { posted: false, reason: `ExpenseBooking ${ebId} not found` };
  if (eb.ESourceType === "GRN") return { posted: false, reason: `ExpenseBooking ${ebId} is GRN-sourced — use the GRN-aware backfill instead` };

  const netAmount = Number(eb.ENetAmount ?? eb.EAmount) || 0;
  if (netAmount <= 0) return { posted: false, reason: `ExpenseBooking ${ebId} net amount is ${netAmount} (<= 0)` };

  const companyId = eb.ECompanyId ?? null;
  const projectId = Number.isFinite(parseInt(eb.EProjectName, 10)) ? parseInt(eb.EProjectName, 10) : null;
  const docNo = eb.EDocNo || `EXB-${ebId}`;
  const voucherDate = eb.EDocDate;

  const supplierHeadId = eb.LHeadId;
  if (!supplierHeadId) return { posted: false, reason: `ExpenseBooking ${ebId}: no LHeadId set — cannot resolve supplier` };

  const baseAmount = Number(eb.EAmount) || 0;
  const gstAndTerms = Math.max(0, netAmount - baseAmount);

  const purchaseHeadId = await getGLHeadId(pool, "Purchase A/c");
  const provisionalCreditHeadId = await getGLHeadId(pool, "Provisional Credit Available");

  await postVoucher(pool, {
    voucherNo: docNo,
    voucherDate,
    sourceType: "ExpenseBooking",
    sourceId: ebId,
    companyId,
    projectId,
    createdBy: userEmail,
    legs: [
      { lHeadId: purchaseHeadId, debit: baseAmount, narration: `${docNo} — expense booked (base)` },
      { lHeadId: provisionalCreditHeadId, debit: gstAndTerms, narration: `${docNo} — GST / billing terms` },
      { lHeadId: supplierHeadId, credit: netAmount, narration: `${docNo} — supplier/contractor liability` },
    ],
  });
  return { posted: true };
}

async function main() {
  await connectDB();
  const pool = getPool();

  const rowsRes = await pool.request().query(`
    SELECT eb.Eid, eb.EDocNo, eb.EName, eb.LHeadId, eb.ENetAmount, eb.EAmount, eb.ESourceType, eb.EStatus,
           ah.LHeadName AS ResolvedSupplierName
    FROM dbo.ExpenseBooking eb
    LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = eb.LHeadId
    WHERE eb.ESourceType NOT IN ('GRN')
      AND eb.EStatus = 'Approved'
      AND NOT EXISTS (
        SELECT 1 FROM dbo.GeneralLedgerEntry gle
        WHERE gle.SourceType IN ('ExpenseBooking', 'InvoicePosting') AND gle.SourceId = eb.Eid AND gle.IsReversed = 0
      )
    ORDER BY ah.LHeadName, eb.Eid
  `);

  console.log(`Found ${rowsRes.recordset.length} approved, unposted, non-GRN invoice(s). Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  let postedCount = 0, skippedCount = 0;
  let totalAmount = 0;
  for (const eb of rowsRes.recordset) {
    const amount = Number(eb.ENetAmount ?? eb.EAmount) || 0;
    const supplierLabel = eb.ResolvedSupplierName || `LHeadId ${eb.LHeadId || "(none)"}`;
    console.log(`${eb.EDocNo} (Eid ${eb.Eid}) — ${supplierLabel} — ₹${fmt(amount)}`);

    if (APPLY) {
      const result = await postDirectInvoice(pool, eb.Eid, "backfill-post-unposted-approved-invoices");
      if (result.posted) {
        postedCount++;
        totalAmount += amount;
        console.log(`    → posted`);
      } else {
        skippedCount++;
        console.log(`    → NOT posted: ${result.reason}`);
      }
    }
    console.log("");
  }

  if (APPLY) {
    console.log(`${postedCount} invoice(s) posted (₹${fmt(totalAmount)} total), ${skippedCount} still skipped (see reasons above).`);
  } else {
    console.log(`${rowsRes.recordset.length} invoice(s) would be attempted. Re-run with --apply to actually post them.`);
  }

  await closeDB();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
