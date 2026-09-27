// Read-only diagnostic for the ExpenseBooking misclassification bug fixed in
// MaterialExpenseBooking.tsx: editing a GRN/PO/Work-Done-linked invoice
// without touching its document picker could, if the wrongly-required
// Expense Head Allocation happened to be filled in and balance, silently
// save with ESourceType flipped to 'TOD' and ESourceId nulled — detaching
// the invoice from its GRN/PO/Work Done record.
//
// This never rewrites DocNo, so a real GRN-sourced invoice keeps a DocNo
// pattern like "INV/GRN-..." (or has an EExpenseHeadAllocations row despite
// looking direct) even after being detached. We flag rows whose current
// ESourceType doesn't match what their DocNo/allocations imply.
//
//   node scripts/diagnoseDetachedGrnInvoices.js
//
// Makes no writes. Prints candidates for manual review — re-linking (if any
// are found) should be a separate, deliberate fix, not part of this script.
const { connectDB, getPool, sql } = require("../db");

(async () => {
  await connectDB();
  const pool = getPool();

  // 1) DocNo looks GRN/PO/Work-Done-sourced (by naming convention) but the
  //    row's current ESourceType says otherwise (or is null).
  const byDocNo = await pool.request().query(`
    SELECT Eid, EDocNo, EName, ESourceType, ESourceId, EStatus, ECompanyId, EUpdatedAt
    FROM dbo.ExpenseBooking
    WHERE (
        EDocNo LIKE 'INV/GRN-%' OR EDocNo LIKE 'INV/PO-%' OR EDocNo LIKE 'INV/WD-%' OR EDocNo LIKE 'INV/WO-%'
      )
      AND (ESourceType IS NULL OR ESourceType = 'TOD' OR ESourceId IS NULL)
    ORDER BY EUpdatedAt DESC
  `);

  // 2) Rows that carry Expense Head Allocations (a TOD-only concept per the
  //    fixed validation) but whose DocNo still looks like a linked invoice —
  //    the other half of the same signature.
  const byAllocation = await pool.request().query(`
    SELECT eb.Eid, eb.EDocNo, eb.EName, eb.ESourceType, eb.ESourceId, eb.EStatus, eb.EUpdatedAt,
           COUNT(a.AllocationId) AS AllocationRows, SUM(a.Amount) AS AllocationTotal
    FROM dbo.ExpenseBooking eb
    JOIN dbo.ExpenseHeadAllocation a ON a.SourceType = 'ExpenseBooking' AND a.SourceId = eb.Eid
    WHERE eb.EDocNo LIKE 'INV/GRN-%' OR eb.EDocNo LIKE 'INV/PO-%' OR eb.EDocNo LIKE 'INV/WD-%' OR eb.EDocNo LIKE 'INV/WO-%'
    GROUP BY eb.Eid, eb.EDocNo, eb.EName, eb.ESourceType, eb.ESourceId, eb.EStatus, eb.EUpdatedAt
    ORDER BY eb.EUpdatedAt DESC
  `);

  console.log(`\n=== Rows whose DocNo implies a linked source but ESourceType/ESourceId disagree (${byDocNo.recordset.length}) ===`);
  if (!byDocNo.recordset.length) console.log("None found.");
  for (const r of byDocNo.recordset) {
    console.log(
      `Eid ${r.Eid}  ${r.EDocNo}  "${r.EName || ""}"  ESourceType=${r.ESourceType ?? "NULL"}  ESourceId=${r.ESourceId ?? "NULL"}  Status=${r.EStatus}  UpdatedAt=${r.EUpdatedAt?.toISOString?.() ?? r.EUpdatedAt}`,
    );
  }

  console.log(`\n=== Rows with Expense Head Allocations despite a linked-looking DocNo (${byAllocation.recordset.length}) ===`);
  if (!byAllocation.recordset.length) console.log("None found.");
  for (const r of byAllocation.recordset) {
    console.log(
      `Eid ${r.Eid}  ${r.EDocNo}  "${r.EName || ""}"  ESourceType=${r.ESourceType ?? "NULL"}  ESourceId=${r.ESourceId ?? "NULL"}  Status=${r.EStatus}  Allocations=${r.AllocationRows} totaling ₹${r.AllocationTotal}  UpdatedAt=${r.EUpdatedAt?.toISOString?.() ?? r.EUpdatedAt}`,
    );
  }

  console.log("\nNo writes made. Cross-check any Eid printed above against its GRN/PO/Work Done history before deciding whether/how to re-link it.");
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
