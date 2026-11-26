-- Legal V2 phase 4: the legal review of a verification workspace, and the Deed Process stage.
--   LegalVerification.Status gains Verified / Returned.
--   LegalVerificationReview: every review decision, numbered, with the checklist and a frozen, hashed copy of the
--   activities and their entries as reviewed (never changed or deleted).
--   LegalLand.DeedStage / DeedDrafterId: where the deed drafting stands and who drafts it.

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalVerification_Status')
  ALTER TABLE dbo.LegalVerification DROP CONSTRAINT CK_LegalVerification_Status;
GO
ALTER TABLE dbo.LegalVerification ADD CONSTRAINT CK_LegalVerification_Status
  CHECK (Status IN (N'In Progress', N'Ready for Review', N'Returned', N'Verified', N'On Hold', N'Closed'));
GO

IF OBJECT_ID('dbo.LegalVerificationReview', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalVerificationReview (
    ReviewId       INT IDENTITY(1,1) CONSTRAINT PK_LegalVerificationReview PRIMARY KEY,
    VerificationId INT NOT NULL CONSTRAINT FK_LegalVerificationReview_Verification REFERENCES dbo.LegalVerification (VerificationId),
    VersionNo      INT NOT NULL,
    Decision       NVARCHAR(40) NOT NULL CONSTRAINT CK_LegalVerificationReview_Decision
                   CHECK (Decision IN (N'Verified', N'Returned for Correction', N'Additional Documents Required', N'Further Investigation Required', N'Reopened')),
    Remarks        NVARCHAR(2000) NULL,
    ChecklistJson  NVARCHAR(MAX) NULL,
    SnapshotJson   NVARCHAR(MAX) NULL,
    SnapshotHash   CHAR(64) NULL,
    ReviewedBy     INT NULL,
    ReviewedAt     DATETIME2 NOT NULL CONSTRAINT DF_LegalVerificationReview_At DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_LegalVerificationReview UNIQUE (VerificationId, VersionNo)
  );
END
GO

IF OBJECT_ID('dbo.TR_LegalVerificationReview_NoChange', 'TR') IS NULL
  EXEC (N'CREATE TRIGGER dbo.TR_LegalVerificationReview_NoChange ON dbo.LegalVerificationReview AFTER UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF CAST(SESSION_CONTEXT(N''legal_reset'') AS INT) = 1 RETURN;
  THROW 51000, ''A legal review cannot be changed or deleted'', 1;
END');
GO

IF COL_LENGTH('dbo.LegalLand', 'DeedStage') IS NULL
  ALTER TABLE dbo.LegalLand ADD DeedStage NVARCHAR(30) NULL, DeedDrafterId INT NULL;
GO
