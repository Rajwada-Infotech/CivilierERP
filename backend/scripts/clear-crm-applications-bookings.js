// One-off dev/test data wipe scoped to Applications + Bookings and every
// row genuinely derived from them (agreements, milestones, receipts,
// parking/extra charges, legal/NOC/sales-deed/handover records, and the
// Finance-side GL/ledger/ReceivedPayment rows those postings created).
//
// Deliberately narrower than clear-crm-data.js (which wipes the whole CRM
// module including master/setup data) — this keeps:
//   - CrmCustomer (customer master)
//   - CrmCustomerPortalUser (customer's own portal login — its optional
//     ApplicationId reference is nulled out, the account itself survives)
//   - CrmMilestoneMaster, CrmPaymentPlanTemplate(+Item), CrmBlockPaymentPlan,
//     CrmUnitPaymentPlan, CrmPaymentPlanProject (payment-plan templates/setup)
//   - CrmProjectBank (Bank Master project tagging)
//   - CrmProjectAutoSetup* (project auto-setup templates)
//   - SaLead (Sales Automation leads — its optional CrmApplicationId/
//     CrmBookingId reference is nulled out, the lead itself survives)
//   - UnitMaster/BlockMaster/RoomMaster/ParkingMaster/ParkingSlotMaster/
//     ExtraChargeMaster (not Crm*-prefixed, untouched by this script anyway)
//
// Run once via `node scripts/clear-crm-applications-bookings.js`.
const { connectDB, getPool } = require("../db");

// Children first, parents last — cleared with FK checks temporarily
// disabled (like clear-crm-data.js) so exact order isn't load-bearing, but
// keeping it dependency-ordered makes the printed counts easy to sanity-check.
const CRM_TABLES = [
  "CrmApplicationStatusLog", "CrmCoApplicant", "CrmCommunicationLog",
  "CrmInventoryHold", "CrmParkingAllotment",
  "CrmAgreementApprovalLog", "CrmAgreementDateHistory", "CrmAgreementDocument",
  "CrmAgreementRevision", "CrmSalesDeed", "CrmAgreement",
  "CrmBookingAmendmentRequest", "CrmBookingAttachment", "CrmBookingDocument",
  "CrmBrokerPayment", "CrmBrokerageMaster", "CrmCancellation",
  "CrmCustomerBankDetail", "CrmExtraCharge", "CrmSnagItem", "CrmHandover",
  "CrmInvoice", "CrmLegalMilestone", "CrmLoanDetail", "CrmNoc",
  "CrmPaymentReceipt", "CrmOnAccountPayment", "CrmPaymentMilestone",
  "CrmPossessionNotice", "CrmPrePossession", "CrmServiceTicket",
  "CrmUnitChangeLog", "CrmWelcomeCall",
  "CrmApplication", "CrmBooking",
];

// Doc-number counters that are genuinely Application/Booking-scoped — reset
// to 0 so numbering restarts cleanly. CUST (customer numbering) is left
// alone since customers aren't being touched.
const DOC_TYPES_TO_RESET = ["APP", "BKG", "INV", "OACC", "RCP"];

async function main() {
  await connectDB();
  const pool = getPool();
  const results = [];

  await pool.request().query("EXEC sp_MSforeachtable @command1='ALTER TABLE ? NOCHECK CONSTRAINT ALL'");

  // Detach kept tables' optional references instead of deleting them.
  const saLead = await pool.request().query(
    "UPDATE dbo.SaLead SET CrmApplicationId = NULL, CrmBookingId = NULL WHERE CrmApplicationId IS NOT NULL OR CrmBookingId IS NOT NULL",
  );
  results.push(`SaLead: ${saLead.rowsAffected[0]} row(s) detached from CRM application/booking`);

  const portalUsers = await pool.request().query(
    "UPDATE dbo.CrmCustomerPortalUser SET ApplicationId = NULL WHERE ApplicationId IS NOT NULL",
  );
  results.push(`CrmCustomerPortalUser: ${portalUsers.rowsAffected[0]} row(s) detached from CRM application (login kept)`);

  // Finance-side records posted FROM the CRM data about to be deleted.
  const gl = await pool.request().query("DELETE FROM dbo.GeneralLedgerEntry WHERE SourceType LIKE 'Crm%'");
  results.push(`GeneralLedgerEntry (Crm* SourceType): ${gl.rowsAffected[0]} row(s) deleted`);

  const oal = await pool.request().query("DELETE FROM dbo.OnAccountLedger WHERE RefType LIKE 'Crm%'");
  results.push(`OnAccountLedger (Crm* RefType): ${oal.rowsAffected[0]} row(s) deleted`);

  const rp = await pool.request().query("DELETE FROM dbo.ReceivedPayment WHERE CrmBookingId IS NOT NULL");
  results.push(`ReceivedPayment (CrmBookingId set): ${rp.rowsAffected[0]} row(s) deleted`);

  const ahm = await pool.request().query("DELETE FROM dbo.AccountHeadMaster WHERE LHeadCode LIKE 'CRMCUST-%'");
  results.push(`AccountHeadMaster (CRMCUST-* ledger heads): ${ahm.rowsAffected[0]} row(s) deleted`);

  // Every Application/Booking table and everything hanging off them.
  for (const table of CRM_TABLES) {
    try {
      const r = await pool.request().query(`DELETE FROM dbo.[${table}]`);
      results.push(`${table}: ${r.rowsAffected[0]} row(s) deleted`);
    } catch (err) {
      results.push(`${table}: SKIPPED — ${err.message}`);
    }
  }

  const audit = await pool.request().query("DELETE FROM dbo.CrmAuditLog WHERE EntityType IN ('Application', 'Booking')");
  results.push(`CrmAuditLog (Application/Booking entries): ${audit.rowsAffected[0]} row(s) deleted`);

  const sla = await pool.request().query("DELETE FROM dbo.CrmSlaEscalationLog");
  results.push(`CrmSlaEscalationLog: ${sla.rowsAffected[0]} row(s) deleted`);

  for (const docType of DOC_TYPES_TO_RESET) {
    const r = await pool.request().input("dt", docType).query(
      "UPDATE dbo.CrmDocNumberSequence SET LastNumber = 0 WHERE DocType = @dt",
    );
    if (r.rowsAffected[0]) results.push(`CrmDocNumberSequence[${docType}]: reset to 0`);
  }

  await pool.request().query("EXEC sp_MSforeachtable @command1='ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL'");

  console.log(results.join("\n"));
  console.log("\nDone. Customers, units, and every master/setup table are untouched.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
