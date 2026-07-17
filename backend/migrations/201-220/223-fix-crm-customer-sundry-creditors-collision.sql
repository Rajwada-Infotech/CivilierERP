-- Fixes a collision introduced by migration 222: LHeadType='C' means
-- "Contractor" in the manual Supplier/Contractor/Customer masters, but two
-- other code paths reuse 'C' to mean "Customer":
--   - crmLedger.js's ensureCrmCustomerLedgerHead() — LHeadCode 'CRMCUST-<id>'
--   - projectMaster.js's ensureProjectLedgerHeads() — LHeadCode 'PRJ-<id>-CUST'
--     (the project-as-customer side of its auto-created trading pair; the
--     matching 'PRJ-<id>-SUPP' head is LHeadType='S' and correctly belongs
--     in Sundry Creditors, same as any other Supplier)
-- Migration 222's `WHERE LHeadType IN ('S','C')` backfill swept both kinds
-- of Customer head into SUNDRY CREDITORS along with real Contractors — they
-- belong in SUNDRY DEBTORS. accountHeadMaster.js's auto-assignment logic
-- now excludes any LHeadCode containing 'CUST' from the Creditors block
-- going forward; this corrects the ones 222 already moved.
DECLARE @SundryDebtorsId INT = (SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'SDS');

IF @SundryDebtorsId IS NOT NULL
BEGIN
  UPDATE dbo.AccountHeadMaster
  SET LBelongsTo = @SundryDebtorsId
  WHERE LHeadType = 'C'
    AND LHeadCode LIKE '%CUST%'
    AND LBelongsTo <> @SundryDebtorsId;

  PRINT 'Restored ' + CAST(@@ROWCOUNT AS NVARCHAR(10)) + ' Customer-type head(s) (mislabelled LHeadType=''C'') to SUNDRY DEBTORS.';
END
ELSE
BEGIN
  PRINT 'SUNDRY DEBTORS account group (Code=SDS) not found — skipped.';
END
