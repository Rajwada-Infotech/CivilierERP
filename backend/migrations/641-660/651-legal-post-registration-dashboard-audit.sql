-- 651: Legal Phase 3. Schema only; safe to re-run.
--  • Post-registration compliance tasks per registered land (mutation, new Khatian / RoR, tax, records…).
--  • Government site evidence on a registry search: source URL, fetched / checked time, match with our records.
--  • Audit trail keeps the user's role and a related document reference.
IF OBJECT_ID('dbo.LegalPostRegTask', 'U') IS NULL
CREATE TABLE dbo.LegalPostRegTask (
  TaskId     INT IDENTITY(1,1) PRIMARY KEY,
  LandId     INT NOT NULL CONSTRAINT FK_LegalPostRegTask_Land REFERENCES dbo.LegalLand (LandId) ON DELETE CASCADE,
  TaskNo     INT NOT NULL,
  Task       NVARCHAR(100) NOT NULL,
  Status     NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalPostRegTask_Status DEFAULT N'Not Started',
  RefNo      NVARCHAR(100) NULL,
  DueDate    DATE NULL,
  Remarks    NVARCHAR(1000) NULL,
  FileId     INT NULL,
  UpdatedBy  INT NULL,
  UpdatedAt  DATETIME2 NULL,
  CONSTRAINT UQ_LegalPostRegTask UNIQUE (LandId, Task)
);
GO
IF COL_LENGTH('dbo.LegalRegistrySearch', 'SourceUrl') IS NULL ALTER TABLE dbo.LegalRegistrySearch ADD SourceUrl NVARCHAR(500) NULL;
IF COL_LENGTH('dbo.LegalRegistrySearch', 'CheckedAt') IS NULL ALTER TABLE dbo.LegalRegistrySearch ADD CheckedAt DATETIME2 NULL;
IF COL_LENGTH('dbo.LegalRegistrySearch', 'MatchResult') IS NULL ALTER TABLE dbo.LegalRegistrySearch ADD MatchResult NVARCHAR(40) NULL;
GO
IF COL_LENGTH('dbo.LegalRecordAudit', 'UserRole') IS NULL ALTER TABLE dbo.LegalRecordAudit ADD UserRole NVARCHAR(60) NULL;
IF COL_LENGTH('dbo.LegalRecordAudit', 'DocumentRef') IS NULL ALTER TABLE dbo.LegalRecordAudit ADD DocumentRef NVARCHAR(200) NULL;
