// One-off remediation for documents caught by the pre-fix amendment bug
// (see the "Force re-approval when editing any already-Approved document"
// commit) — an edit to an already-Approved document that should have sent
// it back for re-approval but didn't, under the OLD code. Two shapes,
// mirrored from diagnoseStuckAmendedDocs.js:
//
//   1. GRN: silently downgraded to Draft instead of Pending. Fixed by
//      setting it to Pending (what should have happened) and, if it had
//      already posted to GL/stock under an earlier approval before the
//      edit, reversing that so re-approval reposts fresh.
//   2. Everything else: silently stayed Approved with the edited (never
//      re-reviewed) numbers standing. Fixed the same way: force Pending,
//      reverse whatever GL posting exists.
//
// Does NOT attempt to reset the approval LEVEL-tracking cycle (no fresh
// Level=0 ApprovalAuditLog marker is written) — same limitation the
// already-shipped Journal Voucher pattern has. For a single-level approval
// workflow this doesn't matter; for a multi-level workflow, a level
// satisfied by the OLD approval could still count. Flagged, not fixed here.
//
// Dry-run by default — prints what it WOULD do without touching the
// database. Pass --apply to actually write.
//
// Usage:
//   node backend/scripts/fixStuckAmendedDocs.js
//   node backend/scripts/fixStuckAmendedDocs.js --apply
//   node backend/scripts/fixStuckAmendedDocs.js --apply --type=grn
//   node backend/scripts/fixStuckAmendedDocs.js --apply --type=grn,purchase-order

require("../config/env").loadEnv();
const { connectDB, getPool, sql, closeDB } = require("../db");
const { reversePostingBySource } = require("../services/generalLedger");
const { bumpCacheVersion } = require("../redis");

const APPLY = process.argv.includes("--apply");
const ACTOR = "fix-stuck-amended-docs-script";
// Optional --type=grn,purchase-order,... to scope the run to specific
// refDocTypes — e.g. fix GRN now, leave CRM-linked received-payment rows
// for a separate, more careful pass later.
const typeArg = process.argv.find((a) => a.startsWith("--type="));
const TYPE_FILTER = typeArg ? new Set(typeArg.slice("--type=".length).split(",")) : null;

// refDocType (dbo.Amendments) -> table/column shape + which GL SourceTypes
// (if any) to reverse — mirrors each route's own wasApproved fix.
const DOC_TYPES = [
  { refDocType: "grn", table: "dbo.GoodsReceiptNotes", pk: "GRNID", statusCol: "Status", docNoCol: "DocNo", checkStatus: "Draft", glSourceTypes: ["GRN", "GRNPosting"] },
  { refDocType: "purchase-order", table: "dbo.PurchaseOrders", pk: "PurchaseOrderID", statusCol: "Status", docNoCol: "DocNo", checkStatus: "Approved", glSourceTypes: [] },
  { refDocType: "payment", table: "dbo.NewPayment", pk: "PPaymentID", statusCol: "Status", docNoCol: "DocNo", checkStatus: "Approved", glSourceTypes: ["NewPayment", "PaymentPosting"] },
  { refDocType: "received-payment", table: "dbo.ReceivedPayment", pk: "RPPaymentID", statusCol: "RPStatus", docNoCol: "RPDocNo", checkStatus: "Approved", glSourceTypes: ["ReceivedPayment"] },
  { refDocType: "work-order", table: "dbo.WorkOrderHeader", pk: "Id", statusCol: "Status", docNoCol: "DocumentNumber", checkStatus: "Approved", glSourceTypes: [] },
  { refDocType: "boq", table: "dbo.BOQ", pk: "BoqID", statusCol: "Status", docNoCol: "DocNo", checkStatus: "Approved", glSourceTypes: [] },
  { refDocType: "material-issue", table: "dbo.MaterialIssues", pk: "IssueId", statusCol: "Status", docNoCol: "DocNo", checkStatus: "Approved", glSourceTypes: [] },
  { refDocType: "material-issue-return", table: "dbo.MaterialIssueReturn", pk: "ReturnId", statusCol: "Status", docNoCol: "DocNo", checkStatus: "Approved", glSourceTypes: [], stockReturn: true },
  { refDocType: "material-request", table: "dbo.MaterialRequests", pk: "MRId", statusCol: "Status", docNoCol: "DocNo", checkStatus: "Approved", glSourceTypes: [] },
  { refDocType: "vehicle-in-out", table: "dbo.VehicleInOut", pk: "VehicleInOutID", statusCol: "Status", docNoCol: "ChallanNo", checkStatus: "Approved", glSourceTypes: [] },
  { refDocType: "expense-booking", table: "dbo.ExpenseBooking", pk: "Eid", statusCol: "EStatus", docNoCol: "EDocNo", checkStatus: "Approved", glSourceTypes: ["ExpenseBooking", "InvoicePosting"] },
  { refDocType: "work-done", table: "dbo.WorkDone", pk: "ID", statusCol: "Status", docNoCol: "DocNo", checkStatus: "Approved", glSourceTypes: [] },
];

