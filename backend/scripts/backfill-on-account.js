/**
 * backfill-on-account.js
 *
 * One-time script:
 *  1. Truncates dbo.OnAccountLedger (removes all seeded / test rows)
 *  2. For every ExpenseBooking where total approved-non-bounced payments exceed
 *     the net invoice amount, inserts a CREDIT row so the On A/C Adjustment
 *     page shows real supplier / contractor balances.
 *
 * Run from the backend/ directory:
 *   node scripts/backfill-on-account.js
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { connectDB, getPool, sql } = require("../db");
const { resolvePartyFromRef }     = require("../utils/resolvePartyFromRef");

const PARTY_LABEL = { S: "Supplier", C: "Contractor", A: "Customer" };

async function main() {
  await connectDB();
  const pool = getPool();
  console.log("Connected to DB.\n");

  // ── 1. Wipe existing OA data ───────────────────────────────────────────────
  await pool.request().query("TRUNCATE TABLE dbo.OnAccountLedger");
  console.log("✓ OnAccountLedger truncated.\n");

  // ── 2. Find invoices where total paid > net amount ─────────────────────────
  //
  // Sum only Approved, non-bounced payments (same as syncBillStatus).
  const rows = await pool.request().query(`
    SELECT
      eb.EDocNo       AS InvoiceRef,
      eb.ENetAmount   AS NetAmount,
      eb.ECompanyId   AS CompanyId,
      TRY_CAST(eb.EProjectName AS INT) AS ProjectId,
      ISNULL((
        SELECT SUM(np.PAmount - ISNULL(np.BounceCharge, 0))
        FROM dbo.NewPayment np
        LEFT JOIN dbo.BankReconciliation br
          ON br.SourceType = 'PAYMENT' AND br.SourceID = np.PPaymentID
        WHERE np.PExpenseRef = eb.EDocNo
          AND np.Status = 'Approved'
          AND (br.IsBounced IS NULL OR br.IsBounced = 0)
      ), 0) AS TotalPaid,
      (
        SELECT TOP 1 np2.DocNo
        FROM dbo.NewPayment np2
        WHERE np2.PExpenseRef = eb.EDocNo AND np2.Status = 'Approved'
        ORDER BY np2.PCreatedAt DESC
      ) AS LastPaymentDocNo,
      (
        SELECT TOP 1 np2.PPaymentID
        FROM dbo.NewPayment np2
        WHERE np2.PExpenseRef = eb.EDocNo AND np2.Status = 'Approved'
        ORDER BY np2.PCreatedAt DESC
      ) AS LastPaymentId,
      (
        SELECT TOP 1 np2.PDate
        FROM dbo.NewPayment np2
        WHERE np2.PExpenseRef = eb.EDocNo AND np2.Status = 'Approved'
        ORDER BY np2.PCreatedAt DESC
      ) AS LastPaymentDate,
      -- Fallback: party stored directly on the payment (for direct invoices)
      (
        SELECT TOP 1 np2.PPartyId
        FROM dbo.NewPayment np2
        WHERE np2.PExpenseRef = eb.EDocNo AND np2.Status = 'Approved' AND np2.PPartyId IS NOT NULL
        ORDER BY np2.PCreatedAt DESC
      ) AS FallbackPartyId,
      (
        SELECT TOP 1 ahm.LHeadType
        FROM dbo.NewPayment np2
        JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = np2.PPartyId
        WHERE np2.PExpenseRef = eb.EDocNo AND np2.Status = 'Approved' AND np2.PPartyId IS NOT NULL
        ORDER BY np2.PCreatedAt DESC
      ) AS FallbackPartyType
    FROM dbo.ExpenseBooking eb
    WHERE eb.EDocNo IS NOT NULL
  `);

  const invoices = rows.recordset;
  let inserted = 0;
  let skipped  = 0;

  for (const inv of invoices) {
    const netAmount = parseFloat(inv.NetAmount ?? 0);
    const totalPaid = parseFloat(inv.TotalPaid ?? 0);
    const excess    = Math.max(0, totalPaid - netAmount);

    if (excess < 0.01)           { skipped++; continue; }
    if (!inv.LastPaymentDocNo)   { skipped++; continue; }

    // Resolve party via the same utility used by the payment approval hook.
    // For direct invoices (INV/PAY/...) the resolver finds no source GRN/PO,
    // so fall back to PPartyId stored on the payment itself.
    let party;
    try {
      party = await resolvePartyFromRef(pool, inv.InvoiceRef);
    } catch (_) { /* ignore */ }

    if (!party?.partyId && inv.FallbackPartyId) {
      party = { partyId: inv.FallbackPartyId, partyType: inv.FallbackPartyType };
    }

    if (!party?.partyId) {
      console.log(`  ⚠ ${inv.InvoiceRef} — could not resolve party, skipped`);
      skipped++;
      continue;
    }

    const partyType = PARTY_LABEL[party.partyType] ?? party.partyType ?? "Supplier";

    await pool.request()
      .input("PartyId",     sql.Int,           party.partyId)
      .input("PartyType",   sql.NVarChar(20),  partyType)
      .input("TxnDate",     sql.Date,          inv.LastPaymentDate ? new Date(inv.LastPaymentDate) : new Date())
      .input("TxnType",     sql.NVarChar(10),  "CREDIT")
      .input("Amount",      sql.Decimal(18,2), excess)
      .input("RefType",     sql.NVarChar(30),  "Payment")
      .input("RefDocNo",    sql.NVarChar(100), inv.LastPaymentDocNo)
      .input("RefId",       sql.Int,           inv.LastPaymentId ?? null)
      .input("AdjRefDocNo", sql.NVarChar(100), null)
      .input("CompanyId",   sql.Int,           inv.CompanyId ?? null)
      .input("ProjectId",   sql.Int,           inv.ProjectId ?? null)
      .input("Notes",       sql.NVarChar(500), `Backfilled: ₹${excess.toFixed(2)} excess from ${inv.LastPaymentDocNo} on ${inv.InvoiceRef}`)
      .query(`
        INSERT INTO dbo.OnAccountLedger
          (PartyId, PartyType, TxnDate, TxnType, Amount, RefType, RefDocNo, RefId, AdjRefDocNo, CompanyId, ProjectId, Notes)
        VALUES
          (@PartyId, @PartyType, @TxnDate, @TxnType, @Amount, @RefType, @RefDocNo, @RefId, @AdjRefDocNo, @CompanyId, @ProjectId, @Notes)
      `);

    console.log(`  ✓ ${inv.InvoiceRef} — ${partyType} #${party.partyId} — excess ₹${excess.toFixed(2)} (via ${inv.LastPaymentDocNo})`);
    inserted++;
  }

  console.log(`\nDone. ${inserted} CREDIT rows inserted, ${skipped} invoices skipped.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err.message);
  process.exit(1);
});
