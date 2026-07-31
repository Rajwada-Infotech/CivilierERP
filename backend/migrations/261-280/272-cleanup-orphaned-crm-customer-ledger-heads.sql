-- ============================================================
-- Cleanup: orphaned CRM customer ledger heads
--
-- Prior E2E/manual test runs created CrmCustomer rows, posted real
-- on-account deposits/receipts through crmLedger.js (which auto-creates a
-- dbo.AccountHeadMaster ledger head per customer, LHeadCode = 'CRMCUST-
-- <CrmCustomer.Id>', and posts balanced GL vouchers + dbo.OnAccountLedger
-- rows against it), and then had their CrmCustomer/CrmApplication/
-- CrmBooking/CrmOnAccountPayment/CrmPaymentReceipt rows deleted during
-- test cleanup. The financial-ledger side of those postings was never
-- cleaned up alongside, leaving phantom balances that surfaced on
-- Finance's On A/C Adjustment screen once it was made CRM-aware (see
-- onAccount.js GET /adjustable) — reported directly by the user after
-- reviewing that screen's real data.
--
-- Verified before writing this (see conversation): for every LHeadId
-- deleted below —
--   * the CrmCustomer.Id encoded in its LHeadCode no longer exists
--   * the GeneralLedgerEntry (SourceType, SourceId) pairs referencing it
--     also have no surviving source row (CrmOnAccountPayment/
--     CrmPaymentReceipt/CrmParkingAllotment all confirmed deleted)
--   * no other FK (NewPayment.PPartyId, ExpenseBooking.LHeadId,
--     CrmApplication.BrokerId/DepositBankId, CrmBooking.BrokerId,
--     CrmCancellation.RefundBankId, etc.) points at it
-- so deleting the full voucher (both GL legs) + the ledger rows + the
-- ledger head itself leaves no dangling reference and no unbalanced GL
-- entry behind.
-- ============================================================

IF OBJECT_ID('tempdb..#OrphanCrmHeads') IS NOT NULL DROP TABLE #OrphanCrmHeads;

SELECT ahm.LHeadId
INTO #OrphanCrmHeads
FROM dbo.AccountHeadMaster ahm
WHERE ahm.LHeadCode LIKE 'CRMCUST-%'
  AND NOT EXISTS (
    SELECT 1 FROM dbo.CrmCustomer c
    WHERE c.Id = TRY_CAST(SUBSTRING(ahm.LHeadCode, 9, 20) AS INT)
  );

DECLARE @OrphanHeadCount INT = (SELECT COUNT(*) FROM #OrphanCrmHeads);
PRINT CONCAT('Orphaned CRM customer ledger heads found: ', @OrphanHeadCount);

-- Delete the full voucher (both legs) for every GL posting that touches an
-- orphaned head, identified by (SourceType, SourceId) rather than just this
-- head's own leg, so the balancing entry at the CRM Collections account
-- doesn't survive as an unbalanced half-voucher.
IF OBJECT_ID('tempdb..#OrphanVouchers') IS NOT NULL DROP TABLE #OrphanVouchers;
SELECT DISTINCT gle.SourceType, gle.SourceId
INTO #OrphanVouchers
FROM dbo.GeneralLedgerEntry gle
JOIN #OrphanCrmHeads oh ON oh.LHeadId = gle.LHeadId;

DELETE gle
FROM dbo.GeneralLedgerEntry gle
JOIN #OrphanVouchers ov ON ov.SourceType = gle.SourceType AND ov.SourceId = gle.SourceId;
PRINT CONCAT('GeneralLedgerEntry rows deleted: ', @@ROWCOUNT);

DELETE oal
FROM dbo.OnAccountLedger oal
JOIN #OrphanCrmHeads oh ON oh.LHeadId = oal.PartyId;
PRINT CONCAT('OnAccountLedger rows deleted: ', @@ROWCOUNT);

DELETE ahm
FROM dbo.AccountHeadMaster ahm
JOIN #OrphanCrmHeads oh ON oh.LHeadId = ahm.LHeadId;
PRINT CONCAT('AccountHeadMaster (orphaned CRM customer heads) deleted: ', @@ROWCOUNT);

DROP TABLE #OrphanVouchers;
DROP TABLE #OrphanCrmHeads;
GO
