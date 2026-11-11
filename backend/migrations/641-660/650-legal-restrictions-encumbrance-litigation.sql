-- 650: Legal due diligence Phase 2. Schema only; safe to re-run.
--  • Special / restricted property checks (Waqf, Debottar, religious trust, ST land, vested land, ceiling, acquisition
--    notification, other restricted transfer) — processing waits until the needed permission is recorded.
--  • Encumbrance: encumbrance certificate, attachment order and verification date on Loan & Mortgage.
--  • Litigation: stay order / injunction on Court Case, and a legal officer's clearance of a case.
IF OBJECT_ID('dbo.LegalPropertyRestriction', 'U') IS NULL
CREATE TABLE dbo.LegalPropertyRestriction (
  RestrictionId      INT IDENTITY(1,1) PRIMARY KEY,
  LandId             INT NOT NULL CONSTRAINT FK_LegalPropertyRestriction_Land REFERENCES dbo.LegalLand (LandId) ON DELETE CASCADE,
  Category           NVARCHAR(60) NOT NULL,
  RestrictionType    NVARCHAR(200) NULL,
  ApplicableLaw      NVARCHAR(300) NULL,
  PermissionRequired NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalPropertyRestriction_Perm DEFAULT N'To Be Determined',
  PermissionFileId   INT NULL,
  PermissionRef      NVARCHAR(100) NULL,
  IssuingAuthority   NVARCHAR(200) NULL,
  Status             NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalPropertyRestriction_Status DEFAULT N'Pending',
  Remarks            NVARCHAR(1000) NULL,
  IsActive           BIT NOT NULL CONSTRAINT DF_LegalPropertyRestriction_Active DEFAULT 1,
  CreatedBy          INT NULL,
  CreatedAt          DATETIME2 NOT NULL CONSTRAINT DF_LegalPropertyRestriction_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedBy          INT NULL,
  UpdatedAt          DATETIME2 NULL
);
GO
IF COL_LENGTH('dbo.LegalMortgage', 'EncumbranceCertFileId') IS NULL ALTER TABLE dbo.LegalMortgage ADD EncumbranceCertFileId INT NULL;
IF COL_LENGTH('dbo.LegalMortgage', 'EncumbranceCertDate') IS NULL ALTER TABLE dbo.LegalMortgage ADD EncumbranceCertDate DATE NULL;
IF COL_LENGTH('dbo.LegalMortgage', 'AttachmentOrder') IS NULL ALTER TABLE dbo.LegalMortgage ADD AttachmentOrder NVARCHAR(40) NULL;
IF COL_LENGTH('dbo.LegalMortgage', 'CheckedOn') IS NULL ALTER TABLE dbo.LegalMortgage ADD CheckedOn DATE NULL;
IF COL_LENGTH('dbo.LegalMortgage', 'CheckRemarks') IS NULL ALTER TABLE dbo.LegalMortgage ADD CheckRemarks NVARCHAR(1000) NULL;
GO
IF COL_LENGTH('dbo.LegalCase', 'StayType') IS NULL ALTER TABLE dbo.LegalCase ADD StayType NVARCHAR(40) NULL;
IF COL_LENGTH('dbo.LegalCase', 'StayDetails') IS NULL ALTER TABLE dbo.LegalCase ADD StayDetails NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.LegalCase', 'LawyerRemarks') IS NULL ALTER TABLE dbo.LegalCase ADD LawyerRemarks NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.LegalCase', 'ClearedBy') IS NULL ALTER TABLE dbo.LegalCase ADD ClearedBy INT NULL;
IF COL_LENGTH('dbo.LegalCase', 'ClearedAt') IS NULL ALTER TABLE dbo.LegalCase ADD ClearedAt DATETIME2 NULL;
IF COL_LENGTH('dbo.LegalCase', 'ClearRemarks') IS NULL ALTER TABLE dbo.LegalCase ADD ClearRemarks NVARCHAR(1000) NULL;
