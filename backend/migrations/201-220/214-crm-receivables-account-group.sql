-- Migration 191: Trade Receivables / Sundry Debtors account group
--
-- This chart of accounts had a full Payables hierarchy (LIABILITIES > CURRENT
-- LIABILITIES > TRADE PAYABLES > SUNDRY CREDITORS, AGId 60) because this ERP's
-- only counterparties were suppliers/contractors — but no Receivables side at
-- all, because there was no customer-facing revenue module before CRM. Every
-- CRM customer ledger head (and CRM Collections A/c) would otherwise be
-- invisible in Trial Balance, which requires AccountHeadMaster.LBelongsTo
-- to be set to a real AccountGroup.
--
-- Mirrors the Payables hierarchy exactly: ASSETS(2) > CURRENT ASSETS(14) >
-- TRADE RECEIVABLES > SUNDRY DEBTORS.

DECLARE @AdminUserId INT = (SELECT TOP 1 CreatedBy FROM dbo.AccountGroup WHERE AGId = 53);

IF NOT EXISTS (SELECT 1 FROM dbo.AccountGroup WHERE Code = 'TR' AND ParentGroupId = 14)
BEGIN
  INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
  VALUES ('TRADE RECEIVABLES', 'TR', 14, 1, @AdminUserId, SYSDATETIME());
  PRINT 'Seeded AccountGroup: TRADE RECEIVABLES';
END
GO

DECLARE @TradeReceivablesId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Code = 'TR' AND ParentGroupId = 14);
DECLARE @AdminUserId2 INT = (SELECT TOP 1 CreatedBy FROM dbo.AccountGroup WHERE AGId = 53);

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
  SET LBelongsTo = 14
WHERE LHeadName = 'CRM Collections A/c' AND LHeadType = 'GL' AND LBelongsTo IS NULL;
PRINT 'Classified CRM Collections A/c under CURRENT ASSETS';
GO
