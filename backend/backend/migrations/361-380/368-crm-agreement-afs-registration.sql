-- Migration 368: Add AFS registration fields to CrmAgreement.
-- The Agreement for Sale (AFS) is registered at the Sub-Registrar Office
-- independently of the Sale Deed — earlier in the process, with its own
-- Doc No and date. These fields track that specific registration event.
-- Previously the system had no way to record *when* or *under what number*
-- the AFS was actually registered, which caused the mark-registered gate to
-- rely on the Sale Deed's RegistrationNo instead (a logical error fixed in
-- the accompanying backend change).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmAgreement') AND name = 'AfsRegistrationNo'
)
BEGIN
  ALTER TABLE dbo.CrmAgreement ADD AfsRegistrationNo NVARCHAR(100) NULL;
  PRINT 'Added AfsRegistrationNo to CrmAgreement';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmAgreement') AND name = 'AfsRegistrationDate'
)
BEGIN
  ALTER TABLE dbo.CrmAgreement ADD AfsRegistrationDate DATE NULL;
  PRINT 'Added AfsRegistrationDate to CrmAgreement';
END
GO
