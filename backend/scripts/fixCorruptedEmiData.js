// backend/scripts/fixCorruptedEmiData.js
//
// Repairs dbo.ExpenseBooking.EEmiData rows corrupted by spreading a STRING
// where an object was expected (JS spreads a string into
// {"0":"c","1":"h",...}) — a bug in dbToRecord (frontend) and the EMI-pay/
// EMI-toggle routes (backend) that, once a row was corrupted once, kept
// re-corrupting it on every subsequent edit (each read-modify-write cycle
// parsed the garbage keys back in and saved them again). Both call sites are
// now guarded (see sanitizeEmiJson in routes/expenseBooking.js and the
// matching guard in ExpenseBooking/helpers.ts's dbToRecord) so this can't
// keep happening — this script is a one-time cleanup for rows already
// corrupted before that fix shipped.
//
// A corrupted blob has a "0" key (a legit EMI config's keys are always named
// fields — enabled, installmentCount, ... — never numeric). The real fields
// are recovered from wherever they still sit in the object (the corrupting
// code only ever added/overwrote named fields alongside the garbage, never
// removed them), same recovery logic as the guard.
//
// Usage:
//   cd backend
//   node scripts/fixCorruptedEmiData.js            # dry run — reports matches, writes nothing
//   node scripts/fixCorruptedEmiData.js --apply     # repairs every matched row

require("dotenv").config();
const { connectDB, getPool, sql } = require("../db");

const APPLY = process.argv.includes("--apply");

function isCorrupted(parsed) {
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    && Object.prototype.hasOwnProperty.call(parsed, "0");
}

function recover(parsed) {
  return {
    enabled: !!parsed.enabled,
    installmentCount: parsed.installmentCount || 0,
    emiAmount: parsed.emiAmount || 0,
    startDate: parsed.startDate || "",
    schedule: Array.isArray(parsed.schedule) ? parsed.schedule : [],
  };
}

(async () => {
  await connectDB();
  const pool = getPool();

  const rows = await pool.request().query(`
    SELECT Eid, EDocNo, EEmiData FROM dbo.ExpenseBooking WHERE EEmiData IS NOT NULL
  `);

  const matches = [];
  for (const row of rows.recordset) {
    let parsed;
    try {
      parsed = JSON.parse(row.EEmiData);
    } catch {
      continue;
    }
    if (isCorrupted(parsed)) matches.push({ row, parsed });
  }

  if (matches.length === 0) {
    console.log("No corrupted EEmiData rows found.");
    process.exit(0);
  }

  console.log(`${matches.length} corrupted EEmiData row(s) found.${APPLY ? "" : " (dry run — pass --apply to write)"}\n`);

  let fixed = 0;
  for (const { row, parsed } of matches) {
    const clean = recover(parsed);
    const label = `Eid ${row.Eid} (${row.EDocNo || "no doc no"}) — recovered: enabled=${clean.enabled}, installmentCount=${clean.installmentCount}, emiAmount=${clean.emiAmount}, startDate=${clean.startDate || "(none)"}, schedule rows=${clean.schedule.length}`;
    if (!APPLY) {
      console.log(`WOULD FIX  ${label}`);
      continue;
    }
    await pool.request()
      .input("Eid", sql.Int, row.Eid)
      .input("EEmiData", sql.NVarChar(sql.MAX), JSON.stringify(clean))
      .query("UPDATE dbo.ExpenseBooking SET EEmiData = @EEmiData WHERE Eid = @Eid");
    console.log(`FIXED  ${label}`);
    fixed++;
  }

  if (APPLY) console.log(`\nFixed: ${fixed}.`);
  process.exit(0);
})().catch((err) => {
  console.error("Script failed:", err.message);
  process.exit(1);
});
