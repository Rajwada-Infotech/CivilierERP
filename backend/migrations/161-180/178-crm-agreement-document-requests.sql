-- Customer document submission: extends the existing CrmAgreementDocument
-- table (rather than a parallel table) with the concept of a staff-side
-- REQUEST for a document, so the customer portal always knows exactly what
-- to upload, and staff always knows what came from the customer vs. was
-- attached in-house. Status now flows: Requested (no file yet, staff asked
-- for it) -> Submitted (customer uploaded) -> Verified / Rejected (staff
-- review) -- alongside the existing Staff-attached path which still starts
-- at 'Uploaded'.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreementDocument') AND name = 'UploadedByType')
BEGIN
  ALTER TABLE dbo.CrmAgreementDocument ADD UploadedByType NVARCHAR(20) NOT NULL CONSTRAINT DF_CrmAgreementDocument_UploadedByType DEFAULT 'Staff';
  PRINT 'Added CrmAgreementDocument.UploadedByType';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreementDocument') AND name = 'RequestedBy')
BEGIN
  ALTER TABLE dbo.CrmAgreementDocument ADD RequestedBy INT NULL REFERENCES dbo.Users(id);
  PRINT 'Added CrmAgreementDocument.RequestedBy';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreementDocument') AND name = 'RequestedAt')
BEGIN
  ALTER TABLE dbo.CrmAgreementDocument ADD RequestedAt DATETIME2(3) NULL;
  PRINT 'Added CrmAgreementDocument.RequestedAt';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreementDocument') AND name = 'Label')
BEGIN
  ALTER TABLE dbo.CrmAgreementDocument ADD Label NVARCHAR(200) NULL;
  PRINT 'Added CrmAgreementDocument.Label';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreementDocument') AND name = 'IsMandatory')
BEGIN
  ALTER TABLE dbo.CrmAgreementDocument ADD IsMandatory BIT NOT NULL CONSTRAINT DF_CrmAgreementDocument_IsMandatory DEFAULT 0;
  PRINT 'Added CrmAgreementDocument.IsMandatory';
END
GO
