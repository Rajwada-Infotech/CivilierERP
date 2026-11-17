// Removes the Legal presentation data loaded by legal-demo-seed.js — only the demo records: lands DEMO/…,
// enquiries DEMO-ENQ-…, and every row linked to them (searches, RS/LR, owners, documents, payments, deed tracking,
// tasks, audit). Anything else entered in Legal is left alone. One transaction: on any error nothing is changed.
//   cd backend && node scripts/legal-demo-remove.js --confirm=<DB_NAME>
require("dotenv").config();
const { connectDB, sql } = require("../db");

const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || "";

(async () => {
  const pool = await connectDB();
  const db = (await pool.request().query("SELECT DB_NAME() AS d, @@SERVERNAME AS s")).recordset[0];
  if (arg("confirm") !== db.d) throw new Error(`Run with --confirm=${db.d} (server ${db.s}).`);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  const q = async (s) => (await new sql.Request(tx).query(s)).recordset;
  try {
    const LAND = "SELECT LandId FROM dbo.LegalLand WHERE LandCode LIKE N'DEMO/%'";
    const ENQ = "SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo LIKE N'DEMO-ENQ-%'";
    const DOC = `SELECT DocumentId FROM dbo.LegalLandDocument WHERE LandId IN (${LAND})`;
    const n = (await q(`SELECT (SELECT COUNT(*) FROM (${LAND}) a) AS L, (SELECT COUNT(*) FROM (${ENQ}) b) AS E`))[0];
    if (!n.L && !n.E) { await tx.rollback(); console.log("No demo records found."); process.exit(0); }

    // Temp lists, so the filters still work while the parent rows are being deleted.
    await q(`SELECT LandId INTO #L FROM (${LAND}) x; SELECT EnquiryId INTO #E FROM (${ENQ}) y; SELECT DocumentId INTO #D FROM (${DOC}) z;`);
    await q("UPDATE dbo.LegalLand SET EnquiryId = NULL WHERE LandId IN (SELECT LandId FROM #L); UPDATE dbo.LegalLandEnquiry SET LandId = NULL WHERE EnquiryId IN (SELECT EnquiryId FROM #E);");
    await q("IF COL_LENGTH('dbo.LegalRsPlot','LandId') IS NOT NULL EXEC('UPDATE dbo.LegalRsPlot SET LandId = NULL WHERE LandId IN (SELECT LandId FROM #L)')");

    // Every Legal table holding a demo LandId / EnquiryId / DocumentId (the masters only lose the parent rows last).
    const cols = await q(`SELECT t.name AS t, c.name AS c FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id
      WHERE t.name LIKE N'Legal%' AND c.name IN (N'LandId', N'EnquiryId', N'DocumentId')`);
    const steps = cols
      .filter((x) => !(x.t === "LegalLand" && x.c === "LandId") && !(x.t === "LegalLandEnquiry" && x.c === "EnquiryId") && !(x.t === "LegalLandDocument" && x.c === "DocumentId"))
      .map((x) => `DELETE FROM dbo.${x.t} WHERE ${x.c} IN (SELECT ${x.c} FROM #${x.c === "LandId" ? "L" : x.c === "EnquiryId" ? "E" : "D"})`);
    steps.push("DELETE FROM dbo.LegalLand WHERE LandId IN (SELECT LandId FROM #L)", "DELETE FROM dbo.LegalLandEnquiry WHERE EnquiryId IN (SELECT EnquiryId FROM #E)");
    let left = steps;
    for (let pass = 0; pass < 15 && left.length; pass++) {
      const next = [];
      for (const s of left) {
        await q("SAVE TRAN s1");
        try { await q(s); } catch { await q("ROLLBACK TRAN s1"); next.push(s); }
      }
      left = next;
    }
    if (left.length) throw new Error(`Could not remove: ${left.join(" | ")}`);
    await tx.commit();
    console.log(`✓ Removed ${n.L} demo land(s), ${n.E} demo enquiry(ies) and everything linked to them.`);
    process.exit(0);
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
})().catch((e) => { console.error("✗ Nothing changed —", e.message); process.exit(1); });
