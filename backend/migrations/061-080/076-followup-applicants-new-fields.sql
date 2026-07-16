-- Migration 076: Add new fields to FollowupApplicants for Applications redesign
-- Adds: CustomerId, PanNumber, ApplicantAddress, CoApplicantName,
--       CoApplicantPhone, CorrespondenceAddress, ApplicationDate, UnitId

IF OBJECT_ID('dbo.FollowupApplicants', 'U') IS NOT NULL
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupApplicants') AND name = 'CustomerId'
)
  ALTER TABLE dbo.FollowupApplicants ADD CustomerId INT NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupApplicants') AND name = 'PanNumber'
)
  ALTER TABLE dbo.FollowupApplicants ADD PanNumber NVARCHAR(20) NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupApplicants') AND name = 'ApplicantAddress'
)
  ALTER TABLE dbo.FollowupApplicants ADD ApplicantAddress NVARCHAR(500) NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupApplicants') AND name = 'CoApplicantName'
)
  ALTER TABLE dbo.FollowupApplicants ADD CoApplicantName NVARCHAR(255) NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupApplicants') AND name = 'CoApplicantPhone'
)
  ALTER TABLE dbo.FollowupApplicants ADD CoApplicantPhone NVARCHAR(20) NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupApplicants') AND name = 'CorrespondenceAddress'
)
  ALTER TABLE dbo.FollowupApplicants ADD CorrespondenceAddress NVARCHAR(500) NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupApplicants') AND name = 'ApplicationDate'
)
  ALTER TABLE dbo.FollowupApplicants ADD ApplicationDate DATE NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupApplicants') AND name = 'UnitId'
)
  ALTER TABLE dbo.FollowupApplicants ADD UnitId INT NULL;

-- FK wrapped in EXEC to avoid Msg 207 batch-parse issue
IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FollowupApplicants_UnitMaster'
)
  EXEC('ALTER TABLE dbo.FollowupApplicants ADD CONSTRAINT FK_FollowupApplicants_UnitMaster FOREIGN KEY (UnitId) REFERENCES dbo.UnitMaster(Id)');

-- Index check uses sys.indexes directly (no EXEC needed, no column reference at parse time)
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.FollowupApplicants') AND name = 'IX_FollowupApplicants_UnitId'
)
  EXEC('CREATE INDEX IX_FollowupApplicants_UnitId ON dbo.FollowupApplicants(UnitId) WHERE UnitId IS NOT NULL');
END
ELSE
BEGIN
  PRINT 'FollowupApplicants not present; skipping legacy applicant field patch.';
END;
