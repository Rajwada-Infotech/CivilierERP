-- ============================================================
-- Migration 415: seeds the "Contra Assets" Account Group under ASSETS
-- (matches STATUTORY/CURRENT ASSETS/NON-CURRENT ASSETS/FIXED ASSETS —
-- the other direct children of the ASSETS root, AGId=2).
--
-- Deliberately empty for now — no GL heads are moved into it. The
-- Balance Sheet builder (backend/routes/financialStatements.js's
-- classifyAssetSection) has no "Contra Assets" bucket yet; a head like
-- "Accumulated Depreciation A/c" currently nets correctly against Fixed
-- Assets because it lives directly under the FIXED ASSETS group. Moving
-- it here without first teaching classifyAssetSection about this group
-- would silently fall through to the currentAssets fallback and
-- misclassify it on the Balance Sheet. That's a separate follow-up.
--
-- Safe to run multiple times.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM dbo.AccountGroup WHERE Name = 'Contra Assets' AND ParentGroupId = (SELECT AGId FROM dbo.AccountGroup WHERE Name = 'ASSETS' AND ParentGroupId IS NULL))
BEGIN
  INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
  SELECT 'Contra Assets', 'CTA', AGId, 1, 5, GETDATE()
  FROM dbo.AccountGroup WHERE Name = 'ASSETS' AND ParentGroupId IS NULL;
  PRINT 'Seeded AccountGroup: Contra Assets (under ASSETS)';
END
ELSE
  PRINT 'AccountGroup Contra Assets already exists';
GO

PRINT '415-contra-assets-group applied successfully.';
GO
