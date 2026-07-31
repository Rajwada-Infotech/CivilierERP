// One-off dev/test data wipe for Finance + Material transactional tables —
// schema stays intact, only rows are removed. Shared masters (FinYear,
// enterprise, ItemMaster, AccountHeadMaster, TypeOfDoc, DocNumberSequence,
// users, etc.) are deliberately excluded — wiping those would break every
// other module (CRM, Task Master) that references them.
//
// FK constraints are temporarily disabled so table order doesn't matter,
// then re-enabled WITH CHECK afterward.
//
// NOT wired into anything automatically — run manually:
//   node scripts/clear-finance-material-data.js
const { connectDB, getPool } = require("../db");

const TABLES = [
  // Finance
  "NewPayment", "ReceivedPayment", "ExpenseBooking", "ChequeMaster",
  "BankReconciliation", "JournalVoucherLines", "JournalVoucher",
  "GeneralLedgerEntry", "GLPostingLog", "OnAccountLedger", "EmiInstallments",
  "ApprovalAuditLog", "ApprovalWorkflows", "SaleInvoices",
  "CustomerSaleOrders", "DebitNoteItems", "DebitNote",
  "QualityRejectionDebitNote",
  // Material
  "PurchaseOrderItems", "PurchaseOrderComments", "PurchaseOrders",
  "GRNAttachments", "GoodsReceiptNotes", "MaterialRequestItems",
  "MaterialRequests", "MaterialIssueItems", "MaterialIssues",
  "MaterialIssueReturnItems", "MaterialIssueReturn", "StockLedger",
  "StockTransfers", "WorkOrderActivityMaterials", "WorkOrderActivities",
  "WorkOrderHeader", "WorkDone", "BOQ", "ActivityItems",
  "AmendmentLineChanges", "Amendments", "VehicleInOutAttachments",
  "VehicleInOutItems", "VehicleInOut", "FixedAssetRecord", "Quotations",
];

async function main() {
  await connectDB();
  const pool = getPool();
  await pool.request().query("EXEC sp_MSforeachtable @command1='ALTER TABLE ? NOCHECK CONSTRAINT ALL'");

  const results = [];
  for (const table of TABLES) {
    try {
      const r = await pool.request().query(`DELETE FROM dbo.[${table}]`);
      results.push(`${table}: ${r.rowsAffected[0]} row(s) deleted`);
    } catch (err) {
      results.push(`${table}: SKIPPED — ${err.message}`);
    }
  }

  await pool.request().query("EXEC sp_MSforeachtable @command1='ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL'");

  console.log(results.join("\n"));
  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
