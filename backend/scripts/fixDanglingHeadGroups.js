"use strict";
/**
 * Account heads whose group is missing or points at a group that no longer
 * exists are left out of the Trial Balance, Balance Sheet and P&L. Migration
 * 523 placed heads with NO group; this also catches a head whose LBelongsTo
 * points at a deleted / non-existent AccountGroup (found on production for
 * Stamp Duty & Registration Expense).
 *
 * Read-only by default: lists every head with a missing or dangling group and
 * what it WOULD do. --apply moves only the heads with a known home:
 *   CRM-STAMPDUTY, BNKCHG, SA-COMMISSION -> INDIRECT EXPENSES (found by name)
 *   CRM-GST-OUTPUT                -> DUTY & TAXES (DAT)
 *   TDS-%  (GL)                   -> TDS PAYABLE  (TDSP)
 * Everything else is listed for Finance to place by hand.
 *
 * Run: node scripts/fixDanglingHeadGroups.js [--apply]
 */
const { connectDB, getPool, closeDB, sql } = require("../db");
const APPLY = process.argv.includes("--apply");

(async () => {
  await connectDB();
  const pool = getPool();
  const q = async (s) => (await pool.request().query(s)).recordset;
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${new Date().toISOString()} — database ${(await q("SELECT DB_NAME() d"))[0].d}`);

  const groups = {
    ie: (await q(`SELECT TOP 1 AGId, Code FROM dbo.AccountGroup WHERE UPPER(LTRIM(RTRIM(Name))) = 'INDIRECT EXPENSES' ORDER BY AGId`))[0],
    dat: (await q(`SELECT TOP 1 AGId, Code FROM dbo.AccountGroup WHERE Code = 'DAT'`))[0],
    tdsp: (await q(`SELECT TOP 1 AGId, Code FROM dbo.AccountGroup WHERE Code = 'TDSP'`))[0],
  };
  console.log("target groups:", JSON.stringify(groups));

  const broken = await q(`
    SELECT h.LHeadId, h.LHeadCode, h.LHeadName, h.LHeadType, h.LBelongsTo,
           CASE WHEN h.LBelongsTo IS NULL THEN 'no group' ELSE 'group ' + CAST(h.LBelongsTo AS VARCHAR(20)) + ' does not exist' END AS Problem,
           (SELECT COUNT(*) FROM dbo.GeneralLedgerEntry e WHERE e.LHeadId = h.LHeadId) AS Legs
    FROM dbo.AccountHeadMaster h
    LEFT JOIN dbo.AccountGroup g ON g.AGId = h.LBelongsTo
    WHERE g.AGId IS NULL
    ORDER BY h.LHeadId`);
  console.log(`\nheads with a missing or dangling group: ${broken.length}`);

  const target = (h) => {
    if (["CRM-STAMPDUTY", "BNKCHG", "SA-COMMISSION"].includes(h.LHeadCode)) return groups.ie;
    if (h.LHeadCode === "CRM-GST-OUTPUT") return groups.dat;
    if (h.LHeadType === "GL" && String(h.LHeadCode || "").startsWith("TDS-")) return groups.tdsp;
    return null;
  };
  let moved = 0;
  for (const h of broken) {
    const t = target(h);
    const line = `  ${String(h.LHeadId).padEnd(6)} ${String(h.LHeadCode || "—").padEnd(22)} ${String(h.LHeadName).slice(0, 44).padEnd(44)} ${h.Problem.padEnd(26)} legs=${h.Legs}`;
    if (!t) { console.log(`${line}  -> leave for Finance`); continue; }
    console.log(`${line}  -> ${APPLY ? "MOVED to" : "would move to"} group ${t.Code} (${t.AGId})`);
    if (APPLY) {
      await pool.request().input("id", sql.Int, h.LHeadId).input("g", sql.Int, t.AGId)
        .query("UPDATE dbo.AccountHeadMaster SET LBelongsTo = @g, UpdatedAt = SYSDATETIME() WHERE LHeadId = @id");
      moved++;
    }
  }
  console.log(APPLY ? `\nmoved ${moved} head(s).` : "\ndry run — nothing changed. Re-run with --apply to move the heads marked above.");
  await closeDB?.();
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.stack || e.message); process.exit(1); });
