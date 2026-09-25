// Read-only diagnostic: breaks a Balance Sheet imbalance into its possible
// causes, so the difference can be traced instead of guessed at.
//
//   Assets - Liabilities  ==  the ledger's own Dr/Cr gap
//                           + heads whose group chain reaches no root (skipped by the sheet)
//                           + bank opening balances (added to Assets with no equity offset)
//                           + on-account advances added back to party heads
//
// Usage: node scripts/diagnoseBalanceSheetImbalance.js [asOf=YYYY-MM-DD]
require("../config/env").loadEnv();
const { connectDB, getPool, sql, closeDB } = require("../db");

const asOf = process.argv[2] || new Date().toISOString().slice(0, 10);
const money = (n) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  await connectDB();
  const pool = getPool();
  const req = () => pool.request().input("asOf", sql.Date, asOf);

  // 1. Is the ledger itself balanced?
  const gap = await req().query(`
    SELECT ISNULL(SUM(DebitAmount),0) AS dr, ISNULL(SUM(CreditAmount),0) AS cr
    FROM dbo.GeneralLedgerEntry WHERE IsReversed = 0 AND VoucherDate <= @asOf`);
  const { dr, cr } = gap.recordset[0];
  console.log(`\n1) GL total Dr ${money(dr)} | Cr ${money(cr)} | gap (Dr-Cr) ${money(dr - cr)}   <-- should be 0.00`);

  // 2. Net (Dr-Cr) per root, walking each head's group chain to its root.
  const byRoot = await req().query(`
    ;WITH chain AS (
      SELECT AGId AS startId, AGId, ParentGroupId, Name, 0 AS depth FROM dbo.AccountGroup
      UNION ALL
      SELECT c.startId, g.AGId, g.ParentGroupId, g.Name, c.depth + 1
      FROM chain c JOIN dbo.AccountGroup g ON g.AGId = c.ParentGroupId WHERE c.depth < 20
    ),
    roots AS (SELECT startId, Name AS RootName FROM chain WHERE ParentGroupId IS NULL)
    SELECT ISNULL(r.RootName, '(NO ROOT / ORPHAN)') AS Root,
           COUNT(DISTINCT ahm.LHeadId) AS Heads,
           ISNULL(SUM(gle.DebitAmount - gle.CreditAmount), 0) AS NetDrCr
    FROM dbo.AccountHeadMaster ahm
    JOIN dbo.GeneralLedgerEntry gle ON gle.LHeadId = ahm.LHeadId AND gle.IsReversed = 0 AND gle.VoucherDate <= @asOf
    LEFT JOIN roots r ON r.startId = ahm.LBelongsTo
    GROUP BY r.RootName ORDER BY 1`);
  console.log("\n2) Net Dr-Cr by root (Assets + Liabilities + Revenue + Expenses + orphans should = 0):");
  console.table(byRoot.recordset.map((r) => ({ ...r, NetDrCr: money(r.NetDrCr) })));

  // 3. Postings on heads with no group (LBelongsTo NULL) — the sheet skips these.
  const noGroup = await req().query(`
    SELECT ahm.LHeadId, ahm.LHeadName, ahm.LHeadType, SUM(gle.DebitAmount - gle.CreditAmount) AS NetDrCr
    FROM dbo.AccountHeadMaster ahm
    JOIN dbo.GeneralLedgerEntry gle ON gle.LHeadId = ahm.LHeadId AND gle.IsReversed = 0 AND gle.VoucherDate <= @asOf
    WHERE ahm.LBelongsTo IS NULL
    GROUP BY ahm.LHeadId, ahm.LHeadName, ahm.LHeadType HAVING ABS(SUM(gle.DebitAmount - gle.CreditAmount)) > 0.005`);
  console.log("3) Heads with postings but NO group (skipped by the Balance Sheet):");
  console.table(noGroup.recordset.map((r) => ({ ...r, NetDrCr: money(r.NetDrCr) })));

  // 4. Bank opening balances added on top of GL with no offsetting entry.
  const bank = await pool.request().query(`
    SELECT LHeadId, LHeadName, BankOpeningBalance FROM dbo.AccountHeadMaster
    WHERE LHeadType = 'B' AND ISNULL(BankOpeningBalance, 0) <> 0`);
  const bankTotal = bank.recordset.reduce((s, r) => s + Number(r.BankOpeningBalance), 0);
  console.log(`4) Bank opening balances (Assets side, no equity offset): total ${money(bankTotal)}`);
  console.table(bank.recordset.map((r) => ({ ...r, BankOpeningBalance: money(r.BankOpeningBalance) })));

  // 5. On-account advances added back to supplier/vendor/contractor heads.
  const oa = await req().query(`
    SELECT ISNULL(SUM(Amount),0) AS advance FROM dbo.OnAccountLedger
    WHERE PartyType IN ('Supplier','Vendor','Contractor') AND TxnType = 'CREDIT' AND TxnDate <= @asOf`);
  console.log(`5) On-account advances added back on the debit side: ${money(oa.recordset[0].advance)}`);

  console.log(`\nInterpretation: the sheet's difference should equal (1) + (3) + (4) + (5) adjusted for sign.`);
  await closeDB();
})().catch((e) => { console.error(e.message); process.exit(1); });
