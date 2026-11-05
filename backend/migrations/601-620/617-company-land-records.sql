-- 617 · Company Land Record Management System
-- Adds AcquisitionType, VerificationStatus, and Two-Level Approvals (L1 & L2) to dbo.LegalLand.
SET NOCOUNT ON;
GO

IF COL_LENGTH(N'dbo.LegalLand', N'AcquisitionType') IS NULL
  ALTER TABLE dbo.LegalLand ADD AcquisitionType NVARCHAR(60) NULL;
GO

IF COL_LENGTH(N'dbo.LegalLand', N'VerificationStatus') IS NULL
  ALTER TABLE dbo.LegalLand ADD VerificationStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalLand_Verification DEFAULT N'Draft';
GO

IF COL_LENGTH(N'dbo.LegalLand', N'L1Status') IS NULL
  ALTER TABLE dbo.LegalLand ADD L1Status NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalLand_L1Status DEFAULT N'Pending';
GO

IF COL_LENGTH(N'dbo.LegalLand', N'L1ReviewerId') IS NULL
  ALTER TABLE dbo.LegalLand ADD L1ReviewerId INT NULL, L1ReviewedAt DATETIME2 NULL, L1Remarks NVARCHAR(1000) NULL;
GO

IF COL_LENGTH(N'dbo.LegalLand', N'L2Status') IS NULL
  ALTER TABLE dbo.LegalLand ADD L2Status NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalLand_L2Status DEFAULT N'Pending';
GO

IF COL_LENGTH(N'dbo.LegalLand', N'L2ApproverId') IS NULL
  ALTER TABLE dbo.LegalLand ADD L2ApproverId INT NULL, L2ApprovedAt DATETIME2 NULL, L2Remarks NVARCHAR(1000) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LegalLand_Search')
  CREATE INDEX IX_LegalLand_Search ON dbo.LegalLand (DistrictId, MouzaId, LandStatus, EntryType);
GO
