-- Migration 399: (re-)create the depreciation GL heads under the groups the
-- business wants, as system-generated General Ledger accounts.
--
--   Depreciation Expense A/c      -> EXPENSES > INDIRECT EXPENSES  (P&L)
--   Accumulated Depreciation A/c  -> ASSETS   > FIXED ASSETS       (contra-asset)
--
-- dev migration 393-seed-depreciation-gl-heads.sql originally placed
-- "Depreciation Expense A/c" under DEPRECIATION AND AMORTIZATION EXPENSE;
-- a later hand-run revert dropped both heads. This recreates them in the
-- requested groups (resolved by name, never a hard-coded AGId — the lesson
-- from migrations 387-391), idempotently: INSERT if missing, otherwise
-- re-point / reactivate the existing row.
--
-- services/fixedAssetDepreciationPosting.js resolves these heads by name, so
-- FA depreciation posting works again as soon as this runs.

DECLARE @IndirectExpenses INT = (
  SELECT TOP 1 AGId FROM dbo.AccountGroup
  WHERE Name = 'INDIRECT EXPENSES' OR Code = 'IE' ORDER BY CASE WHEN Name = 'INDIRECT EXPENSES' THEN 0 ELSE 1 END
);
DECLARE @FixedAssets INT = (
  SELECT TOP 1 AGId FROM dbo.AccountGroup
  WHERE Name = 'FIXED ASSETS' OR Code = 'FA' ORDER BY CASE WHEN Name = 'FIXED ASSETS' THEN 0 ELSE 1 END
);

IF @IndirectExpenses IS NULL OR @FixedAssets IS NULL
BEGIN
  RAISERROR('399: INDIRECT EXPENSES or FIXED ASSETS account group not found -- aborting.', 16, 1);
  RETURN;
END

-- ── Depreciation Expense A/c -> INDIRECT EXPENSES ───────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadName = 'Depreciation Expense A/c' AND LHeadType = 'GL')
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus, Status, LBelongsTo,
     LHeadAddress, LHeadContactPerson, LHeadPaymentTerms, LBranchName, LCountry,
     IsSystemGenerated, CreatedBy, CreatedAt)
  VALUES
    ('Depreciation Expense A/c', 'DEPEXP', 'GL', 1, 'Approved', @IndirectExpenses,
     'N/A', 'N/A', 'N/A', 'Main', 'India',
     1, 'migration', SYSDATETIME());
  PRINT 'Seeded GL head: Depreciation Expense A/c (INDIRECT EXPENSES)';
END
ELSE
BEGIN
  UPDATE dbo.AccountHeadMaster
    SET LHeadType = 'GL', LHeadStatus = 1, IsSystemGenerated = 1, LBelongsTo = @IndirectExpenses
  WHERE LHeadName = 'Depreciation Expense A/c';
  PRINT 'Re-pointed GL head: Depreciation Expense A/c -> INDIRECT EXPENSES';
END
GO

DECLARE @FixedAssets2 INT = (
  SELECT TOP 1 AGId FROM dbo.AccountGroup
  WHERE Name = 'FIXED ASSETS' OR Code = 'FA' ORDER BY CASE WHEN Name = 'FIXED ASSETS' THEN 0 ELSE 1 END
);

-- ── Accumulated Depreciation A/c -> FIXED ASSETS (contra-asset) ─────────────
IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadName = 'Accumulated Depreciation A/c' AND LHeadType = 'GL')
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus, Status, LBelongsTo,
     LHeadAddress, LHeadContactPerson, LHeadPaymentTerms, LBranchName, LCountry,
     IsSystemGenerated, CreatedBy, CreatedAt)
  VALUES
    ('Accumulated Depreciation A/c', 'ACCDEP', 'GL', 1, 'Approved', @FixedAssets2,
     'N/A', 'N/A', 'N/A', 'Main', 'India',
     1, 'migration', SYSDATETIME());
  PRINT 'Seeded GL head: Accumulated Depreciation A/c (FIXED ASSETS)';
END
ELSE
BEGIN
  UPDATE dbo.AccountHeadMaster
    SET LHeadType = 'GL', LHeadStatus = 1, IsSystemGenerated = 1, LBelongsTo = @FixedAssets2
  WHERE LHeadName = 'Accumulated Depreciation A/c';
  PRINT 'Re-pointed GL head: Accumulated Depreciation A/c -> FIXED ASSETS';
END
GO

PRINT '399-seed-depreciation-gl-heads-v2 applied successfully.';
GO
