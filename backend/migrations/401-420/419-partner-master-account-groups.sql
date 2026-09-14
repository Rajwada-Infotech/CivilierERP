-- Migration 419: Account groups for the new Partner Master
--
-- Partner Master (backend/routes/partnerMaster.js) creates
-- dbo.AccountHeadMaster rows with LHeadType='P', tagged under one of two
-- account groups — neither existed in this chart of accounts yet:
--   - "Capital Account", directly under the LIABILITIES root (same
--     placement PARTNERS DRAWINGS already uses — see migration 361 — this
--     chart is partnership-style, not built around Share Capital).
--   - "Current Account", nested under the existing CURRENT ASSETS group.
-- Resolved by Name, not Code or AGId — both are confirmed inconsistent
-- across dev/production for these same root groups (see the long comment
-- at the top of backend/routes/financialStatements.js), Name is the only
-- field confirmed stable.

DECLARE @LiabilitiesRootId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Name = 'LIABILITIES' AND ParentGroupId IS NULL);
DECLARE @AdminUserId       INT = (SELECT TOP 1 id FROM dbo.users WHERE email = 'superadmin@civilier.com');

IF @LiabilitiesRootId IS NULL
BEGIN
  RAISERROR('LIABILITIES root AccountGroup not found', 16, 1);
  RETURN;
END
GO

DECLARE @LiabilitiesRootId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Name = 'LIABILITIES' AND ParentGroupId IS NULL);
DECLARE @AdminUserId       INT = (SELECT TOP 1 id FROM dbo.users WHERE email = 'superadmin@civilier.com');

IF NOT EXISTS (SELECT 1 FROM dbo.AccountGroup WHERE Name = 'Capital Account' AND ParentGroupId = @LiabilitiesRootId)
BEGIN
  INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
  VALUES ('Capital Account', 'CAPAC', @LiabilitiesRootId, 1, @AdminUserId, SYSDATETIME());
  PRINT 'Seeded AccountGroup: Capital Account (under LIABILITIES)';
END
GO

DECLARE @CurrentAssetsId INT = (
  SELECT g.AGId FROM dbo.AccountGroup g
  JOIN dbo.AccountGroup root ON root.AGId = g.ParentGroupId AND root.Name = 'ASSETS' AND root.ParentGroupId IS NULL
  WHERE g.Name = 'CURRENT ASSETS'
);
DECLARE @AdminUserId2 INT = (SELECT TOP 1 id FROM dbo.users WHERE email = 'superadmin@civilier.com');

IF @CurrentAssetsId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.AccountGroup WHERE Name = 'Current Account' AND ParentGroupId = @CurrentAssetsId)
BEGIN
  INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
  VALUES ('Current Account', 'CURAC', @CurrentAssetsId, 1, @AdminUserId2, SYSDATETIME());
  PRINT 'Seeded AccountGroup: Current Account (under CURRENT ASSETS)';
END
GO