async function findCandidates(pool, dt) {
  const result = await pool.request()
    .input("RefDocType", sql.NVarChar(100), dt.refDocType)
    .input("CheckStatus", sql.NVarChar(50), dt.checkStatus)
    .query(`
      SELECT d.${dt.pk} AS Id, d.${dt.docNoCol} AS DocNo
      FROM ${dt.table} d
      JOIN dbo.Amendments a ON a.RefDocType = @RefDocType AND a.RefDocId = d.${dt.pk}
      WHERE d.${dt.statusCol} = @CheckStatus
      GROUP BY d.${dt.pk}, d.${dt.docNoCol}
    `);
  return result.recordset;
}

async function fixOne(pool, dt, id) {
  if (dt.glSourceTypes?.length) {
    for (const st of dt.glSourceTypes) {
      await reversePostingBySource(pool, st, id);
    }
  }
  if (dt.stockReturn) {
    // material-issue-return: un-post its stock IN credit and reset the
    // PostedToStock flag, same as the route's own edit fix.
    await pool.request().input("id", sql.Int, id)
      .query("DELETE FROM dbo.StockLedger WHERE RefType='IRN' AND RefID=@id");
    await pool.request().input("id", sql.Int, id)
      .query("UPDATE dbo.MaterialIssueReturn SET PostedToStock = 0 WHERE ReturnId=@id");
  }
  await pool.request().input("id", sql.Int, id)
    .query(`UPDATE ${dt.table} SET ${dt.statusCol} = 'Pending' WHERE ${dt.pk} = @id`);
}

async function main() {
  await connectDB();
  const pool = getPool();

  const plan = [];
  for (const dt of DOC_TYPES) {
    if (TYPE_FILTER && !TYPE_FILTER.has(dt.refDocType)) continue;
    const rows = await findCandidates(pool, dt);
    for (const row of rows) plan.push({ dt, ...row });
  }

  if (plan.length === 0) {
    console.log("No stuck amended documents found. Nothing to do.");
    await closeDB();
    return;
  }

  console.log(`Found ${plan.length} document(s) to fix:\n`);
  for (const p of plan) {
    console.log(`  [${p.dt.refDocType}] ${p.DocNo || `#${p.Id}`} (Id ${p.Id}) — currently ${p.dt.checkStatus} -> Pending${p.dt.glSourceTypes?.length ? ", GL reversed" : ""}${p.dt.stockReturn ? ", stock credit un-posted" : ""}`);
  }

  if (!APPLY) {
    console.log("\n(dry run — pass --apply to force these back to Pending and reverse any GL posting)");
    await closeDB();
    return;
  }

  console.log("");
  const summary = { done: 0, errored: 0 };
  const touchedCaches = new Set();
  for (const p of plan) {
    try {
      await fixOne(pool, p.dt, p.Id);
      console.log(`  fixed: [${p.dt.refDocType}] ${p.DocNo || `#${p.Id}`} (Id ${p.Id})`);
      summary.done++;
      touchedCaches.add(p.dt.refDocType);
    } catch (err) {
      console.error(`  ERROR: [${p.dt.refDocType}] ${p.DocNo || `#${p.Id}`} (Id ${p.Id}) — ${err.message}`);
      summary.errored++;
    }
  }

  await bumpCacheVersion("trial-balance");
  await bumpCacheVersion("general-ledger");
  await bumpCacheVersion("grns");
  await bumpCacheVersion("purchase-orders");
  await bumpCacheVersion("new-payment");
  await bumpCacheVersion("received-payment");
  await bumpCacheVersion("work-orders");
  await bumpCacheVersion("boq");
  await bumpCacheVersion("material-issues");
  await bumpCacheVersion("material-requests");
  await bumpCacheVersion("expense-booking-options");
  await bumpCacheVersion("stock-ledger");

  console.log(`\nDone. Fixed ${summary.done}, errored ${summary.errored}. Actor: ${ACTOR}`);
  await closeDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
