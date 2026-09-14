-- Seeds the two GL accounts a depreciation journal entry needs:
--   Dr Depreciation Expense A/c   XX
--        To Accumulated Depreciation A/c   XX
--
-- Depreciation Expense A/c -> DEPRECIATION AND AMORTIZATION EXPENSE (an
-- Income Statement / P&L account, already the group this app's own P&L
-- classifier buckets depreciation-type expenses into).
-- Accumulated Depreciation A/c -> FIXED ASSETS (a Balance Sheet contra-asset
-- account that reduces fixed assets' net book value) — no dedicated
-- contra-asset group exists in this chart of accounts (confirmed live), so
-- it's grouped alongside "Fixed Assets A/c" itself under FIXED ASSETS,
-- matching migration 385/390's precedent for that head.
--
-- Looked up by Name (not a hardcoded AGId) — the lesson from migrations
-- 387-391 this session: group ids are not stable across environments.
--
-- Note: this only seeds the two ledger heads. No automated posting exists
-- yet (dbo.DepreciationSetup only stores per-category rates today; nothing
-- calls postVoucher() for depreciation) — that's a separate feature.

DECLARE @DepreciationExpenseGroupId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Name = 'DEPRECIATION AND AMORTIZATION EXPENSE');
DECLARE @FixedAssetsGroupId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Name = 'FIXED ASSETS');

IF @DepreciationExpenseGroupId IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadName = 'Depreciation Expense A/c' AND LHeadType = 'GL')
  BEGIN
    INSERT INTO dbo.AccountHeadMaster
      (LHeadName, LHeadCode, LHeadType, LHeadStatus,
       LHeadAddress, LHeadContactPerson, LHeadPaymentTerms,
       LBranchName, LCountry, LBelongsTo, IsSystemGenerated)
    VALUES
      ('Depreciation Expense A/c', 'DEPEXP', 'GL', 1,
       'N/A', 'N/A', 'N/A',
       'Main', 'India', @DepreciationExpenseGroupId, 1);
    PRINT 'Seeded: Depreciation Expense A/c';
  END
  ELSE
  BEGIN
    UPDATE dbo.AccountHeadMaster
      SET IsSystemGenerated = 1, LBelongsTo = ISNULL(LBelongsTo, @DepreciationExpenseGroupId)
    WHERE LHeadName = 'Depreciation Expense A/c' AND LHeadType = 'GL';
    PRINT 'Already exists: Depreciation Expense A/c';
  END
END
ELSE
  PRINT 'WARNING: No "DEPRECIATION AND AMORTIZATION EXPENSE" group found — Depreciation Expense A/c not seeded.';
GO

DECLARE @FixedAssetsGroupId2 INT = (SELECT AGId FROM dbo.AccountGroup WHERE Name = 'FIXED ASSETS');

IF @FixedAssetsGroupId2 IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadName = 'Accumulated Depreciation A/c' AND LHeadType = 'GL')
  BEGIN
    INSERT INTO dbo.AccountHeadMaster
      (LHeadName, LHeadCode, LHeadType, LHeadStatus,
       LHeadAddress, LHeadContactPerson, LHeadPaymentTerms,
       LBranchName, LCountry, LBelongsTo, IsSystemGenerated)
    VALUES
      ('Accumulated Depreciation A/c', 'ACCDEP', 'GL', 1,
       'N/A', 'N/A', 'N/A',
       'Main', 'India', @FixedAssetsGroupId2, 1);
    PRINT 'Seeded: Accumulated Depreciation A/c';
  END
  ELSE
  BEGIN
    UPDATE dbo.AccountHeadMaster
      SET IsSystemGenerated = 1, LBelongsTo = ISNULL(LBelongsTo, @FixedAssetsGroupId2)
    WHERE LHeadName = 'Accumulated Depreciation A/c' AND LHeadType = 'GL';
    PRINT 'Already exists: Accumulated Depreciation A/c';
  END
END
ELSE
  PRINT 'WARNING: No "FIXED ASSETS" group found — Accumulated Depreciation A/c not seeded.';
GO
