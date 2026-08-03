
-- Migration 191/214: Trade Receivables / Sundry Debtors account group
--
-- This chart of accounts had a full Payables hierarchy (LIABILITIES > CURRENT
-- LIABILITIES > TRADE PAYABLES > SUNDRY CREDITORS) because this ERP's only
-- counterparties were suppliers/contractors — but no Receivables side at
-- all, because there was no customer-facing revenue module before CRM. Every
-- CRM customer ledger head (and CRM Collections A/c) would otherwise be
-- invisible in Trial Balance, which requires AccountHeadMaster.LBelongsTo
-- to be set to a real AccountGroup.
--
-- Mirrors the Payables hierarchy exactly: ASSETS > CURRENT ASSETS >
-- TRADE RECEIVABLES > SUNDRY DEBTORS.
-- Depends on migration 213a (seeds the base ASSETS/CURRENT ASSETS groups).
-- Looks up groups by Code rather than hardcoded AGId, since AGId values
-- differ across environments depending on insert order.

DECLARE @CurrentAssetsId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Code = 'CA');
DECLARE @AdminUserId INT = (SELECT TOP 1 id FROM dbo.users WHERE email = 'superadmin@civilier.com');

IF @CurrentAssetsId IS NULL
BEGIN
  RAISERROR('CURRENT ASSETS account group (Code=CA) not found -- run migration 213a first', 16, 1);
  RETURN;
END

IF NOT EXISTS (SELECT 1 FROM dbo.AccountGroup WHERE Code = 'TR' AND ParentGroupId = @CurrentAssetsId)
BEGIN
  INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
  VALUES ('TRADE RECEIVABLES', 'TR', @CurrentAssetsId, 1, @AdminUserId, SYSDATETIME());
  PRINT 'Seeded AccountGroup: TRADE RECEIVABLES';
END
GO

DECLARE @TradeReceivablesId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Code = 'TR');
DECLARE @AdminUserId2 INT = (SELECT TOP 1 id FROM dbo.users WHERE email = 'superadmin@civilier.com');

IF NOT EXISTS (SELECT 1 FROM dbo.AccountGroup WHERE Code = 'SDS' AND ParentGroupId = @TradeReceivablesId)
BEGIN
  INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
  VALUES ('SUNDRY DEBTORS', 'SDS', @TradeReceivablesId, 1, @AdminUserId2, SYSDATETIME());
  PRINT 'Seeded AccountGroup: SUNDRY DEBTORS';
END
GO

-- Classify CRM Collections A/c under CURRENT ASSETS directly — same
-- pattern the pre-existing "Provisional Credit Available" GL clearing
-- account already uses (a cash-in-transit account, not deep-classified
-- further).
UPDATE dbo.AccountHeadMaster
  SET LBelongsTo = (SELECT AGId FROM dbo.AccountGroup WHERE Code = 'CA')
WHERE LHeadName = 'CRM Collections A/c' AND LHeadType = 'GL' AND LBelongsTo IS NULL;
PRINT 'Classified CRM Collections A/c under CURRENT ASSETS';
GO
