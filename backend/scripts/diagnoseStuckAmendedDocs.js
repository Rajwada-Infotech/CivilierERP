/**
 * Read-only: finds documents affected by the pre-fix amendment bug — an
 * edit to an already-Approved document that should have sent it back for
 * re-approval but didn't (see the "Force re-approval when editing any
 * already-Approved document" commit). Two shapes:
 *
 *   1. GRN specifically: the frontend hardcoded status:"Draft" on every
 *      save, so an edited-Approved GRN got silently SET TO DRAFT instead of
 *      Pending — invisible to Approval Inbox and to the Expense Booking
 *      invoice picker. Detected as: currently Status='Draft' but has at
 *      least one row in dbo.Amendments (only an edit to an Approved record
 *      ever writes an Amendment row — a genuinely new, never-approved Draft
 *      has none).
 *
 *   2. Every other doc type: the Status column was either left untouched or
 *      client-controlled on edit, so an edited-Approved record just STAYED
 *      Approved, with the new (unreviewed) numbers standing as if nothing
 *      happened. Detected as: currently Status='Approved' (or the module's
 *      equivalent status column/value) with at least one Amendments row —
 *      under the old code there was no path back to Pending, so any such
 *      row means the edit was never actually re-reviewed.
 *
 * Prints counts and the affected doc numbers per type. Makes no writes.
 *
 * Usage: node backend/scripts/diagnoseStuckAmendedDocs.js
 */
require("../config/env").loadEnv();
const { connectDB, getPool, sql } = require("../db");

// RefDocType (dbo.Amendments) -> table/column shape, mirroring each route's
// own snapshotRow() call.
const DOC_TYPES = [
  { refDocType: "grn", table: "dbo.GoodsReceiptNotes", pk: "GRNID", statusCol: "Status", docNoCol: "DocNo", checkStatus: "Draft" },
  { refDocType: "purchase-order", table: "dbo.PurchaseOrders", pk: "PurchaseOrderID", statusCol: "Status", docNoCol: "DocNo", checkStatus: "Approved" },
  { refDocType: "payment", table: "dbo.NewPayment", pk: "PPaymentID", statusCol: "Status", docNoCol: "DocNo", checkStatus: "Approved" },
  { refDocType: "received-payment", table: "dbo.ReceivedPayment", pk: "RPPaymentID", statusCol: "RPStatus", docNoCol: "RPDocNo", checkStatus: "Approved" },
  { refDocType: "work-order", table: "dbo.WorkOrderHeader", pk: "Id", statusCol: "Status", docNoCol: "DocumentNumber", checkStatus: "Approved" },
  { refDocType: "boq", table: "dbo.BOQ", pk: "BoqID", statusCol: "Status", docNoCol: "DocNo", checkStatus: "Approved" },
  { refDocType: "material-issue", table: "dbo.MaterialIssues", pk: "IssueId", statusCol: "Status", docNoCol: "DocNo", checkStatus: "Approved" },
  { refDocType: "material-issue-return", table: "dbo.MaterialIssueReturn", pk: "ReturnId", statusCol: "Status", docNoCol: "DocNo", checkStatus: "Approved" },
  { refDocType: "material-request", table: "dbo.MaterialRequests", pk: "MRId", statusCol: "Status", docNoCol: "DocNo", checkStatus: "Approved" },
  { refDocType: "vehicle-in-out", table: "dbo.VehicleInOut", pk: "VehicleInOutID", statusCol: "Status", docNoCol: "ChallanNo", checkStatus: "Approved" },
  { refDocType: "expense-booking", table: "dbo.ExpenseBooking", pk: "Eid", statusCol: "EStatus", docNoCol: "EDocNo", checkStatus: "Approved" },
  { refDocType: "work-done", table: "dbo.WorkDone", pk: "ID", statusCol: "Status", docNoCol: "DocNo", checkStatus: "Approved" },
];

(async () => {
  await connectDB();
  const pool = getPool();

  let totalAffected = 0;
  for (const dt of DOC_TYPES) {
    const result = await pool.request()
      .input("RefDocType", sql.NVarChar(100), dt.refDocType)
      .input("CheckStatus", sql.NVarChar(50), dt.checkStatus)
      .query(`
        SELECT d.${dt.pk} AS Id, d.${dt.docNoCol} AS DocNo, d.${dt.statusCol} AS CurrentStatus,
               MAX(a.CreatedAt) AS LastAmendedAt, COUNT(a.Id) AS AmendmentCount
        FROM ${dt.table} d
        JOIN dbo.Amendments a ON a.RefDocType = @RefDocType AND a.RefDocId = d.${dt.pk}
        WHERE d.${dt.statusCol} = @CheckStatus
        GROUP BY d.${dt.pk}, d.${dt.docNoCol}, d.${dt.statusCol}
        ORDER BY MAX(a.CreatedAt) DESC
      `);

    if (result.recordset.length) {
      totalAffected += result.recordset.length;
      console.log(`\n${dt.refDocType} — ${result.recordset.length} affected (currently "${dt.checkStatus}" with amendment history):`);
      console.table(result.recordset.map(r => ({
        Id: r.Id, DocNo: r.DocNo, LastAmendedAt: r.LastAmendedAt?.toISOString?.().slice(0, 16),
        Amendments: r.AmendmentCount,
      })));
    } else {
      console.log(`${dt.refDocType} — none affected.`);
    }
  }

  console.log(`\nTotal affected across all doc types: ${totalAffected}`);
  console.log(`\n(Read-only — nothing was changed. See reclassifyCrmOnAccountBank.js for the paired\nfix-script pattern once a remediation approach is decided.)`);
  process.exit(0);
})().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
