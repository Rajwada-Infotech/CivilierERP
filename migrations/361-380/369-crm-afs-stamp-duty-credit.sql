-- Migration 369: AFS stamp duty fields on CrmAgreement + StampDutyCredit on CrmSalesDeed.
-- In Maharashtra, AP, Telangana and several other states, stamp duty paid at
-- AFS registration (Sub-Registrar Visit 1) is creditable against the stamp
-- duty payable at Sale Deed registration (Sub-Registrar Visit 2). These fields
-- capture the AFS-side cost so the Sale Deed query payment module can show
-- the correct NET amount due rather than the gross.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmAgreement') AND name = 'AfsStampDuty'
)
BEGIN
  ALTER TABLE dbo.CrmAgreement ADD AfsStampDuty DECIMAL(18,2) NULL;
  PRINT 'Added AfsStampDuty to CrmAgreement';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmAgreement') AND name = 'AfsRegistrationFee'
)
BEGIN
  ALTER TABLE dbo.CrmAgreement ADD AfsRegistrationFee DECIMAL(18,2) NULL;
  PRINT 'Added AfsRegistrationFee to CrmAgreement';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'StampDutyCredit'
)
BEGIN
  ALTER TABLE dbo.CrmSalesDeed ADD StampDutyCredit DECIMAL(18,2) NULL;
  PRINT 'Added StampDutyCredit to CrmSalesDeed';
END
GO
