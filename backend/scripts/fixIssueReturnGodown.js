// Issue returns saved before the form sent a godown: the return has no GodownId, so
// when it was approved its stock went back into the ledger with no godown and shows
// in none. Fills in the godown the return's issue took the stock from, on the return
// and on its stock lines (RefType 'IRN'). Returns whose issue has no godown either are
// listed and left alone.
//   node scripts/fixIssueReturnGodown.js           dry run - lists, changes nothing
//   node scripts/fixIssueReturnGodown.js --apply   writes the godowns
const { connectDB, getPool, closeDB, sql } = require("../db");

const apply = process.argv.includes("--apply");

(async () => {
  await connectDB();
  const pool = getPool();
  const rows = (await pool.request().query(`
    SELECT ir.ReturnId, ir.DocNo, ir.Status, ir.IssueId, mi.DocNo AS IssueDocNo,
           mi.GodownId AS IssueGodownId, g.GodownName,
           (SELECT COUNT(*) FROM dbo.StockLedger sl
             WHERE sl.RefType = 'IRN' AND sl.RefID = ir.ReturnId AND sl.GodownID IS NULL) AS LinesNoGodown
    FROM dbo.MaterialIssueReturn ir
    LEFT JOIN dbo.MaterialIssues mi ON mi.IssueId = ir.IssueId
    LEFT JOIN dbo.Godowns g ON g.GodownID = mi.GodownId
    WHERE ir.GodownId IS NULL
       OR EXISTS (SELECT 1 FROM dbo.StockLedger sl WHERE sl.RefType = 'IRN' AND sl.RefID = ir.ReturnId AND sl.GodownID IS NULL)
    ORDER BY ir.ReturnId`)).recordset;

  if (!rows.length) { console.log("OK   every issue return has its godown"); await closeDB?.(); process.exit(0); }

  const fixable = rows.filter((r) => r.IssueGodownId != null);
  for (const r of rows) {
    if (r.IssueGodownId == null) {
      console.log(`SKIP ${r.DocNo} (${r.Status}): its issue ${r.IssueDocNo || "(none)"} has no godown either`);
    } else {
      console.log(`FIX  ${r.DocNo} (${r.Status}) <- ${r.GodownName || "#" + r.IssueGodownId} from ${r.IssueDocNo}; ${r.LinesNoGodown} stock line(s) without a godown`);
    }
  }
  const lines = fixable.reduce((s, r) => s + Number(r.LinesNoGodown), 0);
  console.log(`${fixable.length} return(s) to fix, ${lines} stock line(s); ${rows.length - fixable.length} skipped`);
  if (!apply) { console.log("Dry run - nothing changed. Run again with --apply to fix."); await closeDB?.(); process.exit(0); }

  const tx = pool.transaction();
  await tx.begin();
  try {
    for (const r of fixable) {
      await tx.request().input("id", sql.Int, r.ReturnId).input("g", sql.Int, r.IssueGodownId)
        .query("UPDATE dbo.MaterialIssueReturn SET GodownId = @g WHERE ReturnId = @id AND GodownId IS NULL");
      await tx.request().input("id", sql.Int, r.ReturnId).input("g", sql.Int, r.IssueGodownId)
        .query("UPDATE dbo.StockLedger SET GodownID = @g WHERE RefType = 'IRN' AND RefID = @id AND GodownID IS NULL");
    }
    await tx.commit();
    console.log(`Done - ${fixable.length} return(s) and ${lines} stock line(s) now carry their godown.`);
  } catch (err) {
    await tx.rollback();
    console.error("Failed, nothing changed:", err.message);
    process.exitCode = 1;
  }
  await closeDB?.();
  process.exit();
})().catch((err) => { console.error(err); process.exit(1); });
