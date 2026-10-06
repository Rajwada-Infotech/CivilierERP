// READ-ONLY. Sizes, on live data, each risk found in the CRM & DPR audit, so
// fixes can be prioritised by real exposure. Writes nothing.
//
//   node scripts/auditProdSnapshot.js
const { connectDB, getPool, closeDB } = require("../db");

const DEAD = "(N'Cancelled', N'Rejected', N'Expired', N'Transferred')";

async function main() {
  await connectDB();
  const pool = getPool();
  const one = async (label, text) => {
    try {
      const rows = (await pool.request().query(text)).recordset;
      console.log(`\n${label}`);
      if (!rows.length) console.log("   (none)");
      rows.slice(0, 15).forEach((r) => console.log("   " + JSON.stringify(r)));
      if (rows.length > 15) console.log(`   … ${rows.length - 15} more`);
    } catch (e) { console.log(`\n${label}\n   SKIPPED: ${e.message}`); }
  };

  console.log("CRM & DPR audit — production snapshot (read-only)");

  await one("A1  Converted plots with no land owner (villa can never be sold)", `
    SELECT p.ProjectId, p.PlotName, u.UnitName AS Villa
    FROM dbo.PlotMaster p JOIN dbo.UnitMaster u ON u.Id = p.ConvertedUnitId AND u.IsActive = 1
    WHERE p.IsActive = 1 AND NOT EXISTS (
      SELECT 1 FROM dbo.CrmBookingPlot bp JOIN dbo.CrmBooking b ON b.Id = bp.BookingId
      WHERE bp.PlotId = p.Id AND bp.Status = N'Active' AND b.IsActive = 1 AND b.Status NOT IN ${DEAD})`);

  await one("A3  Bookings hard-deleted so far (gaps in booking ids with live children elsewhere)", `
    SELECT COUNT(*) AS OrphanApplicationsWithoutBooking FROM dbo.CrmApplication a
    WHERE a.IsActive = 1 AND a.Status = N'Converted'
      AND NOT EXISTS (SELECT 1 FROM dbo.CrmBooking b WHERE b.ApplicationId = a.Id)`);

  await one("A4  Advance from Customer balance (must be >= 0)", `
    SELECT h.LHeadName, SUM(ISNULL(g.CreditAmount,0)) - SUM(ISNULL(g.DebitAmount,0)) AS CreditBalance
    FROM dbo.GeneralLedgerEntry g JOIN dbo.AccountHeadMaster h ON h.LHeadId = g.LHeadId
    WHERE h.LHeadName = N'Advance from Customer' AND ISNULL(g.IsReversed, 0) = 0
    GROUP BY h.LHeadName`);

  await one("A5  Dues still listed on resold / expired bookings", `
    SELECT b.Status, COUNT(DISTINCT b.Id) AS Bookings, SUM(m.AmountDue - ISNULL(m.AmountPaid,0)) AS Outstanding
    FROM dbo.CrmBooking b JOIN dbo.CrmPaymentMilestone m ON m.BookingId = b.Id
    WHERE b.IsActive = 1 AND b.Status IN (N'Expired', N'Transferred') AND m.Status <> N'Waived'
      AND (m.AmountDue - ISNULL(m.AmountPaid,0)) > 0
    GROUP BY b.Status`);

  await one("B1  Commercial units vs commercial GST rules", `
    SELECT (SELECT COUNT(*) FROM dbo.UnitMaster u JOIN dbo.CrmConstructedAssetKind k ON k.Code = u.UnitKind
              WHERE u.IsActive = 1 AND k.IsCommercial = 1) AS CommercialUnits,
           (SELECT COUNT(*) FROM dbo.CrmGstRule WHERE IsActive = 1 AND ForCommercial = 1) AS CommercialGstRules,
           (SELECT COUNT(*) FROM dbo.CrmBooking b JOIN dbo.UnitMaster u ON u.Id = b.UnitId JOIN dbo.CrmConstructedAssetKind k ON k.Code = u.UnitKind
              WHERE b.IsActive = 1 AND k.IsCommercial = 1 AND b.Status NOT IN ${DEAD}) AS LiveCommercialBookings`);

  await one("B2  Bookings that would auto-expire mid-approval or with money received (next 7 days or overdue)", `
    SELECT b.BookingNo, b.WorkflowStage, b.ConfirmDeadline,
           (SELECT ISNULL(SUM(AmountPaid),0) FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id) AS Paid
    FROM dbo.CrmBooking b
    WHERE b.IsActive = 1 AND b.Status NOT IN (N'Approved', N'Cancelled', N'Rejected', N'Expired', N'Transferred')
      AND b.ConfirmDeadline IS NOT NULL AND b.ConfirmDeadline < DATEADD(DAY, 7, SYSDATETIME())
      AND (b.WorkflowStage IN (N'MarketingHeadApproval', N'DirectorApproval', N'Confirmed')
           OR EXISTS (SELECT 1 FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = b.Id AND ISNULL(m.AmountPaid,0) > 0))`);

  await one("B2  Bookings already auto-expired that had money received", `
    SELECT COUNT(DISTINCT b.Id) AS ExpiredWithMoney, SUM(ISNULL(m.AmountPaid,0)) AS MoneyOnThem
    FROM dbo.CrmBooking b JOIN dbo.CrmPaymentMilestone m ON m.BookingId = b.Id AND ISNULL(m.AmountPaid,0) > 0
    WHERE b.IsActive = 1 AND b.Status = N'Expired'`);

  await one("B3  Users / roles with project restrictions (CRM ignores them today)", `
    SELECT (SELECT COUNT(DISTINCT UserId) FROM dbo.UserProjectAccess) AS RestrictedUsers,
           (SELECT COUNT(*) FROM dbo.RoleProjectAccess) AS RoleRestrictionRows`);

  await one("B4  Approvals where the approver also raised the record (refunds / cancellations)", `
    SELECT 'Cancellation' AS Kind, COUNT(*) AS N FROM dbo.CrmCancellation c
    WHERE c.Status = N'Approved' AND c.ApprovedBy IS NOT NULL AND CAST(c.ApprovedBy AS NVARCHAR(200)) = CAST(c.RequestedBy AS NVARCHAR(200))`);

  await one("B5  Standalone parking payments sitting as customer credit", `
    SELECT COUNT(*) AS Allotments, SUM(TotalAmount) AS Amount
    FROM dbo.CrmParkingAllotment WHERE BookingId IS NULL AND IsActive = 1 AND ISNULL(TotalAmount,0) > 0`);

  await one("B6  Retired DPR chains with live steps", `
    SELECT COUNT(DISTINCT d.Id) AS Chains, COUNT(*) AS LiveSteps
    FROM dbo.DependencyMaster d JOIN dbo.DependencyMasterActivity x ON x.DependencyMasterId = d.Id
    JOIN dbo.DependencyActivityAssignment a ON a.DependencyMasterActivityId = x.Id
    WHERE d.IsActive = 0 AND a.Status IN (N'PENDING', N'IN_PROGRESS', N'ALLOCATED')`);

  await one("C1  Sale value double-counted in Booking Register (resold units)", `
    SELECT COUNT(*) AS TransferredBookings, SUM(TotalValue) AS ValueCountedTwice
    FROM dbo.CrmBooking WHERE IsActive = 1 AND Status = N'Transferred'`);

  console.log("\nDone — nothing was changed.");
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("auditProdSnapshot failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
