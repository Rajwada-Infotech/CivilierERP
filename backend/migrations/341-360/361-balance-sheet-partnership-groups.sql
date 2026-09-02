-- 361: Account groups needed for the partnership-style Balance Sheet
--
-- The Balance Sheet is fully account-group driven (see
-- backend/routes/financialStatements.js) — but two of the sections in the
-- new partnership layout have no group to pull from in this chart of
-- accounts at all:
--   - Partners' Drawings (this chart only ever had SHAREHOLDER'S FUNDS,
--     built for a company, not a partnership)
--   - Fictitious Assets / Deferred Revenue Expenditure
-- Both are seeded here so accountants can start tagging heads under them
-- immediately; until then the corresponding Balance Sheet section simply
-- shows ₹0, same as "Further Capital = ₹0 when none exists" per spec.
--
-- Resolved by Name, not Code or AGId — Code and AGId are both confirmed
-- inconsistent across dev/production for these same root groups (see the
-- long comment at the top of financialStatements.js), Name is the only
-- field confirmed stable.

DECLARE @LiabilitiesRootId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Name = 'LIABILITIES' AND ParentGroupId IS NULL);
DECLARE @AssetsRootId      INT = (SELECT AGId FROM dbo.AccountGroup WHERE Name = 'ASSETS' AND ParentGroupId IS NULL);
DECLARE @AdminUserId       INT = (SELECT TOP 1 id FROM dbo.users WHERE email = 'superadmin@civilier.com');

IF @LiabilitiesRootId IS NULL OR @AssetsRootId IS NULL
BEGIN
  RAISERROR('LIABILITIES / ASSETS root AccountGroup not found', 16, 1);
  RETURN;
END
GO

DECLARE @LiabilitiesRootId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Name = 'LIABILITIES' AND ParentGroupId IS NULL);
DECLARE @AdminUserId       INT = (SELECT TOP 1 id FROM dbo.users WHERE email = 'superadmin@civilier.com');

IF NOT EXISTS (SELECT 1 FROM dbo.AccountGroup WHERE Name = 'PARTNERS DRAWINGS' AND ParentGroupId = @LiabilitiesRootId)
BEGIN
  INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
  VALUES ('PARTNERS DRAWINGS', 'PDRW', @LiabilitiesRootId, 1, @AdminUserId, SYSDATETIME());
  PRINT 'Seeded AccountGroup: PARTNERS DRAWINGS';
END
GO

-- Nested under NON-CURRENT ASSETS (the existing "Fixed Assets" parent
-- group) — Fictitious Assets sit alongside Fixed Assets / Investments in
-- the classic vertical format, and this chart already has that parent.
DECLARE @NonCurrentAssetsId INT = (
  SELECT g.AGId FROM dbo.AccountGroup g
  JOIN dbo.AccountGroup root ON root.AGId = g.ParentGroupId AND root.Name = 'ASSETS' AND root.ParentGroupId IS NULL
  WHERE g.Name = 'NON-CURRENT ASSETS'
);
DECLARE @AdminUserId2 INT = (SELECT TOP 1 id FROM dbo.users WHERE email = 'superadmin@civilier.com');

IF @NonCurrentAssetsId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.AccountGroup WHERE Name = 'FICTITIOUS ASSETS' AND ParentGroupId = @NonCurrentAssetsId)
BEGIN
  INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
  VALUES ('FICTITIOUS ASSETS', 'FICA', @NonCurrentAssetsId, 1, @AdminUserId2, SYSDATETIME());
  PRINT 'Seeded AccountGroup: FICTITIOUS ASSETS';
END
GO
