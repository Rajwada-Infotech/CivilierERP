// One-off backfill for the "every Direct Expense Booking (DINV) invoice
// shows the same doc number" bug (see backend/routes/expenseBooking.js —
// the RecordId back-patch after INSERT used the ALREADY-PREFIXED doc no
// ("INV/DINV.../...") to find the DocNumberSequence row that was actually
// reserved under the UN-prefixed value ("DINV.../..."). The UPDATE never
// matched, RecordId stayed NULL forever, and every subsequent booking's
// reservation loop treated that row as an abandoned reservation and
// reclaimed the exact same number instead of incrementing. Combined with a
// second bug (an off-by-one in the MAX-sequence lookup that made it always
// return NULL for anything with a "/finYear" suffix), the sequence never
// advanced past the very first booking. Both bugs are fixed in
// expenseBooking.js; this script renumbers the records created while they
// were broken.
//
// What it does, per affected TypeOfDoc row (normally just one — "DINV"):
//   1. Loads every non-deleted ExpenseBooking row for that doc type,
//      ordered by creation time (oldest first) — this is the order the
//      numbers SHOULD have been issued in.
//   2. Groups them by EFinYear (DocNo resets per financial year for this
//      doc type) and assigns 1, 2, 3, ... within each group, starting from
//      the doc type's configured StartingDocNo.
//   3. Rewrites each row's EDocNo to the correctly-sequenced value, in the
//      exact format the app itself produces (prefix + padded serial +
//      "/finYear", with the "INV/" module prefix applied on top).
//   4. Rebuilds DocNumberSequence for this TypeOfDocId from scratch so
//      future bookings continue the sequence correctly instead of
//      colliding with the just-backfilled numbers.
//
// Dry-run by default — prints what it WOULD change without touching the
// database. Pass --apply to actually write.
//
// Usage:
//   node backend/scripts/backfillDirectExpenseBookingDocNumbers.js
//   node backend/scripts/backfillDirectExpenseBookingDocNumbers.js --apply
//   node backend/scripts/backfillDirectExpenseBookingDocNumbers.js --apply --prefix=DINV

const { connectDB, getPool, sql, closeDB } = require("../db");

const APPLY = process.argv.includes("--apply");
const prefixArg = process.argv.find((a) => a.startsWith("--prefix="));
const TARGET_PREFIX = prefixArg ? prefixArg.split("=")[1] : "DINV";

function pad(n, width) {
  return String(n).padStart(width, "0");
}

async function main() {
  await connectDB();
  const pool = getPool();

  const typeResult = await pool
    .request()
    .input("Prefix", sql.NVarChar(50), TARGET_PREFIX).query(`
      SELECT TypeOfDocId, Prefix, FullPrefix, DocNoPrefix, StartingDocNo, ISNULL(DocNoPadding, 6) AS DocNoPadding
      FROM dbo.TypeOfDoc
      WHERE Prefix = @Prefix OR DocNoPrefix = @Prefix
    `);

  if (typeResult.recordset.length === 0) {
    console.log(`No TypeOfDoc row found for prefix "${TARGET_PREFIX}" — nothing to do.`);
    await closeDB();
    return;
  }

  for (const typeRow of typeResult.recordset) {
    const { TypeOfDocId, DocNoPadding } = typeRow;
    const rawPrefix = typeRow.FullPrefix ?? typeRow.Prefix ?? "";
    const truePrefix = rawPrefix.replace(/\d+$/, "");
    const startFrom = typeRow.StartingDocNo ?? 1;
    // Direct Expense Bookings (DINV) don't get the generic "INV/" module
    // prefix stacked on top — see the matching skip in expenseBooking.js.
    const isDinv = typeRow.DocNoPrefix === "DINV";

    console.log(`\n=== TypeOfDocId ${TypeOfDocId} — prefix "${truePrefix}", starting at ${startFrom}, padding ${DocNoPadding} ===`);

    const bookingsResult = await pool
      .request()
      .input("TypeOfDocId", sql.Int, TypeOfDocId).query(`
        SELECT Eid, EDocNo, EFinYear, ECreatedAt
        FROM dbo.ExpenseBooking
        WHERE EDocTypeId = @TypeOfDocId
          AND ISNULL(EStatus, '') <> 'Deleted'
        ORDER BY ECreatedAt ASC, Eid ASC
      `);

    const rows = bookingsResult.recordset;
    if (rows.length === 0) {
      console.log("No bookings for this doc type — nothing to do.");
      continue;
    }

    // Group by financial year (empty string groups bookings with no fin year together).
    const groups = new Map();
    for (const row of rows) {
      const key = (row.EFinYear || "").trim();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    const plan = []; // { Eid, oldDocNo, reservedDocNo, finalDocNo }
    for (const [finYear, groupRows] of groups) {
      let seq = startFrom;
      for (const row of groupRows) {
        const padded = pad(seq, DocNoPadding);
        const reservedDocNo = finYear ? `${truePrefix}${padded}/${finYear}` : `${truePrefix}${padded}`;
        const finalDocNo = isDinv || reservedDocNo.startsWith("INV/") ? reservedDocNo : `INV/${reservedDocNo}`;
        plan.push({ Eid: row.Eid, oldDocNo: row.EDocNo, reservedDocNo, finalDocNo });
        seq += 1;
      }
    }

    console.log(`${plan.length} booking(s) to renumber:`);
    for (const p of plan) {
      console.log(`  Eid ${p.Eid}: "${p.oldDocNo}" -> "${p.finalDocNo}"`);
    }

    if (!APPLY) {
      console.log("(dry run — pass --apply to write these changes)");
      continue;
    }

    const transaction = pool.transaction();
    await transaction.begin();
    try {
      // Rebuild DocNumberSequence for this doc type from scratch so future
      // bookings continue the sequence correctly instead of colliding.
      await transaction
        .request()
        .input("TypeOfDocId", sql.Int, TypeOfDocId)
        .query(`DELETE FROM dbo.DocNumberSequence WHERE TypeOfDocId = @TypeOfDocId AND TableName = 'ExpenseBooking'`);

      for (const p of plan) {
        await transaction
          .request()
          .input("Eid", sql.Int, p.Eid)
          .input("EDocNo", sql.NVarChar(100), p.finalDocNo)
          .query(`UPDATE dbo.ExpenseBooking SET EDocNo = @EDocNo WHERE Eid = @Eid`);

        await transaction
          .request()
          .input("TypeOfDocId", sql.Int, TypeOfDocId)
          .input("DocNo", sql.NVarChar(100), p.reservedDocNo)
          .input("TableName", sql.NVarChar(100), "ExpenseBooking")
          .input("RecordId", sql.Int, p.Eid)
          .input("IssuedBy", sql.NVarChar(200), "backfill-script").query(`
            INSERT INTO dbo.DocNumberSequence (TypeOfDocId, DocNo, TableName, RecordId, IssuedBy)
            VALUES (@TypeOfDocId, @DocNo, @TableName, @RecordId, @IssuedBy)
          `);
      }

      await transaction.commit();
      console.log(`Applied — ${plan.length} row(s) updated for TypeOfDocId ${TypeOfDocId}.`);
    } catch (err) {
      await transaction.rollback();
      console.error(`Failed for TypeOfDocId ${TypeOfDocId}:`, err.message);
      throw err;
    }
  }

  await closeDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
