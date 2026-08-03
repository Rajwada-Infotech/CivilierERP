
-- Migration 213a: Seed base Chart of Accounts group hierarchy
-- This hierarchy (ASSETS/LIABILITIES top-level groups and their standard
-- sub-groups) existed only as manually-entered data in the original
-- production database and was never captured by any tracked migration or
-- seed script. When the DB is rebuilt from scratch via migrate.js,
-- dbo.AccountGroup ends up empty, breaking migration 214 (CRM Receivables)
-- and 230 (Trial Balance), both of which assume this hierarchy exists.
-- Idempotent: every insert guarded by IF NOT EXISTS on Name (the real
-- unique constraint is UQ_AccountGroup_Name_Parent). Codes below match
-- what already exists on production (verified 2026-08-03): ASSETS=A,
-- LIABILITIES=L, SUNDRY CREDITORS=SCS (SC is taken by SHARE CAPITAL).

DECLARE @AdminUserId INT = (SELECT TOP 1 id FROM dbo.users WHERE email = 'superadmin@civilier.com');
IF @AdminUserId IS NULL
BEGIN
  RAISERROR('superadmin@civilier.com not found in dbo.users -- aborting base AccountGroup seed', 16, 1);
  RETURN;
END

-- ASSETS
IF NOT EXISTS (SELECT 1 FROM dbo.AccountGroup WHERE Name = 'ASSETS' AND ParentGroupId IS NULL)
  INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
  VALUES ('ASSETS', 'A', NULL, 1, @AdminUserId, SYSDATETIME());

DECLARE @AssetsId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Name = 'ASSETS' AND ParentGroupId IS NULL);

IF NOT EXISTS (SELECT 1 FROM dbo.AccountGroup WHERE Name = 'CURRENT ASSETS' AND ParentGroupId = @AssetsId)
  INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
  VALUES ('CURRENT ASSETS', 'CA', @AssetsId, 1, @AdminUserId, SYSDATETIME());

-- LIABILITIES
IF NOT EXISTS (SELECT 1 FROM dbo.AccountGroup WHERE Name = 'LIABILITIES' AND ParentGroupId IS NULL)
  INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
  VALUES ('LIABILITIES', 'L', NULL, 1, @AdminUserId, SYSDATETIME());

DECLARE @LiabilitiesId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Name = 'LIABILITIES' AND ParentGroupId IS NULL);

IF NOT EXISTS (SELECT 1 FROM dbo.AccountGroup WHERE Name = 'CURRENT LIABILITIES' AND ParentGroupId = @LiabilitiesId)
  INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
  VALUES ('CURRENT LIABILITIES', 'CL', @LiabilitiesId, 1, @AdminUserId, SYSDATETIME());

DECLARE @CurrentLiabilitiesId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Name = 'CURRENT LIABILITIES' AND ParentGroupId = @LiabilitiesId);

IF NOT EXISTS (SELECT 1 FROM dbo.AccountGroup WHERE Name = 'TRADE PAYABLES' AND ParentGroupId = @CurrentLiabilitiesId)
  INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
  VALUES ('TRADE PAYABLES', 'TP', @CurrentLiabilitiesId, 1, @AdminUserId, SYSDATETIME());

DECLARE @TradePayablesId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Name = 'TRADE PAYABLES' AND ParentGroupId = @CurrentLiabilitiesId);

IF NOT EXISTS (SELECT 1 FROM dbo.AccountGroup WHERE Name = 'SUNDRY CREDITORS' AND ParentGroupId = @TradePayablesId)
  INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
  VALUES ('SUNDRY CREDITORS', 'SCS', @TradePayablesId, 1, @AdminUserId, SYSDATETIME());

PRINT '213a-seed-base-account-groups: done';
GO
