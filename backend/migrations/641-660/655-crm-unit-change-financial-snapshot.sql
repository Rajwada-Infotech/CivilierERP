-- Migration 655: preserve the commercial and money snapshot for each unit change.
-- These are audit values, not live balances: later receipt allocation or a
-- rebooking transfer must not rewrite what staff saw when the unit changed.

IF COL_LENGTH('dbo.CrmUnitChangeLog', 'OldProjectId') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD OldProjectId INT NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'NewProjectId') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD NewProjectId INT NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'OldCompanyId') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD OldCompanyId INT NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'NewCompanyId') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD NewCompanyId INT NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'OldAreaSqFt') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD OldAreaSqFt DECIMAL(18,2) NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'NewAreaSqFt') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD NewAreaSqFt DECIMAL(18,2) NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'OldRatePerSqFt') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD OldRatePerSqFt DECIMAL(18,4) NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'NewRatePerSqFt') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD NewRatePerSqFt DECIMAL(18,4) NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'OldTotalValue') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD OldTotalValue DECIMAL(18,2) NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'NewTotalValue') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD NewTotalValue DECIMAL(18,2) NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'OldGrandTotal') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD OldGrandTotal DECIMAL(18,2) NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'NewGrandTotal') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD NewGrandTotal DECIMAL(18,2) NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'OldBookingAmount') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD OldBookingAmount DECIMAL(18,2) NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'NewBookingAmount') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD NewBookingAmount DECIMAL(18,2) NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'OldPaymentPlanId') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD OldPaymentPlanId INT NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'NewPaymentPlanId') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD NewPaymentPlanId INT NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'ClearedAtChange') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD ClearedAtChange DECIMAL(18,2) NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'AvailableCreditAtChange') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD AvailableCreditAtChange DECIMAL(18,2) NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'HeldCreditAtChange') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD HeldCreditAtChange DECIMAL(18,2) NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'PendingFinanceAtChange') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD PendingFinanceAtChange DECIMAL(18,2) NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'PendingCrmReceiptAtChange') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD PendingCrmReceiptAtChange DECIMAL(18,2) NULL;
GO
IF COL_LENGTH('dbo.CrmUnitChangeLog', 'ContractualDueAtChange') IS NULL
  ALTER TABLE dbo.CrmUnitChangeLog ADD ContractualDueAtChange DECIMAL(18,2) NULL;
GO
