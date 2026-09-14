// One-off dev/test data wipe for every dbo.Crm* table — schema stays intact,
// only rows are removed. FK constraints are temporarily disabled so table
// order doesn't matter, then re-enabled WITH CHECK afterward. Run once via
// `node scripts/clear-crm-data.js`, not wired into the migration runner
// since this is data cleanup, not a schema change.
const { connectDB, getPool } = require("../db");

const TABLES = [
  "CrmAgreementApprovalLog", "CrmAgreementDateHistory", "CrmAgreementDocument",
  "CrmAgreementRevision", "CrmAgreement", "CrmApplicationStatusLog",
  "CrmApplication", "CrmAuditLog", "CrmBlockPaymentPlan",
  "CrmBookingAmendmentRequest", "CrmBookingAttachment", "CrmBookingDocument",
  "CrmBooking", "CrmBrokerPayment", "CrmBrokerageMaster", "CrmCancellation",
  "CrmCoApplicant", "CrmCommunicationLog", "CrmConstructionUpdate",
  "CrmCustomerBankDetail", "CrmCustomerPortalUser", "CrmCustomer",
  "CrmDocNumberSequence", "CrmExtraCharge", "CrmHandover", "CrmInventoryHold",
  "CrmInvoice", "CrmLegalMilestone", "CrmLoanDetail", "CrmMilestoneMaster",
  "CrmNoc", "CrmOnAccountPayment", "CrmParkingAllotment",
  "CrmPaymentMilestone", "CrmPaymentPlanProject", "CrmPaymentPlanTemplateItem",
  "CrmPaymentPlanTemplate", "CrmPaymentReceipt", "CrmPossessionNotice",
  "CrmPrePossession", "CrmProjectAutoSetupFloor",
  "CrmProjectAutoSetupParkingTemplate", "CrmProjectAutoSetupUnitTemplate",
  "CrmProjectBank", "CrmSalesDeed", "CrmServiceTicket", "CrmSlaEscalationLog",
  "CrmSnagItem", "CrmUnitChangeLog", "CrmUnitPaymentPlan", "CrmWelcomeCall",
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
